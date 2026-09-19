import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [html, app, css, packageText] = await Promise.all([
  readFile(path.join(root, "index.html"), "utf8"),
  readFile(path.join(root, "app.js"), "utf8"),
  readFile(path.join(root, "styles.css"), "utf8"),
  readFile(path.join(root, "package.json"), "utf8")
]);
const packageVersion = JSON.parse(packageText).version;

assert.match(html, /id="thankSupportBtn"/);
assert.match(html, /id="aboutBtn"/);
assert.match(html, /id="aboutModal"/);
assert.match(html, new RegExp(`版本 ${packageVersion.replaceAll(".", "\\.")}`), "about dialog version must match package version");
assert.match(html, /Microsoft Flight Simulator/);
assert.match(html, /接地载荷高于 3G 视为坠机/);
assert.match(html, /存档会加密保存在本机/);
assert.match(app, /thankSupportBtn\?\.addEventListener\("click", openSupport\)/);
assert.match(app, /aboutBtn\?\.addEventListener\("click", openAbout\)/);
assert.match(app, /function openAbout\(\)/);
assert.match(css, /\.about-steps/);

console.log("quick actions support and about dialogs passed");
