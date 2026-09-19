import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const data = JSON.parse(await readFile(new URL("../assets/data/global-airports-zh.json", import.meta.url), "utf8"));
const appSource = await readAppSource();

assert.ok(data.airports.length >= 10000, "global airport catalog should contain all four-letter ICAO airports");
assert.equal(new Set(data.airports.map((airport) => airport.icao)).size, data.airports.length, "airport ICAO codes should be unique");
assert.ok(data.airports.every((airport) => /^[A-Z0-9]{4}$/.test(airport.icao)), "every bundled airport should use a four-character ICAO code");
assert.ok(data.airports.every((airport) => /[\u4e00-\u9fff]/.test(airport.name)), "every airport label should contain Chinese text");
assert.equal(data.airports.find((airport) => airport.icao === "ZBAA")?.name, "北京首都");
assert.match(appSource, /global-airports-zh\.json/, "the company base picker should load the global airport catalog");
assert.match(appSource, /companyBaseInput/, "the company base should support direct ICAO input");
assert.match(appSource, /companyAirportByIcao/, "company base validation should use the global airport index");

console.log(`Global airports: ${data.airports.length} four-letter ICAO records with Chinese labels passed`);
