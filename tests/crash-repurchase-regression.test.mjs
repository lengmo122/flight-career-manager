import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
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

const crashAt = Date.parse("2026-09-28T10:00:00Z");
const context = {
  state: {
    features: { landingWearStartedAt: 0, lastProcessedLandingReportAt: 0 },
    fleet: [{ id: "old-c172", catalogId: "c172", owned: true, rented: false, conditionPercent: 100 }]
  },
  telemetryMatchesAircraft: (_landing, aircraft) => aircraft.catalogId === "c172"
};

vm.runInNewContext([
  readFunction("aircraftCondition"),
  readFunction("landingWearPercent"),
  readFunction("applyLandingWear"),
  readFunction("syncFleetLandingWear"),
  "globalThis.syncFleetLandingWear = syncFleetLandingWear;"
].join("\n"), context);

const crashReport = {
  timestamp: new Date(crashAt).toISOString(),
  aircraftTitle: "Cessna Skyhawk G1000 Asobo",
  landingRateFpm: 428,
  peakG: 4.28,
  airport: "ZBAA",
  runway: "36R"
};

const firstWear = context.syncFleetLandingWear(crashReport);
assert.ok(firstWear, "the original crash report should be consumed once");
assert.equal(context.state.features.lastProcessedLandingReportAt, crashAt);

context.state.fleet = [{ id: "new-c172", catalogId: "c172", owned: true, rented: false, conditionPercent: 100 }];
const repeatedWear = context.syncFleetLandingWear(crashReport);
assert.equal(repeatedWear, null, "a replacement aircraft must not consume the previous aircraft's crash report");
assert.equal(context.state.fleet[0].conditionPercent, 100, "the replacement aircraft must remain undamaged");

const laterLanding = { ...crashReport, timestamp: new Date(crashAt + 60_000).toISOString(), peakG: 1.2 };
assert.ok(context.syncFleetLandingWear(laterLanding), "a genuinely newer landing report must still be processed");

assert.match(source, /merged\.logs\.map\(\(log\) => Number\(log\?\.landingReportAt\)/,
  "legacy saves must recover the global landing watermark from flight and crash logs");
assert.match(source, /Array\.isArray\(incoming\.fleet\) \? incoming\.fleet : merged\.fleet/,
  "legacy saves must also recover the watermark from the actual saved fleet");

console.log("Crash repurchase regression: stale landing reports cannot destroy replacement aircraft");
