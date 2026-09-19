import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { EdgeTTS } from "node-edge-tts";
import { PanelService } from "./panel-service.mjs";

let panelService;
function getPanelService() { return panelService ||= new PanelService(); }

const rootDir = resolve(import.meta.dirname);
const port = Number(process.env.PORT || 4174);
const tiandituToken = String(process.env.TIANDITU_TOKEN || "2c704d83ccac96ef278898d98bd1f86e").trim();
const telemetryDir = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "SkylineVA", "msfs2024-telemetry-v2");
const telemetryPath = join(telemetryDir, "telemetry.ndjson");
const landingReportPath = join(telemetryDir, "landing-reports.jsonl");
const sceneStatusPath = join(telemetryDir, "scene-status.json");
const flightPlanStatusPath = join(telemetryDir, "flight-plan-status.json");
const fuelCommandPath = join(telemetryDir, "fuel-command.json");
const fuelStatusPath = join(telemetryDir, "fuel-status.json");
const runtimeLogPath = join(telemetryDir, "runtime-log.ndjson");
// The telemetry bridge writes five snapshots per second, but MSFS can pause
// SimConnect briefly while loading scenery or changing aircraft.
const telemetryFreshnessMs = 8_000;
const auxiliaryBridgeWarmupMs = 8_000;
const metarCacheTtlMs = 5 * 60 * 1000;
const metarCache = new Map();
let telemetryBridge = null;
let telemetryStartPromise = null;
let sceneBridge = null;
let flightPlanBridge = null;
let telemetryStopPromise = null;
let sceneStopPromise = null;
let flightPlanStopPromise = null;
let telemetryConnectedSince = null;
let lastLoggedTelemetryConnection = null;
let runtimeLogs = [];
let runtimeLogsLoaded = false;
let runtimeLogWritePromise = Promise.resolve();
let telemetryStopPath = null;
let sceneStopPath = null;
let flightPlanStopPath = null;
let activeSceneMissionId = null;
let activeFlightPlanMissionId = null;
const bridgeMeta = {
  telemetry: { executable: null, pid: null, startedAt: null, lastExit: null, lastError: null },
  scene: { executable: null, pid: null, startedAt: null, lastExit: null, lastError: null },
  flightPlan: { executable: null, pid: null, startedAt: null, lastExit: null, lastError: null }
};

async function loadRuntimeLogs() {
  if (runtimeLogsLoaded) return runtimeLogs;
  runtimeLogsLoaded = true;
  try {
    const text = readFileSync(runtimeLogPath, "utf8");
    runtimeLogs = text.split(/\r?\n/).filter(Boolean).slice(-300).flatMap((line) => {
      try { const entry = JSON.parse(line); return entry?.message ? [entry] : []; } catch { return []; }
    });
  } catch { runtimeLogs = []; }
  return runtimeLogs;
}

