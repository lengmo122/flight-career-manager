import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, electronMain, packageJson, icon] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "electron-main.mjs"), "utf8"),
  readFile(path.join(root, "package.json"), "utf8"),
  readFile(path.join(root, "assets", "app-icon.ico"))
]);

assert.match(html, /<title>模飞生涯<\/title>/);
const { version } = JSON.parse(packageJson);
assert.match(
  html,
  new RegExp(`模飞生涯 · 版本 ${version.replaceAll(".", "\\.")}`),
  "visible app version must match package version"
);
assert.match(electronMain, /title: "模飞生涯"/);
assert.match(packageJson, /"productName": "模飞生涯"/);
assert.equal(icon.readUInt16LE(0), 0, "ICO reserved field must be zero");
assert.equal(icon.readUInt16LE(2), 1, "application icon must use ICO type");
assert.ok(icon.readUInt16LE(4) >= 3, "ICO must contain multiple resolution entries");
assert.equal(icon.readUInt8(6), 16, "ICO must include a 16px entry");
assert.equal(icon.readUInt8(6 + 16 * 6), 0, "ICO must include a 256px entry");

console.log("app branding and valid ICO passed");
