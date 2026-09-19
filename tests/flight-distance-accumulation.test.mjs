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
  readFunction("distanceNm"),
  readFunction("accumulateFlightDistance"),
  "globalThis.distanceNm = distanceNm; globalThis.accumulateFlightDistance = accumulateFlightDistance;"
].join("\n"), context);

const oneFrameAtSixtyKnots = 60 * 0.2 / 3600;
const coordinateStep = context.distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: oneFrameAtSixtyKnots / 60 });
assert.ok(coordinateStep > 0.003 && coordinateStep < 0.004,
  "A 200 ms telemetry movement must retain sub-hundredth-nautical-mile precision");

let total = 0;
for (let index = 0; index < 18000; index += 1) {
  total = context.accumulateFlightDistance(total, oneFrameAtSixtyKnots);
}
assert.ok(Math.abs(total - 60) < 0.02, `Expected about 60 nm, received ${total} nm`);
assert.ok(context.accumulateFlightDistance(0, 0.003333) > 0,
  "Small valid telemetry steps must not round down to zero");
assert.equal(context.accumulateFlightDistance(12.5, Number.NaN), 12.5,
  "Invalid telemetry steps must not change the route distance");
assert.equal(context.accumulateFlightDistance(12.5, -3), 12.5,
  "Negative telemetry steps must not change the route distance");

assert.match(source, /flight\.distanceNm = accumulateFlightDistance\(flight\.distanceNm, step\)/,
  "Actual MSFS flight logs must use the precise distance accumulator");
assert.match(source, /movement\.kind === "normal"[\s\S]{0,180}verification\.flightDistanceNm = accumulateFlightDistance\(verification\.flightDistanceNm, movement\.stepNm\)/,
  "Career mission progress must accumulate every normal telemetry route segment");

console.log("Flight distance accumulation: high-frequency telemetry precision cases passed");
