import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readAppSource()
]);

for (const id of ["scheduleImportBtn", "quickScheduleBtn", "scheduleViewImportBtn", "schedulePreviewModal", "scheduleFile"]) {
  assert.equal(html.includes(`id=\"${id}\"`), false, `${id} should be removed from the UI`);
  assert.equal(app.includes(`getElementById(\"${id}\")`), false, `${id} should not be referenced by app.js`);
}

assert.equal(html.includes("导入时刻表"), false, "schedule import copy should be removed from the UI");
assert.equal(app.includes("导入时刻表"), false, "schedule import copy should be removed from app.js");
assert.match(app, /schedules:\s*\[\]/, "legacy schedule records remain supported");
assert.match(app, /function renderSchedules\(\)/, "legacy schedule records remain viewable");

console.log("schedule import UI removed; legacy records remain readable");
