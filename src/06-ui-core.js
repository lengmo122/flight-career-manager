// 模飞生涯 渲染器源码 06-ui-core.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "FL";
}

function isAvatarDataUrl(value) {
  return typeof value === "string" && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value);
}

function getAvatarPreset(id) {
  return AVATAR_PRESETS.find((avatar) => avatar.id === id) || null;
}

function activeAvatarSource(pilot = state.pilot) {
  const preset = getAvatarPreset(pilot?.avatarPreset);
  if (preset) return preset.src;
  return isAvatarDataUrl(pilot?.avatarDataUrl) ? pilot.avatarDataUrl : "";
}

function renderAvatar(element, dataUrl, name, presetId = "") {
  if (!element) return;
  element.replaceChildren();
  const preset = getAvatarPreset(presetId);
  const source = preset?.src || (isAvatarDataUrl(dataUrl) ? dataUrl : "");
  if (source) {
    const image = document.createElement("img");
    image.src = source;
    image.alt = `${name || "飞行员"}头像`;
    element.append(image);
  } else {
    element.textContent = initials(name || "");
  }
}

function renderAvatarChoices() {
  if (!els.avatarChoiceGrid) return;
  const customAvatar = isAvatarDataUrl(state.pilot.avatarDataUrl)
    ? { id: "custom", label: "我的上传", src: state.pilot.avatarDataUrl }
    : null;
  const choices = customAvatar ? [...AVATAR_PRESETS, customAvatar] : AVATAR_PRESETS;
  const selectedId = getAvatarPreset(state.pilot.avatarPreset)?.id || (customAvatar ? "custom" : "");
  els.avatarChoiceGrid.innerHTML = choices.map((avatar) => `
    <button class="avatar-choice${escapeHtml(selectedId === avatar.id ? " is-selected" : "")}" type="button" data-avatar-choice="${escapeHtml(avatar.id)}" aria-label="选择${escapeHtml(avatar.label)}" title="${escapeHtml(avatar.label)}">
      <img src="${escapeHtml(avatar.src)}" alt="${escapeHtml(avatar.label)}">
      <span class="avatar-choice-label">${escapeHtml(avatar.label)}</span>
    </button>`).join("");
  if (els.avatarChoiceStatus) {
    els.avatarChoiceStatus.textContent = selectedId === "custom"
      ? "我的上传"
      : getAvatarPreset(selectedId)?.label || "默认头像";
  }
}

