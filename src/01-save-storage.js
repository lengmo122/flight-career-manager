// 模飞生涯 渲染器源码 01-save-storage.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
const STORAGE_KEY = "flight-career-manager-v1";
const BACKUP_KEY = "flight-career-manager-backups-v1";
const SAVE_ENVELOPE_FORMAT = "flight-career-save-aes-gcm-v1";
// The key is deliberately stable so an encrypted export can be imported after an update
// or on another installation of the application. AES-GCM still authenticates every byte.
const SAVE_ENCRYPTION_SECRET = "模飞生涯|flight-career-manager|save-key|v1";
const SAVE_ENCRYPTION_ALGORITHM = { name: "AES-GCM", length: 256 };
const SAVE_IV_LENGTH = 12;
const AVATAR_PRESETS = Array.from({ length: 9 }, (_, index) => {
  const id = `preset-${String(index + 1).padStart(2, "0")}`;
  return { id, label: `预设 ${String(index + 1).padStart(2, "0")}`, src: `./assets/avatars/${id}.png` };
});
let saveCryptoKeyPromise = null;
let saveWriteChain = Promise.resolve();
let backupWriteChain = Promise.resolve();
let backupCache = [];
let saveStorageError = null;
let saveStorageHydrated = false;
let backupsHydrated = false;

async function readStorageValue(key) {
  const desktopStorage = window.desktopApp?.readPersistentStorage;
  if (typeof desktopStorage === "function") {
    try {
      const persistentValue = await desktopStorage(key);
      if (typeof persistentValue === "string" && persistentValue) return persistentValue;
    } catch {
      // Fall back to this origin's legacy browser storage if the desktop file is unavailable.
    }
  }
  const legacyValue = localStorage.getItem(key);
  if (legacyValue && typeof window.desktopApp?.writePersistentStorage === "function") {
    try {
      await window.desktopApp.writePersistentStorage(key, legacyValue);
    } catch {
      // The legacy value remains usable for this launch even if migration cannot be written.
    }
  }
  return legacyValue;
}

async function writeStorageValue(key, value) {
  let browserStorageError = null;
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    browserStorageError = error;
  }
  if (typeof window.desktopApp?.writePersistentStorage === "function") {
    await window.desktopApp.writePersistentStorage(key, value);
    return;
  }
  if (browserStorageError) throw browserStorageError;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function saveCryptoKey() {
  if (saveCryptoKeyPromise) return saveCryptoKeyPromise;
  saveCryptoKeyPromise = (async () => {
    const webCrypto = globalThis.crypto;
    if (!webCrypto?.subtle || !globalThis.TextEncoder) throw new Error("save-crypto-unavailable");
    const digest = await webCrypto.subtle.digest("SHA-256", new TextEncoder().encode(SAVE_ENCRYPTION_SECRET));
    return webCrypto.subtle.importKey("raw", digest, SAVE_ENCRYPTION_ALGORITHM, false, ["encrypt", "decrypt"]);
  })();
  return saveCryptoKeyPromise;
}

async function encryptSaveText(text) {
  const webCrypto = globalThis.crypto;
  const key = await saveCryptoKey();
  const iv = webCrypto.getRandomValues(new Uint8Array(SAVE_IV_LENGTH));
  const ciphertext = await webCrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    format: SAVE_ENVELOPE_FORMAT,
    algorithm: "AES-GCM",
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext))
  });
}

async function decryptSaveText(raw) {
  const envelope = JSON.parse(String(raw || ""));
  if (envelope?.format !== SAVE_ENVELOPE_FORMAT || envelope.algorithm !== "AES-GCM") throw new Error("save-format-invalid");
  const webCrypto = globalThis.crypto;
  const key = await saveCryptoKey();
  const plaintext = await webCrypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
    key,
    base64ToBytes(envelope.data)
  );
  return new TextDecoder().decode(plaintext);
}

async function decodeSavePayload(raw) {
  const text = String(raw || "");
  const parsed = JSON.parse(text);
  if (parsed?.format !== SAVE_ENVELOPE_FORMAT) return { value: parsed, legacy: true };
  return { value: JSON.parse(await decryptSaveText(text)), legacy: false };
}

