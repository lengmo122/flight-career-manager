import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const signatureEnd = source.indexOf(") {", start);
  assert.ok(signatureEnd >= 0, `${name} signature was incomplete`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} source was incomplete`);
}

let nextId = 0;
const context = {
  state: {
    pilot: { base: "ZBAA" },
    missions: Array.from({ length: 6 }, (_, index) => ({
      id: `standard-${index}`,
      category: "客运",
      origin: "ZBAA",
      status: "open",
      refreshable: true,
      createdAt: 1_000 + index
    })),
    fleet: [
      { id: "cabri-g2", kind: "直升机", owned: true, rented: false },
      { id: "fixed-wing", kind: "训练机", owned: true, rented: false }
    ],
    licenses: []
  },
  isCompanyAircraft: () => false,
  aircraftOperationalBase: (aircraft, fallback = "ZBAA") => aircraft?.lastLandingAirport || fallback,
  makeEmergencyMission: (preferredKind = "") => ({
    id: `emergency-${nextId += 1}`,
    category: "事故调查",
    origin: "ZBAA",
    status: "open",
    refreshable: true,
    permittedAircraftIds: [preferredKind === "helicopter" ? "cabri-g2" : "fixed-wing"],
    createdAt: 10_000 + nextId
  }),
  makeMission: () => ({
    id: `generated-${nextId += 1}`,
    category: "客运",
    origin: "ZBAA",
    status: "open",
    refreshable: true,
    createdAt: 10_000 + nextId
  }),
  randomCategory: () => "客运",
  randomSubtype: () => "区域通勤",
  compatibleCategories: () => ["客运"],
  currentAircraft: () => ({ id: "cabri-g2", kind: "直升机" }),
  pick: (list) => list[0],
  hasAircraftLicense: () => false,
  isFreeMode: () => false,
  STARTER_HELICOPTER_ID: "cabri-g2",
  saveState() {},
  renderMissions() {},
  renderProfile() {},
  wireIcons() {},
  toast() {}
};

vm.runInNewContext([
  'const emergencyMissionCategories = ["医疗", "搜救", "海上救援", "事故调查"];',
  "const MISSION_OFFER_TARGET_COUNT = 50;",
  "const MISSION_EMERGENCY_TARGET_COUNT = 2;",
  "const MISSION_OFFER_LIFETIME_MS = 180000;",
  readFunction("normalizeBaseCode"),
  readFunction("missionBelongsToBase"),
  readFunction("missionBelongsToAircraftLocation"),
  readFunction("missionAircraftLocationMatches"),
  readFunction("missionVisibleForBase"),
  readFunction("removeOpenMissionsOutsideBase"),
  readFunction("migrateMissionRouteTitle"),
  readFunction("isEmergencyMission"),
  readFunction("isHelicopterAircraft"),
  readFunction("isHelicopterEmergencyMission"),
  readFunction("missionEligibleAircraft"),
  readFunction("refreshableMissionOffers"),
  readFunction("oldestExpiredMission"),
  readFunction("autoRefreshMissions"),
  "globalThis.autoRefreshMissions = autoRefreshMissions; globalThis.isEmergencyMission = isEmergencyMission; globalThis.migrateMissionRouteTitle = migrateMissionRouteTitle;"
].join("\n"), context);

const legacySceneMission = { title: "ZBAA → 现场 007°", site: { lat: 40, lon: 116 } };
context.migrateMissionRouteTitle(legacySceneMission);
assert.equal(legacySceneMission.title, "ZBAA → 航向 007°", "Legacy scene headings must migrate");
const standardMission = { title: "ZBAA → 现场 007°" };
context.migrateMissionRouteTitle(standardMission);
assert.equal(standardMission.title, "ZBAA → 现场 007°", "Standard mission titles must not be rewritten");
const descriptiveSceneMission = { title: "事故现场支援", site: { lat: 40, lon: 116 } };
context.migrateMissionRouteTitle(descriptiveSceneMission);
assert.equal(descriptiveSceneMission.title, "事故现场支援", "Scene descriptions must not be rewritten");

context.autoRefreshMissions();
assert.equal(context.state.missions.filter((mission) => mission.refreshable).length, 50);
assert.equal(context.state.missions.filter(context.isEmergencyMission).length, 2, "Two emergency offers must be guaranteed");
assert.ok(context.state.missions.some((mission) => mission.permittedAircraftIds?.includes("cabri-g2")), "A helicopter emergency offer must be guaranteed when one is available");

const stableIds = context.state.missions.map((mission) => mission.id).sort();
assert.equal(context.autoRefreshMissions(), 0, "A full healthy pool must remain stable between rotations");
assert.deepEqual(context.state.missions.map((mission) => mission.id).sort(), stableIds);

context.state.missions.unshift({
  id: "scheduled-1",
  category: "客运",
  origin: "ZBAA",
  status: "open",
  refreshable: false,
  createdAt: 0
});
context.autoRefreshMissions();
assert.ok(context.state.missions.some((mission) => mission.id === "scheduled-1"), "Scheduled missions must not be replaced");
assert.equal(context.state.missions.filter((mission) => mission.refreshable).length, 50);

const beforeRotation = new Set(context.state.missions.filter((mission) => mission.refreshable).map((mission) => mission.id));
assert.equal(context.autoRefreshMissions({ rotateExpired: true }), 1, "One expired offer must be replaced per refresh tick");
const afterRotation = context.state.missions.filter((mission) => mission.refreshable).map((mission) => mission.id);
assert.equal(afterRotation.filter((id) => !beforeRotation.has(id)).length, 1);
assert.equal(context.state.missions.filter(context.isEmergencyMission).length, 2);
assert.ok(context.state.missions.some((mission) => mission.permittedAircraftIds?.includes("cabri-g2")), "Rotations must preserve the helicopter emergency offer");
assert.ok(context.state.missions.some((mission) => mission.id === "scheduled-1"), "Rotation must preserve scheduled missions");

console.log("Mission refresh: stable pool, emergency guarantee and scheduled mission preservation passed");
