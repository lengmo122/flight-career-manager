import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [main, pkgText] = await Promise.all(
  ["electron-main.mjs", "package.json"].map((name) => readFile(new URL(name, root), "utf8"))
);
const pkg = JSON.parse(pkgText);

assert.equal(pkg.dependencies["electron-updater"] ? true : false, true, "electron-updater must be a production dependency");
const publish = pkg.build.publish?.[0];
assert.equal(publish?.provider, "github", "publish provider must be GitHub Releases");
assert.equal(publish?.owner, "lengmo122");
assert.equal(publish?.repo, "flight-career-manager");
assert.equal(pkg.build.win.target, "nsis", "auto-update on Windows requires the NSIS target");
assert.match(pkg.scripts["release:win"], /electron-builder --win nsis --publish always/);

assert.match(main, /async function setupAutoUpdater\(\)/);
assert.match(main, /if \(!app\.isPackaged\) return;/, "development runs must not check for updates");
assert.match(main, /await import\("electron-updater"\)/, "updater must load lazily so fast directory builds without it still start");
assert.match(main, /autoUpdater\.on\("update-downloaded"/, "downloaded updates should prompt for restart");
assert.match(main, /autoUpdater\.quitAndInstall\(\)/);
assert.match(main, /autoInstallOnAppQuit = true/, "deferred updates must install on next quit");
assert.match(main, /autoUpdater\.on\("error", \(\) => \{\}\)/, "offline update checks must stay silent");
assert.match(main, /setupAutoUpdater\(\)\.catch\(\(\) => \{\}\)/, "updater setup must not break window creation");

console.log("Auto update: GitHub Releases publish config and updater wiring passed");
