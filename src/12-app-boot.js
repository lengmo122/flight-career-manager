// 模飞生涯 渲染器源码 12-app-boot.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）

// state 必须在所有函数定义文件加载完成后初始化（defaultState 依赖 makeMission 等跨文件函数）。
var state = loadState();
function handleAircraftManagementInput(event) {
  const slider = event.target.closest('[data-action="fuel-target"]');
  if (!slider) return;
  const { id } = slider.dataset;
  const minimumPercent = Number(slider.dataset.minimum || 0);
  const targetPercent = Math.max(minimumPercent, Math.min(100, Number(slider.value) || 0));
  slider.value = String(targetPercent);
  fuelTargetPercents.set(id, targetPercent);
  fuelTargetBaselines.set(id, minimumPercent);
  const prefix = String(slider.dataset.controlPrefix || "").trim();
  const output = document.getElementById(`fuelTarget-${prefix ? `${prefix}-` : ""}${id}`);
  if (output) output.textContent = `${targetPercent.toFixed(0)}%`;
  const button = document.querySelector(`[data-action="refuel-aircraft"][data-id="${id}"][data-control-prefix="${CSS.escape(prefix)}"]`);
  if (button) button.disabled = targetPercent <= Number(slider.dataset.minimum || 0);
}

function manualLog(prefill = {}) {
  logMode = "manual";
  els.logModalTitle.textContent = "记录航段";
  els.logForm.dataset.mode = "manual";
  els.logFrom.value = prefill.from || state.pilot.base;
  els.logTo.value = prefill.to || "";
  els.logAircraft.value = prefill.aircraft || currentAircraft().name;
  els.logHours.value = prefill.hours || 1.2;
  els.logMiles.value = prefill.miles || 180;
  els.logIncome.value = prefill.income || 2400;
  els.logNotes.value = prefill.notes || "";
  els.logModal.showModal();
}

function saveManualLog() {
  const from = els.logFrom.value.trim().toUpperCase();
  const to = els.logTo.value.trim().toUpperCase();
  const aircraftName = els.logAircraft.value.trim();
  const hours = Number(els.logHours.value);
  const miles = Number(els.logMiles.value);
  const income = Number(els.logIncome.value);
  if (!from || !to || !aircraftName) return;
  const aircraft = state.fleet.find((item) => item.name === aircraftName) || currentAircraft();
  state.logs.unshift({
    id: cryptoId("log"),
    date: Date.now(),
    from,
    to,
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    hours,
    miles,
    income,
    notes: els.logNotes.value.trim()
  });
  recordFundTransaction({
    amount: income,
    type: income >= 0 ? "manual-income" : "manual-expense",
    title: income >= 0 ? "手动航段收入" : "手动航段支出",
    detail: `${from} → ${to} · ${aircraft.name}`,
    referenceId: state.logs[0].id
  });
  state.stats.totalHours += hours;
  state.stats.totalMiles += miles;
  state.stats.totalLandings += 2;
  state.stats.manualLogs += 1;
  state.reputation += Math.max(1, Math.round(hours / 2));
  toast("航段已记录");
  maybeAutoCreateMission();
  renderAll();
}

function loginPilot() {
  state.pilot.loggedIn = false;
  els.pilotNameInput.value = String(state.pilot.name || "").replace(/\D/g, "").slice(0, 32);
  els.pilotBaseInput.value = normalizeAirportInputCode(state.pilot.base || "");
  renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
  renderAvatarChoices();
  els.loginGate.hidden = false;
  els.appShell.hidden = true;
  document.body.classList.add("auth-only");
  window.desktopApp?.setWindowMode("login");
  window.setTimeout(() => els.pilotNameInput.focus(), 0);
}

function enterSystem() {
  els.loginGate.hidden = true;
  els.appShell.hidden = false;
  document.body.classList.remove("auth-only");
  window.desktopApp?.setWindowMode("system");
}

function logoutPilot() {
  state.pilot.loggedIn = false;
  saveState();
  renderProfile();
  wireIcons();
  loginPilot();
}

function togglePilotLogin() {
  if (state.pilot.loggedIn) logoutPilot();
  else loginPilot();
}

