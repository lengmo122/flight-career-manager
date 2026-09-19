import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readAppSource();

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
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

const pickRouteSource = readFunction("pickBaseRoute");
const refreshSource = readFunction("refreshMissionFromAircraft");
const companyOfferSource = readFunction("companyMissionOffer");
const dispatchSource = readFunction("dispatchCompanyTask");
const completeSource = readFunction("completeMission");
const companyCompleteSource = readFunction("completeCompanyTask");

assert.match(pickRouteSource, /aircraftOperationalBase\(aircraft\)/);
assert.match(refreshSource, /makeMission\(category, randomSubtype\(category\), 0, aircraft\)/);
assert.match(source, /generationBase = normalizeBaseCode\(state\?\.pilot\?\.base\)/);
assert.match(source, /makeMission\(category, randomSubtype\(category\), 0, aircraft, generationBase\)/);
assert.match(source, /originMode: normalizeBaseCode\(baseOverride\) \? "pilot-base"/);
assert.match(source, /Once a mission is accepted, the assigned aircraft may be anywhere along/);
assert.match(refreshSource, /state\.missions\.unshift\(mission\)/);
assert.match(completeSource, /aircraft\.lastLandingAirport = completedArrivalAirport/);
assert.match(completeSource, /refreshMissionFromAircraft\(aircraft\)/);
assert.match(companyOfferSource, /function companyMissionOffer\(aircraft = null\)/);
assert.match(companyOfferSource, /aircraftId: selectedAircraft\?\.id/);
assert.match(dispatchSource, /origin: aircraftOperationalBase\(aircraft, mission\.origin \|\| state\.company\.base\)/);
assert.match(companyCompleteSource, /refreshCompanyMissionFromAircraft\(companyAircraft\)/);
assert.match(source, /function missionBelongsToAircraftLocation\(mission\)/);
assert.match(source, /missionBelongsToAircraftLocation\(mission\)/);

console.log("Mission aircraft location: completed routes refresh from the aircraft landing airport for personal and company operations");