function recordRuntimeLog(level, message, context = {}) {
  if (!runtimeLogsLoaded) void loadRuntimeLogs();
  const entry = {
    at: new Date().toISOString(),
    level: ["info", "warn", "error"].includes(level) ? level : "info",
    message: String(message || "未知运行事件").slice(0, 500),
    context: context && typeof context === "object" ? context : {}
  };
  runtimeLogs.push(entry);
  runtimeLogs = runtimeLogs.slice(-300);
  runtimeLogWritePromise = runtimeLogWritePromise.then(async () => {
    await mkdir(telemetryDir, { recursive: true });
    await appendFile(runtimeLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  }).catch(() => {});
  return entry;
}

async function clearRuntimeLogs() {
  await runtimeLogWritePromise;
  runtimeLogs = [];
  runtimeLogsLoaded = true;
  await unlink(runtimeLogPath).catch(() => {});
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

function respondJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function latestMetarObservations(ids) {
  const requested = [...new Set(ids.map((id) => String(id || "").trim().toUpperCase()))]
    .filter((id) => /^[A-Z]{4}$/.test(id))
    .slice(0, 20);
  if (!requested.length) throw new Error("invalid-airport-list");

  const now = Date.now();
  const missing = requested.filter((id) => now - Number(metarCache.get(id)?.fetchedAt || 0) >= metarCacheTtlMs);
  let upstreamError = "";
  if (missing.length) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const endpoint = new URL("https://aviationweather.gov/api/data/metar");
      endpoint.searchParams.set("ids", missing.join(","));
      endpoint.searchParams.set("format", "json");
      const response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "MofeiCareer/1.0" }
      });
      if (!response.ok) throw new Error(`metar-upstream-${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("invalid-metar-response");
      payload.forEach((item) => {
        const icao = String(item?.icaoId || "").trim().toUpperCase();
        const raw = String(item?.rawOb || "").trim();
        if (!missing.includes(icao) || !raw) return;
        metarCache.set(icao, {
          icao,
          raw: raw.slice(0, 500),
          observedAt: String(item?.reportTime || item?.obsTime || ""),
          fetchedAt: now
        });
      });
    } catch (error) {
      upstreamError = error?.name === "AbortError" ? "timeout" : "unavailable";
    } finally {
      clearTimeout(timeout);
    }
  }

  const observations = Object.fromEntries(requested
    .map((id) => [id, metarCache.get(id)])
    .filter(([, value]) => value)
    .map(([id, value]) => [id, {
      icao: id,
      raw: value.raw,
      observedAt: value.observedAt,
      stale: now - value.fetchedAt >= metarCacheTtlMs
    }]));
  return { observations, updatedAt: now, upstreamError };
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function worldPosition(latitude, longitude, altitudeFt = 0) {
  const dms = (value, positive, negative) => {
    const absolute = Math.abs(Number(value));
    const totalSeconds = Math.round(absolute * 3600 * 100) / 100;
    let degrees = Math.floor(totalSeconds / 3600);
    let remaining = totalSeconds - degrees * 3600;
    let minutes = Math.floor(remaining / 60);
    let seconds = remaining - minutes * 60;
    if (seconds >= 59.995) { seconds = 0; minutes += 1; }
    if (minutes >= 60) { minutes = 0; degrees += 1; }
    return `${value >= 0 ? positive : negative}${degrees}°${String(minutes).padStart(2, "0")}'${seconds.toFixed(2).padStart(5, "0")}"`;
  };
  const altitude = Math.max(0, Math.round(Number(altitudeFt) || 0));
  return `${dms(latitude, "N", "S")},${dms(longitude, "E", "W")},+${String(altitude).padStart(6, "0")}.00`;
}

function normalizedFlightPlanPoint(value, fallbackId, fallbackName) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lon);
  const icao = String(value?.icao || fallbackId || "").trim().toUpperCase();
  if (!icao || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return {
    id: icao,
    name: String(value?.name || fallbackName || icao).slice(0, 120),
    latitude,
    longitude,
    altitudeFt: Number(value?.altitudeFt || 0),
    type: value?.type === "UserWaypoint" ? "UserWaypoint" : "Airport"
  };
}

function flightPlanXml({ missionId, origin, target, returnPoint }) {
  // MSFS uses DestinationID/LLA to decide which point is active in the VFR
  // map. The old file made the base the destination and left the task point
  // as an intermediate waypoint, so the route could load without presenting
  // the task as the active in-game leg. The first leg must end at the task.
  const points = [origin, target];
  const waypointXml = points.map((point) => `
    <ATCWaypoint id="${xmlEscape(point.id)}">
      <ATCWaypointType>${point.type === "Airport" ? "Airport" : "User"}</ATCWaypointType>
      <WorldPosition>${worldPosition(point.latitude, point.longitude, point.altitudeFt)}</WorldPosition>${point.type === "Airport" ? `
      <ICAO>
        <ICAOIdent>${xmlEscape(point.id)}</ICAOIdent>
      </ICAO>` : ""}
    </ATCWaypoint>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<SimBase.Document Type="AceXML" version="1,0">
  <Descr>FlightPlan</Descr>
  <FlightPlan.FlightPlan>
    <Title>FCM-${xmlEscape(missionId)}</Title>
    <FPType>VFR</FPType>
    <RouteType>Direct</RouteType>
    <CruisingAlt>3500</CruisingAlt>
    <DepartureID>${xmlEscape(origin.id)}</DepartureID>
    <DepartureLLA>${worldPosition(origin.latitude, origin.longitude, origin.altitudeFt)}</DepartureLLA>
    <DestinationID>${xmlEscape(target.id)}</DestinationID>
    <DestinationLLA>${worldPosition(target.latitude, target.longitude, target.altitudeFt)}</DestinationLLA>
    <DepartureName>${xmlEscape(origin.name)}</DepartureName>
    <DestinationName>${xmlEscape(target.name)}</DestinationName>${waypointXml}
    <Descr>Flight Career Manager task route ${xmlEscape(missionId)}</Descr>
    <AppVersion>
      <AppVersionMajor>1</AppVersionMajor>
      <AppVersionBuild>1</AppVersionBuild>
    </AppVersion>
  </FlightPlan.FlightPlan>
</SimBase.Document>`;
}

const xiaoxiaoTts = new EdgeTTS({
  voice: "zh-CN-XiaoxiaoNeural",
  lang: "zh-CN",
  outputFormat: "audio-24khz-48kbitrate-mono-mp3",
  timeout: 10_000
});

async function synthesizeSpeech(payload) {
  const text = String(payload.text || "").trim().slice(0, 500);
  const voice = String(payload.voice || "zh-CN-XiaoxiaoNeural").trim();
  if (!text || voice !== "zh-CN-XiaoxiaoNeural") {
    return { status: 400, payload: { error: "Only Microsoft Xiaoxiao is supported" } };
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "flight-career-tts-"));
  const audioPath = join(temporaryDirectory, "speech.mp3");
  try {
    await xiaoxiaoTts.ttsPromise(text, audioPath);
    const audio = await readFile(audioPath);
    return { status: 200, audio };
  } catch {
    return { status: 502, payload: { error: "Xiaoxiao TTS service unavailable" } };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function readJsonBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32 * 1024) throw new Error("Request body is too large");
  }
  return body ? JSON.parse(body) : {};
}

