import { readAppSource } from './helpers/app-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [html, styles, server] = await Promise.all(['index.html', 'styles.css', 'server.mjs']
  .map((name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')));
const app = await readAppSource();

assert.match(html, /class="mission-list mission-open-list" id="missionsList"/);
assert.match(app, /visibleMissions\.map\(renderMissionListItem\)/);
assert.match(app, /任务简报[\s\S]*?METAR[\s\S]*?燃油计划/);
assert.match(app, /scene\.label \|\| "任务现场"/);
assert.match(styles, /\.mission-open-list[\s\S]*?\.mission-list-item/);
assert.match(server, /url\.pathname === "\/api\/metar"/);

const metarContext = {
  routeAirportCodes: (mission) => String(mission.title || '').match(/[A-Z]{4}/g) || []
};
vm.runInNewContext(app.slice(app.indexOf('function missionMetarAirportCodes('), app.indexOf('function metarObservationMeta(')), metarContext);
assert.deepEqual(
  Array.from(metarContext.missionMetarAirportCodes([
    { title: 'ZBAA -> ZSQD', origin: 'ZBAA', destination: 'ZSQD' },
    { title: 'ZBAA -> ZSSS', origin: 'ZBAA', destination: 'ZSSS' }
  ])),
  ['ZBAA', 'ZSQD', 'ZSSS']
);

let aircraft = { kind: '通航单发', name: 'Cessna 172 Skyhawk', lastFuelKg: 120, fuelCapacityKg: 150 };
const fuelContext = {
  missionAircraft: () => aircraft,
  formatFuel: (value) => `${Number(value).toFixed(1)} kg`
};
vm.runInNewContext(app.slice(app.indexOf('function missionFuelBurnKgPerHour('), app.indexOf('function missionActionHtml(')), fuelContext);
let plan = fuelContext.missionFuelPlan({ duration: 1 });
assert.equal(plan.burnRate, 48);
assert.equal(plan.recommendedFuel, 90);
assert.equal(plan.statusClass, 'is-ready');
assert.match(plan.status, /余量/);

aircraft = { kind: '宽体客机', name: 'Boeing 787-10 Dreamliner', lastFuelKg: 5000, fuelCapacityKg: 100000 };
plan = fuelContext.missionFuelPlan({ duration: 2 });
assert.equal(plan.burnRate, 6200);
assert.equal(plan.statusClass, 'is-low');
assert.match(plan.status, /还需/);

aircraft = { kind: '通航单发', name: 'Cessna 172 Skyhawk', lastFuelKg: null, fuelCapacityKg: null };
plan = fuelContext.missionFuelPlan({ duration: 1 });
assert.equal(plan.currentFuel, null);
assert.equal(plan.statusClass, 'is-waiting');

console.log('Mission briefing: open list layout, METAR airports, and fuel planning passed.');
