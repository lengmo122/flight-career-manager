import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

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
  readFunction("normalizeHeading"),
  readFunction("aircraftDisplaySpeed"),
  readFunction("aircraftIconRotation"),
  "globalThis.aircraftIconRotation = aircraftIconRotation;",
  "globalThis.aircraftDisplaySpeed = aircraftDisplaySpeed;"
].join("\n"), context);

assert.equal(context.aircraftIconRotation(0), 315, "North must counter the Lucide plane's 45-degree intrinsic angle");
assert.equal(context.aircraftIconRotation(90), 45);
assert.equal(context.aircraftIconRotation(180), 135);
assert.equal(context.aircraftIconRotation(270), 225);
assert.equal(context.aircraftIconRotation(360), 315);
assert.equal(context.aircraftIconRotation(null), -45);
assert.deepEqual(
  { ...context.aircraftDisplaySpeed({ trueAirspeedKt: 115, indicatedAirspeedKt: 108, groundSpeedKt: 125 }) },
  { label: "TAS", value: 115 },
  "cockpit TAS must take precedence over IAS and ground speed"
);
assert.deepEqual(
  { ...context.aircraftDisplaySpeed({ indicatedAirspeedKt: 108, groundSpeedKt: 125 }) },
  { label: "IAS", value: 108 },
  "IAS must be used when the telemetry bridge has no TAS"
);
assert.deepEqual(
  { ...context.aircraftDisplaySpeed({ groundSpeedKt: 125 }) },
  { label: "GS", value: 125 },
  "ground speed remains the final compatibility fallback"
);
assert.match(source, /data-lucide="plane" class="live-aircraft-symbol"/);
assert.doesNotMatch(source, /&#9992;/, "The map marker must not depend on an OS-specific airplane font glyph");
assert.match(
  source,
  /sample\?\.magneticHeadingDeg \?\? sample\?\.headingMagneticDeg \?\? sample\?\.headingDeg/,
  "live map heading must prefer MSFS magnetic heading to match cockpit HDG"
);

console.log("Map heading: cardinal rotations and stable Lucide marker passed");
