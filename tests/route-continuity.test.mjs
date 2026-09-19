import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const bodyStart = source.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} source was incomplete`);
}

const context = {
  telemetryBoolean: (value) => value === true
};
vm.runInNewContext([
  readFunction("distanceNm"),
  readFunction("assessTelemetryMovement"),
  "globalThis.distanceNm = distanceNm; globalThis.assessTelemetryMovement = assessTelemetryMovement;"
].join("\n"), context);

const route = [
  { lat: 0, lon: 0 },
  { lat: 0.033333, lon: 0 },
  { lat: 0.033333, lon: 0.033333 }
];
const firstLeg = context.assessTelemetryMovement(route[0], route[1], 0, 60_000, { groundSpeedKt: 120 });
const secondLeg = context.assessTelemetryMovement(route[1], route[2], 60_000, 120_000, { groundSpeedKt: 120 });
assert.equal(firstLeg.kind, "normal");
assert.equal(secondLeg.kind, "normal", "A standard-airway turn must remain a valid route segment");
const flownDistance = firstLeg.stepNm + secondLeg.stepNm;
const directDistance = context.distanceNm(route[0], route[2]);
assert.ok(flownDistance > directDistance * 1.35, "The test route must be materially longer than the direct airport line");

const reconnectGap = context.assessTelemetryMovement(route[0], route[2], 0, 600_000, { groundSpeedKt: 120 });
assert.equal(reconnectGap.kind, "gap", "A telemetry reconnect must not be treated as route cheating");
const coordinateJump = context.assessTelemetryMovement(route[0], { lat: 2, lon: 2 }, 0, 2_000, { groundSpeedKt: 250 });
assert.equal(coordinateJump.kind, "jump", "An impossible coordinate discontinuity should be ignored as a bad segment");
const slew = context.assessTelemetryMovement(route[0], route[1], 0, 2_000, { groundSpeedKt: 120, slewActive: true });
assert.equal(slew.kind, "slew", "Explicit MSFS SLEW remains a blocking condition");

assert.match(source, /if \(movement\.kind === "jump"\)[\s\S]{0,180}ignoredTelemetryJumps/, "Coordinate jumps should only be recorded and skipped");
assert.match(source, /if \(activeSlew\)[\s\S]{0,180}teleportLocked = true/, "Only explicit SLEW should lock a mission");
assert.doesNotMatch(source, /movementJump \|\| activeSlew/, "Legacy coordinate-jump locking must be removed");
assert.match(source, /actualLog\.airportCheck = rewardEligible \? "passed" : "failed"/, "Final mission validation must correct the actual flight log result");
assert.match(source, /legacyPositionLock[\s\S]{0,300}teleportLocked = legacyPositionLock \? false/, "Legacy false position locks must be cleared during migration");

console.log("Route continuity: airway turns, reconnects, coordinate jumps, SLEW locks and final airport checks passed");
