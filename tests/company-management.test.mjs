import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const appSource = await readAppSource();
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const logoFiles = new Set(await readdir(new URL("../assets/logos/", import.meta.url)));

for (const section of ["management", "tasks", "pilots", "recruitment", "hangar", "finance"]) {
  assert.match(htmlSource, new RegExp(`data-company-section="${section}"`), `${section} company module should exist`);
  assert.match(htmlSource, new RegExp(`data-company-panel="${section}"`), `${section} company panel should exist`);
}
assert.match(appSource, /company: \{/, "company state should be part of the save model");
assert.match(appSource, /function canCreateCompany\(/, "company creation should expose a qualification check");
assert.match(appSource, /rank === "机长" \|\| rank === "教员" \|\| Number\(state\.cash \|\| 0\) >= 1_000_000/, "captain rank or one million personal funds should qualify");
assert.match(appSource, /if \(!canCreateCompany\(\)\) \{[\s\S]{0,120}return;/, "unqualified pilots must be blocked from creating a company");
assert.match(appSource, /recordFundTransaction\(\{ amount: -funds, type: "company-investment"/, "company creation should debit personal funds");
assert.match(appSource, /companyTransaction\(\{ amount: funds, type: "company-investment"/, "company creation should credit company funds");
assert.match(appSource, /function hireCompanyPilot\(/, "recruitment should hire pilots");
assert.match(appSource, /function upgradeCompanyPilot\(/, "pilot management should support skill upgrades");
assert.match(appSource, /function fireCompanyPilot\(/, "pilot management should support firing");
assert.match(appSource, /function dispatchCompanyTask\(/, "company tasks should support dispatch");
assert.match(appSource, /function completeCompanyTask\(/, "company tasks should support completion income");
assert.match(appSource, /function renderManagedAircraftCard\(/, "company hangar should reuse aircraft operations");
assert.match(appSource, /companyHangarIsActive\(\)/, "company hangar operations should select the company account");
assert.match(appSource, /companyTransaction\(\{ amount: -cost, type: "maintenance-expense"/, "company repairs should debit company funds");
assert.match(appSource, /function closeCompany\(/, "company management should support closing a company");
assert.match(appSource, /writeBackup\(`关闭公司前：\$\{companyName\}`\)/, "closing a company should create a recoverable backup");
assert.match(appSource, /data-action="close-company"/, "company management should expose a close-company action");
assert.match(appSource, /pilots: \[\],\n    applicants: \[\],\n    taskOffers: \[\],\n    tasks: \[\]/, "closing a company should clear company collections");
const airlineCodes = [...appSource.matchAll(/\{ id: "[^"]+", code: "([A-Z]{3})"/g)].map((match) => match[1]);
for (const code of airlineCodes) assert.ok(logoFiles.has(`${code}.png`), `${code}.png should be bundled from the airline logo library`);
assert.ok(logoFiles.has("default.png"), "default airline logo should be bundled");
assert.match(appSource, /const LOGO_BASE_URL = "\.\/assets\/logos\/"/, "airline logos should load from bundled logo assets");
assert.match(appSource, /id="companyNameInput"[^>]+minlength="3"[^>]+maxlength="3"/, "company creation should accept a three-letter airline code in the company field");
assert.match(appSource, /id="companyAircraftSelect"/, "company creation should expose an initial aircraft selector");
assert.match(appSource, /function normalizeAirlineCode\(/, "airline code input should be normalized");
assert.match(appSource, /const airline = airlines\.find\(\(item\) => item\.code === airlineCode\)/, "company creation should resolve the entered airline code");
assert.match(appSource, /请输入有效的三字航空公司代码/, "invalid airline codes should be rejected");
assert.match(appSource, /airlinePanelTitle/, "sidebar airline panel should expose a synchronized title");
assert.match(htmlSource, /id="airlinePanel"/, "sidebar company panel should have a dedicated visibility boundary");
assert.match(appSource, /els\.airlinePanel\) els\.airlinePanel\.hidden = !company/, "sidebar company panel should stay hidden until a company exists");
assert.doesNotMatch(appSource, /id="airlineSelect"/, "sidebar should not expose a redundant airline selector");
assert.doesNotMatch(appSource, /airlineSelect\.addEventListener/, "sidebar should not bind a removed airline selector");
assert.match(appSource, /company \? "运营中" : "当前就职"/, "company status should use concise natural wording");
assert.match(appSource, /公司资金 \$\{formatMoney\(company\.funds\)\}/, "sidebar should show synchronized company funds");

console.log("Company management: six modules, isolated funds, pilot actions, dispatch and hangar wiring passed");
