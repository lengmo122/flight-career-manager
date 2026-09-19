import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();
assert.doesNotMatch(source, /MSFS 对象 \$\{scene\.objectTitle\}/, "Mission cards must not expose internal MSFS object names");
assert.doesNotMatch(source, /游戏内烟雾 \$\{missionSmokeTitle\(scene\)\}/, "Mission cards must not expose internal smoke object names");

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
    航空事故调查: { objectTitle: "FCMcrashedplane6", terrain: "land", requiresLanding: true, arrivalMode: "landing" },
    山地伤员撤离: { objectTitle: "FCMscene2", terrain: "land", requiresLanding: true, arrivalMode: "landing" },
    海上人员搜救: { objectTitle: "FCMsea1", terrain: "water", requiresLanding: false, arrivalMode: "low-altitude" }
  },
  missionSceneModelPolicies: {
    FCMscene2: { terrain: "land", requiresLanding: true },
    FCMcrashedplane6: { terrain: "land", requiresLanding: true },
    FCMsea1: { terrain: "water", requiresLanding: false }
  }
};
vm.runInNewContext([
  readFunction("escapeHtml"),
  readFunction("missionSceneModelPolicy"),
  readFunction("missionRequiresLanding"),
  readFunction("missionArrivalMode"),
  readFunction("hasDepartedTaskSite"),
  readFunction("renderLiveTaskProgress"),
  "globalThis.missionArrivalMode = missionArrivalMode;",
  "globalThis.hasDepartedTaskSite = hasDepartedTaskSite;",
  "globalThis.renderLiveTaskProgress = renderLiveTaskProgress;"
].join("\n"), context);

assert.equal(context.missionArrivalMode({ subtype: "航空事故调查", scene: { arrivalMode: "low-altitude" } }), "landing",
  "The current packaged rule must override a legacy saved fly-over rule");
assert.equal(context.missionArrivalMode({ subtype: "山地伤员撤离", scene: { arrivalMode: "low-altitude" } }), "landing");
assert.equal(context.missionArrivalMode({ subtype: "山地伤员搬离", scene: { objectTitle: "FCMscene2", arrivalMode: "low-altitude" } }), "landing");
assert.equal(context.missionArrivalMode({ subtype: "海上人员搜救", scene: { arrivalMode: "low-altitude" } }), "low-altitude");
assert.equal(context.missionArrivalMode({ destination: "ZSHC" }), "landing");

assert.equal(context.hasDepartedTaskSite(true, 80), false, "Ground movement must never start the return leg");
assert.equal(context.hasDepartedTaskSite(false, 19), false, "A low-speed airborne transition must not start the return leg");
assert.equal(context.hasDepartedTaskSite(false, 20), true, "The return leg starts only after a confirmed takeoff");

const liveCard = context.renderLiveTaskProgress({
  title: "ZSPD -> 事故现场",
  verification: {
    phaseLabel: "任务点停留中",
    detail: "已在任务点停稳，停留 8 / 15 秒。",
    flightDistanceNm: 10.4,
    lastTelemetryTimestamp: "2026-08-21T08:00:00Z"
  }
});
assert.match(liveCard, /任务点停留中/);
assert.match(liveCard, /停留 8 \/ 15 秒/);
assert.match(liveCard, /实际航迹 10 nm/);
assert.match(liveCard, /实时更新/);

assert.match(source, /const liveProgress = activeMission \? renderLiveTaskProgress\(activeMission\) : ""/);
assert.match(source, /renderMissions\(\);\s*renderLogs\(\);\s*wireIcons\(\);/);
assert.match(source, /arrivalMode: "landing"[^\n]+航空事故现场附近安全着陆|arrivalMode: "landing"[^\n]+事故现场附近安全着陆/);
assert.match(source, /if \(arrivedAtAirport\) \{[\s\S]{0,500}completeMission\(mission\.id/,
  "An airport mission must complete immediately after a valid landing");
assert.doesNotMatch(source, /arrivedAtAirport[\s\S]{0,260}if \(verification\.engineRunning === false\)/,
  "Engine shutdown must not be required after landing");

console.log("Mission progression: live log, landing completion and return takeoff gate passed");
