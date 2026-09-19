import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [source, html] = await Promise.all([
  readAppSource(),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);

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

const normalizeSource = readFunction("normalizeAircraftLicenses");
const purchaseSource = readFunction("purchaseAircraftLicense");
const completeSource = readFunction("completeMission");
const renderSource = readFunction("renderAircraftLicenses");
const refreshSource = readFunction("refreshLicenseAssessmentMissions");

assert.match(normalizeSource, /legacyLicensed/);
assert.match(normalizeSource, /assessmentCompleted/);
assert.match(normalizeSource, /assessmentMissionId:\s*String\(found\?\.assessmentMissionId/, "saved assessment links should survive reloads");
assert.match(purchaseSource, /考核资格/);
assert.match(purchaseSource, /createLicenseAssessmentMission\(license\)/);
assert.match(completeSource, /assessmentPassed/);
assert.match(completeSource, /record\.assessmentCompleted = true/);
assert.match(renderSource, /待完成机型考核/);
assert.match(renderSource, /licensedCount/);
assert.match(source, /mission\.kind === "license-assessment"/);
assert.match(source, /mission\.permittedAircraftIds = \[aircraft\.id\]/);
assert.match(html, /id="refreshLicenseAssessmentsBtn"[\s\S]*?refresh-cw/, "license panel should expose a refresh action");
assert.match(refreshSource, /ensureLicenseAssessmentMissions\(\)/, "refresh should recreate missing assessments");
assert.match(refreshSource, /record\.assessmentMissionId = mission\.id/, "refresh should repair stale mission references");
assert.match(refreshSource, /mission\.licenseAssessmentId = record\.id/, "refresh should repair legacy missions missing their license link");
assert.match(refreshSource, /state\.activeView = "missions"/, "refresh should open the recovered task list");
assert.match(source, /refreshLicenseAssessmentsBtn\?\.addEventListener\("click", refreshLicenseAssessmentMissions\)/,
  "refresh control should be wired to assessment recovery");

console.log("Aircraft license assessment: purchase, task recovery, gating, completion and legacy migration passed");
