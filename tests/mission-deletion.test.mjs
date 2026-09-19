import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();

function readFunction(name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
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

const requests = [];
const messages = [];
const context = {
  state: {},
  endingMissionIds: new Set(),
  showConfirmDialog: async () => true,
  activeVerifiedMission: () => context.state.missions.find((mission) => mission.status === "accepted" && mission.verification) || null,
  fetch: async (url, options) => { requests.push([url, options?.method]); return { ok: true }; },
  saveState: () => {},
  renderAll: () => {},
  toast: (message) => messages.push(message)
};
vm.runInNewContext([
  readFunction("deleteMission"),
  "globalThis.deleteMission = deleteMission;"
].join("\n"), context);

context.state = {
  missions: [{ id: "open-1", title: "ZSPD -> ZBAA", status: "open" }],
  taskEvents: [{ missionId: "open-1" }],
  schedules: [{ missionId: "open-1", kind: "route-plan" }],
  licenses: [],
  simulatorFlight: { active: false, missionId: "" }
};
await context.deleteMission("open-1");
assert.equal(context.state.missions.length, 0, "An open mission must be removed");
assert.equal(context.state.taskEvents.length, 0, "Its task events must be removed");
assert.equal(context.state.schedules.length, 0, "Its planned-route record must be removed");
assert.equal(requests.length, 0, "Deleting an inactive offer must not call the simulator cleanup APIs");

context.state = {
  missions: [{ id: "active-1", title: "Active mission", status: "accepted", verification: { phase: "outbound" } }],
  taskEvents: [{ missionId: "active-1" }],
  schedules: [],
  licenses: [{ id: "a320", assessmentMissionId: "active-1", assessmentCompleted: false }],
  simulatorFlight: { active: true, missionId: "active-1", distanceNm: 12.5 }
};
await context.deleteMission("active-1");
assert.deepEqual(requests, [
  ["/api/simulator/scene", "DELETE"],
  ["/api/simulator/flight-plan", "DELETE"]
], "Deleting the active mission must unload its scene and flight plan");
assert.equal(context.state.simulatorFlight.missionId, "", "The current flight must no longer settle against the deleted mission");
assert.equal(context.state.simulatorFlight.distanceNm, 12.5, "Independent actual-flight tracking must be preserved");
assert.equal(context.state.licenses[0].assessmentMissionId, "", "A deleted assessment must be eligible for regeneration");
assert.ok(messages.includes("执行中任务已删除"));

assert.match(source, /data-action="delete-mission"[\s\S]{0,120}trash-2[\s\S]{0,120}删除任务/,
  "Every mission card must render the delete control with a trash icon");
assert.doesNotMatch(source, /data-action="end-mission"/, "The old duplicate end-task control must be removed");

console.log("Mission deletion: card action, confirmation and related-state cleanup passed");
