import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readAppSource();
const catalogStart = source.indexOf("const aircraftCatalog =");
const rulesStart = source.indexOf("const aircraftIdentityRules =");
const functionsStart = source.indexOf("function compactAircraftName");
const functionsEnd = source.indexOf("function pointFromAirport");
assert.ok(catalogStart >= 0 && rulesStart > catalogStart && functionsStart > rulesStart && functionsEnd > functionsStart, "Aircraft matching source was not found");

const catalogEnd = source.indexOf("\n\nconst aircraftIdentityRules", catalogStart);
const rulesEnd = source.indexOf("\n\nconst missionPolicies", rulesStart);
const policiesStart = source.indexOf("const missionPolicies =", rulesEnd);
const policiesEnd = source.indexOf("\n\nconst missionPools", policiesStart);
const testCases = [
  ["PMDG 737-800", "b738", "Boeing 737-800", true],
  ["Boeing 737-800BDSF", "b738-bdsf", "737-800F", true],
  ["PMDG 737-800BCF", "b738-bcf", "737-800F", true],
  ["Boeing 737-800BDSF", "b738-bcf", "737-800F", false],
  ["Boeing 737-800BCF", "b738-bdsf", "737-800F", false],
  ["PMDG 737-800", "b38m", "Boeing 737 MAX 8", false],
  ["FlyByWire A32NX", "a320", "Airbus A320neo", true],
  ["FlyByWire A32NX", "a321", "Airbus A321LR", false],
  ["", "c172", "Cessna 172 Skyhawk", false],
  ["Asobo C172SP G1000", "c172", "Cessna 172 Skyhawk", true],
  ["Cessna Skyhawk G1000 Asobo", "c172", "Cessna 172 Skyhawk", true],
  ["Airbus H125", "h125", "Airbus H125", true],
  ["Airbus H125", "h225", "Airbus H225", false],
  ["", "a320", "Airbus A320neo", true, "A20N"],
  ["Airbus A320neo", "a320-ceo", "Airbus A320", false],
  ["Airbus A320", "a320-ceo", "Airbus A320", true, "A320"],
  ["FenixA319 CFM SL HD", "a319", "Airbus A319", true],
  ["FenixA320 CFM", "a320-ceo", "Airbus A320", true],
  ["FenixA321 CFM", "a321-ceo", "Airbus A321", true],
  ["Boeing 787-9 Dreamliner", "b789", "Boeing 787-9 Dreamliner", true, "B789"],
  ["Bombardier CRJ-900", "crj-900", "Bombardier CRJ-900", true, "CRJ9"],
  ["Bell Model 407 - Microsoft/iniBuilds", "bell-407", "Bell Model 407", true, "B407"],
  ["Erickson Incorporated S-64F Skycrane - Blackbird Simulations", "s64f", "Erickson S-64F Skycrane", true],
  ["Boeing CH-47D Chinook - Blackbird Simulations", "ch47d", "Boeing CH-47D Chinook", true],
  ["Eurocopter EC-135 T1 - Nemeth Designs", "ec135-t1", "Eurocopter EC-135 T1", true],
  ["Robinson R66 Turbine - Microsoft/Carenado", "r66", "Robinson R66 Turbine", true],
  ["Guimbal Cabri G2 - Asobo Studio", "cabri-g2", "Guimbal Cabri G2", true],
  ["Bell UH-1H Huey - Taog's Hangar", "uh1h", "Bell UH-1H Huey", true],
  ["Bell Model 407 - Microsoft/iniBuilds", "uh1h", "Bell UH-1H Huey", false],
  ["Bell UH-1H Huey - Taog's Hangar", "bell-407", "Bell Model 407", false],
  ["Airbus A350-900 ULR", "a350-900", "Airbus A350-900", true],
  ["Airbus A350-1000 Etihad Cabin", "a350-1000", "Airbus A350-1000", true],
  ["FlyByWire A380X", "a380-800", "Airbus A380-800", true, "A388"],
  ["Cirrus Vision Jet G2", "sf50", "Cirrus Vision Jet SF50", true],
  ["Aviat Pitts Special S-1S", "pitts-s1s", "Aviat Pitts Special S-1S", true],
  ["Aviat Pitts Special S-1S", "pitts", "Aviat Pitts Special S-2S", false],
  ["Aviat Pitts Special S-2S", "pitts", "Aviat Pitts Special S-2S", true],
  ["Aviat Pitts Special S-2S", "pitts-s1s", "Aviat Pitts Special S-1S", false],
  ["Beechcraft King Air C90 GTX", "kingair-c90", "Beechcraft King Air C90 GTX", true],
  ["Blackbird Simulations 310R", "blackbird-310r", "Blackbird Simulations 310R", true],
  ["Cessna 185 Skywagon", "cessna-185", "Cessna 185 Skywagon", true],
  ["Cessna 188 AGtruck", "cessna-188", "Cessna 188 AGtruck", true],
  ["Cessna 404 Titan", "cessna-404", "Cessna 404 Titan", true],
  ["Cessna C400 Corvalis TT", "cessna-c400", "Cessna C400 Corvalis TT", true],
  ["Cessna C408 SkyCourier", "cessna-c408", "Cessna C408 SkyCourier", true],
  ["Curtiss JN-4 Jenny", "curtiss-jn4", "Curtiss JN-4 Jenny", true],
  ["De Havilland DHC-6-300 Twin Otter", "dhc6-300", "De Havilland DHC-6-300 Twin Otter", true],
  ["Magni Gyro M24", "magni-m24", "Magni Gyro M24", true],
  ["Atey Aviation Draco X", "draco-x", "Atey Aviation Draco X", true],
  ["Pilatus PC-24", "pc24", "Pilatus PC-24", true],
  ["Ryan NYP Spirit of St. Louis", "ryan-nyp", "Ryan NYP Spirit of St. Louis", true],
  ["Saab 340B", "saab-340", "Saab 340", true],
  ["Cessna C400 Corvalis TT", "cessna-404", "Cessna 404 Titan", false],
  ["Cessna C408 SkyCourier", "cessna-c400", "Cessna C400 Corvalis TT", false],
  ["Pilatus PC-24", "pc12", "Pilatus PC-12 NGX", false],
  ["Pilatus PC-12 NGX", "pc24", "Pilatus PC-24", false],
  ["Airbus A350-900 ULR", "a350-1000", "Airbus A350-1000", false],
  ["Airbus A350-1000 Etihad Cabin", "a350-900", "Airbus A350-900", false],
  ["德事隆航空 塞斯纳152 Aerobat - Asobo Studio 默认", "c152-aerobat", "Cessna 152 Aerobat", true],
  ["Cessna 152 Aerobat - Asobo Studio", "c152", "Cessna 152", false],
  ["德事隆航空 塞斯纳152 - Asobo Studio 空中广告", "c152", "Cessna 152", true],
  ["德事隆航空 比奇男爵 G58 - Asobo Studio 私人包机", "baron-g58", "Beechcraft Baron G58", true],
  ["德事隆航空 比奇富豪 G36 - Asobo Studio 私人包机", "bonanza-g36", "Beechcraft Bonanza G36", true],
  ["德事隆航空 比奇空中国王350i - Asobo Studio 默认", "kingair-350", "Beechcraft King Air 350i", true],
  ["塞斯纳 208B Grand Caravan EX - Asobo Studio 医疗后送", "cessna-208", "Cessna 208B Grand Caravan EX", true],
  // MSFS 2020/2024 原生补充与第三方付费机型。
  ["Douglas DC-3 - Microsoft/Aeroplane Heaven", "dc3", "Douglas DC-3", true],
  ["De Havilland Dash 8 Q400", "dash8-q400", "De Havilland Dash 8 Q400", true],
  ["PMDG 737-700 PW Winglets", "b737-pmdg-700", "Boeing 737-700", true],
  ["PMDG 737-700 PW Winglets", "b736", "Boeing 737-600", false],
  ["PMDG 737-800", "b737-pmdg-700", "Boeing 737-700", false],
  ["Boeing 777F GE", "b77f", "Boeing 777F", true],
  ["Boeing 777-200LR GE", "b77f", "Boeing 777F", false],
  ["Boeing 747-8F Cargolux", "b748f", "Boeing 747-8F", true],
  ["Airbus A321neo iniBuilds", "a321neo", "Airbus A321neo", true],
  ["Airbus A321LR", "a321neo", "Airbus A321neo", false],
  ["Fly The Maddog X MD-82", "md80-leonardo", "Leonardo MD-82 Fly The Maddog X", true],
  ["Felis Boeing 747-200", "b742", "Boeing 747-200", true],
  ["Boeing 747-400 Rolls Royce", "b744", "Boeing 747-400", true],
  ["Boeing 747-400 Rolls Royce", "b748", "Boeing 747-8 Intercontinental", false],
  ["Concorde by DC Designs", "concorde", "Aerospatiale-BAC Concorde", true],
  ["HPG Airbus H135 Luxury", "airbus-h135", "Airbus H135", true],
  ["Airbus H145 Action Pack", "h145", "Airbus H145", true],
  ["Airbus H160 - Asobo", "h160", "Airbus H160", true],
  ["Robinson R44 Raven II", "r44", "Robinson R44 Raven II", true],
  ["Robinson R44 Raven II", "r66", "Robinson R66 Turbine", false],
  ["Bell 206B JetRanger", "bell-206", "Bell 206B JetRanger", true],
  ["Just Flight PA-28R Arrow III", "pa28-arrow", "Piper PA-28R Arrow III", true],
  ["Just Flight PA-38 Tomahawk", "pa38-tomahawk", "Piper PA-38 Tomahawk", true],
  ["Daher Kodiak 100 Series II", "kodiak-100", "Daher Kodiak 100", true],
  ["Embraer Phenom 300E", "phenom-300", "Embraer Phenom 300E", true],
  ["HondaJet HA-420", "hjet", "Honda HA-420 HondaJet", true],
  ["PMDG DC-6B Cloudmaster", "dc6", "Douglas DC-6B", true],
  ["Aerosoft DHC-6 Twin Otter 300", "twin-otter-aerosoft", "DHC-6 Twin Otter (Aerosoft)", true],
  ["Antonov An-2 - Wing42", "an2", "Antonov An-2", true],
  ["Supermarine Spitfire Mk IX", "spitfire", "Supermarine Spitfire", true],
  ["North American P-51D Mustang", "p51d", "North American P-51D Mustang", true],
  ["Lockheed C-130 Hercules", "dc-designs-c130", "Lockheed C-130 Hercules", true],
  ["Cessna 182T Skylane G1000", "c182t", "Cessna 182T Skylane", true],
  ["Cessna 310R Blackbird", "c310r", "Cessna 310R", true]
];

