import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [app, main, preload] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../electron-main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../preload.cjs", import.meta.url), "utf8")
]);

assert.match(preload, /readPersistentStorage\(key\)[\s\S]*?persistent-storage-read/, "preload should expose fixed desktop storage reads");
assert.match(preload, /writePersistentStorage\(key, value\)[\s\S]*?persistent-storage-write/, "preload should expose fixed desktop storage writes");
assert.match(main, /app\.getPath\("userData"\)[\s\S]*?career-storage\.json/, "desktop storage should use the stable Electron user-data directory");
assert.match(main, /LEGACY_USER_DATA_NAMES = \["flight-career-manager", "Flight Career Manager", "模飞生涯", "Electron"\]/, "desktop storage should recognize legacy application data directories");
assert.match(main, /function readPersistentStorageValue\(key\)[\s\S]*?legacyPersistentStoragePaths\(\)[\s\S]*?writePersistentStorageFile\(migrated\)/, "legacy saves should migrate into the current user-data directory");
assert.match(main, /PERSISTENT_STORAGE_KEYS = new Set\(\["flight-career-manager-v1", "flight-career-manager-backups-v1"\]\)/, "IPC storage should accept only career save keys");
assert.match(main, /persistent-storage-read/, "main process should handle persistent reads");
assert.match(main, /persistent-storage-write/, "main process should serialize persistent writes");
assert.match(main, /persistentStorageWriteChain\.catch/, "application shutdown should wait for queued persistent writes");
assert.match(app, /async function readStorageValue\(key\)/, "renderer should read through the desktop persistence adapter");
assert.match(app, /async function writeStorageValue\(key, value\)/, "renderer should write through the desktop persistence adapter");
assert.match(app, /const raw = await readStorageValue\(STORAGE_KEY\)/, "career hydration should no longer depend on the current port's localStorage");
assert.match(app, /const raw = await readStorageValue\(BACKUP_KEY\)/, "backup hydration should no longer depend on the current port's localStorage");
assert.match(app, /await writeStorageValue\(STORAGE_KEY, await encryptSaveText/, "fixed storage should contain only the encrypted save envelope");
assert.match(app, /async function savePilot\(\)[\s\S]*?await saveState\(\);[\s\S]*?enterSystem\(\)/, "first login should finish persistence before entering the system");
assert.match(app, /document\.body\.dataset\.appReady = "true"/, "restart tests should wait until encrypted hydration and automatic login finish");

console.log("Desktop persistence: port-independent encrypted saves, migration and login flush passed");
