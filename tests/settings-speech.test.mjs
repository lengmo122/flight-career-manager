import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, html, css] = await Promise.all([
  readAppSource(),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8")
]);
assert.match(source, /id="settingsBtn"|settingsBtn/, "settings gear should be wired");
assert.match(source, /speechVolumeRange/, "speech volume range should be present");
assert.match(source, /audio\.volume = normalizeSpeechVolume/, "audio playback should use the saved volume");
assert.match(source, /settingsModal\.returnValue = ""/, "opening settings should clear a stale dialog result");
assert.match(source, /settingsModal\.returnValue !== "confirm"/, "only explicit confirmation should save volume");
assert.match(source, /function applyTheme\(darkMode = false\)/, "theme application should be centralized");
assert.equal(html.includes('id="darkModeToggle"'), false, "settings should not duplicate the top-bar theme control");
assert.equal(source.includes("darkModeToggle"), false, "removed settings theme input should not be referenced");
assert.ok(html.indexOf('id="themeModeBtn"') < html.indexOf('id="contactAuthorBtn"'), "theme command should sit before contact author");
assert.match(source, /function toggleThemeMode\(\)[\s\S]*?state\.settings\.darkMode = darkMode;[\s\S]*?saveState\(\)/, "top-bar theme changes should apply and persist immediately");
assert.match(html, /class="app-switch"[\s\S]*?id="freeModeToggle"[\s\S]*?app-switch-off">OFF[\s\S]*?app-switch-on">ON/, "free mode should use the custom ON/OFF switch structure");
assert.match(css, /\.app-switch-input:checked \+ \.app-switch-track/, "custom switch should render its checked state through app CSS");

function readFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} source was incomplete`);
}

const context = {};
vm.runInNewContext(`${readFunction("normalizeSpeechVolume")}; globalThis.normalizeSpeechVolume = normalizeSpeechVolume;`, context);
assert.equal(context.normalizeSpeechVolume(0.35), 0.35);
assert.equal(context.normalizeSpeechVolume(-1), 0);
assert.equal(context.normalizeSpeechVolume(2), 1);
assert.equal(context.normalizeSpeechVolume("invalid"), 1);

console.log("Speech settings: gear control, persistence clamp and audio volume wiring passed");