const context = { testCases };
vm.runInNewContext([
  source.slice(catalogStart, catalogEnd),
  source.slice(rulesStart, rulesEnd),
  source.slice(policiesStart, policiesEnd),
  source.slice(functionsStart, functionsEnd),
  "globalThis.catalogIds = aircraftCatalog.map((aircraft) => aircraft.id);",
  "globalThis.catalogNames = Object.fromEntries(aircraftCatalog.map((aircraft) => [aircraft.id, aircraft.name]));",
  "globalThis.missionKinds = Object.fromEntries(Object.entries(missionPolicies).map(([category, policy]) => [category, policy.kinds]));",
  "globalThis.results = testCases.map(([title, id, name, expected, typeCode]) => ({ expected, actual: telemetryMatchesAircraft({ aircraftTitle: title, aircraftTypeCode: typeCode || '' }, { id, name }) }));"
].join("\n"), context);

context.results.forEach((result, index) => assert.equal(result.actual, result.expected, `Aircraft match case ${index + 1} failed`));
const helicopterIds = ["h125", "h225", "bell-407", "s64f", "ch47d", "ec135-t1", "r66", "cabri-g2", "uh1h"];
helicopterIds.forEach((id) => assert.ok(context.catalogIds.includes(id), `Helicopter catalog is missing ${id}`));
const picturedAircraftIds = [
  "c152-aerobat", "pitts-s1s", "kingair-c90", "blackbird-310r", "cessna-185", "cessna-188",
  "cessna-404", "cessna-c400", "cessna-c408", "curtiss-jn4", "dhc6-300",
  "magni-m24", "draco-x", "pc24", "ryan-nyp", "saab-340"
];
picturedAircraftIds.forEach((id) => assert.ok(context.catalogIds.includes(id), `Pictured aircraft catalog is missing ${id}`));
[
  ["b738-bdsf", "737-800F"],
  ["b738-bcf", "737-800F"]
].forEach(([id, name]) => {
  assert.ok(context.catalogIds.includes(id), `Cargo 737 catalog is missing ${id}`);
  assert.equal(context.catalogNames[id], name, `${id} should display as ${name}`);
});
assert.ok(context.missionKinds.包机.includes("直升机"), "Light helicopters must support charter missions");
assert.ok(context.missionKinds.货运.includes("直升机"), "Light helicopters must support cargo missions");
assert.ok(context.missionKinds.货运.includes("重型直升机"), "Heavy helicopters must support cargo missions");
assert.ok(context.missionKinds.货运.includes("货运喷气"), "Cargo jets must support cargo missions");
assert.ok(context.missionKinds.包机.includes("旋翼机"), "Gyroplanes must support charter missions");
assert.ok(context.missionKinds.包机.includes("复古飞机"), "Vintage aircraft must support charter missions");
console.log(`Aircraft matching: ${context.results.length} cases passed`);
