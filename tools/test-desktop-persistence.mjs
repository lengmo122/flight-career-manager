import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const electron = join(root, "node_modules", "electron", "dist", "electron.exe");
const applicationExecutable = process.argv[2] ? resolve(process.argv[2]) : electron;
const launchesSourceDirectory = applicationExecutable === electron;
const userData = await mkdtemp(join(tmpdir(), "flight-career-persistence-"));

async function waitForPage(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.url.startsWith("http://127.0.0.1:"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron has not opened the renderer yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Electron renderer did not start on debugging port ${port}`);
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP evaluation timed out"));
    }, 15_000);
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    }, { once: true });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.error || message.result.exceptionDetails)));
        return;
      }
      resolve(message.result?.result?.value);
    });
  });
}

async function launch(debugPort) {
  const child = spawn(applicationExecutable, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userData}`,
    ...(launchesSourceDirectory ? [root] : [])
  ], {
    cwd: root,
    env: { ...process.env, FLIGHT_MANAGER_PERSISTENCE_TEST: "1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
  child.completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, diagnostics }));
  });
  const page = await waitForPage(debugPort);
  const readyDeadline = Date.now() + 20_000;
  while (Date.now() < readyDeadline) {
    const ready = await evaluate(page.webSocketDebuggerUrl, `typeof window.state === "object"
      && typeof window.saveState === "function"
      && document.readyState === "complete"
      && document.body.dataset.appReady === "true"`);
    if (ready) return { child, page };
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Flight Career application did not finish initialization");
}

async function close(run) {
  try {
    await evaluate(run.page.webSocketDebuggerUrl, "window.close(); true");
  } catch {
    // The explicit process-tree fallback below handles a renderer that is already gone.
  }
  const result = await Promise.race([
    run.child.completion,
    new Promise((resolve) => setTimeout(() => resolve(null), 5_000))
  ]);
  if (!result) {
    const killer = spawn("taskkill", ["/PID", String(run.child.pid), "/T", "/F"], { stdio: "ignore" });
    await new Promise((resolve) => killer.once("exit", resolve));
  }
}

try {
  const first = await launch(9347);
  const firstPort = new URL(first.page.url).port;
  const saved = await evaluate(first.page.webSocketDebuggerUrl, `(async () => {
    window.state.pilot.name = "6063";
    window.state.pilot.base = "ZSPD";
    window.state.pilot.loggedIn = true;
    window.state.pilot.hasCompletedLogin = true;
    await window.saveState();
    return {
      api: Object.keys(window.desktopApp || {}),
      storageError: saveStorageError ? String(saveStorageError.message || saveStorageError) : ""
    };
  })()`);
  assert.deepEqual(saved.api.sort(), ["readPersistentStorage", "setWindowMode", "writePersistentStorage"]);
  assert.equal(saved.storageError, "", `desktop write failed: ${saved.storageError}`);
  await close(first);

  const storage = JSON.parse(await readFile(join(userData, "career-storage.json"), "utf8"));
  const envelope = JSON.parse(storage["flight-career-manager-v1"]);
  assert.equal(envelope.format, "flight-career-save-aes-gcm-v1");
  assert.equal(envelope.algorithm, "AES-GCM");
  assert.equal(Object.hasOwn(envelope, "pilot"), false, "desktop file must not contain plaintext career data");

  const second = await launch(9348);
  const secondPort = new URL(second.page.url).port;
  const restored = await evaluate(second.page.webSocketDebuggerUrl, `({
    authOnly: document.body.classList.contains("auth-only"),
    appHidden: document.getElementById("appShell").hidden,
    name: window.state.pilot.name,
    base: window.state.pilot.base,
    completed: window.state.pilot.hasCompletedLogin
  })`);
  await close(second);

  assert.notEqual(firstPort, secondPort, "test requires two different random application ports");
  assert.deepEqual(restored, {
    authOnly: false,
    appHidden: false,
    name: "6063",
    base: "ZSPD",
    completed: true
  });
  console.log(`Desktop restart persistence passed across ports ${firstPort} and ${secondPort}`);
} finally {
  await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
