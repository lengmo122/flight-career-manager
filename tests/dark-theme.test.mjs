import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(css, /\.mission-animation\s*\{[\s\S]*?background:\s*var\(--surface\)/, "mission progress must follow the active theme");
assert.match(css, /\.tag\s*\{[\s\S]*?background:\s*var\(--surface\)/, "tags must follow the active theme");
assert.match(css, /\.meter\s*\{[\s\S]*?background:\s*var\(--surface-3\)/, "progress meters must follow the active theme");
assert.match(css, /\.task-event-card\.is-live\s*\{[\s\S]*?background:\s*rgba\(8,\s*127,\s*140,\s*0\.09\)/, "live task cards must use a translucent accent");
assert.match(css, /\.career-map\.map-layer-dark \.leaflet-tile-pane\s*\{[\s\S]*?invert\(1\)[\s\S]*?grayscale\(1\)/, "dark map tiles must render as a black and gray layer");
assert.match(css, /\.career-map\.map-layer-dark \.leaflet-control-zoom a/, "dark map controls must have a matching theme");
assert.match(html, /id="themeModeBtn"[\s\S]*?data-lucide="sun"[\s\S]*?data-lucide="moon"/, "top bar should expose sun and moon theme states");
assert.match(css, /:root\[data-theme="dark"\] \.theme-mode-btn \.sun-icon/, "theme command should swap icons with the active app theme");
assert.match(css, /\.theme-mode-btn \.theme-icon\s*\{[\s\S]*?inset:\s*0;[\s\S]*?margin:\s*auto;/, "theme icons must stay centered inside the theme button");

console.log("Dark theme: mission surfaces, shared controls and black-gray map styling passed");
