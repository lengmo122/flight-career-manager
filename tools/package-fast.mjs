import { access, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageInfo = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = packageInfo.version;
const stage = join(root, ".fast-package-stage");
const output = join(root, process.env.FCM_FAST_OUTPUT || `release-fast-${version}`);
const electronInfo = JSON.parse(await readFile(join(root, "node_modules", "electron", "package.json"), "utf8"));
const zipName = `electron-v${electronInfo.version}-win32-x64.zip`;
const cacheRoot = join(process.env.LOCALAPPDATA || join(process.env.USERPROFILE, "AppData", "Local"), "electron", "Cache");

async function findInstalledPackage(name) {
  const direct = join(root, "node_modules", name);
  try {
    return await realpath(direct);
  } catch {
    const store = join(root, "node_modules", ".pnpm");
    const encodedName = name.startsWith("@") ? name.slice(1).replace("/", "+") : name;
    const entries = await readdir(store, { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(`${encodedName}@`));
    if (!match) throw new Error(`未找到依赖：${name}`);
    return realpath(join(store, match.name, "node_modules", name));
  }
}

async function findElectronZipDir() {
  const entries = await readdir(cacheRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(cacheRoot, entry.name, zipName);
    try {
      await access(candidate);
      return join(cacheRoot, entry.name);
    } catch {
      // Keep looking through the local Electron cache.
    }
  }
  throw new Error(`未找到本地 Electron 运行时缓存：${zipName}`);
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const runtimeDependencyNames = ["node-edge-tts", "ws", "https-proxy-agent", "agent-base", "debug", "ms"];
const runtimeDependencyRoots = new Map();
const runtimeDependencies = {};
for (const dependency of runtimeDependencyNames) {
  const dependencyRoot = await findInstalledPackage(dependency);
  runtimeDependencyRoots.set(dependency, dependencyRoot);
  const dependencyInfo = JSON.parse(await readFile(join(dependencyRoot, "package.json"), "utf8"));
  runtimeDependencies[dependency] = dependencyInfo.version;
}

const appFiles = [
  "index.html",
  "styles.css",
  "terrain.js",
  "server.mjs",
  "panel-agent.mjs",
  "panel-discovery.mjs",
  "panel-native.mjs",
  "panel-service.mjs",
  "electron-main.mjs",
  "preload.cjs",
  "package.json"
];
await Promise.all(appFiles.map((file) => cp(join(root, file), join(stage, file))));
await cp(join(root, "assets"), join(stage, "assets"), { recursive: true });
await cp(join(root, "src"), join(stage, "src"), { recursive: true });
await writeFile(join(stage, "package.json"), JSON.stringify({
  name: "flight-career-manager",
  productName: "模飞生涯",
  version,
  main: "electron-main.mjs",
  type: "module",
  dependencies: runtimeDependencies
}, null, 2));
const edgeTtsStage = join(stage, "node_modules", "node-edge-tts");
await cp(join(runtimeDependencyRoots.get("node-edge-tts"), "dist"), join(edgeTtsStage, "dist"), { recursive: true });
await writeFile(join(edgeTtsStage, "package.json"), JSON.stringify({
  name: "node-edge-tts",
  version: "1.2.10",
  main: "dist/edge-tts.js"
}, null, 2));
for (const dependency of runtimeDependencyNames.slice(1)) {
  await cp(runtimeDependencyRoots.get(dependency), join(stage, "node_modules", dependency), { recursive: true });
}

const electronZipDir = await findElectronZipDir();
const [packageDir] = await packager({
  dir: stage,
  out: output,
  name: "模飞生涯",
  icon: join(stage, "assets", "app-icon.ico"),
  appVersion: version,
  platform: "win32",
  arch: "x64",
  asar: true,
  overwrite: true,
  electronZipDir
});

await cp(join(root, "tools", "msfs-telemetry"), join(packageDir, "resources", "telemetry"), { recursive: true });
await cp(join(root, "tools", "msfs-scene-bridge"), join(packageDir, "resources", "scene-bridge"), { recursive: true });
await mkdir(join(packageDir, "resources", "panel-capture"), { recursive: true });
for (const file of ["MofeiCapture.dll", "MofeiCaptureHost.exe", "MinHook-LICENSE.txt"]) {
  await cp(join(root, "tools", "panel-capture", file), join(packageDir, "resources", "panel-capture", file));
}
await rm(stage, { recursive: true, force: true });

console.log(`快速打包完成：${packageDir}`);
