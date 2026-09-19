import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readAppSource();
const htmlSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../styles.css", import.meta.url), "utf8");

assert.match(htmlSource, /id="followAircraftBtn"/, "map should expose an aircraft tracking button");
assert.match(htmlSource, /aria-pressed="false"/, "tracking button should expose its initial state");
assert.match(appSource, /mapAutoTrack: false/, "tracking should be disabled by default");
assert.match(appSource, /state\.settings\.mapAutoTrack = enabled/, "tracking toggle should persist its state");
assert.match(appSource, /leafletMap\.setView\(latLng, leafletMap\.getZoom\(\), \{ animate: false \}\)/, "live updates should recenter the map without changing zoom");
assert.match(cssSource, /\.map-track-btn\.is-active/, "active tracking state should be visible");

console.log("Map tracking: button, persistence, live recentering and active styling passed");
