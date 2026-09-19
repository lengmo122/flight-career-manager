import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { shutdownBridges, startServer } from "./server.mjs";

let server;
let mainWindow;
let quitting = false;
const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));
const appIconPath = fileURLToPath(new URL("./assets/app-icon.ico", import.meta.url));
const SYSTEM_WINDOW_WIDTH = 1566;
const SYSTEM_WINDOW_HEIGHT = 854;
const SYSTEM_WINDOW_MAX_HEIGHT = 885;
const SYSTEM_MIN_WIDTH = 1024;
const SYSTEM_MIN_HEIGHT = 640;
const LOGIN_WINDOW_WIDTH = 500;
const LOGIN_WINDOW_HEIGHT = 390;
const PERSISTENT_STORAGE_KEYS = new Set(["flight-career-manager-v1", "flight-career-manager-backups-v1"]);
const LEGACY_USER_DATA_NAMES = ["flight-career-manager", "Flight Career Manager", "模飞生涯", "Electron"];
let persistentStorageWriteChain = Promise.resolve();

if (process.env.FLIGHT_MANAGER_PERSISTENCE_TEST === "1" && isAbsolute(process.env.FLIGHT_MANAGER_TEST_USER_DATA || "")) {
  app.setPath("userData", process.env.FLIGHT_MANAGER_TEST_USER_DATA);
}

function persistentStoragePath() {
  return join(app.getPath("userData"), "career-storage.json");
}

function legacyPersistentStoragePaths() {
  const currentPath = persistentStoragePath().toLowerCase();
  return LEGACY_USER_DATA_NAMES
    .map((name) => join(app.getPath("appData"), name, "career-storage.json"))
    .filter((path) => path.toLowerCase() !== currentPath);
}

async function readPersistentStorageFileAt(path) {
  try {
    const text = await readFile(path, "utf8");
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function readPersistentStorageFile() {
  return readPersistentStorageFileAt(persistentStoragePath());
}

async function readPersistentStorageValue(key) {
  const current = await readPersistentStorageFile();
  if (typeof current[key] === "string" && current[key]) return current[key];
  for (const legacyPath of legacyPersistentStoragePaths()) {
    const legacy = await readPersistentStorageFileAt(legacyPath).catch(() => ({}));
    if (typeof legacy[key] !== "string" || !legacy[key]) continue;
    const migrated = { ...legacy, ...current };
    await writePersistentStorageFile(migrated);
    return migrated[key];
  }
  return null;
}

async function writePersistentStorageFile(values) {
  const target = persistentStoragePath();
  const temporary = `${target}.tmp`;
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(temporary, JSON.stringify(values), "utf8");
  await rename(temporary, target);
}

function registerPersistentStorageHandlers() {
  ipcMain.handle("persistent-storage-read", async (_event, key) => {
    if (!PERSISTENT_STORAGE_KEYS.has(key)) return null;
    return readPersistentStorageValue(key);
  });
  ipcMain.handle("persistent-storage-write", (_event, key, value) => {
    if (!PERSISTENT_STORAGE_KEYS.has(key) || typeof value !== "string") {
      throw new Error("persistent-storage-invalid");
    }
    persistentStorageWriteChain = persistentStorageWriteChain
      .catch(() => {})
      .then(async () => {
        const values = await readPersistentStorageFile();
        values[key] = value;
        await writePersistentStorageFile(values);
      });
    return persistentStorageWriteChain;
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

async function createWindow() {
  const persistenceTestMode = process.env.FLIGHT_MANAGER_PERSISTENCE_TEST === "1";
  process.env.FLIGHT_MANAGER_TELEMETRY_EXE = join(process.resourcesPath, "telemetry", "SkylineVA.Msfs2024Telemetry.exe");
  process.env.FLIGHT_MANAGER_SCENE_EXE = join(process.resourcesPath, "scene-bridge", "SkylineVA.MsfsSceneBridge.exe");
  let running;
  try {
    running = await startServer(4174);
  } catch (error) {
    if (error?.code !== "EADDRINUSE") throw error;
    running = await startServer(0);
  }
  server = running.server;
  mainWindow = new BrowserWindow({
    width: LOGIN_WINDOW_WIDTH,
    height: LOGIN_WINDOW_HEIGHT,
    minWidth: LOGIN_WINDOW_WIDTH,
    minHeight: LOGIN_WINDOW_HEIGHT,
    maxWidth: SYSTEM_WINDOW_WIDTH,
    maxHeight: SYSTEM_WINDOW_MAX_HEIGHT,
    resizable: false,
    maximizable: false,
    useContentSize: true,
    show: false,
    backgroundColor: "#fbfcfd",
    autoHideMenuBar: true,
    title: "模飞生涯",
    icon: appIconPath,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.once("ready-to-show", () => {
    if (!persistenceTestMode) mainWindow?.show();
  });
    await mainWindow.loadURL(`http://127.0.0.1:${running.port}/?v=${app.getVersion()}`);
}

app.whenReady().then(() => {
  registerPersistentStorageHandlers();
  ipcMain.on("window-mode", (_event, mode) => {
    if (!mainWindow) return;
    if (mode === "system") {
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(SYSTEM_MIN_WIDTH, SYSTEM_MIN_HEIGHT);
      mainWindow.setMaximumSize(SYSTEM_WINDOW_WIDTH, SYSTEM_WINDOW_MAX_HEIGHT);
      mainWindow.setContentSize(SYSTEM_WINDOW_WIDTH, SYSTEM_WINDOW_HEIGHT, true);
    } else {
      mainWindow.setMinimumSize(LOGIN_WINDOW_WIDTH, LOGIN_WINDOW_HEIGHT);
      mainWindow.setMaximumSize(SYSTEM_WINDOW_WIDTH, SYSTEM_WINDOW_MAX_HEIGHT);
      mainWindow.setContentSize(LOGIN_WINDOW_WIDTH, LOGIN_WINDOW_HEIGHT, true);
      mainWindow.setResizable(false);
    }
    mainWindow.center();
  });
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  return createWindow();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  const closeServer = server
    ? new Promise((resolveClose) => {
      // Renderer keep-alive connections must not prevent native capture cleanup on quit.
      const deadline = setTimeout(() => server.closeAllConnections?.(), 1500);
      deadline.unref();
      server.close(() => { clearTimeout(deadline); resolveClose(); });
      server.closeIdleConnections?.();
    })
    : Promise.resolve();
  void Promise.all([closeServer, shutdownBridges(), persistentStorageWriteChain.catch(() => {})])
    .finally(() => app.quit());
});
