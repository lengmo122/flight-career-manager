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

const context = {
  telemetryBoolean: (value) => value === true,
  telemetryEventTime: (value, fallback = Date.now()) => {
    const parsed = typeof value === "number" ? value : Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : fallback;
  },
  telemetryMatchesAircraft: (sample, aircraft) => sample.aircraftTitle === aircraft.telemetryTitle,
  distanceNm: (from, to) => Math.hypot(from.lat - to.lat, from.lon - to.lon) * 60,
  landingWearPercent: () => 2
};
vm.runInNewContext([
  readFunction("landingReportMatchesTouchdown"),
  readFunction("landingReportActual"),
  "globalThis.landingReportMatchesTouchdown = landingReportMatchesTouchdown; globalThis.landingReportActual = landingReportActual;"
].join("\n"), context);

const aircraft = { telemetryTitle: "Cessna Skyhawk G1000 Asobo", lastLandingWearPercent: 2 };
const sample = {
  timestamp: "2026-08-22T13:43:14.000Z",
  aircraftTitle: aircraft.telemetryTitle,
  onGround: true,
  latitude: 31.15359,
  longitude: 121.78909
};
const freshLanding = {
  timestamp: "2026-08-22T13:43:13.500Z",
  aircraftTitle: aircraft.telemetryTitle,
  touchdownLatitude: 31.15358,
  touchdownLongitude: 121.78908,
  airport: "ZSPD",
  runway: "35L",
  landingRateFpm: 108,
  peakG: 1.13
};

assert.equal(context.landingReportMatchesTouchdown(freshLanding, sample, aircraft, Date.parse("2026-08-22T13:20:00Z")), true,
  "A fresh matching touchdown must complete a career landing");
const recoveredSample = { ...sample, timestamp: "2026-08-22T14:03:13.500Z" };
assert.equal(
  context.landingReportMatchesTouchdown(
    freshLanding,
    recoveredSample,
    aircraft,
    Date.parse("2026-08-22T13:20:00Z"),
    12 * 60 * 60_000,
    "ZSPD"
  ),
  true,
  "A valid touchdown from the current mission must recover after an app restart beyond ten minutes"
);
assert.equal(
  context.landingReportMatchesTouchdown(
    freshLanding,
    recoveredSample,
    aircraft,
    Date.parse("2026-08-22T13:20:00Z"),
    12 * 60 * 60_000,
    "ZSHC"
  ),
  false,
  "A landing report from another airport must not be recovered"
);
assert.equal(
  context.landingReportMatchesTouchdown(
    freshLanding,
    recoveredSample,
    aircraft,
    Date.parse("2026-08-22T13:20:00Z"),
    12 * 60 * 60_000,
    "ZSPD"
  ),
  true,
  "A generic simulator flight restarted after touchdown must not invalidate the mission landing"
);
assert.equal(context.landingReportMatchesTouchdown({ ...freshLanding, timestamp: "2026-08-21T13:43:13.500Z" }, sample, aircraft, Date.parse("2026-08-22T13:20:00Z")), false,
  "A previous flight's landing report must not complete a new mission");
assert.equal(context.landingReportMatchesTouchdown(freshLanding, { ...sample, onGround: false }, aircraft, Date.parse("2026-08-22T13:20:00Z")), false,
  "An airborne sample must never be treated as a landing");
assert.equal(context.landingReportMatchesTouchdown({ ...freshLanding, aircraftTitle: "Other Aircraft" }, sample, aircraft, Date.parse("2026-08-22T13:20:00Z")), false,
  "A different aircraft's report must not complete the mission");
assert.equal(context.landingReportMatchesTouchdown({ ...freshLanding, touchdownLatitude: 30, touchdownLongitude: 120 }, sample, aircraft, Date.parse("2026-08-22T13:20:00Z")), false,
  "A report from another location must not complete the mission");

aircraft.lastLandingReportAt = Date.parse(freshLanding.timestamp);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.landingReportActual(freshLanding, aircraft))),
  {
    landingRateFpm: 108,
    landingPeakG: 1.13,
    landingWearPercent: 2,
    landingAirport: "ZSPD",
    landingRunway: "35L",
    landingReportAt: Date.parse(freshLanding.timestamp)
  }
);

assert.match(source, /&& Boolean\(careerLanding\);/, "Career completion gates must require the current landing report");
assert.match(source, /12 \* 60 \* 60_000,\s*expectedLandingAirport/, "Mission-bound landing recovery should survive an app restart");
assert.match(source, /const missionDepartedAt = Number\(verification\.departedAt\)/, "Mission departure must remain the landing report lower bound");
assert.match(source, /const landingDepartedAt = Number\.isFinite\(missionDepartedAt\)/, "Generic flight restarts must not override mission departure");
assert.match(source, /Boolean\(careerLanding\) && isSopMode\(\) && !sopCanComplete/, "SOP instructions must only claim a valid landing after a matching report exists");
assert.match(source, /正在等待本次接地率和跑道数据/, "The UI must explain the touchdown confirmation wait");
assert.match(source, /landingRateFpm,\s*landingPeakG,\s*landingWearPercent/, "Mission logs must retain landing measurements");
assert.match(source, /processTelemetry\(payload\.sample, payload\.landing, simulatorFlightAtLanding\)/,
  "Career landing reports must be matched against the active simulator leg");
assert.doesNotMatch(source, /返回基地\$\{landing\?\.runway/,
  "Return notes must never reuse a stale landing report");

console.log("Career landing detection: fresh touchdown gating and landing log fields passed");
