import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

assert.match(appSource, /function createCompanyAircraft\(selectedId = ""\)/, "company creation should build a dedicated aircraft record");
assert.match(appSource, /aircraftCatalog\.filter\(\(aircraft\) => aircraft\.kind === "干线喷气"\)/, "the starter aircraft pool should contain only trunk jets");
assert.match(appSource, /createCompanyAircraft\(starterAircraft\.id\)/, "new companies should use the selected trunk jet");
assert.match(appSource, /companyOwned: true/, "the starter company aircraft should be marked company-owned");
assert.match(appSource, /aircraftIds: companyAircraft \? \[companyAircraft\.id\] : \[\]/, "the company should link its starter aircraft");
assert.match(appSource, /if \(companyAircraft\) state\.fleet\.push\(companyAircraft\)/, "the starter company aircraft should be persisted in the fleet");
assert.match(appSource, /!isCompanyAircraft\(aircraft\) && \(aircraft\.owned \|\| aircraft\.rented\)/, "personal mission and management lists should exclude company aircraft");
assert.match(appSource, /state\.fleet = state\.fleet\.filter\(\(aircraft\) => !isCompanyAircraft\(aircraft\)\)/, "closing a company should remove its dedicated aircraft");
assert.match(appSource, /customFleet/, "custom personal and company aircraft should survive save-state migration");
assert.match(appSource, /state\.company\.starterAircraftGranted !== true/, "existing companies should receive the starter aircraft once during migration");

console.log("Company default aircraft: selected trunk jet, isolated company ownership and cleanup passed");
