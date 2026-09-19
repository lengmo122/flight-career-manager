import { readAppSource } from "./helpers/app-source.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readAppSource();

assert.match(source, /SAVE_ENVELOPE_FORMAT\s*=\s*["']flight-career-save-aes-gcm-v1/);
assert.match(source, /name:\s*["']AES-GCM["']/);
assert.match(source, /async function encryptSaveText/);
assert.match(source, /async function decryptSaveText/);
assert.match(source, /hydrateStoredState\(\)/);
assert.match(source, /a\.download\s*=\s*`flight-career-save-\$\{.*\.fcm/);
assert.match(source, /decoded\.legacy \? ["']旧版存档已导入并加密/);
assert.match(source, /writeStorageValue\(BACKUP_KEY, await encryptSaveText/);

console.log("Save encryption: AES-GCM storage, backups, export and legacy migration passed");