function selectAvatar(choiceId) {
  if (choiceId === "custom") {
    if (!isAvatarDataUrl(state.pilot.avatarDataUrl)) {
      toast("请先上传头像");
      return;
    }
    state.pilot.avatarPreset = "";
  } else if (getAvatarPreset(choiceId)) {
    state.pilot.avatarPreset = choiceId;
  } else {
    return;
  }
  renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatar(els.pilotInitials, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatarChoices();
  saveState();
  toast(choiceId === "custom" ? "已选择我的上传头像" : "头像已更新");
}

function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) {
      reject(new Error("unsupported-avatar-type"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("avatar-too-large"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("avatar-read-failed"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("avatar-decode-failed"));
      image.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("avatar-canvas-failed"));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function showView(view) {
  state.activeView = view;
  document.body.classList.toggle("map-view-active", view === "map");
  Object.entries(els.views).forEach(([key, node]) => node.classList.toggle("is-active", key === view));
  els.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  if (view === "map") renderMapPage();
  if (view === "monitor") updateMonitor(lastSimulatorPayload);
  if (view === "sop") renderSopMonitor();
  saveState();
}

function monitorText(value, fallback = "--") {
  return value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value)) ? fallback : String(value);
}

function monitorNumber(value, suffix = "", digits = 0) {
  if (value === null || value === undefined || value === "") return `--${suffix}`;
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString("zh-CN", { maximumFractionDigits: digits })}${suffix}` : `--${suffix}`;
}

function monitorBoolean(value, onText = "开启", offText = "关闭") {
  if (value === null || value === undefined || value === "") return { text: "无数据", className: "is-unknown", checked: false };
  const active = telemetryBoolean(value);
  return { text: active ? onText : offText, className: active ? "is-on" : "is-off", checked: active };
}

function monitorEquipmentState(key, value) {
  if (key === "parkingBrake") return monitorBoolean(value, "已设置", "未设置");
  if (!["flapsPercent", "spoilersPercent", "gearPercent"].includes(key)) return monitorBoolean(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    return { text: "无数据", className: "is-unknown", checked: false, stateKey: "unknown" };
  }
  const percent = Math.max(0, Math.min(100, Number(value)));
  if (key === "gearPercent") {
    if (percent >= 95) return { text: "已放下", className: "is-on", checked: true, stateKey: "on" };
    if (percent <= 5) return { text: "已收起", className: "is-off", checked: false, stateKey: "off" };
    return { text: `转换中 ${Math.round(percent)}%`, className: "is-transition", checked: false, stateKey: "transition" };
  }
  const active = percent > 0.5;
  const text = key === "flapsPercent"
    ? (active ? `放出 ${Math.round(percent)}%` : "已收起")
    : (active ? `展开 ${Math.round(percent)}%` : "已收起");
  return { text, className: active ? "is-on" : "is-off", checked: active, stateKey: active ? "on" : "off" };
}

function updateMonitor(payload = {}) {
  if (!els.monitorConnection) return;
  const connected = payload.connected === true && payload.sample;
  const stateKey = connected ? "connected" : payload.bridgeError || payload.bridgeExit ? "error" : payload.bridgeRunning ? "waiting" : "offline";
  if (stateKey !== lastMonitorConnectionState) {
    if (lastMonitorConnectionState && stateKey !== "connected") void reportRuntimeLog("warn", `实时监测状态：${stateKey}`);
    if (stateKey === "connected") void reportRuntimeLog("info", "实时监测已接收 MSFS 遥测");
    lastMonitorConnectionState = stateKey;
  }
  els.monitorConnection.className = `monitor-connection-band ${connected ? "is-live" : stateKey === "error" ? "is-error" : "is-offline"}`;
  els.monitorConnectionTitle.textContent = connected ? "MSFS 已连接" : stateKey === "error" ? "MSFS 连接异常" : payload.bridgeRunning ? "等待 MSFS" : "等待 MSFS 连接";
  els.monitorConnectionDetail.textContent = connected
    ? `${payload.sample.aircraftTitle || payload.sample.aircraftModel || "未知机型"} · ${payload.sample.aircraftTypeCode || ""}`
    : payload.bridgeError?.message || payload.bridgeExit?.message || "遥测服务正在自动检测模拟器";
  els.monitorUpdatedAt.textContent = connected ? `更新于 ${new Date().toLocaleTimeString("zh-CN")}` : "尚无实时数据";

  const sample = connected ? payload.sample : null;
  const values = {
    aircraftTitle: sample ? `${sample.aircraftTitle || sample.aircraftModel || "未知机型"} · ${sample.loadedAircraftName || ""}`.replace(/ · $/, "") : "等待飞机数据",
    callsign: sample?.callsign,
    indicatedAirspeedKt: monitorNumber(sample?.indicatedAirspeedKt, " kt"),
    trueAirspeedKt: monitorNumber(sample?.trueAirspeedKt, " kt"),
    groundSpeedKt: monitorNumber(sample?.groundSpeedKt, " kt"),
    verticalSpeedFpm: monitorNumber(sample?.verticalSpeedFpm, " fpm"),
    altitudeFt: monitorNumber(sample?.altitudeFt, " ft"),
    radioAltitudeFt: monitorNumber(sample?.radioAltitudeFt, " ft"),
    magneticHeadingDeg: monitorNumber(sample?.magneticHeadingDeg ?? sample?.headingDeg, "°"),
    attitude: sample ? `${monitorNumber(sample.pitchDeg, "°", 1)} / ${monitorNumber(sample.bankDeg, "°", 1)}` : "--° / --°",
    gForce: monitorNumber(sample?.gForce, " G", 2),
    fuel: sample ? `${formatFuel(telemetryFuelKg(sample))} / ${formatFuel(telemetryFuelCapacityKg(sample))}` : "--",
    parkingBrake: sample ? (monitorBoolean(sample.parkingBrake).text) : "--",
    simulationRate: sample ? `${monitorNumber(sample.simulationRate, "x", 1)}${sample.slewActive ? " · SLEW" : ""}` : "--",
    position: sample ? `${monitorNumber(sample.latitude, "°", 4)}, ${monitorNumber(sample.longitude, "°", 4)}` : "--",
    engineRunning: sample ? (monitorBoolean(sample.engineRunning).text) : "--",
    flightPhase: connected ? (sample.onGround ? "地面" : "飞行中") : "未连接"
  };
  document.querySelectorAll("[data-monitor-field]").forEach((node) => {
    node.textContent = monitorText(values[node.dataset.monitorField]);
  });
  const monitorControlKeys = ["navigationLights", "antiCollisionLights", "taxiLights", "landingLights", "strobeLights", "parkingBrake", "flapsPercent", "spoilersPercent", "gearPercent"];
  monitorControlKeys.forEach((key) => {
    const value = key === "antiCollisionLights"
      ? sample?.antiCollisionLights ?? sample?.beaconLights
      : sample?.[key];
    const state = monitorEquipmentState(key, value);
    const input = document.querySelector(`[data-monitor-light="${key}"]`);
    const status = document.querySelector(`[data-monitor-light-state="${key}"]`);
    if (input) {
      input.checked = state.checked;
      input.dataset.monitorState = state.stateKey || (state.checked ? "on" : state.className === "is-unknown" ? "unknown" : "off");
      input.setAttribute("aria-checked", String(state.checked));
    }
    if (status) {
      status.className = `monitor-light-state ${state.className}`;
      status.querySelector("b").textContent = state.text;
    }
  });
}

async function reportRuntimeLog(level, message, context = {}) {
  const text = String(message || "").trim().slice(0, 500);
  const signature = `${level}:${text}:${JSON.stringify(context)}`;
  if (!text || runtimeLogRequestPromise || (signature === lastRuntimeLogSignature && Date.now() - lastRuntimeLogAt < 30_000)) return;
  lastRuntimeLogSignature = signature;
  lastRuntimeLogAt = Date.now();
  runtimeLogRequestPromise = fetch("/api/runtime-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ level: ["info", "warn", "error"].includes(level) ? level : "info", message: text, context })
  }).catch(() => {}).finally(() => { runtimeLogRequestPromise = null; });
  await runtimeLogRequestPromise;
}

function renderRuntimeLogs(logs = []) {
  if (!els.runtimeLogList) return;
  els.runtimeLogStatus.textContent = `${logs.length} 条 · ${new Date().toLocaleTimeString("zh-CN")}`;
  els.runtimeLogList.innerHTML = logs.length ? logs.map((entry) => `
    <div class="runtime-log-entry is-${escapeHtml(entry.level || "info")}">
      <span class="runtime-log-dot"></span>
      <time>${escapeHtml(new Date(entry.at || Date.now()).toLocaleString("zh-CN"))}</time>
      <strong>${escapeHtml(entry.level === "error" ? "错误" : entry.level === "warn" ? "警告" : "信息")}</strong>
      <p>${escapeHtml(entry.message || "无消息")}${entry.context && Object.keys(entry.context).length ? `<small>${escapeHtml(Object.entries(entry.context).map(([key, value]) => `${key}: ${value}`).join(" · "))}</small>` : ""}</p>
    </div>`).join("") : `<p class="runtime-log-empty">暂无运行日志。</p>`;
}

async function loadRuntimeLogs() {
  if (!els.runtimeLogList) return;
  els.runtimeLogStatus.textContent = "正在读取";
  try {
    const response = await fetch("/api/runtime-log", { cache: "no-store" });
    if (!response.ok) throw new Error(`runtime log ${response.status}`);
    renderRuntimeLogs((await response.json()).logs || []);
  } catch (error) {
    els.runtimeLogStatus.textContent = "读取失败";
    els.runtimeLogList.innerHTML = `<p class="runtime-log-empty">运行日志服务不可用。</p>`;
    void reportRuntimeLog("error", "读取运行日志失败", { error: error.message });
  }
}

async function clearRuntimeLogs() {
  if (!await showConfirmDialog("确定清空运行日志吗？清空后无法恢复。")) return;
  try {
    const response = await fetch("/api/runtime-log", { method: "DELETE" });
    if (!response.ok) throw new Error(`runtime log ${response.status}`);
    renderRuntimeLogs([]);
    toast("运行日志已清空");
  } catch { toast("运行日志清空失败"); }
}

async function exportRuntimeLogs() {
  try {
    const response = await fetch("/api/runtime-log", { cache: "no-store" });
    if (!response.ok) throw new Error("runtime log unavailable");
    const payload = await response.json();
    const blob = new Blob([JSON.stringify(payload.logs || [], null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `mofei-runtime-log-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("运行日志已导出");
  } catch { toast("运行日志导出失败"); }
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}

