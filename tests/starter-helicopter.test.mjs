import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

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

const catalogEntry = source.match(/\{ id: "cabri-g2",[^\n]+\}/)?.[0] || "";
assert.match(catalogEntry, /price: 0/);
assert.match(catalogEntry, /rent: 0/);
assert.match(catalogEntry, /unlockHours: 0/);

const defaultStateSource = readFunction("defaultState");
assert.match(defaultStateSource, /aircraft\.id === STARTER_HELICOPTER_ID/);
assert.match(defaultStateSource, /selected: aircraft\.id === "c172"/);

const context = { STARTER_HELICOPTER_ID: "cabri-g2" };
vm.runInNewContext([
  readFunction("isStarterAircraft"),
  readFunction("grantStarterHelicopter"),
  "globalThis.isStarterAircraft = isStarterAircraft; globalThis.grantStarterHelicopter = grantStarterHelicopter;"
].join("\n"), context);

const legacyState = {
  features: { sceneObjectsSeeded: true },
  fleet: [
    { id: "c172", owned: true, rented: false, selected: true },
    { id: "cabri-g2", price: 450_000, rent: 2_400, unlockHours: 12, owned: false, rented: true, selected: false }
  ]
};
assert.equal(context.grantStarterHelicopter(legacyState), true);
assert.equal(legacyState.fleet[1].owned, true);
assert.equal(legacyState.fleet[1].rented, false);
assert.equal(legacyState.fleet[1].price, 0);
assert.equal(legacyState.fleet[1].rent, 0);
assert.equal(legacyState.fleet[1].unlockHours, 0);
assert.equal(legacyState.fleet[0].selected, true);
assert.equal(legacyState.fleet[1].selected, false);
assert.equal(legacyState.features.starterHelicopterGranted, true);
assert.equal(context.grantStarterHelicopter(legacyState), false);

const staleGrantedState = {
  features: { starterHelicopterGranted: true },
  fleet: [{ id: "cabri-g2", price: 450_000, rent: 2_400, unlockHours: 12, owned: true, rented: false }]
};
assert.equal(context.grantStarterHelicopter(staleGrantedState), true);
assert.equal(staleGrantedState.fleet[0].price, 0);
assert.equal(context.grantStarterHelicopter(staleGrantedState), false);

assert.equal(context.isStarterAircraft("c172"), true);
assert.equal(context.isStarterAircraft("cabri-g2"), true);
assert.equal(context.isStarterAircraft("h125"), false);

const sellAircraftSource = readFunction("sellAircraft");
assert.match(sellAircraftSource, /isStarterAircraft\(aircraft\.id\)/);

console.log("Starter helicopter: defaults, migration, selection and sale protection passed");