async function readLastJsonLine(filePath) {
  const info = await stat(filePath);
  const length = Math.min(info.size, 128 * 1024);
  if (!length) return { value: null, modifiedAt: info.mtimeMs };
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    const lines = buffer.toString("utf8").trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      try { return { value: JSON.parse(line), modifiedAt: info.mtimeMs }; } catch { /* Skip an incomplete append. */ }
    }
    return { value: null, modifiedAt: info.mtimeMs };
  } finally {
    await handle.close();
  }
}

async function simulatorStatus() {
  try {
    const [sample, landing] = await Promise.all([
      readLastJsonLine(telemetryPath),
      readLastJsonLine(landingReportPath).catch(() => ({ value: null }))
    ]);
    const ageMs = Date.now() - sample.modifiedAt;
    const connected = Boolean(sample.value) && ageMs >= 0 && ageMs < telemetryFreshnessMs;
    if (connected !== lastLoggedTelemetryConnection) {
      recordRuntimeLog(connected ? "info" : "warn", connected ? "MSFS 遥测已连接" : "MSFS 遥测已断开", {
        ageMs: Number.isFinite(ageMs) ? Math.round(ageMs) : null,
        aircraft: sample.value?.aircraftTitle || sample.value?.aircraftModel || ""
      });
      lastLoggedTelemetryConnection = connected;
    }
    if (connected) telemetryConnectedSince ??= Date.now();
    else telemetryConnectedSince = null;
    const connectedForMs = connected && telemetryConnectedSince ? Date.now() - telemetryConnectedSince : 0;
    return {
      connected,
      connectedForMs,
      auxiliaryReady: connectedForMs >= auxiliaryBridgeWarmupMs,
      bridgeRunning: telemetryBridgeIsRunning(),
      ageMs: Number.isFinite(ageMs) ? ageMs : null,
      sample: sample.value,
      landing: landing.value,
      bridgePid: bridgeMeta.telemetry.pid,
      bridgeStartedAt: bridgeMeta.telemetry.startedAt,
      bridgeExit: bridgeMeta.telemetry.lastExit,
      bridgeError: bridgeMeta.telemetry.lastError
    };
  } catch {
    if (lastLoggedTelemetryConnection !== false) {
      recordRuntimeLog("warn", "遥测文件不可用，等待 MSFS 连接");
      lastLoggedTelemetryConnection = false;
    }
    telemetryConnectedSince = null;
    return {
      connected: false,
      connectedForMs: 0,
      auxiliaryReady: false,
      bridgeRunning: telemetryBridgeIsRunning(),
      ageMs: null,
      sample: null,
      landing: null,
      bridgePid: bridgeMeta.telemetry.pid,
      bridgeStartedAt: bridgeMeta.telemetry.startedAt,
      bridgeExit: bridgeMeta.telemetry.lastExit,
      bridgeError: bridgeMeta.telemetry.lastError
    };
  }
}

