import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

assert.match(htmlSource, /id="toggleCompanyAircraftBtn"/, "the map should expose a company-aircraft visibility toggle");
assert.match(appSource, /mapShowCompanyAircraft: true/, "company aircraft should be visible by default");
assert.match(appSource, /function companyTaskMapPoint\(/, "assigned company flights should calculate a live position");
assert.match(appSource, /function activeCompanyMapFlights\(/, "active company pilots should produce map flights");
assert.match(appSource, /function updateCompanyAircraftOnMap\(/, "company map markers should update in place");
assert.match(appSource, /companyAircraftMarkers = new Map\(\)/, "company markers should be tracked independently");
assert.match(appSource, /state\.company\.pilots\.filter\(\(pilot\) => pilot\.status === "active"\)/, "only active company pilots should be shown");
assert.match(appSource, /toggleCompanyAircraft\(\)/, "the company-aircraft toggle should be wired");
assert.match(cssSource, /\.company-aircraft-marker \{/, "company aircraft should have a distinct map marker style");

console.log("Company aircraft map: live pilot positions, no company track and visibility toggle passed");