async function savePilot() {
  const previousBase = normalizeBaseCode(state.pilot.base);
  const name = String(els.pilotNameInput.value || "").replace(/\D/g, "").slice(0, 32);
  const base = normalizeAirportInputCode(els.pilotBaseInput.value);
  if (!/^\d{2,32}$/.test(name)) {
    toast("飞行员呼号只能输入 2 至 32 位数字");
    return false;
  }
  if (!/^[A-Z]{4}$/.test(base)) {
    toast("机场代码只能输入四位英文字母");
    return false;
  }
  if (!companyAirportByIcao(base)) {
    toast("请输入有效的四字 ICAO 机场代码");
    return false;
  }
  els.pilotNameInput.value = name;
  els.pilotBaseInput.value = base;
  state.pilot.name = name;
  state.pilot.base = base;
  state.pilot.loggedIn = true;
  state.pilot.hasCompletedLogin = true;
  if (state.pilot.base !== previousBase) {
    const removed = removeOpenMissionsOutsideBase(state.pilot.base);
    const added = autoRefreshMissions({ silent: true, forceRefresh: true });
    saveState();
    toast(`基地已切换至 ${state.pilot.base}，已生成周边任务`);
  } else {
    toast("飞行员档案已保存");
  }
  await saveState();
  enterSystem();
  renderAll();
  return true;
}

function generateMission() {
  const category = randomCategory();
  const mission = makeMission(category, randomSubtype(category));
  if (!mission) {
    toast("当前基地周边暂时没有符合条件的任务");
    return;
  }
  state.missions.unshift(mission);
  toast("已生成新任务");
  renderAll();
}

function makeSceneMission(category, subtype = randomSubtype(category), offsetHours = 0) {
  const compatibleAircraft = state.fleet
    .filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented) && isAircraftCompatible(category, aircraft))
    .sort((a, b) => Number(a.unlockHours || 0) - Number(b.unlockHours || 0));
  const selected = currentAircraft();
  const missionAircraft = compatibleAircraft.find((aircraft) => aircraft.id === selected.id)
    || compatibleAircraft.find((aircraft) => aircraft.owned || aircraft.rented)
    || compatibleAircraft[0];
  if (!missionAircraft) return null;
  const mission = makeMission(category, subtype, offsetHours, missionAircraft);
  if (!mission) return null;
  mission.permittedAircraftIds = compatibleAircraft.map((aircraft) => aircraft.id);
  mission.aircraftHint = compatibleAircraft.slice(0, 3).map((aircraft) => aircraft.name).join(" / ");
  return mission;
}

function generateSceneMission() {
  const sceneCategories = ["搜救", "海上救援", "事故调查"];
  const lastCategory = state.features?.lastSceneCategory;
  const categoryIndex = lastCategory ? (sceneCategories.indexOf(lastCategory) + 1) % sceneCategories.length : 0;
  const category = sceneCategories[categoryIndex];
  const previousSubtype = state.features?.lastSceneSubtype;
  const subtypePool = (missionPools[category] || []).filter((subtype) => subtype !== previousSubtype);
  const subtype = pick(subtypePool.length ? subtypePool : missionPools[category]);
  const mission = makeSceneMission(category, subtype);
  if (!mission) {
    const hasCompatibleAircraft = state.fleet.some((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented) && isAircraftCompatible(category, aircraft));
    toast(hasCompatibleAircraft ? "基地周边暂时没有可用任务点，请稍后重试" : `${category}暂时没有适配机型`);
    return;
  }
  state.missions.unshift(mission);
  state.features = { ...(state.features || {}), lastSceneCategory: category, lastSceneSubtype: subtype };
  state.missionFilters = { search: "", status: "all", category };
  toast(`已生成 ${category}：${subtype}`);
  renderAll();
}

