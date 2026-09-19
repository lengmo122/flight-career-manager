import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction >= 0 ? nextFunction : source.length).trim();
}

const context = {
  FUEL_PRICE_PER_KG: 1.35,
  telemetryBoolean: (value) => value === true,
  telemetryFuelKg: (sample) => Number.isFinite(Number(sample?.fuelKg)) ? Number(sample.fuelKg) : null,
  normalizeBaseCode: (value) => String(value || "").trim().toUpperCase(),
  telemetryAirport: (sample) => sample?.airport ? { airport: { icao: sample.airport } } : null,
  distanceNm: (from, to) => Math.abs(Number(to.lon) - Number(from.lon)) * 60,
  activeVerifiedMission: () => context.state.missions.find((mission) => mission.status === "accepted") || null,
  cryptoId: () => "actual-log-1",
  missionAircraft: () => context.aircraft,
  rand: () => 1,
  missionScene: () => ({ objectTitle: "" }),
  recordTaskEvent: () => true,
  formatMoney: (value) => String(value),
  formatFuel: (value) => String(value),
  isPackagedScene: () => false,
  toast: () => {},
  sopRewardMultiplier: (enabled, score) => enabled ? (Number(score) >= 100 ? 1.3 : Math.max(0, Number(score) || 0) / 100) : 1,
  recordFundTransaction: ({ amount }) => { context.state.cash += amount; },
  maybeAutoUnlockAircraft: () => {},
  maybeAutoCreateMission: () => {},
  renderAll: () => {}
};

vm.runInNewContext([
  readFunction("emptySimulatorFlight"),
  readFunction("normalizeSimulatorFlight"),
  readFunction("telemetryEventTime"),
  readFunction("accumulateFlightDistance"),
  readFunction("simulatorFlightMission"),
  readFunction("updateSimulatorFlight"),
  readFunction("buildLandingSopSnapshot"),
  readFunction("finalizeSimulatorFlight"),
  readFunction("completeMission"),
  "globalThis.emptySimulatorFlight = emptySimulatorFlight; globalThis.updateSimulatorFlight = updateSimulatorFlight; globalThis.finalizeSimulatorFlight = finalizeSimulatorFlight; globalThis.completeMission = completeMission;"
].join("\n"), context);

context.aircraft = { id: "c172", name: "Cessna 172", rented: false, lastFuelKg: 92 };
const mission = {
  id: "mission-1",
  title: "ZBAA → ZSPD",
  origin: "ZBAA",
  destination: "ZSPD",
  status: "accepted",
  duration: 1,
  distance: 100,
  payout: 5000,
  repGain: 3,
  category: "客运",
  verification: {
    aircraftId: "c172",
    phase: "outbound",
    departureAirport: "ZBAA",
    fuelStartKg: 100,
    fuelCurrentKg: 92,
    fuelUsedKg: 8
  }
};
context.state = {
  simulatorFlight: context.emptySimulatorFlight(),
  missions: [mission],
  logs: [],
  cash: 1000,
  reputation: 0,
  stats: {
    totalHours: 0,
    totalMiles: 0,
    totalLandings: 0,
    completedMissions: 0,
    totalFuelKg: 0,
    totalFuelCost: 0
  }
};

context.updateSimulatorFlight({ timestamp: "2026-08-21T08:00:00Z", onGround: true, airport: "ZBAA", latitude: 0, longitude: 0, fuelKg: 100 }, context.aircraft);
context.updateSimulatorFlight({ timestamp: "2026-08-21T08:01:00Z", onGround: false, latitude: 0, longitude: 0, fuelKg: 100, groundSpeedKt: 120 }, context.aircraft);
assert.equal(context.state.simulatorFlight.active, true);
assert.equal(context.state.simulatorFlight.origin, "ZBAA");
assert.equal(context.state.simulatorFlight.missionId, "mission-1");

context.updateSimulatorFlight({ timestamp: "2026-08-21T08:02:00Z", onGround: false, latitude: 0, longitude: 0.016, fuelKg: 95, groundSpeedKt: 120 }, context.aircraft);
context.updateSimulatorFlight({ timestamp: "2026-08-21T08:11:00Z", onGround: true, airport: "ZSPD", latitude: 0, longitude: 0.016, fuelKg: 92, groundSpeedKt: 0 }, context.aircraft);
assert.ok(context.state.simulatorFlight.distanceNm > 0.9, "Actual route distance should accumulate from telemetry");
assert.equal(context.state.simulatorFlight.fuelUsedKg, 8);

const landing = { timestamp: "2026-08-21T08:11:00Z", airport: "ZSPD", runway: "35L" };
const wear = { aircraft: context.aircraft, landingRateFpm: 210, peakG: 1.28, wearPercent: 2 };
const log = context.finalizeSimulatorFlight(wear, landing, { airport: "ZSPD" });
assert.equal(context.state.logs.length, 1);
assert.equal(log.source, "msfs");
assert.equal(log.from, "ZBAA");
assert.equal(log.to, "ZSPD");
assert.equal(log.fuelUsedKg, 8);
assert.equal(log.landingRateFpm, 210);
assert.equal(log.landingRunway, "35L");
log.airportCheck = "failed";
assert.equal(context.state.stats.totalLandings, 1);
assert.equal(context.finalizeSimulatorFlight(wear, landing, { airport: "ZSPD" }), null, "The same completed leg must not be logged twice");

const actualStats = { ...context.state.stats };
context.completeMission("mission-1", {
  hours: 0.17,
  miles: 1,
  fuelUsedKg: 8,
  fuelStartKg: 100,
  fuelEndKg: 92,
  departureAirport: "ZBAA",
  arrivalAirport: "ZSPD"
});
assert.equal(context.state.logs.length, 1, "Mission settlement must merge into the matching actual MSFS log");
assert.equal(context.state.logs[0].taskTitle, "ZBAA → ZSPD");
assert.equal(context.state.logs[0].income, 4989);
assert.equal(context.state.logs[0].airportCheck, "passed", "Final mission validation must correct a premature failed airport check");
assert.ok(context.state.logs[0].settledAt);
assert.equal(context.state.stats.totalHours, actualStats.totalHours, "Actual hours must not be counted twice");
assert.equal(context.state.stats.totalMiles, actualStats.totalMiles, "Actual distance must not be counted twice");
assert.equal(context.state.stats.totalLandings, actualStats.totalLandings, "Actual landing must not be counted twice");
assert.equal(context.state.stats.completedMissions, 1);

assert.match(source, /els\.recentLogs\.innerHTML = logs\.slice\(0, 3\)\.map\(renderLogCard\)/, "Dashboard recent logs must use the same actual flight log collection");
assert.match(source, /MSFS 实际/, "Actual MSFS records must be visibly identified");

console.log("MSFS flight log: telemetry, fuel, landing, task merge, dedupe and dashboard cases passed");
