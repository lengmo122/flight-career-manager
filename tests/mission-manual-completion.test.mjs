import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function readFunction(name) {
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

const completions = [];
const messages = [];
const requests = [];
const backups = [];
const aircraft = {
  id: "fleet-c172",
  lastLandingAirport: "ZSPD",
  lastLandingRateFpm: 180,
  lastLandingPeakG: 1.18,
  lastLandingWearPercent: 0.2,
  lastLandingRunway: "35L",
  lastLandingReportAt: Date.now()
};
const mission = {
  id: "mission-1",
  title: "ZBAA -> ZSPD",
  origin: "ZBAA",
  destination: "ZSPD",
  duration: 2,
  status: "accepted",
  verification: {
    departureAirport: "ZBAA",
    flightDistanceNm: 620,
    fuelStartKg: 1200,
    fuelUsedKg: 350,
    departedAt: Date.now() - 3600000
  }
};

const context = {
  state: { missions: [mission] },
  endingMissionIds: new Set(),
  lastTelemetryConnected: true,
  lastTelemetry: { onGround: false, fuelWeightKg: 850 },
  missionAircraft: () => aircraft,
  telemetryBoolean: (value) => value === true,
  telemetryAirport: () => ({ airport: { icao: "ZSPD" } }),
  telemetryFuelKg: (sample) => sample.fuelWeightKg,
  normalizeBaseCode: (value) => String(value || "").trim().toUpperCase(),
  showConfirmDialog: async () => true,
  writeBackup: (reason) => backups.push(reason),
  fetch: async (url, options) => { requests.push([url, options?.method]); return { ok: true }; },
  completeMission: (id, actual) => completions.push({ id, actual }),
  toast: (message) => messages.push(message)
};
vm.runInNewContext([
  readFunction("manualCompleteMission"),
  "globalThis.manualCompleteMission = manualCompleteMission;"
].join("\n"), context);

await context.manualCompleteMission(mission.id);
assert.equal(completions.length, 0, "Manual completion must be blocked while telemetry explicitly reports airborne");
assert.match(messages.at(-1), /仍在空中/);

context.lastTelemetry.onGround = true;
await context.manualCompleteMission(mission.id);
assert.equal(completions.length, 1, "An accepted mission may be manually completed after landing");
assert.equal(completions[0].actual.manualCompletion, true);
assert.equal(completions[0].actual.rewardEligible, true);
assert.equal(completions[0].actual.departureAirport, "ZBAA");
assert.equal(completions[0].actual.arrivalAirport, "ZSPD");
assert.equal(completions[0].actual.miles, 620);
assert.equal(completions[0].actual.fuelUsedKg, 350);
assert.equal(completions[0].actual.landingRateFpm, 180);
assert.equal(backups.length, 1, "A backup must be written before manual settlement");
assert.deepEqual(requests, [
  ["/api/simulator/scene", "DELETE"],
  ["/api/simulator/flight-plan", "DELETE"]
]);
assert.equal(context.endingMissionIds.size, 0, "The completion lock must be released");

assert.match(source, /data-action="manual-complete-mission"[\s\S]{0,160}手动完成/,
  "Accepted mission cards must expose the manual completion control");
assert.match(source, /mission\.manualCompleted = manualCompletion/,
  "Mission history must retain how the settlement was triggered");

console.log("Mission manual completion: landing guard, confirmation, telemetry settlement and cleanup passed");
