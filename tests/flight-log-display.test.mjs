import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, nextFunction >= 0 ? nextFunction : source.length).trim();
}

const context = {};
vm.runInNewContext(`${readFunction("visibleFlightLogs")}; globalThis.visibleFlightLogs = visibleFlightLogs;`, context);

const visible = context.visibleFlightLogs([
  { id: "mission-1-hop", missionId: "mission-1", source: "msfs", date: 400 },
  { id: "mission-1-settled", missionId: "mission-1", source: "msfs", date: 300, settledAt: 500 },
  { id: "mission-2-flight", missionId: "mission-2", source: "msfs", date: 350 },
  { id: "free-flight", source: "msfs", date: 250 },
  { id: "manual-flight", date: 200 }
]);

assert.deepEqual(
  Array.from(visible, (log) => log.id),
  ["mission-2-flight", "mission-1-settled", "free-flight", "manual-flight"],
  "each mission should show one record and prefer the settled record"
);
assert.match(source, /const logs = visibleFlightLogs\(state\.logs\)/, "all flight-log surfaces should use the collapsed collection");

console.log("Flight log display: one preferred record per mission and independent free flights passed");