function showConfirmDialog(message) {
  if (!els.confirmModal || !els.confirmMessage) return Promise.resolve(false);
  els.confirmMessage.textContent = message;
  els.confirmModal.showModal();
  return new Promise((resolve) => {
    const handleClose = () => {
      els.confirmModal.removeEventListener("close", handleClose);
      resolve(els.confirmModal.returnValue === "confirm");
    };
    els.confirmModal.addEventListener("close", handleClose, { once: true });
  });
}

async function speakNext() {
  if (speechPlaying || !speechQueue.length) return;
  speechPlaying = true;
  const text = speechQueue.shift();
  let audioUrl = "";
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: preferredVoiceName })
    });
    if (!response.ok) throw new Error(`speech service ${response.status}`);
    audioUrl = URL.createObjectURL(await response.blob());
    const audio = new Audio(audioUrl);
    audio.preload = "auto";
    audio.volume = normalizeSpeechVolume(state.settings?.speechVolume);
    await new Promise((resolve, reject) => {
      audio.addEventListener("canplaythrough", resolve, { once: true });
      audio.addEventListener("error", () => reject(new Error("audio decode failed")), { once: true });
      audio.load();
    });
    await audio.play();
    await new Promise((resolve) => {
      audio.addEventListener("ended", resolve, { once: true });
      audio.addEventListener("error", resolve, { once: true });
    });
    speechServiceErrorNotified = false;
  } catch {
    if (!speechServiceErrorNotified) {
      speechServiceErrorNotified = true;
      toast(`无法连接 Microsoft Xiaoxiao（${preferredVoiceName}）语音服务，请检查网络`);
    }
  } finally {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    speechPlaying = false;
    void speakNext();
  }
}