async function exportSave() {
  const encrypted = await encryptSaveText(JSON.stringify(state));
  const blob = new Blob([encrypted], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flight-career-save-${new Date().toISOString().slice(0, 10)}.fcm`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("加密存档已导出");
}

async function importSave(file) {
  const text = await file.text();
  const decoded = await decodeSavePayload(text);
  const merged = mergeState(defaultState(), decoded.value);
  writeBackup(`导入存档前：${file.name}`);
  Object.assign(state, merged);
  saveStorageError = null;
  await saveState();
  toast(decoded.legacy ? "旧版存档已导入并加密" : "加密存档已导入");
  renderAll();
}

async function resetDemo() {
  if (!await showConfirmDialog("确定重置所有数据吗？当前职业数据会被覆盖，操作前将自动保留备份。")) return;
  writeBackup("重置所有数据前");
  Object.assign(state, defaultState());
  saveStorageError = null;
  await saveState();
  toast("已重置所有数据");
  renderAll();
  loginPilot();
}

function handleAction(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const { action: name, id } = action.dataset;
  if (name === "accept-mission") acceptMission(id);
  if (name === "manual-complete-mission") void manualCompleteMission(id);
  if (name === "delete-mission") void deleteMission(id);
  if (name === "restore-backup") {
    if (els.settingsModal?.open) els.settingsModal.close();
    void restoreBackup(id);
  }
  if (name === "buy-aircraft") buyAircraft(id);
  if (name === "rent-aircraft") rentAircraft(id);
  if (name === "return-aircraft") returnAircraft(id);
  if (name === "sell-aircraft") void sellAircraft(id);
  if (name === "select-aircraft") { selectAircraft(id); renderAll(); toast("已切换默认机型"); }
  if (name === "refuel-aircraft") void refuelAircraft(id);
  if (name === "repair-aircraft") repairAircraft(id);
  if (name === "buy-aircraft-license") purchaseAircraftLicense(id);
  if (name === "create-company") createCompany();
  if (name === "close-company") void closeCompany();
  if (name === "hire-company-pilot") hireCompanyPilot(id);
  if (name === "upgrade-company-pilot") upgradeCompanyPilot(id);
  if (name === "fire-company-pilot") fireCompanyPilot(id);
  if (name === "dispatch-company-task") dispatchCompanyTask(id);
  if (name === "complete-company-task") completeCompanyTask(id);
  if (name === "open-company-tasks") setCompanySection("tasks");
}

function bindEvents() {
  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewShortcut));
  });
  document.querySelectorAll("[data-company-section]").forEach((button) => {
    button.addEventListener("click", () => setCompanySection(button.dataset.companySection));
  });

  document.addEventListener("click", handleAction);
  document.addEventListener("input", handleAircraftManagementInput);
  els.companyTaskList?.addEventListener("change", (event) => {
    const select = event.target.closest("[data-company-pilot-for], [data-company-aircraft-for]");
    if (!select) return;
    const row = select.closest("[data-company-dispatch-for]");
    updateCompanyTaskSelectors(row, select.matches("[data-company-pilot-for]") ? "pilot" : "aircraft");
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "pilotNameInput") {
      event.target.value = String(event.target.value || "").replace(/\D/g, "").slice(0, 32);
    }
    if (event.target.id === "pilotBaseInput" || event.target.id === "companyBaseInput") {
      event.target.value = normalizeAirportInputCode(event.target.value);
    }
    if (event.target.id === "planOriginInput" || event.target.id === "planDestinationInput") {
      updatePlanAirportFields();
    }
    if (event.target.id === "companyBaseInput" || event.target.id === "companyNameInput") updateCompanyCreatePreview();
  });
  els.followAircraftBtn.addEventListener("click", toggleMapTracking);
  els.toggleCompanyAircraftBtn.addEventListener("click", toggleCompanyAircraft);
  els.mapLayerControls.forEach((button) => {
    button.addEventListener("click", () => setMapLayer(button.dataset.mapLayer));
  });
  document.getElementById("refreshMapBtn").addEventListener("click", renderMapPage);
  document.getElementById("connectSimulatorBtn").addEventListener("click", connectSimulator);
  document.getElementById("createBackupBtn").addEventListener("click", createManualBackup);
  els.generatePlannedMissionBtn.addEventListener("click", generatePlannedMission);
  els.planAircraftSelect?.addEventListener("change", updatePlanAirportFields);
  document.getElementById("heroMissionBtn").addEventListener("click", () => showView("missions"));
  document.getElementById("heroLogBtn").addEventListener("click", () => showView("logs"));
  els.loginPilotBtn.addEventListener("click", togglePilotLogin);
  els.avatarChoiceGrid?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-avatar-choice]");
    if (choice) selectAvatar(choice.dataset.avatarChoice);
  });
  els.uploadAvatarBtn?.addEventListener("click", () => els.pilotAvatarFile?.click());
  els.pilotAvatarFile?.addEventListener("change", async () => {
    const file = els.pilotAvatarFile.files?.[0];
    if (!file) return;
    try {
      state.pilot.avatarDataUrl = await resizeAvatarFile(file);
      state.pilot.avatarPreset = "";
      renderAvatar(els.pilotAvatarPreview, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
      renderAvatar(els.pilotInitials, state.pilot.avatarDataUrl, state.pilot.name, state.pilot.avatarPreset);
      renderAvatarChoices();
      saveState();
      wireIcons();
      toast("头像已更新");
    } catch (error) {
      toast(error?.message === "avatar-too-large" ? "头像文件不能超过 5 MB" : "头像格式不支持，请选择 PNG、JPG 或 WebP 图片");
    } finally {
      els.pilotAvatarFile.value = "";
    }
  });
  els.supportBtn?.addEventListener("click", openSupport);
  els.thankSupportBtn?.addEventListener("click", openSupport);
  els.themeModeBtn?.addEventListener("click", toggleThemeMode);
  els.contactAuthorBtn?.addEventListener("click", openContactAuthor);
  els.copyAuthorQqBtn?.addEventListener("click", () => void copyAuthorQqGroup());
  els.aboutBtn?.addEventListener("click", openAbout);
  document.getElementById("exportBtn").addEventListener("click", () => void exportSave().catch(() => toast("存档加密失败，请稍后重试")));
  document.getElementById("importBtn").addEventListener("click", () => els.importFile.click());
  els.settingsBtn.addEventListener("click", openSettings);
  els.speechVolumeRange.addEventListener("input", updateSettingsVolumePreview);
  els.settingsModal.addEventListener("close", closeSettings);
  els.refreshRuntimeLogBtn?.addEventListener("click", () => void loadRuntimeLogs());
  els.clearRuntimeLogBtn?.addEventListener("click", () => void clearRuntimeLogs());
  els.exportRuntimeLogBtn?.addEventListener("click", () => void exportRuntimeLogs());
  document.getElementById("resetBtn").addEventListener("click", () => void resetDemo());
  document.getElementById("refreshApplicantsBtn").addEventListener("click", refreshCompanyApplicants);
  document.getElementById("refreshCompanyTasksBtn").addEventListener("click", refreshCompanyTasks);

  els.missionSearch.addEventListener("input", () => {
    state.missionFilters.search = els.missionSearch.value;
    saveState();
    renderMissions();
    wireIcons();
  });
  els.missionDistanceSort.addEventListener("change", () => {
    state.missionFilters.distanceSort = els.missionDistanceSort.value;
    saveState();
    renderMissions();
    wireIcons();
  });
  els.missionStatusFilter.addEventListener("change", () => {
    state.missionFilters.status = els.missionStatusFilter.value;
    saveState();
    renderMissions();
    wireIcons();
  });
  els.missionCategoryButtons.forEach((button) => button.addEventListener("click", () => {
    state.missionFilters.category = button.dataset.missionCategory || "all";
    saveState();
    renderMissions();
    wireIcons();
  }));
  els.refreshMissionsBtn?.addEventListener("click", () => {
    autoRefreshMissions({ silent: false, forceRefresh: true });
  });
  els.refreshLicenseAssessmentsBtn?.addEventListener("click", refreshLicenseAssessmentMissions);

  els.importFile.addEventListener("change", async () => {
    const file = els.importFile.files?.[0];
    if (!file) return;
    try {
      await importSave(file);
    } catch (error) {
      toast("导入失败，文件格式不正确");
    } finally {
      els.importFile.value = "";
    }
  });

  els.pilotForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (await savePilot()) toast(`已登录：${state.pilot.name}`);
  });

  els.hangarFilter.addEventListener("change", () => {
    state.hangarFilter = els.hangarFilter.value;
    saveState();
    renderHangar();
  });

  els.hangarSearch.addEventListener("input", () => {
    state.hangarSearch = els.hangarSearch.value;
    saveState();
    renderHangar();
  });
  els.aircraftManagementFilter?.addEventListener("change", () => {
    state.aircraftManagementFilter = els.aircraftManagementFilter.value;
    saveState();
    renderAircraftManagement();
  });
  els.aircraftManagementSearch?.addEventListener("input", () => {
    state.aircraftManagementSearch = els.aircraftManagementSearch.value;
    saveState();
    renderAircraftManagement();
  });
  els.companyHangarFilter?.addEventListener("change", () => {
    state.companyHangarFilter = els.companyHangarFilter.value;
    saveState();
    renderCompanyHangar();
    wireIcons();
  });
  els.companyHangarSearch?.addEventListener("input", () => {
    state.companyHangarSearch = els.companyHangarSearch.value;
    saveState();
    renderCompanyHangar();
    wireIcons();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void exportSave().catch(() => toast("存档加密失败，请稍后重试"));
    }
  });
}

function migrateMissionRouteTitle(mission) {
  if (mission?.site && typeof mission.title === "string") {
    mission.title = mission.title.replace(/→\s*现场\s*(\d{3}°)/, "→ 航向 $1");
  }
  return mission;
}

function hydrateFromState() {
  const taskEventsBeforeDedupe = Array.isArray(state.taskEvents) ? state.taskEvents.length : 0;
  const starterHelicopterGranted = grantStarterHelicopter(state);
  let companyStarterAircraftGranted = false;
  if (state.company?.created && state.company.starterAircraftGranted !== true) {
    const existingCompanyAircraft = state.fleet.find((aircraft) => isCompanyAircraft(aircraft));
    const companyAircraft = existingCompanyAircraft || createCompanyAircraft();
    if (companyAircraft && !existingCompanyAircraft) state.fleet.push(companyAircraft);
    if (companyAircraft) {
      state.company.aircraftIds = [...new Set([...(state.company.aircraftIds || []), companyAircraft.id])];
      state.company.starterAircraftGranted = true;
      companyStarterAircraftGranted = true;
    }
  }
  const landingWearStarted = !(Number(state.features?.landingWearStartedAt) > 0);
  if (landingWearStarted) {
    state.features = { ...(state.features || {}), landingWearStartedAt: Date.now() };
  }
  state.taskEvents = uniqueTaskEvents(state.taskEvents);
  state.missions = Array.isArray(state.missions) ? state.missions.filter(Boolean) : [];
  const removedOpenMissions = removeOpenMissionsOutsideBase();
  if (!state.fleet.some((item) => item.selected && !isCompanyAircraft(item))) selectAircraft("c172");
  if (!state.missions.length) state.missions = seedMissions();
  state.missions.forEach((mission) => {
    let resetLegacySceneArrival = false;
    migrateMissionRouteTitle(mission);
    // Older saves stored an airline on each mission. Keep the save compatible,
    // but remove the obsolete relationship so the airline panel stays independent.
    delete mission.airlineId;
    if (mission.refreshable === undefined) mission.refreshable = !String(mission.subtype || "").startsWith("时刻表");
    mission.priority ||= isEmergencyMission(mission) ? "emergency" : mission.refreshable === false ? "scheduled" : "standard";
    mission.aircraftHint ||= currentAircraft().name;
    mission.permittedAircraftIds ||= [currentAircraft().id];
    mission.dispatchPhase ||= "日间";
    mission.recommendedPhases ||= missionPolicies[mission.category]?.phases || ["日间"];
    if (mission.scene?.objectTitle) {
      const previousArrivalMode = mission.scene.arrivalMode;
      mission.scene.icon = flightCareerMissionScenes[mission.subtype]?.icon || mission.scene.icon;
      mission.scene.objectTitle = mission.scene.objectTitle.replace(/^neofly/i, "FCM");
      if (typeof mission.scene.clip === "string") mission.scene.clip = mission.scene.clip.replace(/neofly/gi, "FCM");
      mission.scene.terrain = missionTerrainType(mission);
      mission.scene.requiresLanding = missionRequiresLanding(mission);
      mission.scene.arrivalMode = mission.scene.requiresLanding ? "landing" : "low-altitude";
      resetLegacySceneArrival = previousArrivalMode === "low-altitude" && mission.scene.arrivalMode === "landing";
      mission.scene.source = "Flight Career Objects 1.0.0";
    }
    if (typeof mission.verification?.sceneDetail === "string") {
      mission.verification.sceneDetail = mission.verification.sceneDetail.replace(/NeoFly 对象包/gi, "Flight Career Objects");
    }
    if (mission.status === "accepted" && mission.verification) {
      mission.verification.aircraftId ||= mission.permittedAircraftIds[0] || currentAircraft().id;
      mission.verification.aircraftName ||= state.fleet.find((aircraft) => aircraft.id === mission.verification.aircraftId)?.name || mission.aircraftHint;
      if (mission.verification.phase === "airborne") mission.verification.phase = "outbound";
      if (!mission.verification.phase) mission.verification.phase = "briefed";
      mission.verification.lastTelemetryTimestamp ||= "";
      const legacyPositionLock = mission.verification.teleportLocked === true
        && mission.verification.teleportReason !== "slew";
      mission.verification.teleportLocked = legacyPositionLock ? false : mission.verification.teleportLocked === true;
      mission.verification.teleportReason = mission.verification.teleportLocked ? "slew" : "";
      mission.verification.teleportDistanceNm ||= 0;
      mission.verification.teleportElapsedSec ||= 0;
      mission.verification.ignoredTelemetryJumps = Math.max(0, Number(mission.verification.ignoredTelemetryJumps) || 0);
      if (legacyPositionLock) {
        mission.verification.teleportDistanceNm = 0;
        mission.verification.teleportElapsedSec = 0;
        mission.verification.lastPoint = null;
        mission.verification.lastTelemetryTimestamp = "";
      }
      mission.verification.lastVoiceKey ||= "";
      if (mission.verification.engineRunning === undefined) mission.verification.engineRunning = null;
      mission.verification.engineStartAnnounced ||= false;
      mission.verification.outboundStartPoint ||= null;
      mission.verification.departureAirport ||= null;
      mission.verification.arrivalAirport ||= null;
      mission.verification.landingDwellStartedAt ||= null;
      mission.verification.landingDwellSeconds ||= 0;
      mission.verification.targetLandingConfirmed ||= false;
      if (resetLegacySceneArrival
        && ["target-confirmed", "returning"].includes(mission.verification.phase)
        && !mission.verification.targetLandingConfirmed) {
        mission.verification.phase = "outbound";
        mission.verification.phaseLabel = "前往任务点";
        mission.verification.detail = "该任务使用地面救援模型，必须在任务现场安全着陆并确认接地后才能返航。";
        mission.verification.landingDwellStartedAt = null;
        mission.verification.landingDwellSeconds = 0;
        mission.verification.arrivalNoticeAnnounced = false;
      }
      mission.verification.arrivalNoticeAnnounced ||= false;
      if (mission.verification.rewardEligible === undefined) mission.verification.rewardEligible = null;
      if (mission.verification.fuelStartKg === undefined) mission.verification.fuelStartKg = null;
      if (mission.verification.fuelCurrentKg === undefined) mission.verification.fuelCurrentKg = null;
      if (mission.verification.fuelLastKg === undefined) mission.verification.fuelLastKg = null;
      mission.verification.fuelUsedKg = Math.max(0, Number(mission.verification.fuelUsedKg) || 0);
      mission.verification.fuelAddedKg = Math.max(0, Number(mission.verification.fuelAddedKg) || 0);
      mission.verification.fuelUpdatedAt ||= null;
      ensureSopState(mission.verification);
      if (isSopMode()) mission.verification.sop.enabled = true;
    }
  });
  const licenseAssessmentsAdded = ensureLicenseAssessmentMissions();
  if (!state.logs.length && state.stats.totalHours > 0) {
    state.logs.unshift({
      id: cryptoId("log"),
      date: Date.now() - 86400000,
      from: state.pilot.base,
      to: "ZSPD",
      aircraftId: currentAircraft().id,
      aircraftName: currentAircraft().name,
      hours: 1.4,
      miles: 210,
      income: 2400,
      notes: "演示日志"
    });
  }
  if (!state.achievements.length) {
    state.achievements = achievementDefs.map((a) => ({ id: a.id, unlocked: false }));
  }
  if (!state.features?.sceneObjectsSeeded && !state.features?.neoFlyScenesSeeded) {
    [
      ["搜救", "坠机现场搜救"],
      ["海上救援", "海上人员搜救"],
      ["事故调查", "航空事故调查"]
    ].reverse().forEach(([category, subtype], index) => {
      const mission = makeSceneMission(category, subtype, index + 1);
      if (mission) state.missions.unshift(mission);
    });
    state.features = { ...(state.features || {}), sceneObjectsSeeded: true };
  }
  if (state.features?.neoFlyScenesSeeded) {
    state.features.sceneObjectsSeeded = true;
    delete state.features.neoFlyScenesSeeded;
  }
  if (taskEventsBeforeDedupe !== state.taskEvents.length || removedOpenMissions > 0 || starterHelicopterGranted || companyStarterAircraftGranted || landingWearStarted || licenseAssessmentsAdded) saveState();
}

async function initializeTerrainData() {
  try {
    const response = await fetch("./assets/data/land-110m.geojson", { cache: "force-cache" });
    if (!response.ok) throw new Error(`terrain ${response.status}`);
    const geojson = await response.json();
    const polygonCount = window.FlightTerrain?.configure(geojson) || 0;
    if (!polygonCount) throw new Error("terrain data is empty");
    return true;
  } catch {
    // Standard airport missions remain available if the optional terrain file is unavailable.
    return false;
  }
}

async function initializeGlobalAirportData() {
  try {
    const response = await fetch("./assets/data/global-airports-zh.json", { cache: "force-cache" });
    if (!response.ok) throw new Error(`airports ${response.status}`);
    const payload = await response.json();
    const airports = Array.isArray(payload?.airports) ? payload.airports.filter((airport) => /^[A-Z0-9]{4}$/.test(airport?.icao)) : [];
    if (!airports.length) throw new Error("airport data is empty");
    globalAirportDatabase = airports;
    globalAirportIndex = new Map(airports.map((airport) => [airport.icao, airport]));
    return true;
  } catch {
    globalAirportDatabase = [...airportDatabase];
    globalAirportIndex = new Map(globalAirportDatabase.map((airport) => [airport.icao, airport]));
    return false;
  }
}

async function startApplication() {
  await Promise.all([initializeTerrainData(), initializeGlobalAirportData()]);
  await Promise.all([hydrateStoredState(), hydrateBackups()]);
  hydrateFromState();
  bindEvents();
  const hasPilotProfile = Boolean(state.pilot?.hasCompletedLogin && state.pilot?.name?.trim() && state.pilot?.base?.trim());
  state.pilot.loggedIn = hasPilotProfile;
  applyTheme(state.settings?.darkMode === true);
  renderAll();
  if (saveStorageError) {
    window.setTimeout(() => toast("存档校验失败，已拒绝加载被修改的数据；如需重新开始，请使用重置所有数据"), 0);
  }
  if (hasPilotProfile) enterSystem();
  else loginPilot();
  document.body.dataset.appReady = "true";
  void pollSimulator();
  simulatorPollTimer = window.setInterval(pollSimulator, 2000);
  autoRefreshMissions({ rotateExpired: true });
  missionRefreshTimer = window.setInterval(() => autoRefreshMissions({ rotateExpired: true }), MISSION_REFRESH_INTERVAL_MS);
}

window.addEventListener("error", (event) => {
  void reportRuntimeLog("error", "前端运行异常", { message: event.message, source: event.filename, line: event.lineno });
});
window.addEventListener("unhandledrejection", (event) => {
  void reportRuntimeLog("error", "未处理的异步异常", { reason: String(event.reason?.message || event.reason || "unknown") });
});

startApplication();

