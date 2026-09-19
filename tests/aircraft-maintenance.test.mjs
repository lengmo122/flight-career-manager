import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
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

const context = {};
vm.runInNewContext([
  readFunction("aircraftCondition"),
  readFunction("aircraftMaintenanceCost"),
  readFunction("aircraftConditionLevel"),
  readFunction("landingWearPercent"),
  readFunction("applyLandingWear"),
  "globalThis.aircraftCondition = aircraftCondition; globalThis.aircraftMaintenanceCost = aircraftMaintenanceCost; globalThis.aircraftConditionLevel = aircraftConditionLevel; globalThis.landingWearPercent = landingWearPercent; globalThis.applyLandingWear = applyLandingWear;"
].join("\n"), context);

const aircraft = { price: 500_000, conditionPercent: 100 };
assert.equal(context.landingWearPercent({ landingRateFpm: 55 }), 1);
assert.equal(context.landingWearPercent({ landingRateFpm: 224 }), 2);
assert.equal(context.landingWearPercent({ landingRateFpm: 350 }), 5);
assert.equal(context.landingWearPercent({ landingRateFpm: 500 }), 10);
assert.equal(context.landingWearPercent({ landingRateFpm: 900 }), 21);
assert.equal(context.landingWearPercent({ landingRateFpm: 3000 }), 35);

const landing = { timestamp: "2026-08-21T09:00:00Z", landingRateFpm: 500, peakG: 1.83, airport: "ZSPD", runway: "35L" };
const result = context.applyLandingWear(aircraft, landing, Date.parse("2026-08-21T08:00:00Z"));
assert.equal(result.wearPercent, 10);
assert.equal(aircraft.conditionPercent, 90);
assert.equal(aircraft.lastLandingRateFpm, 500);
assert.equal(aircraft.lastLandingPeakG, 1.83);
assert.equal(aircraft.lastLandingAirport, "ZSPD");
assert.equal(context.applyLandingWear(aircraft, landing, 0), null, "The same landing report must not apply twice");
assert.equal(aircraft.conditionPercent, 90);

const historical = { timestamp: "2026-08-20T09:00:00Z", landingRateFpm: 900, peakG: 2.4 };
assert.equal(context.applyLandingWear(aircraft, historical, Date.parse("2026-08-21T08:00:00Z")), null, "Pre-upgrade landing reports must be ignored");
assert.equal(aircraft.conditionPercent, 90);
assert.equal(context.aircraftMaintenanceCost(aircraft), 100);
assert.equal(context.aircraftConditionLevel({ conditionPercent: 99 }).label, "状态良好");
assert.equal(context.aircraftConditionLevel({ conditionPercent: 90 }).label, "轻度磨损");
assert.equal(context.aircraftConditionLevel({ conditionPercent: 60 }).label, "需要维修");
assert.equal(context.aircraftConditionLevel({ conditionPercent: 25 }).label, "严重损坏");

aircraft.conditionPercent = 80;
assert.equal(context.aircraftMaintenanceCost(aircraft), 200);
assert.equal(context.aircraftCondition({ conditionPercent: 120 }), 100);
assert.equal(context.aircraftCondition({ conditionPercent: -10 }), 0);

console.log("Aircraft maintenance: VA landing wear, dedupe, migration and repair cost cases passed");
