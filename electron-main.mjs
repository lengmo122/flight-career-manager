import { app, BrowserWindow, dialog, ipcMain } from "electron";
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

// 自动更新：从 GitHub Releases 检查新版本，下载完成后询问是否重启安装。
// 未打包（开发模式）、快速目录版（不含 electron-updater）或离线时静默跳过。
async function setupAutoUpdater() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    const mod = await import("electron-updater");
    autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  } catch {
    return;
  }
  if (!autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-downloaded", (info) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "info",
      buttons: ["立即重启更新", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "发现新版本",
      message: `新版本 ${info.version} 已下载完成`,
      detail: "点击“立即重启更新”完成安装；选择“稍后”则会在下次退出应用时自动安装。"
    });
    if (choice === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on("error", () => {});
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 5000);
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
  setupAutoUpdater().catch(() => {});
    await mainWindow.loadURL(`http://127.0.0.1:${running.port}/?v=${app.getVersion()}`);
}

app.whenReady().then(() => {
  registerPersistentStorageHandlers();
  ipcMain.on("window-mode", (_event, mode) => {
    if (!mainWindow) return;
    if (mode === "system") {
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(SYSTEM_MIN_WIDTH, SYSTEM_MIN_HEIGHT);
      // No upper bound in system mode: allow maximize/fullscreen on large displays.
      mainWindow.setMaximumSize(0, 0);
      mainWindow.setMaximizable(true);
      mainWindow.setContentSize(SYSTEM_WINDOW_WIDTH, SYSTEM_WINDOW_HEIGHT, true);
    } else {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      mainWindow.setMaximizable(false);
      mainWindow.setMinimumSize(LOGIN_WINDOW_WIDTH, LOGIN_WINDOW_HEIGHT);
      mainWindow.setMaximumSize(0, 0);
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