function queueVoice(text) {
  // TTS is generated by the server with Xiaoxiao; SpeechSynthesis is not the audio backend.
  if (!text || typeof Audio === "undefined") return;
  speechQueue.push(text);
  speakNext();
}

function normalizeSpeechVolume(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeMapLayer(value) {
  return ["standard", "satellite", "dark"].includes(value) ? value : "standard";
}

function applyTheme(darkMode = false) {
  document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
  if (els.themeModeBtn) {
    const currentTheme = darkMode ? "深色" : "浅色";
    const nextTheme = darkMode ? "浅色" : "深色";
    els.themeModeBtn.setAttribute("aria-label", `当前${currentTheme}模式，点击切换为${nextTheme}模式`);
    els.themeModeBtn.title = `切换为${nextTheme}模式`;
    els.themeModeBtn.setAttribute("aria-pressed", String(darkMode));
  }
}

function toggleThemeMode() {
  const darkMode = state.settings?.darkMode !== true;
  state.settings.darkMode = darkMode;
  applyTheme(darkMode);
  saveState();
  toast(`已切换为${darkMode ? "深色" : "浅色"}模式`);
}

function canCreateCompany() {
  const rankInfo = getRankInfo(state.stats?.totalHours || 0);
  const rank = rankInfo.rank;
  return rank === "机长" || rank === "教员" || Number(state.cash || 0) >= 1_000_000 || rankInfo.minHours >= 120;
}

function companyCreationRequirementText() {
  const rank = getRankInfo(state.stats?.totalHours || 0).rank;
  if (canCreateCompany()) return "已满足创建条件：机长资历或个人资金达到 100 万。";
  return `创建条件：达到机长（当前${rank}）或个人资金达到 100 万（当前 ${formatMoney(state.cash)}）。`;
}

function openSettings() {
  if (!els.settingsModal || !els.speechVolumeRange) return;
  settingsDraftSpeechVolume = normalizeSpeechVolume(state.settings?.speechVolume);
  els.speechVolumeRange.value = String(Math.round(settingsDraftSpeechVolume * 100));
  els.speechVolumeValue.textContent = `${els.speechVolumeRange.value}%`;
  if (els.freeModeToggle) els.freeModeToggle.checked = isFreeMode();
  if (els.sopModeToggle) els.sopModeToggle.checked = state.settings?.sopMode === true;
  renderBackups();
  void loadRuntimeLogs();
  els.settingsModal.returnValue = "";
  els.settingsModal.showModal();
  wireIcons();
}

function openSupport() {
  if (!els.supportModal) return;
  els.supportModal.showModal();
  wireIcons();
}

function openContactAuthor() {
  if (!els.contactModal) return;
  els.contactModal.showModal();
  wireIcons();
}

async function copyAuthorQqGroup() {
  const groupNumber = els.authorQqGroup?.textContent?.trim() || "1048217475";
  try {
    await navigator.clipboard.writeText(groupNumber);
    toast(`QQ群 ${groupNumber} 已复制`);
  } catch {
    toast(`QQ群：${groupNumber}`);
  }
}

function openAbout() {
  if (!els.aboutModal) return;
  els.aboutModal.showModal();
  wireIcons();
}

function updateSettingsVolumePreview() {
  const percent = Math.max(0, Math.min(100, Number(els.speechVolumeRange?.value) || 0));
  settingsDraftSpeechVolume = percent / 100;
  if (els.speechVolumeValue) els.speechVolumeValue.textContent = `${percent}%`;
}

function closeSettings() {
  if (!els.settingsModal) return;
  if (els.settingsModal.returnValue !== "confirm") {
    return;
  }
  state.settings.speechVolume = normalizeSpeechVolume(settingsDraftSpeechVolume);
  const nextFreeMode = els.freeModeToggle?.checked === true;
  const freeModeChanged = applyFreeModeFinancialState(nextFreeMode);
  state.settings.sopMode = !nextFreeMode && els.sopModeToggle?.checked === true;
  saveState();
  if (freeModeChanged) renderAll();
  else renderSopMonitor();
  toast(`设置已保存${state.settings.freeMode ? "，自由模式已开启，SOP 检测暂不生效" : state.settings.sopMode ? "，SOP 模式已开启" : ""}`);
}

function recordTaskEvent(mission, { key, title, detail, voiceText, phase }) {
  const normalizedKey = String(key || "").trim();
  if (!mission?.id || !normalizedKey || (!taskLogEventKeys.has(normalizedKey) && !normalizedKey.startsWith("sop-"))) return false;
  const isSopEvent = normalizedKey.startsWith("sop-");
  const exists = state.taskEvents.some((event) => {
    const sameMission = event.missionId === mission.id || event.missionTitle === mission.title;
    return sameMission
      && String(event.key || "").trim() === normalizedKey
      && (!isSopEvent || String(event.detail || "").trim() === String(detail || "").trim());
  });
  if (exists) return false;
  state.taskEvents.unshift({
    id: cryptoId("task-event"),
    missionId: mission.id,
    missionTitle: mission.title,
    date: Date.now(),
    phase: phase || mission.verification?.phase || "",
    key: normalizedKey,
    title: title || "任务状态更新",
    detail: detail || "",
    voiceText: voiceText || ""
  });
  state.taskEvents = state.taskEvents.slice(0, 100);
  if (voiceText) queueVoice(voiceText);
  return true;
}

function setMissionStatus(mission, { phase, label, detail, voiceKey, voiceText, eventKey, eventTitle, eventDetail }) {
  const verification = mission?.verification;
  if (!verification) return false;
  const changed = verification.phase !== phase || verification.phaseLabel !== label || verification.detail !== detail;
  verification.phase = phase;
  verification.phaseLabel = label;
  verification.detail = detail;
  if (voiceKey && verification.lastVoiceKey !== voiceKey && !eventKey) {
    verification.lastVoiceKey = voiceKey;
    queueVoice(voiceText);
  }
  if (voiceKey && eventKey && verification.lastVoiceKey !== voiceKey) {
    verification.lastVoiceKey = voiceKey;
  }
  if (changed && eventKey) {
    recordTaskEvent(mission, {
      key: eventKey,
      title: eventTitle || label,
      detail: eventDetail || detail,
      voiceText,
      phase
    });
  }
  return changed;
}

function updateRankAndAchievements() {
  const rank = getRankInfo(state.stats.totalHours);
  const next = rankRules.find((item) => item.minHours > state.stats.totalHours) || rankRules.at(-1);
  const progressMax = rank.nextHours || rank.minHours || 1;
  const progressValue = rank.nextHours ? ((state.stats.totalHours - rank.minHours) / (rank.nextHours - rank.minHours)) * 100 : 100;
  els.pilotRank.textContent = rank.rank;
  els.nextRankLabel.textContent = rank.label;
  els.rankProgressText.textContent = rank.nextHours ? `${Math.min(state.stats.totalHours, rank.nextHours)} / ${rank.nextHours} 小时` : "已达顶级";
  els.rankMeter.style.width = `${Math.max(0, Math.min(100, progressValue))}%`;
  if (next && next.rank !== rank.rank) {
    els.careerGoal.textContent = `继续积累 ${next.minHours - state.stats.totalHours > 0 ? next.minHours - state.stats.totalHours : 0} 小时，向 ${next.rank} 迈进`;
    els.careerGoalText.textContent = `当前阶段：${rank.rank}。完成任务、记录航段或手动同步后，系统会自动更新薪资、声望与解锁等级。`;
  } else {
    els.careerGoal.textContent = `你已经达到 ${rank.rank}`;
    els.careerGoalText.textContent = "继续提升声望，优化机队并挑战更高收益任务。";
  }

  state.achievements = achievementDefs.map((def) => {
    const unlocked = def.test(state);
    return { id: def.id, unlocked };
  });
}

function renderProfile() {
  const rank = getRankInfo(state.stats.totalHours);
  renderAvatar(els.pilotInitials, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatarChoices();
  els.pilotName.textContent = state.pilot.loggedIn ? state.pilot.name : "未登录";
  els.loginPilotBtn.innerHTML = state.pilot.loggedIn
    ? `<i data-lucide="log-out"></i><span>退出</span>`
    : `<i data-lucide="log-in"></i><span>登录</span>`;
  els.pilotRank.textContent = rank.rank;
  els.totalHours.textContent = state.stats.totalHours.toFixed(1);
  els.reputation.textContent = state.reputation;
  els.balance.textContent = formatCompactMoney(state.cash);
  els.totalMiles.textContent = `${state.stats.totalMiles.toLocaleString("en-US")} nm`;
  els.totalLandings.textContent = state.stats.totalLandings.toLocaleString("en-US");
  els.completedCount.textContent = state.stats.completedMissions.toLocaleString("en-US");
  els.activeMissionCount.textContent = `${selectedMissions().length} 个待飞`;
  const fleetLeader = [...state.fleet].sort((a, b) => getAircraftHours(b.id) - getAircraftHours(a.id))[0];
  els.topAircraft.textContent = fleetLeader ? fleetLeader.name : "暂无";
  els.topAircraftHours.textContent = fleetLeader ? `${getAircraftHours(fleetLeader.id).toFixed(1)} 小时` : "0 小时";
  const trend = state.stats.totalHours >= 20 ? "已进入晋升窗口" : "先积累基础飞行时数";
  els.milesTrend.textContent = trend;
}

function getAircraftHours(id) {
  return state.logs.filter((log) => log.aircraftId === id).reduce((sum, log) => sum + Number(log.hours || 0), 0);
}

function logoUrl(airline) {
  return `${LOGO_BASE_URL}${airline?.code || "default"}.png`;
}

function fallbackLogoUrl() {
  return `${LOGO_BASE_URL}default.png`;
}

function airlineLogo(airline, className = "airline-logo") {
  const name = airline?.name || "Airline";
  return `<img class="${className}" src="${logoUrl(airline)}" alt="${name} logo" onerror="this.onerror=null;this.src='${fallbackLogoUrl()}';">`;
}

function renderAirline() {
  const company = state.company?.created ? state.company : null;
  if (els.airlinePanel) els.airlinePanel.hidden = !company;
  if (!company) {
    if (els.airlineMeta) els.airlineMeta.innerHTML = "";
    return;
  }
  const airlineId = company?.airlineId || state.airlineId;
  const airline = airlines.find((item) => item.id === airlineId) || airlines[0];
  const base = company ? companyBase() : null;
  if (els.airlinePanelTitle) els.airlinePanelTitle.textContent = company ? "我的航空公司" : "就职航空公司";
  els.airlineMeta.innerHTML = `
    <div class="mission-card airline-card" style="background:var(--surface-2);box-shadow:none;">
      <div class="mission-head">
        <div class="airline-title">
          ${airlineLogo(airline)}
          <div>
          <h3>${escapeHtml(company?.name || airline.name)}</h3>
            <p>${escapeHtml(airline.name)} · ${escapeHtml(airline.code)} · ${company ? `基地 ${escapeHtml(company.base)}${base?.name ? ` · ${escapeHtml(base.name)}` : ""}` : escapeHtml(airline.type)}</p>
          </div>
        </div>
        <span class="tag ${airline.color}">${company ? "运营中" : "当前就职"}</span>
      </div>
      <div class="tag-row">
        ${company ? `<span class="tag good">公司资金 ${formatMoney(company.funds)}</span><span class="tag">${escapeHtml(company.pilots.filter((pilot) => pilot.status !== "fired").length)} 名飞行员</span><span class="tag">${companyManagedFleet().length} 架飞机</span>` : `<span class="tag">声望要求 ${airline.rep}</span><span class="tag">建议 ${airline.region}</span><span class="tag info">与任务独立</span>`}
      </div>
    </div>`;
}

function renderMissions() {
  const missions = state.missions.slice().filter((mission) => mission && missionVisibleForBase(mission));
  const open = missions.filter((mission) => mission.status !== "completed");
  const recommended = open.slice(0, 3);
  const filters = state.missionFilters || { search: "", status: "all", category: "all", distanceSort: "near" };
  const query = String(filters.search || "").trim().toUpperCase();
  const filteredMissions = missions.filter((mission) => {
    const searchable = `${mission.title} ${mission.route} ${mission.summary} ${mission.category} ${mission.subtype}`.toUpperCase();
    const matchesSearch = !query || searchable.includes(query);
    const matchesStatus = filters.status === "all" || mission.status === filters.status;
    const matchesCategory = filters.category === "all" || mission.category === filters.category;
    return matchesSearch && matchesStatus && matchesCategory;
  });
  const visibleMissions = filteredMissions.sort((a, b) => {
    if (filters.distanceSort === "near" || filters.distanceSort === "far") {
      const distanceDelta = missionDistanceNm(a) - missionDistanceNm(b);
      if (distanceDelta !== 0) return filters.distanceSort === "near" ? distanceDelta : -distanceDelta;
    }
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
  els.missionSearch.value = filters.search || "";
  els.missionDistanceSort.value = filters.distanceSort || "near";
  els.missionStatusFilter.value = filters.status || "all";
  els.missionCategoryButtons.forEach((button) => {
    const active = (button.dataset.missionCategory || "all") === (filters.category || "all");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  els.missionResultCount.textContent = `${visibleMissions.length} / ${missions.length} 个任务`;
  els.recommendedMissions.innerHTML = recommended.map(renderMissionCard).join("") || emptyCard("暂无可推荐任务");
  els.missionsList.innerHTML = visibleMissions.map(renderMissionListItem).join("") || `<p class="mission-list-empty">没有符合条件的任务。</p>`;
  void loadMissionMetars(visibleMissions);
}

function missionDistanceNm(mission) {
  const distance = Number(mission?.site?.distanceNm ?? mission?.distance);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function routeAirportCodes(mission) {
  return String(mission.title || "").match(/[A-Z]{4}/g) || [];
}

function missionMetarAirportCodes(missions) {
  return [...new Set(missions.flatMap((mission) => {
    const codes = routeAirportCodes(mission);
    return [mission.origin || codes[0], mission.destination || codes[1]];
  }).filter((code) => /^[A-Z]{4}$/.test(String(code || "").toUpperCase())).map((code) => String(code).toUpperCase()))];
}

function metarObservationMeta(report) {
  if (!report || report.unavailable) return "暂无最新报文";
  const observedAt = Date.parse(report.observedAt);
  if (!Number.isFinite(observedAt)) return report.stale ? "缓存报文" : "最新报文";
  const minutes = Math.max(0, Math.round((Date.now() - observedAt) / 60000));
  return `${minutes} 分钟前 · ${report.stale ? "缓存" : "AWC"}`;
}

function missionMetarLine(icao, label, fallbackWeather) {
  const code = String(icao || "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    return `<div class="mission-metar-line is-unavailable"><span>${label}</span><div><b>任务现场</b><code>无机场 METAR · ${escapeHtml(fallbackWeather || "按现场条件执行")}</code></div></div>`;
  }
  const report = missionMetarCache.get(code);
  const raw = report?.raw || (report?.unavailable ? `暂无报文 · ${fallbackWeather || "按任务天气执行"}` : "正在获取最新报文...");
  return `<div class="mission-metar-line" data-metar-icao="${code}" data-metar-fallback="${escapeHtml(fallbackWeather || "按任务天气执行")}">
    <span>${label}</span>
    <div><b>${code}</b><code>${escapeHtml(raw)}</code><small>${metarObservationMeta(report)}</small></div>
  </div>`;
}

function updateMissionMetarReadouts() {
  document.querySelectorAll("[data-metar-icao]").forEach((node) => {
    const report = missionMetarCache.get(node.dataset.metarIcao);
    const fallback = node.dataset.metarFallback || "按任务天气执行";
    const code = node.querySelector("code");
    const meta = node.querySelector("small");
    if (code) code.textContent = report?.raw || (report?.unavailable ? `暂无报文 · ${fallback}` : "正在获取最新报文...");
    if (meta) meta.textContent = metarObservationMeta(report);
  });
}

async function loadMissionMetars(missions) {
  const codes = missionMetarAirportCodes(missions);
  const now = Date.now();
  const needed = codes.filter((code) => now - Number(missionMetarCache.get(code)?.fetchedAt || 0) >= missionMetarClientTtlMs);
  if (!needed.length || missionMetarPromise) {
    updateMissionMetarReadouts();
    return missionMetarPromise;
  }
  missionMetarPromise = (async () => {
    try {
      const response = await fetch(`/api/metar?ids=${encodeURIComponent(needed.join(","))}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "metar-unavailable");
      needed.forEach((code) => {
        const report = payload.observations?.[code];
        missionMetarCache.set(code, report
          ? { ...report, fetchedAt: now }
          : { unavailable: true, fetchedAt: now });
      });
    } catch {
      needed.forEach((code) => missionMetarCache.set(code, { unavailable: true, fetchedAt: now }));
    } finally {
      missionMetarPromise = null;
      updateMissionMetarReadouts();
    }
  })();
  return missionMetarPromise;
}

