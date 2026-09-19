import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const rulesStart = source.indexOf("const aircraftIdentityRules =");
const rulesEnd = source.indexOf("\n\nconst missionPolicies", rulesStart);
const functionsStart = source.indexOf("function compactAircraftName");
const functionsEnd = source.indexOf("function pointFromAirport", functionsStart);
assert.ok(rulesStart >= 0 && rulesEnd > rulesStart && functionsStart >= 0 && functionsEnd > functionsStart);

const context = {
  state: {
    fleet: [
      { id: "c152", name: "Cessna 152" },
      { id: "c152-aerobat", name: "Cessna 152 Aerobat" },
      { id: "c172", name: "Cessna 172 Skyhawk" }
    ]
  },
  mission: {
    permittedAircraftIds: ["c152", "c152-aerobat", "c172"],
    verification: { aircraftId: "c152" }
  },
  sample: { aircraftTitle: "Cessna Skyhawk G1000 Asobo" }
};

vm.runInNewContext([
  source.slice(rulesStart, rulesEnd),
  source.slice(functionsStart, functionsEnd),
  "globalThis.match = telemetryMissionAircraft(sample, mission);"
].join("\n"), context);

assert.equal(context.match?.id, "c172", "an accepted mission must match every aircraft advertised as permitted");
console.log("Mission permitted aircraft: C172 G1000 can satisfy a multi-aircraft task passed");
