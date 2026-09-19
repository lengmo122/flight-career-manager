import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readAppSource();
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(htmlSource, /id="pilotNameInput"[^>]+inputmode="numeric"[^>]+pattern="\[0-9\]\{2,32\}"/, "pilot callsign should accept digits only");
assert.match(htmlSource, /id="pilotBaseInput"[^>]+pattern="\[A-Za-z\]\{4\}"/, "pilot base should accept letters only");
assert.match(appSource, /function normalizeAirportInputCode\(/, "airport input should have a dedicated letters-only normalizer");
assert.match(appSource, /event\.target\.id === "pilotNameInput"[\s\S]{0,180}replace\(\/\\D\/g, ""\)/, "callsign input should remove non-digits while typing");
assert.match(appSource, /if \(!\/\^\\d\{2,32\}\$\/.test\(name\)\)/, "login should reject non-numeric callsigns");
assert.match(appSource, /if \(!\/\^\[A-Z\]\{4\}\$\/.test\(base\)\)/, "login should reject non-letter airport codes");
assert.match(appSource, /id="companyBaseInput"[^>]+pattern="\[A-Za-z\]\{4\}"/, "company base should use the same letters-only airport rule");

console.log("Pilot input validation: numeric callsign and alphabetic airport-code rules passed");
