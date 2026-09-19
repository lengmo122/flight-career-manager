import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function readFunction(name) {
  const plainStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.lastIndexOf(`async function ${name}(`, plainStart);
  const start = asyncStart >= 0 ? asyncStart : plainStart;
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

const renderHangarSource = readFunction("renderHangar");
const marketCardSource = readFunction("renderAircraftCard");
const managementSource = readFunction("renderAircraftManagement");
assert.match(renderHangarSource, /aircraftCatalog\.filter/);
assert.match(marketCardSource, /data-action="buy-aircraft"/);
assert.match(marketCardSource, /data-action="rent-aircraft"/);
assert.doesNotMatch(marketCardSource, /data-action="select-aircraft"/);
assert.doesNotMatch(marketCardSource, /data-action="sell-aircraft"/);
assert.doesNotMatch(marketCardSource, /data-action="return-aircraft"/);
assert.match(marketCardSource, /可重复购买\/租赁/);
assert.match(managementSource, /aircraftManagementFilter/);
assert.match(managementSource, /aircraftManagementSearch/);
assert.match(source, /function aircraftResaleRate\(aircraft\)/);
assert.match(source, /预计回收/);
assert.match(source, /await showConfirmDialog\(`确定出售/);

const context = {
  aircraftCatalog: [{
    id: "test-jet",
    name: "测试喷气机",
    kind: "干线喷气",
    price: 1_000,
    rent: 100,
    range: 1_500,
    pace: "测试",
    unlockHours: 0,
    note: "重复交易测试"
  }],
  state: {
    cash: 10_000,
    stats: { totalHours: 100 },
    fleet: [],
    company: { aircraftIds: [] }
  },
  STARTER_HELICOPTER_ID: "cabri-g2",
  isFreeMode: () => false,
  isCompanyAircraft: () => false,
  aircraftHasActiveMission: () => false,
  companyHangarIsActive: () => false,
  companyTransaction: () => {},
  recordFundTransaction({ amount }) { context.state.cash += amount; },
  renderAll: () => {},
  toast: () => {},
  showConfirmDialog: async () => true,
  formatMoney: (value) => String(value),
  console
};

vm.runInNewContext([
  readFunction("normalizeFleetAircraft"),
  readFunction("cryptoId"),
  readFunction("aircraftCatalogId"),
  readFunction("createPersonalAircraft"),
  readFunction("aircraftFleetNumber"),
  readFunction("isStarterAircraft"),
  readFunction("selectAircraft"),
  readFunction("ensureSelectedPersonalAircraft"),
  readFunction("buyAircraft"),
  readFunction("rentAircraft"),
  readFunction("sellAircraft"),
  readFunction("aircraftCondition"),
  readFunction("aircraftResaleRate"),
  readFunction("aircraftResaleValue"),
  "globalThis.buyAircraft = buyAircraft; globalThis.rentAircraft = rentAircraft; globalThis.sellAircraft = sellAircraft; globalThis.aircraftResaleRate = aircraftResaleRate; globalThis.aircraftResaleValue = aircraftResaleValue;"
].join("\n"), context);

context.buyAircraft("test-jet");
context.buyAircraft("test-jet");
context.rentAircraft("test-jet");

assert.equal(context.state.fleet.length, 3);
assert.equal(new Set(context.state.fleet.map((aircraft) => aircraft.id)).size, 3);
assert.ok(context.state.fleet.every((aircraft) => aircraft.catalogId === "test-jet"));

assert.equal(context.aircraftResaleRate({ price: 100_000, conditionPercent: 100 }), 0.42);
assert.equal(context.aircraftResaleValue({ price: 100_000, conditionPercent: 100 }), 42_000);
assert.equal(context.aircraftResaleValue({ price: 100_000, conditionPercent: 50 }), 28_500);
assert.equal(context.state.fleet.filter((aircraft) => aircraft.owned).length, 2);
assert.equal(context.state.fleet.filter((aircraft) => aircraft.rented).length, 1);
assert.equal(context.state.cash, 7_900);

const remainingId = context.state.fleet[1].id;
await context.sellAircraft(context.state.fleet[0].id);
assert.equal(context.state.fleet.length, 2);
assert.ok(context.state.fleet.some((aircraft) => aircraft.id === remainingId));
assert.ok(context.state.fleet.every((aircraft) => aircraft.catalogId === "test-jet"));

console.log("Hangar marketplace: repeat purchases, rentals and independent aircraft instances passed");
