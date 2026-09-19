import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [html, app, styles] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);

assert.match(html, /id="planOriginInput"[\s\S]*?maxlength="4"/, "plan view should expose a four-character origin ICAO input");
assert.match(html, /id="planDestinationInput"[\s\S]*?maxlength="4"/, "plan view should expose a four-character destination ICAO input");
assert.match(html, /id="planAircraftSelect"[\s\S]*?aria-label="选择已购买或租赁的机型"/, "plan view should expose owned and rented aircraft");
assert.match(html, /id="generatePlannedMissionBtn"/, "plan view should expose a mission generation command");

const settingsStart = html.indexOf('id="settingsModal"');
const settingsEnd = html.indexOf("</dialog>", settingsStart);
const backupList = html.indexOf('id="backupList"');
assert.ok(settingsStart >= 0 && backupList > settingsStart && backupList < settingsEnd, "backup controls should live inside settings");

assert.match(app, /function updatePlanAirportFields\(\)/, "ICAO fields should resolve airport names while typing");
assert.match(app, /function availablePlanAircraft\(\)[\s\S]*?!isCompanyAircraft\(aircraft\) && \(aircraft\.owned \|\| aircraft\.rented\)/, "planned routes should include personal rentals but exclude company aircraft");
assert.match(app, /function renderPlanAircraftOptions\(\)/, "purchased aircraft should render in the selector");
assert.match(app, /const \{ origin, destination, aircraft \} = updatePlanAirportFields\(\)/, "generation should use the selected aircraft");
assert.match(app, /aircraftId:\s*aircraft\.id,[\s\S]*?aircraftName:\s*aircraft\.name/, "schedule records should retain the selected aircraft");
assert.match(app, /els\.planAircraftSelect\?\.addEventListener\("change", updatePlanAirportFields\)/, "aircraft selection should update generation readiness");
assert.match(app, /companyAirportByIcao\(originCode\)/, "planned routes should use the global airport index");
assert.match(app, /function generatePlannedMission\(\)/, "planned route generation should be implemented");
assert.match(app, /const distance = Math\.round\(distanceNm\(origin, destination\)\)/, "planned mission distance should be stored as whole nautical miles");
assert.match(app, /<span class="tag">\$\{formatTaskDistanceNm\(mission\.distance\)\}<\/span>/, "mission cards should format legacy decimal distances");
assert.match(app, /kind:\s*"planned-route"[\s\S]*?refreshable:\s*false/, "planned missions should survive automatic refreshes");
assert.match(app, /state\.schedules\.unshift\(\{[\s\S]*?kind:\s*"route-plan"/, "planned routes should be recorded in the schedule");
assert.match(app, /showView\("missions"\)/, "generation should open the mission list");
assert.match(app, /generatePlannedMissionBtn\.addEventListener\("click", generatePlannedMission\)/, "generation button should be wired");
assert.match(app, /function airportByIcao\(icao\)[\s\S]*?globalAirportIndex\.get\(code\)/, "mission airport lookup should support the global airport catalog");
assert.match(styles, /\.plan-route-builder\s*\{/, "planned route controls should have a stable layout");

const purchasedStart = app.indexOf("function availablePlanAircraft()");
const purchasedEnd = app.indexOf("function plannedMissionCruiseSpeed(", purchasedStart);
assert.ok(purchasedStart >= 0 && purchasedEnd > purchasedStart, "purchased-aircraft helpers should be testable");
const selectionContext = {
  state: {
    fleet: [
      { id: "owned-default", owned: true, rented: false, selected: true },
      { id: "owned-choice", owned: true, rented: false, selected: false },
      { id: "rented-only", owned: false, rented: true, selected: false },
      { id: "not-purchased", owned: false, rented: false, selected: false },
      { id: "company-owned", owned: true, rented: false, selected: false, companyOwned: true },
      { id: "company-rental", owned: false, rented: true, companyOwned: true }
    ]
  },
  els: { planAircraftSelect: { value: "owned-choice" }, planAircraftHint: { classList: { toggle() {} } } },
  escapeHtml: value => String(value || "")
};
vm.runInNewContext(`
  function isCompanyAircraft(aircraft) { return aircraft?.companyOwned === true; }
  ${app.slice(purchasedStart, purchasedEnd)}
  globalThis.purchasedIds = availablePlanAircraft().map((aircraft) => aircraft.id);
  globalThis.selectedId = selectedPlanAircraft()?.id || null;
`, selectionContext);
assert.deepEqual([...selectionContext.purchasedIds], ["owned-default", "owned-choice", "rented-only"], "personal purchases and rentals should be selectable");
assert.equal(selectionContext.selectedId, "owned-choice", "the user's explicit aircraft selection should win over the default aircraft");
selectionContext.els.planAircraftSelect.value = "rented-only";
assert.equal(selectionContext.selectedPlanAircraft().id, "rented-only");
selectionContext.renderPlanAircraftOptions();
assert.equal(selectionContext.els.planAircraftSelect.value, "rented-only", "rerender must preserve the chosen rental");
assert.match(selectionContext.els.planAircraftSelect.innerHTML, /value="rented-only"[^<]*>[^<]*租赁/);

Object.assign(selectionContext, {
  updatePlanAirportFields: () => ({origin:{icao:'ZBAA',name:'Beijing'},destination:{icao:'ZSPD',name:'Shanghai'},aircraft:selectionContext.selectedPlanAircraft()}),
  compatibleCategories: () => ['客运'], isHelicopterAircraft: () => false,
  distanceNm: () => 580.4, cryptoId: prefix => prefix + '-test', buildMissionScene: () => ({}),
  saveState() {}, renderAll() {}, toast() {}, showView() {}
});
selectionContext.state.missions = []; selectionContext.state.schedules = [];
vm.runInNewContext(app.slice(purchasedEnd, app.indexOf('function renderSchedules()', purchasedEnd)), selectionContext);
const rentalMission = selectionContext.generatePlannedMission();
assert.deepEqual([...rentalMission.permittedAircraftIds], ['rented-only']);
assert.equal(selectionContext.state.schedules[0].aircraftId, 'rented-only');
selectionContext.state.fleet = selectionContext.state.fleet.filter(aircraft => aircraft.id !== 'rented-only');
assert.equal(selectionContext.selectedPlanAircraft(), null, 'a returned rental must not silently select another aircraft');
assert.equal(selectionContext.generatePlannedMission(), null);
assert.equal(selectionContext.state.missions.length, 1, 'returned rentals cannot create further tasks');
selectionContext.state.fleet = [];
selectionContext.renderPlanAircraftOptions();
assert.equal(selectionContext.els.planAircraftSelect.disabled, true);

const distanceFormatStart = app.indexOf("function formatTaskDistanceNm(");
const distanceFormatEnd = app.indexOf("function formatTaskRouteLabel(", distanceFormatStart);
assert.ok(distanceFormatStart >= 0 && distanceFormatEnd > distanceFormatStart, "task distance formatter should be testable");
const distanceContext = {};
vm.runInNewContext(`${app.slice(distanceFormatStart, distanceFormatEnd)}\n` +
  "globalThis.formatTaskDistanceNm = formatTaskDistanceNm;", distanceContext);
assert.equal(distanceContext.formatTaskDistanceNm(89.54727278780564), "90 nm");
assert.equal(distanceContext.formatTaskDistanceNm(1450.4), "1,450 nm");

console.log("Planned route ICAO lookup, generation, schedule record and settings backup placement passed");
