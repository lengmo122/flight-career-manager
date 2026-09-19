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
  flightCareerMissionScenes: {
    山地伤员撤离: { objectTitle: "FCMscene2", terrain: "land", requiresLanding: true, arrivalMode: "landing" },
    海上人员搜救: { objectTitle: "FCMsea1", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude" }
  },
  missionSceneModelPolicies: {
    FCMscene2: { terrain: "land", requiresLanding: true },
    FCMsea1: { terrain: "water", requiresLanding: false }
  }
};
vm.runInNewContext([
  readFunction("missionSceneModelPolicy"),
  readFunction("missionTerrainType"),
  readFunction("missionRequiresLanding"),
  readFunction("missionArrivalMode"),
  readFunction("missionTerrainLabel"),
  "Object.assign(globalThis, { missionSceneModelPolicy, missionTerrainType, missionRequiresLanding, missionArrivalMode, missionTerrainLabel });"
].join("\n"), context);

const currentMountainTask = { subtype: "山地伤员撤离", scene: { objectTitle: "FCMscene2", arrivalMode: "low-altitude" }, site: { terrain: "land" } };
assert.equal(context.missionTerrainType(currentMountainTask), "land");
assert.equal(context.missionRequiresLanding(currentMountainTask), true);
assert.equal(context.missionArrivalMode(currentMountainTask), "landing");
assert.equal(context.missionTerrainLabel(currentMountainTask), "地面模型 · 必须降落");

const legacyMountainTask = { subtype: "山地伤员搬离", scene: { objectTitle: "FCMscene2", terrain: "land", arrivalMode: "low-altitude" } };
assert.equal(context.missionRequiresLanding(legacyMountainTask), true,
  "Legacy task names must inherit the FCMscene2 model landing rule");
assert.equal(context.missionArrivalMode(legacyMountainTask), "landing");

const seaTask = { subtype: "海上人员搜救", scene: { objectTitle: "FCMsea1", terrain: "water" } };
assert.equal(context.missionTerrainType(seaTask), "water");
assert.equal(context.missionRequiresLanding(seaTask), false);
assert.equal(context.missionTerrainLabel(seaTask), "海上模型 · 低空作业");

assert.match(source, /stationaryAtLandingSite[\s\S]{0,300}Boolean\(careerLanding\)/,
  "Ground-model scene tasks must require a real touchdown report");
assert.match(source, /resetLegacySceneArrival[\s\S]{0,1500}\["target-confirmed", "returning"\]/,
  "Legacy FCMscene2 tasks advanced by the old fly-over rule must return to the outbound phase");
assert.match(source, /verification\.targetLandingConfirmed = requiresLanding/,
  "A successful scene landing must be recorded before the return phase");

console.log("Mission scene arrival rules: terrain, model landing and legacy migration cases passed");
