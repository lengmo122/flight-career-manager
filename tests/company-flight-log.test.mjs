import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readAppSource();
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(htmlSource, /data-company-section="flight-log"/);
assert.match(htmlSource, /data-company-panel="flight-log"/);
assert.match(htmlSource, /id="companyFlightLogList"/);
assert.match(appSource, /flightLogs: \[\]/);
assert.match(appSource, /function renderCompanyFlightLogs\(/);
assert.match(appSource, /function createCompanyFlightLog\(/);
assert.match(appSource, /function isCrashLanding\(/);
assert.match(appSource, /Number\(landingOrWear\?\.peakG/);
assert.match(appSource, /handleAircraftCrash\(/);
assert.match(appSource, /state\.fleet = state\.fleet\.filter\(\(item\) => item\.id !== aircraft\.id\)/);
assert.match(appSource, /departureAirport/);
assert.match(appSource, /arrivalAirport/);
assert.match(appSource, /airportCheck/);

console.log("Company flight log: independent records, airport checks and crash removal wiring passed");