async function fuelStatus() {
  try {
    return JSON.parse(await readFile(fuelStatusPath, "utf8"));
  } catch {
    return { state: "idle", message: "尚未执行加注燃油" };
  }
}

async function requestSimulatorFuel(payload) {
  const targetPercent = Number(payload?.targetPercent);
  if (!Number.isFinite(targetPercent) || targetPercent < 0 || targetPercent > 100) {
    return { status: 400, payload: { state: "error", message: "燃油目标必须在 0% 到 100% 之间" } };
  }
  const simulator = await simulatorStatus();
  if (!simulator.connected || !simulator.sample) {
    return { status: 409, payload: { state: "error", message: "请先连接 MSFS 并进入飞行界面" } };
  }
  if (!simulator.sample.onGround) {
    return { status: 409, payload: { state: "error", message: "飞机必须停在地面才能加注燃油" } };
  }
  if (simulator.sample.engineRunning) {
    return { status: 409, payload: { state: "error", message: "请先关闭发动机再加注燃油" } };
  }
  const id = randomUUID();
  await mkdir(telemetryDir, { recursive: true });
  const temporaryPath = `${fuelCommandPath}.${id}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ id, targetPercent }), "utf8");
  await rename(temporaryPath, fuelCommandPath);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const status = await fuelStatus();
    if (status.id !== id) continue;
    return { status: status.state === "applied" ? 200 : 409, payload: status };
  }
  return { status: 202, payload: { id, state: "pending", message: "加注命令已发送，等待 MSFS 确认", targetPercent } };
}

function childIsRunning(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

function telemetryBridgeIsRunning() {
  return childIsRunning(telemetryBridge);
}

function bridgeExitMessage(code, signal) {
  if (signal) return `桥接程序被系统终止（${signal}）`;
  if (code === 0) return "桥接程序已退出";
  return `桥接程序异常退出（代码 ${code ?? "未知"}）`;
}

function trackBridgeChild(kind, child, executable) {
  const meta = bridgeMeta[kind];
  meta.executable = executable;
  meta.pid = child.pid || null;
  meta.startedAt = new Date().toISOString();
  meta.lastExit = null;
  meta.lastError = null;
  recordRuntimeLog("info", `${kind} 桥接程序已启动`, { pid: meta.pid, executable });
  child.once("error", (error) => {
    meta.lastError = { message: error?.message || "桥接程序启动失败", at: new Date().toISOString() };
    recordRuntimeLog("error", `${kind} 桥接程序启动失败`, { error: error?.message || "unknown" });
  });
  child.once("exit", (code, signal) => {
    meta.lastExit = { code, signal, message: bridgeExitMessage(code, signal), at: new Date().toISOString() };
    recordRuntimeLog(code === 0 ? "info" : "error", `${kind} 桥接程序退出`, { code, signal, message: meta.lastExit.message });
    if (kind === "telemetry" && telemetryBridge === child) telemetryBridge = null;
    if (kind === "scene" && sceneBridge === child) sceneBridge = null;
    if (kind === "flightPlan" && flightPlanBridge === child) flightPlanBridge = null;
    if (child.fcmStopPath) void unlink(child.fcmStopPath).catch(() => {});
  });
}

function waitForBridgeExit(child, timeoutMs = 2_000) {
  if (!childIsRunning(child)) return Promise.resolve();
  return new Promise((resolveExit) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveExit();
    };
    const timeout = setTimeout(settle, timeoutMs);
    child.once("exit", settle);
  });
}

function telemetryExecutable() {
  const explicit = process.env.FLIGHT_MANAGER_TELEMETRY_EXE;
  const candidates = [
    explicit,
    join(rootDir, "tools", "msfs-telemetry", "SkylineVA.Msfs2024Telemetry.exe")
  ].filter(Boolean);
  return candidates.find((filePath) => existsSync(filePath)) || null;
}

async function startTelemetryBridgeOnce() {
  const currentStatus = await simulatorStatus();
  if (currentStatus.connected) {
    return { started: false, reason: "already-connected", pid: currentStatus.bridgePid };
  }
  if (telemetryBridgeIsRunning()) {
    return { started: false, reason: "already-running", pid: telemetryBridge.pid };
  }
  const executable = telemetryExecutable();
  if (!executable) return { started: false, reason: "bridge-not-found" };
  await mkdir(telemetryDir, { recursive: true });
  // Each server owns only its own stop signal. The bridge's named mutex handles
  // cross-process single instancing without one app window stopping another.
  telemetryStopPath = join(telemetryDir, `telemetry-stop-${randomUUID()}.signal`);
  await unlink(telemetryStopPath).catch(() => {});
  // Only stop auxiliary clients owned by this server instance. Abruptly
  // terminating arbitrary SimConnect processes can destabilize MSFS 2024.
  stopSceneBridge();
  stopFlightPlanBridge();
  telemetryBridge = spawn(executable, ["--data-dir", telemetryDir, "--stop-file", telemetryStopPath], {
    cwd: dirname(executable), stdio: "ignore", windowsHide: true, detached: true
  });
  telemetryBridge.fcmStopPath = telemetryStopPath;
  trackBridgeChild("telemetry", telemetryBridge, executable);
  telemetryBridge.unref();
  return { started: true, pid: telemetryBridge.pid };
}

async function startTelemetryBridge() {
  if (telemetryStartPromise) return telemetryStartPromise;
  telemetryStartPromise = startTelemetryBridgeOnce()
    .finally(() => { telemetryStartPromise = null; });
  return telemetryStartPromise;
}

function stopTelemetryBridge() {
  if (telemetryStopPromise) return telemetryStopPromise;
  const child = telemetryBridge;
  const childStopPath = child?.fcmStopPath || telemetryStopPath;
  if (childIsRunning(child)) {
    try { if (childStopPath) writeFileSync(childStopPath, "stop", "utf8"); } catch { /* The helper may already be exiting. */ }
    child.unref();
  }
  telemetryBridge = null;
  telemetryStopPath = null;
  telemetryConnectedSince = null;
  telemetryStopPromise = waitForBridgeExit(child).finally(() => { telemetryStopPromise = null; });
  return telemetryStopPromise;
}

function sceneExecutable() {
  const candidates = [
    process.env.FLIGHT_MANAGER_SCENE_EXE,
    join(rootDir, "tools", "msfs-scene-bridge", "SkylineVA.MsfsSceneBridge.exe")
  ].filter(Boolean);
  return candidates.find((filePath) => existsSync(filePath)) || null;
}

function requestGracefulBridgeStop(child, stopPath) {
  if (!childIsRunning(child) || !stopPath) return Promise.resolve();
  try { writeFileSync(stopPath, "stop", "utf8"); } catch { /* The bridge may already be exiting. */ }
  child.unref();
  return waitForBridgeExit(child);
}

function stopSceneBridge() {
  if (sceneStopPromise) return sceneStopPromise;
  const child = sceneBridge;
  const stopPath = sceneStopPath;
  sceneBridge = null;
  sceneStopPath = null;
  activeSceneMissionId = null;
  sceneStopPromise = requestGracefulBridgeStop(child, stopPath).finally(() => { sceneStopPromise = null; });
  return sceneStopPromise;
}

function stopFlightPlanBridge() {
  if (flightPlanStopPromise) return flightPlanStopPromise;
  const child = flightPlanBridge;
  const stopPath = flightPlanStopPath;
  flightPlanBridge = null;
  flightPlanStopPath = null;
  activeFlightPlanMissionId = null;
  flightPlanStopPromise = requestGracefulBridgeStop(child, stopPath).finally(() => { flightPlanStopPromise = null; });
  return flightPlanStopPromise;
}

export async function shutdownBridges() {
  await Promise.all([stopTelemetryBridge(), stopSceneBridge(), stopFlightPlanBridge(), panelService?.close()]);
  panelService = null;
}

async function flightPlanStatus() {
  if (!activeFlightPlanMissionId) return { state: "idle", missionId: null, bridgeRunning: false };
  try {
    const status = JSON.parse(await readFile(flightPlanStatusPath, "utf8"));
    const bridgeRunning = childIsRunning(flightPlanBridge);
    return {
      ...status,
      ...(status.state === "connecting" && !bridgeRunning && bridgeMeta.flightPlan.lastExit
        ? { state: "error", message: bridgeMeta.flightPlan.lastExit.message }
        : {}),
      missionId: activeFlightPlanMissionId,
      bridgeRunning,
      bridgePid: bridgeMeta.flightPlan.pid,
      bridgeExit: bridgeMeta.flightPlan.lastExit,
      bridgeError: bridgeMeta.flightPlan.lastError
    };
  } catch {
    const bridgeRunning = childIsRunning(flightPlanBridge);
    return {
      state: bridgeRunning ? "connecting" : "error",
      missionId: activeFlightPlanMissionId,
      bridgeRunning,
      bridgePid: bridgeMeta.flightPlan.pid,
      bridgeExit: bridgeMeta.flightPlan.lastExit,
      bridgeError: bridgeMeta.flightPlan.lastError,
      message: bridgeRunning ? "正在等待 MSFS 确认航路" : bridgeMeta.flightPlan.lastExit?.message || "MSFS 航路桥未运行"
    };
  }
}

async function startFlightPlanBridge(payload) {
  const missionId = String(payload.missionId || "").slice(0, 80);
  if (!missionId || !/^[A-Za-z0-9_-]{2,80}$/.test(missionId)) {
    return { status: 400, payload: { state: "error", message: "Invalid flight plan mission" } };
  }
  const origin = normalizedFlightPlanPoint(payload.origin, "", "起飞机场");
  const target = normalizedFlightPlanPoint(payload.target, "TASK", "任务点");
  const returnPoint = normalizedFlightPlanPoint(payload.returnPoint || payload.origin, "", "返航基地");
  if (!origin || !target || !returnPoint) {
    return { status: 400, payload: { state: "error", message: "任务点或机场坐标无效" } };
  }
  if (activeFlightPlanMissionId === missionId) {
    return { status: 200, payload: await flightPlanStatus() };
  }
  const simulator = await simulatorStatus();
  if (!simulator.connected) {
    return {
      status: 409,
      payload: {
        state: "waiting",
        reason: "simulator-not-connected",
        message: simulator.bridgeError?.message || "请先启动 MSFS 并建立遥测连接，再发送任务航路"
      }
    };
  }
  const planDirectory = join(telemetryDir, "FlightPlans");
  const planPath = join(planDirectory, `FCM-${missionId}.pln`);
  await mkdir(planDirectory, { recursive: true });
  await writeFile(planPath, flightPlanXml({ missionId, origin, target, returnPoint }), "utf8");
  stopFlightPlanBridge();
  activeFlightPlanMissionId = missionId;
  const prepared = {
    state: "prepared",
    missionId,
    planPath,
    bridgeRunning: false,
    message: "任务航路文件已生成；为避免 MSFS 2024 闪退，未使用 SimConnect 自动注入航路"
  };
  await writeFile(flightPlanStatusPath, JSON.stringify(prepared), "utf8");
  return { status: 200, payload: prepared };
}

async function sceneStatus() {
  if (!activeSceneMissionId) return { state: "idle", missionId: null, bridgeRunning: false };
  try {
    const status = JSON.parse(await readFile(sceneStatusPath, "utf8"));
    return { ...status, missionId: activeSceneMissionId, bridgeRunning: childIsRunning(sceneBridge), bridgePid: bridgeMeta.scene.pid, bridgeExit: bridgeMeta.scene.lastExit, bridgeError: bridgeMeta.scene.lastError };
  } catch {
    const bridgeRunning = childIsRunning(sceneBridge);
    return { state: bridgeRunning ? "connecting" : "error", missionId: activeSceneMissionId, bridgeRunning, bridgePid: bridgeMeta.scene.pid, bridgeExit: bridgeMeta.scene.lastExit, bridgeError: bridgeMeta.scene.lastError, message: bridgeRunning ? "正在等待 MSFS 确认场景对象" : bridgeMeta.scene.lastExit?.message || "MSFS 场景桥未运行" };
  }
}

async function startSceneBridge(payload) {
  const missionId = String(payload.missionId || "").slice(0, 80);
  const objectTitle = String(payload.objectTitle || "");
  const smokeTitle = String(payload.smokeTitle || "");
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const altitudeFt = Number(payload.altitudeFt || 0);
  const headingDeg = Number(payload.headingDeg || 0);
  if (!missionId || !/^[A-Za-z0-9_-]{2,80}$/.test(objectTitle) || (smokeTitle && !/^FCMsmoke[1-5]$/.test(smokeTitle))
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { status: 400, payload: { state: "error", message: "Invalid scene request" } };
  }
  if (sceneBridge && !sceneBridge.killed && activeSceneMissionId === missionId) {
    return { status: 200, payload: await sceneStatus() };
  }
  const executable = sceneExecutable();
  if (!executable) return { status: 404, payload: { state: "error", message: "Scene bridge not found" } };
  const simulator = await simulatorStatus();
  if (!simulator.connected) {
    return { status: 409, payload: { state: "waiting", reason: "simulator-not-connected", message: simulator.bridgeError?.message || "请先启动 MSFS 并建立遥测连接，再生成任务场景" } };
  }
  if (!simulator.auxiliaryReady) {
    return {
      status: 409,
      payload: {
        state: "waiting",
        reason: "simulator-warming-up",
        retryAfterMs: Math.max(500, auxiliaryBridgeWarmupMs - simulator.connectedForMs),
        message: "遥测连接正在稳定，稍后再生成任务场景"
      }
    };
  }
  stopSceneBridge();
  await unlink(sceneStatusPath).catch(() => {});
  activeSceneMissionId = missionId;
  sceneStopPath = join(telemetryDir, `scene-stop-${randomUUID()}.signal`);
  const child = spawn(executable, [objectTitle, String(latitude), String(longitude), String(altitudeFt), String(headingDeg), smokeTitle, sceneStatusPath, sceneStopPath], {
    cwd: dirname(executable),
    stdio: "ignore",
    windowsHide: true
  });
  child.fcmStopPath = sceneStopPath;
  sceneBridge = child;
  trackBridgeChild("scene", child, executable);
  return { status: 202, payload: { state: "connecting", missionId, bridgeRunning: true } };
}

function serveStatic(res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(rootDir, `.${normalize(requestPath)}`);
  if (!filePath.startsWith(`${rootDir}\\`) || !existsSync(filePath)) {
    respondJson(res, 404, { error: "Not found" });
    return;
  }
  const contentType = contentTypes[extname(filePath).toLowerCase()];
  if (!contentType) {
    respondJson(res, 403, { error: "Unsupported file type" });
    return;
  }
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  if (res.req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function proxyTile(res, layer, zoom, x, y) {
  if (!tiandituToken || zoom < 3 || zoom > 18 || x < 0 || y < 0 || x >= 2 ** zoom || y >= 2 ** zoom) {
    respondJson(res, 400, { error: "Invalid map tile request" });
    return;
  }
  const subdomain = (x + y + zoom) % 8;
  const tileUrl = `https://t${subdomain}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL=${x}&TILEROW=${y}&TILEMATRIX=${zoom}&tk=${encodeURIComponent(tiandituToken)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(tileUrl, {
      signal: controller.signal,
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8" }
    });
    const contentType = String(response.headers.get("content-type") || "");
    if (!response.ok || !contentType.startsWith("image/")) throw new Error(`Tile provider returned ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": "public, max-age=432000, immutable"
    });
    res.end(body);
  } catch (error) {
    respondJson(res, error.name === "AbortError" ? 504 : 502, { error: "Map tile is temporarily unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

// Every API route is reachable only from the application itself: the request must
// target a loopback host, and a browser-supplied Origin / Sec-Fetch-Site must be
// same-origin. This blocks cross-site pages and DNS-rebinding from driving the
// simulator, speech or log endpoints.
function isLocalAppRequest(req) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host || "")) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}`) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/") && !isLocalAppRequest(req)) {
    respondJson(res, 403, { error: "Local application access only" });
    return;
  }
  const match = url.pathname.match(/^\/api\/map\/tianditu\/(vec|cva|img|cia)\/(\d{1,2})\/(\d+)\/(\d+)$/);
  if (req.method === "GET" && match) {
    await proxyTile(res, match[1], Number(match[2]), Number(match[3]), Number(match[4]));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/metar") {
    const ids = String(url.searchParams.get("ids") || "").split(",");
    try {
      respondJson(res, 200, await latestMetarObservations(ids));
    } catch {
      respondJson(res, 400, { error: "Invalid METAR airport list" });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/health") {
    respondJson(res, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/runtime-log") {
    const origin = req.headers.origin;
    const sameOrigin = !origin || origin === `http://${req.headers.host}`;
    if (!sameOrigin || req.headers["sec-fetch-site"] === "cross-site") {
      respondJson(res, 403, { error: "Local application access only" });
      return;
    }
    try {
      await loadRuntimeLogs();
      if (req.method === "GET") {
        respondJson(res, 200, { logs: [...runtimeLogs].reverse(), generatedAt: new Date().toISOString() });
      } else if (req.method === "POST") {
        const payload = await readJsonBody(req);
        const context = payload.context && typeof payload.context === "object"
          ? Object.fromEntries(Object.entries(payload.context).slice(0, 12).map(([key, value]) => [String(key).slice(0, 60), String(value ?? "").slice(0, 300)]))
          : {};
        const entry = recordRuntimeLog(payload.level, `前端：${String(payload.message || "未知消息").slice(0, 480)}`, context);
        respondJson(res, 201, { entry });
      } else if (req.method === "DELETE") {
        await clearRuntimeLogs();
        respondJson(res, 200, { logs: [] });
      } else respondJson(res, 405, { error: "Method not allowed" });
    } catch (error) {
      respondJson(res, 500, { error: "Runtime log unavailable", message: error?.message || "unknown" });
    }
    return;
  }
  if (url.pathname.startsWith("/api/panels/")) {
    // Capture controls and share tokens are available only to the local application.
    const origin = req.headers.origin;
    const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "");
    if (!localHost || (origin && origin !== `http://${req.headers.host}`) || req.headers["sec-fetch-site"] === "cross-site") {
      respondJson(res, 403, { error: "Local application access only" }); return;
    }
    try {
      const service = getPanelService();
      if (req.method === "GET" && url.pathname === "/api/panels/status") {
        respondJson(res, 200, await service.status());
      } else if (req.method === "POST" && url.pathname === "/api/panels/capture" && req.headers["x-mofei-panel"] === "1") {
        const payload = await readJsonBody(req);
        if (payload.action === "start") await service.startCapture(String(payload.panelId || ""));
        else if (payload.action === "stop") await service.stopCapture();
        else throw new Error("invalid-capture-action");
        respondJson(res, 200, await service.status());
      } else respondJson(res, 404, { error: "Not found" });
    } catch (error) {
      recordRuntimeLog("error", "面板服务请求失败", { error: error?.message || "unknown" });
      respondJson(res, 503, { connected: false, error: error.message });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/speech") {
    try {
      const result = await synthesizeSpeech(await readJsonBody(req));
      if (result.audio) {
        res.writeHead(200, {
          "content-type": "audio/mpeg",
          "content-length": result.audio.length,
          "cache-control": "no-store"
        });
        res.end(result.audio);
      } else {
        respondJson(res, result.status, result.payload);
      }
    } catch {
      respondJson(res, 400, { error: "Invalid speech request" });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/simulator/status") {
    respondJson(res, 200, await simulatorStatus());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/start") {
    const result = await startTelemetryBridge();
    respondJson(res, result.started || ["already-running", "already-connected", "external-running"].includes(result.reason) ? 200 : 404, result);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/simulator/fuel") {
    respondJson(res, 200, await fuelStatus());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/fuel") {
    try {
      const result = await requestSimulatorFuel(await readJsonBody(req));
      respondJson(res, result.status, result.payload);
    } catch {
      respondJson(res, 500, { state: "error", message: "加注燃油命令处理失败" });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/simulator/scene") {
    respondJson(res, 200, await sceneStatus());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/simulator/flight-plan") {
    respondJson(res, 200, await flightPlanStatus());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/flight-plan") {
    try {
      const result = await startFlightPlanBridge(await readJsonBody(req));
      respondJson(res, result.status, result.payload);
    } catch {
      respondJson(res, 400, { state: "error", message: "飞行计划生成失败" });
    }
    return;
  }
  if (req.method === "DELETE" && url.pathname === "/api/simulator/flight-plan") {
    stopFlightPlanBridge();
    respondJson(res, 200, { state: "idle" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/simulator/scene") {
    try {
      const result = await startSceneBridge(await readJsonBody(req));
      respondJson(res, result.status, result.payload);
    } catch {
      respondJson(res, 400, { state: "error", message: "Invalid scene request" });
    }
    return;
  }
  if (req.method === "DELETE" && url.pathname === "/api/simulator/scene") {
    stopSceneBridge();
    respondJson(res, 200, { state: "idle" });
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(res, url.pathname);
    return;
  }
  respondJson(res, 405, { error: "Method not allowed" });
});

export function startServer(requestedPort = port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
  server.once("close", () => { void shutdownBridges(); });
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      if (requestedPort !== 0) recordRuntimeLog("info", "应用服务已启动", { port: server.address().port, version: "1.0.139" });
      resolve({ server, port: server.address().port });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  startServer().then(({ port: activePort }) => console.log(`Flight Career Manager: http://localhost:${activePort}`));
}
