import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [appSource, serverSource] = await Promise.all([
  readAppSource(),
  readFile(new URL("../server.mjs", import.meta.url), "utf8")
]);

function readFunction(source, name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} source was incomplete`);
}

let requestCount = 0;
const context = {
  simulatorStartPromise: null,
  nextSimulatorAutoConnectAt: 0,
  simulatorAutoConnectFailures: 0,
  fetch: async () => {
    requestCount += 1;
    await Promise.resolve();
    return { ok: true, json: async () => ({ started: true }) };
  },
  Date,
  Error,
  Math
};

vm.runInNewContext([
  readFunction(appSource, "requestSimulatorBridgeStart"),
  readFunction(appSource, "ensureSimulatorAutoConnection"),
  "globalThis.ensureSimulatorAutoConnection = ensureSimulatorAutoConnection;"
].join("\n"), context);

const concurrent = await Promise.all([
  context.ensureSimulatorAutoConnection(null),
  context.ensureSimulatorAutoConnection(null)
]);
assert.equal(requestCount, 1, "Concurrent status polls must share one bridge start request");
assert.equal(concurrent.filter(Boolean).length, 1, "Only the poll that starts the bridge should report success");

context.nextSimulatorAutoConnectAt = 0;
await context.ensureSimulatorAutoConnection({ connected: false, bridgeRunning: true });
assert.equal(requestCount, 1, "A bridge already waiting for MSFS must never be restarted");

context.nextSimulatorAutoConnectAt = 0;
context.fetch = async () => {
  requestCount += 1;
  throw new Error("temporary failure");
};
const beforeFailure = Date.now();
assert.equal(await context.ensureSimulatorAutoConnection(null), false);
assert.equal(context.simulatorAutoConnectFailures, 1);
assert.ok(context.nextSimulatorAutoConnectAt >= beforeFailure + 20_000, "Failures must use a retry backoff");

const startBridgeSource = readFunction(serverSource, "startTelemetryBridge");
const startBridgeOnceSource = readFunction(serverSource, "startTelemetryBridgeOnce");
assert.match(startBridgeOnceSource, /telemetryBridgeIsRunning\(\)[\s\S]*?reason: "already-running"/,
  "The server must reuse its active telemetry bridge");
assert.ok(startBridgeOnceSource.indexOf("already-running") < startBridgeOnceSource.indexOf("telemetry-stop-${randomUUID()}"),
  "An active bridge must be returned before any graceful-stop signal is written");
assert.match(startBridgeSource, /if \(telemetryStartPromise\) return telemetryStartPromise/,
  "Concurrent server requests must share one telemetry startup");
assert.match(startBridgeSource, /startTelemetryBridgeOnce\(\)[\s\S]*?finally/,
  "The server startup lock must be released after completion");
assert.match(serverSource, /const telemetryFreshnessMs = 8_000/,
  "Brief SimConnect sampling pauses must not flicker the connection state");
assert.match(appSource, /pollSimulator\([\s\S]*?ensureSimulatorAutoConnection\(payload\)/,
  "Normal simulator polling must activate automatic connection");

console.log("Simulator auto-connect: single-flight startup, bridge reuse and retry backoff passed");
