import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const catalogStart = source.indexOf("const aircraftCatalog =");
const catalogEnd = source.indexOf("const aircraftLicenseCatalog", catalogStart);
const rulesStart = source.indexOf("const aircraftIdentityRules =");
const rulesEnd = source.indexOf("\n\nconst missionPolicies", rulesStart);
const policiesStart = source.indexOf("const missionPolicies =");
const policiesEnd = source.indexOf("\n\nconst missionPools", policiesStart);
const compatibilityStart = source.indexOf("function missionRange");
const compatibilityEnd = source.indexOf("function dispatchPhase", compatibilityStart);
assert.ok(catalogStart >= 0 && catalogEnd > catalogStart);
assert.ok(rulesStart > catalogEnd && rulesEnd > rulesStart);
assert.ok(policiesStart > rulesEnd && policiesEnd > policiesStart);
assert.ok(compatibilityStart > policiesEnd && compatibilityEnd > compatibilityStart);

const context = {};
vm.runInNewContext([
  source.slice(catalogStart, catalogEnd),
  source.slice(rulesStart, rulesEnd),
  source.slice(policiesStart, policiesEnd),
  source.slice(compatibilityStart, compatibilityEnd),
  "globalThis.catalog = aircraftCatalog;",
  "globalThis.family = aircraftManufacturerFamily;",
  "globalThis.compatible = isAircraftCompatible;"
].join("\n"), context);

const byId = (id) => context.catalog.find((aircraft) => aircraft.id === id);
assert.equal(context.family(byId("a320")), "空客");
assert.equal(context.family(byId("a319")), "空客");
assert.equal(context.family(byId("b738")), "波音");
assert.equal(context.family(byId("b738-bdsf")), "波音");
assert.equal(context.family(byId("c172")), "其他制造商");

[
  "a320", "a319", "a330", "a380-800", "b738", "b748", "b789",
  "sf50", "cj4", "longitude", "e190", "pc12", "cessna-c408", "h125", "bell-407"
].forEach((id) => {
  assert.equal(context.compatible("客运", byId(id)), true, `${id} should be eligible for passenger missions`);
});
assert.equal(context.compatible("客运", byId("b738-bdsf")), false, "737-800F must remain cargo-only");
assert.equal(context.compatible("客运", byId("beluga")), false, "Beluga must remain cargo-only");
assert.equal(context.compatible("客运", byId("fa18")), false, "F/A-18 must remain outside passenger missions");
console.log("Aircraft classification and passenger mission capability: passed");
