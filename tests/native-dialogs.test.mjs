import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../app.js", import.meta.url), "utf8");

assert.doesNotMatch(appSource, /\b(?:window\.)?confirm\s*\(/, "browser-native confirm dialogs should not expose the localhost title");
assert.doesNotMatch(appSource, /\b(?:window\.)?alert\s*\(/, "browser-native alert dialogs should not expose the localhost title");
assert.match(appSource, /await showConfirmDialog\(/, "destructive actions should use the in-app confirmation modal");
assert.match(appSource, /function showConfirmDialog\(/, "the in-app confirmation modal should remain available");

console.log("Native dialogs: browser title prompts removed in favor of in-app confirmation UI passed");
