import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readAppSource();

assert.match(appSource, /function normalizeAircraftKinds\(/, "pilot aircraft capabilities should have a shared normalizer");
assert.match(appSource, /aircraftKinds,\n\s+aircraftKind: aircraftKinds\[0\]/, "new pilots should retain an array and legacy primary kind");
assert.match(appSource, /applicant\?\.aircraftKinds \|\| applicant\?\.aircraftKind/, "legacy applicants should migrate from aircraftKind");
assert.match(appSource, /function pilotCanOperateAircraft\(/, "dispatch filtering should use a capability matcher");
assert.match(appSource, /selectApplicantAircraftKinds\(skillLevel\)/, "recruitment candidates should receive multiple possible aircraft kinds");
assert.match(appSource, /const visibleAircraft = pilot \? aircraft\.filter\(\(item\) => pilotCanOperateAircraft\(pilot, item\)\) : aircraft/, "pilot selection should filter aircraft");
assert.match(appSource, /const visiblePilots = plane \? pilots\.filter\(\(item\) => pilotCanOperateAircraft\(item, plane\)\) : pilots/, "aircraft selection should filter pilots");
assert.match(appSource, /els\.companyTaskList\?\.addEventListener\("change"/, "dispatch selectors should update on change without leaving the task page");
assert.match(appSource, /if \(!pilotCanOperateAircraft\(pilot, aircraft\)\)/, "dispatch should repeat the capability check before assignment");

console.log("Company pilot aircraft compatibility: multi-type migration, two-way filtering and dispatch guard passed");
