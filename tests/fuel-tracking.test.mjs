import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();
assert.match(source, /type="range" min="0" max="100"/, "Fuel slider must use the full 0-100% track");

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
  readFunction("telemetryFuelKg"),
  readFunction("fuelSliderState"),
  readFunction("updateMissionFuel"),
  "globalThis.telemetryFuelKg = telemetryFuelKg; globalThis.fuelSliderState = fuelSliderState; globalThis.updateMissionFuel = updateMissionFuel;"
].join("\n"), context);

assert.equal(context.telemetryFuelKg({ fuelKg: 65.2402 }), 65.2402);
assert.equal(context.telemetryFuelKg({ fuelKg: 0 }), 0);
assert.equal(context.telemetryFuelKg({ fuelKg: null }), null);
assert.equal(context.telemetryFuelKg({ fuelKg: -1 }), null);
assert.equal(context.telemetryFuelKg({ fuelKg: "invalid" }), null);

let slider = context.fuelSliderState(37.2, undefined, undefined);
assert.equal(slider.minimumPercent, 38);
assert.equal(slider.targetPercent, 38, "Slider must initially follow actual fuel");
assert.equal(slider.usesRequestedTarget, false);

slider = context.fuelSliderState(37.2, 100, 38);
assert.equal(slider.targetPercent, 100, "A pending refuel target must remain selectable while fuel is unchanged");
assert.equal(slider.usesRequestedTarget, true);

slider = context.fuelSliderState(36.8, 100, 38);
assert.equal(slider.targetPercent, 37, "Slider must return to actual fuel after telemetry changes");
assert.equal(slider.usesRequestedTarget, false);

slider = context.fuelSliderState(100, 100, 100);
assert.equal(slider.targetPercent, 100);

const verification = { phase: "origin-confirmed", departedAt: null };
context.updateMissionFuel(verification, { fuelKg: 100 });
assert.equal(verification.fuelStartKg, 100);
assert.equal(verification.fuelUsedKg, 0);

verification.phase = "outbound";
verification.departedAt = Date.now();
context.updateMissionFuel(verification, { fuelKg: 95 });
assert.equal(verification.fuelUsedKg, 5);

context.updateMissionFuel(verification, { fuelKg: 110 });
assert.equal(verification.fuelUsedKg, 5, "Refueling must not reduce tracked consumption");
assert.equal(verification.fuelAddedKg, 15);

context.updateMissionFuel(verification, { fuelKg: 107 });
assert.equal(verification.fuelUsedKg, 8);

context.updateMissionFuel(verification, { fuelKg: 0 });
assert.equal(verification.fuelUsedKg, 8, "An implausible one-sample drop must be ignored");

console.log("Fuel tracking: telemetry validation, live slider, burn, refueling and anomaly cases passed");
