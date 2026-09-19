import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryRoot = await mkdtemp(join(tmpdir(), "fcm-simulator-lifecycle-"));
const telemetryDirectory = join(temporaryRoot, "SkylineVA", "msfs2024-telemetry-v2");
process.env.LOCALAPPDATA = temporaryRoot;
process.env.FLIGHT_MANAGER_TELEMETRY_EXE = process.execPath;

await mkdir(telemetryDirectory, { recursive: true });
await writeFile(join(telemetryDirectory, "telemetry.ndjson"), `${JSON.stringify({
  timestamp: new Date().toISOString(),
  latitude: 31.1443,
  longitude: 121.8083,
  onGround: true
})}\n`, "utf8");

const { startServer } = await import(`../server.mjs?simulator-lifecycle=${Date.now()}`);
const { server, port } = await startServer(0);

try {
  const startResponse = await fetch(`http://127.0.0.1:${port}/api/simulator/start`, { method: "POST" });
  const startResult = await startResponse.json();
  assert.equal(startResponse.status, 200);
  assert.equal(startResult.started, false);
  assert.equal(startResult.reason, "already-connected", "Fresh telemetry must be reused without spawning another helper");

  const routeResponse = await fetch(`http://127.0.0.1:${port}/api/simulator/flight-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      missionId: "mission-safe-route",
      origin: { icao: "ZSPD", name: "Shanghai Pudong", lat: 31.1443, lon: 121.8083, type: "Airport" },
      target: { icao: "TASK", name: "Mission Site", lat: 31.01, lon: 121.7, type: "UserWaypoint" },
      returnPoint: { icao: "ZSPD", name: "Shanghai Pudong", lat: 31.1443, lon: 121.8083, type: "Airport" }
    })
  });
  const routeResult = await routeResponse.json();
  assert.equal(routeResponse.status, 200);
  assert.equal(routeResult.state, "prepared");
  assert.equal(routeResult.bridgeRunning, false, "Preparing a route must not attach another SimConnect client");

  const plan = await readFile(routeResult.planPath, "utf8");
  assert.match(plan, /<ATCWaypointType>User<\/ATCWaypointType>/);
  assert.match(plan, /<ICAOIdent>ZSPD<\/ICAOIdent>/);

  const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const telemetrySource = await readFile(new URL("../tools/msfs-telemetry-source/Program.cs", import.meta.url), "utf8");
  assert.doesNotMatch(serverSource, /taskkill/i, "Connecting must never force-kill a bridge process");
  assert.doesNotMatch(serverSource, /(?:telemetryBridge|sceneBridge|flightPlanBridge|child)\.kill\(/,
    "Bridge shutdown must not terminate a SimConnect client abruptly");
  assert.match(serverSource, /`telemetry-stop-\$\{randomUUID\(\)\}\.signal`/,
    "Each telemetry bridge must use an isolated graceful stop signal");
  assert.match(serverSource, /telemetryBridge\.fcmStopPath = telemetryStopPath/,
    "The server must only stop the telemetry bridge it owns");
  assert.match(telemetrySource, /new Semaphore\(1, 1, "Local\\\\FlightCareerManager\.MsfsTelemetry\.V2"\)/,
    "The async telemetry helper must use a thread-independent single-instance gate");
  assert.doesNotMatch(telemetrySource, /ReleaseMutex\(/,
    "Telemetry shutdown must not release a mutex from a different async continuation thread");
  assert.match(serverSource, /--data-dir/, "The current bridge must use its isolated telemetry directory");
  assert.match(serverSource, /waitForBridgeExit/, "Bridge shutdown must wait for child exit");
  assert.doesNotMatch(serverSource, /spawn\(executable, \[planPath, flightPlanStatusPath\]/, "Routes must not be injected with SimConnect_FlightPlanLoad");
  const desktopSource = await readFile(new URL("../electron-main.mjs", import.meta.url), "utf8");
  const packageSource = await readFile(new URL("../tools/package-fast.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(desktopSource, /FLIGHT_MANAGER_ROUTE_EXE/);
  assert.match(desktopSource, /shutdownBridges/, "Desktop quit must await all bridge cleanup");
  assert.doesNotMatch(packageSource, /msfs-route-bridge/, "The retired route injector must not ship in the desktop package");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("Simulator lifecycle: safe telemetry reuse and non-injected route generation passed");
