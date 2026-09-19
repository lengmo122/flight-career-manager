import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const app = await readAppSource();
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /id="freeModeToggle"[\s\S]*?aria-label="自由模式"/, "settings must expose a free mode switch");
assert.match(app, /freeMode:\s*false/, "free mode must be disabled by default");
assert.match(app, /freeMode:\s*incoming\.settings\?\.freeMode === true/, "free mode must migrate from saved settings");
assert.match(app, /!isFreeMode\(\) && !mission\.permittedAircraftIds\?\.includes/, "free mode must bypass mission aircraft restrictions");
assert.match(app, /const detectedMissionAircraft = isFreeMode\(\)/, "free mode must bypass live aircraft restrictions");
assert.match(app, /const arrivedAtAirport = isFreeMode\(\)/, "free mode must complete airport tasks without touchdown");
assert.match(app, /\(isFreeMode\(\) && targetDistance <= targetRadius\)/, "free mode must complete scene arrival without touchdown");
assert.match(app, /payload\.connected && !isFreeMode\(\) \? syncFleetLandingWear/, "free mode must disable landing wear and crash checks");
assert.match(app, /自由模式 · 不限机型/, "mission cards must explain the active free-mode rule");
assert.match(app, /const unlockable = isFreeMode\(\) \|\| state\.stats\.totalHours >= aircraft\.unlockHours/,
  "free mode must remove aircraft market hour limits");
assert.match(app, /if \(!isFreeMode\(\) && state\.stats\.totalHours < template\.unlockHours\)/,
  "aircraft purchases and rentals must bypass hour checks in free mode");
assert.match(app, /freeModeCashSnapshot/, "free mode must persist the original career balance");

const context = { state: { settings: { freeMode: true } } };
vm.runInNewContext("function isFreeMode() { return state.settings?.freeMode === true; } globalThis.isFreeMode = isFreeMode;", context);
assert.equal(context.isFreeMode(), true);
context.state.settings.freeMode = false;
assert.equal(context.isFreeMode(), false);

const transactions = [];
const financeContext = {
  state: { cash: 42_500, settings: { freeMode: false, freeModeCashSnapshot: null } },
  FREE_MODE_CASH: 1_000_000,
  isFreeMode() { return financeContext.state.settings.freeMode === true; },
  recordFundTransaction({ amount, ...transaction }) {
    financeContext.state.cash += amount;
    transactions.push({ amount, ...transaction, balance: financeContext.state.cash });
  }
};
const applyStart = app.indexOf("function applyFreeModeFinancialState(");
const applyBody = app.indexOf("{", applyStart);
let applyDepth = 0;
let applyEnd = applyBody;
for (; applyEnd < app.length; applyEnd += 1) {
  if (app[applyEnd] === "{") applyDepth += 1;
  if (app[applyEnd] === "}") applyDepth -= 1;
  if (applyDepth === 0) break;
}
vm.runInNewContext(`${app.slice(applyStart, applyEnd + 1)}\nglobalThis.applyFreeModeFinancialState = applyFreeModeFinancialState;`, financeContext);

assert.equal(financeContext.applyFreeModeFinancialState(true), true);
assert.equal(financeContext.state.cash, 1_000_000);
assert.equal(financeContext.state.settings.freeModeCashSnapshot, 42_500);
assert.equal(transactions[0].type, "free-mode-adjustment");

financeContext.state.cash = 760_000;
assert.equal(financeContext.applyFreeModeFinancialState(false), true);
assert.equal(financeContext.state.cash, 42_500, "career balance must be restored after free mode closes");
assert.equal(financeContext.state.settings.freeModeCashSnapshot, null);
assert.equal(transactions[1].balance, 42_500);

console.log("Free mode: market unlock, temporary funds, persistence and unrestricted mission rules passed");
