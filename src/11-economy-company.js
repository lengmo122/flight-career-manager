// 模飞生涯 渲染器源码 11-economy-company.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function readBackups() {
  return Array.isArray(backupCache) ? backupCache : [];
}

function writeBackup(reason) {
  backupCache.unshift({
    id: cryptoId("backup"),
    reason,
    createdAt: Date.now(),
    state: JSON.stringify(state)
  });
  backupCache = backupCache.slice(0, 8);
  backupWriteChain = backupWriteChain
    .catch(() => {})
    .then(async () => {
      await writeStorageValue(BACKUP_KEY, await encryptSaveText(JSON.stringify(backupCache)));
    })
    .catch((error) => {
      saveStorageError = error;
    });
  return backupWriteChain;
}

async function hydrateBackups() {
  const raw = await readStorageValue(BACKUP_KEY);
  if (!raw) {
    backupsHydrated = true;
    return;
  }
  try {
    const decoded = await decodeSavePayload(raw);
    backupCache = Array.isArray(decoded.value) ? decoded.value : [];
    backupsHydrated = true;
    if (decoded.legacy) {
      backupWriteChain = backupWriteChain.then(async () => {
        await writeStorageValue(BACKUP_KEY, await encryptSaveText(JSON.stringify(backupCache)));
      });
      await backupWriteChain;
    }
  } catch (error) {
    // Do not expose or silently accept a modified backup chain.
    backupCache = [];
    backupsHydrated = true;
    saveStorageError ||= error;
  }
}

function createManualBackup() {
  writeBackup("手动备份");
  toast("已创建本地备份");
  renderBackups();
  wireIcons();
}

async function restoreBackup(id) {
  const backup = readBackups().find((item) => item.id === id);
  if (!backup) {
    toast("备份不存在或已被清理");
    return;
  }
  if (!await showConfirmDialog(`恢复“${backup.reason}”吗？当前进度会先自动备份。`)) return;
  try {
    const restored = JSON.parse(backup.state);
    writeBackup("恢复备份前");
    Object.assign(state, mergeState(defaultState(), restored));
    toast("备份已恢复");
    renderAll();
  } catch {
    toast("备份数据损坏，无法恢复");
  }
}

function airlineFromCode(code) {
  return airlines.find((airline) => code.startsWith(airline.code) || airline.code.startsWith(code));
}

function estimateDistance(from, to, duration) {
  const seed = [...`${from}${to}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const cruise = 210 + (seed % 180);
  return Math.max(80, Math.round(duration * cruise));
}

function randomCategory(allowed = compatibleCategories()) {
  const categories = allowed.length ? allowed : ["包机"];
  const weights = categories.map((category) => ({ 客运: 0.28, 货运: 0.18, 包机: 0.14, 医疗: 0.14, 搜救: 0.1, 海上救援: 0.09, 事故调查: 0.07 }[category] || 0.1));
  return pick(categories, weights);
}

function randomSubtype(category) {
  return pick(missionPools[category] || missionPools.客运, [0.35, 0.25, 0.2, 0.2]);
}

function makeEmergencyMission(preferredKind = "", baseOverride = "") {
  const managedFleet = missionEligibleAircraft();
  const categoryOptions = emergencyMissionCategories.map((category) => ({
    category,
    aircraft: managedFleet.filter((aircraft) => isAircraftCompatible(category, aircraft) && (preferredKind !== "helicopter" || isHelicopterAircraft(aircraft)))
  })).filter((option) => option.aircraft.length);
  if (!categoryOptions.length) return null;

  const option = pick(categoryOptions);
  const selected = currentAircraft();
  const aircraft = option.aircraft.find((candidate) => candidate.id === selected.id) || pick(option.aircraft);
  const mission = makeMission(option.category, randomSubtype(option.category), 0, aircraft, baseOverride);
  if (!mission) return null;
  const origin = normalizeBaseCode(mission.origin);
  const sameAirportAircraft = option.aircraft.filter((candidate) => normalizeBaseCode(aircraftOperationalBase(candidate)) === origin);
  const permittedAircraft = sameAirportAircraft.length ? sameAirportAircraft : [aircraft];
  mission.permittedAircraftIds = permittedAircraft.map((candidate) => candidate.id);
  mission.aircraftHint = permittedAircraft.slice(0, 3).map((candidate) => candidate.name).join(" / ");
  mission.priority = "emergency";
  return mission;
}

function maybeAutoUnlockAircraft() {
  state.fleet.forEach((aircraft) => {
    if (aircraft.unlockHours === 0) return;
    if (state.stats.totalHours >= aircraft.unlockHours && !aircraft.owned && !aircraft.rented) {
      // show as available only; no auto-grant
    }
  });
}

async function deleteMission(id) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || endingMissionIds.has(id)) return;
  const active = mission.status === "accepted";
  const completed = mission.status === "completed";
  const message = active
    ? `确定删除执行中任务“${mission.title}”吗？当前任务进度会被清除，且不会获得奖励。`
    : completed
      ? `确定删除已完成任务“${mission.title}”吗？任务卡和任务日志会被移除，飞行日志仍会保留。`
      : `确定删除任务“${mission.title}”吗？删除后不能再次接取。`;
  if (!await showConfirmDialog(message)) return;
  endingMissionIds.add(id);
  try {
    if (activeVerifiedMission()?.id === mission.id) {
      await fetch("/api/simulator/scene", { method: "DELETE" }).catch(() => {});
      await fetch("/api/simulator/flight-plan", { method: "DELETE" }).catch(() => {});
    }
    state.missions = state.missions.filter((item) => item.id !== id);
    state.taskEvents = state.taskEvents.filter((event) => event.missionId !== id);
    state.schedules = state.schedules.filter((record) => record.missionId !== id);
    if (state.simulatorFlight?.missionId === id) {
      state.simulatorFlight = { ...state.simulatorFlight, missionId: "" };
    }
    const license = state.licenses.find((record) => record.assessmentMissionId === id);
    if (license && !license.assessmentCompleted) license.assessmentMissionId = "";
    saveState();
    toast(completed ? "已删除任务，飞行日志已保留" : active ? "执行中任务已删除" : "任务已删除");
    renderAll();
  } finally {
    endingMissionIds.delete(id);
  }
}

function buyAircraft(id) {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === id);
  if (!template) return;
  if (!isFreeMode() && state.stats.totalHours < template.unlockHours) {
    toast(`需要 ${template.unlockHours} 小时后解锁`);
    return;
  }
  if (state.cash < template.price) {
    toast("资金不足");
    return;
  }
  const aircraft = createPersonalAircraft(template.id, "owned");
  if (!aircraft) return;
  recordFundTransaction({
    amount: -template.price,
    type: "aircraft-purchase",
    title: "购买飞机",
    detail: `${template.name} · 机队编号 ${aircraftFleetNumber(aircraft)}`,
    referenceId: aircraft.id
  });
  state.fleet.push(aircraft);
  selectAircraft(aircraft.id);
  toast(`已购买 ${aircraft.name}，已加入飞机管理`);
  renderAll();
}

function rentAircraft(id) {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === id);
  if (!template) return;
  if (!isFreeMode() && state.stats.totalHours < template.unlockHours) {
    toast(`需要 ${template.unlockHours} 小时后解锁`);
    return;
  }
  if (state.cash < template.rent) {
    toast("租金不足");
    return;
  }
  const aircraft = createPersonalAircraft(template.id, "rented");
  if (!aircraft) return;
  recordFundTransaction({
    amount: -template.rent,
    type: "aircraft-rental",
    title: "租赁飞机",
    detail: `${template.name} · 机队编号 ${aircraftFleetNumber(aircraft)}`,
    referenceId: aircraft.id
  });
  state.fleet.push(aircraft);
  selectAircraft(aircraft.id);
  toast(`已租赁 ${aircraft.name}，已加入飞机管理`);
  renderAll();
}

function returnAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  if (!aircraft || !aircraft.rented || isCompanyAircraft(aircraft)) return;
  if (aircraftHasActiveMission(aircraft)) {
    toast("执行任务期间不能归还飞机");
    return;
  }
  state.fleet = state.fleet.filter((item) => item.id !== id);
  ensureSelectedPersonalAircraft();
  toast(`已归还 ${aircraft.name}`);
  renderAll();
}

function aircraftResaleRate(aircraft) {
  const condition = aircraftCondition(aircraft);
  // A new aircraft returns 42% of list price. Wear lowers the return value to
  // 15% at zero condition, making maintenance meaningful before resale.
  return +(0.15 + condition / 100 * 0.27).toFixed(3);
}

function aircraftResaleValue(aircraft) {
  return Math.max(0, Math.round(Number(aircraft?.price || 0) * aircraftResaleRate(aircraft)));
}

async function sellAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  if (!aircraft || !aircraft.owned || (!isCompanyAircraft(aircraft) && isStarterAircraft(aircraft.id))) return;
  if (isCompanyAircraft(aircraft) && !companyHangarIsActive()) return;
  if (aircraftHasActiveMission(aircraft)) {
    toast("执行任务期间不能出售飞机");
    return;
  }
  const condition = aircraftCondition(aircraft);
  const resale = aircraftResaleValue(aircraft);
  const rate = Math.round(aircraftResaleRate(aircraft) * 100);
  const accountLabel = isCompanyAircraft(aircraft) ? "公司账户" : "个人账户";
  if (!await showConfirmDialog(`确定出售 ${aircraft.name}（机队编号 ${aircraftFleetNumber(aircraft)}）吗？当前机况 ${condition.toFixed(1)}%，预计回收 ${formatMoney(resale)}（新机价 ${formatMoney(aircraft.price)} 的 ${rate}%），款项将计入${accountLabel}。出售后无法撤销。`)) return;
  if (companyHangarIsActive()) {
    companyTransaction({ amount: resale, type: "aircraft-sale", title: "出售公司飞机", detail: aircraft.name, referenceId: aircraft.id });
  } else {
    recordFundTransaction({ amount: resale, type: "aircraft-sale", title: "出售飞机", detail: aircraft.name, referenceId: aircraft.id });
  }
  if (isCompanyAircraft(aircraft)) {
    state.company.aircraftIds = (state.company.aircraftIds || []).filter((aircraftId) => aircraftId !== id);
  }
  state.fleet = state.fleet.filter((item) => item.id !== id);
  ensureSelectedPersonalAircraft();
  toast(`已出售 ${aircraft.name}（${aircraftFleetNumber(aircraft)}），回收 ${formatMoney(resale)}`);
  renderAll();
}

function selectAircraft(id) {
  if (isCompanyAircraft(state.fleet.find((aircraft) => aircraft.id === id))) return;
  state.fleet.forEach((aircraft) => {
    aircraft.selected = !isCompanyAircraft(aircraft) && aircraft.id === id;
  });
}

function ensureSelectedPersonalAircraft() {
  const managedFleet = state.fleet.filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented));
  if (!managedFleet.length || managedFleet.some((aircraft) => aircraft.selected)) return;
  selectAircraft(managedFleet[0].id);
}

async function refuelAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  const liveAircraft = lastTelemetryConnected ? telemetryFleetAircraft(lastTelemetry) : null;
  if (!aircraft || liveAircraft?.id !== id) {
    toast("请先在 MSFS 切换到这架飞机");
    return;
  }
  if (!telemetryBoolean(lastTelemetry?.onGround)) {
    toast("飞机必须停在地面才能加注燃油");
    return;
  }
  if (telemetryBoolean(lastTelemetry?.engineRunning)) {
    toast("请先关闭发动机再加注燃油");
    return;
  }
  const capacityKg = telemetryFuelCapacityKg(lastTelemetry) || aircraft.fuelCapacityKg;
  const currentFuelKg = telemetryFuelKg(lastTelemetry);
  if (!(Number(capacityKg) > 0) || currentFuelKg === null) {
    toast("尚未读取到 MSFS 油箱容量");
    return;
  }
  const currentPercent = currentFuelKg / Number(capacityKg) * 100;
  const targetPercent = Math.max(0, Math.min(100, Number(fuelTargetPercents.get(id)) || 0));
  if (targetPercent <= currentPercent + 0.1) {
    toast("请将滑块调到高于当前油量");
    return;
  }
  refuelPendingIds.add(id);
  renderAircraftManagement();
  wireIcons();
  try {
    const response = await fetch("/api/simulator/fuel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aircraftId: id, targetPercent })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "MSFS 拒绝加注燃油");
    if (result.state === "applied") {
      aircraft.lastFuelKg = +(Number(capacityKg) * targetPercent / 100).toFixed(2);
      aircraft.lastFuelAt = Date.now();
    }
    fuelTargetPercents.delete(id);
    fuelTargetBaselines.delete(id);
    toast(result.message || `已发送加注至 ${targetPercent.toFixed(0)}% 的命令`);
  } catch (error) {
    toast(error?.message || "加注燃油失败");
  } finally {
    refuelPendingIds.delete(id);
    saveState();
    renderAircraftManagement();
    wireIcons();
  }
}

function repairAircraft(id) {
  const aircraft = state.fleet.find((item) => item.id === id);
  if (!aircraft || (!aircraft.owned && !aircraft.rented)) return;
  if (aircraftHasActiveMission(aircraft)) {
    toast("执行任务期间不能维修飞机");
    return;
  }
  const cost = aircraftMaintenanceCost(aircraft);
  if (cost <= 0) {
    toast("飞机状态良好，无需维修");
    return;
  }
  const useCompanyFunds = companyHangarIsActive();
  const availableFunds = useCompanyFunds ? state.company.funds : state.cash;
  if (availableFunds < cost) {
    toast("余额不足，无法完成维修");
    return;
  }
  if (useCompanyFunds) {
    companyTransaction({ amount: -cost, type: "maintenance-expense", title: "公司飞机维修", detail: aircraft.name, referenceId: aircraft.id });
  } else {
    recordFundTransaction({ amount: -cost, type: "maintenance-expense", title: "飞机维修", detail: aircraft.name, referenceId: aircraft.id });
  }
  aircraft.conditionPercent = 100;
  aircraft.lastMaintenanceAt = Date.now();
  toast(`已完成 ${aircraft.name} 维修，支出 ${formatMoney(cost)}`);
  renderAll();
}

function createCompany() {
  if (state.company?.created) return;
  if (!canCreateCompany()) {
    toast(companyCreationRequirementText());
    return;
  }
  const airlineCode = normalizeAirlineCode(document.getElementById("companyNameInput")?.value || currentAirline().code);
  const airline = airlines.find((item) => item.code === airlineCode);
  if (!airline) {
    toast("请输入有效的三字航空公司代码");
    return;
  }
  const airlineId = airline.id;
  const name = airline.name;
  const base = normalizeAirportInputCode(document.getElementById("companyBaseInput")?.value || state.pilot.base);
  const funds = Math.round(Number(document.getElementById("companyFundsInput")?.value) || 0);
  const aircraftId = String(document.getElementById("companyAircraftSelect")?.value || "");
  const starterAircraft = aircraftCatalog.find((aircraft) => aircraft.id === aircraftId && aircraft.kind === "干线喷气");
  if (!/^[A-Z]{4}$/.test(base) || !companyAirportByIcao(base)) {
    toast("请输入有效的四位英文字母 ICAO 公司基地");
    return;
  }
  if (funds < COMPANY_STARTUP_FUNDS_MIN) {
    toast(`启动资金最低为 ${formatMoney(COMPANY_STARTUP_FUNDS_MIN)}`);
    return;
  }
  if (funds > COMPANY_STARTUP_FUNDS_MAX) {
    toast(`启动资金最多为 ${formatMoney(COMPANY_STARTUP_FUNDS_MAX)}`);
    return;
  }
  if (funds > Number(state.cash || 0)) {
    toast("个人账户资金不足以注资公司");
    return;
  }
  if (!starterAircraft) {
    toast("请选择公司初始飞机");
    return;
  }
  const companyAircraft = createCompanyAircraft(starterAircraft.id);
  state.company = {
    created: true,
    name,
    airlineId: airline.id,
    base,
    funds: 0,
    pilots: [createCompanyPilot({ name: state.pilot.name || "公司负责人", skillLevel: 3, skill: 72, aircraftKind: "训练机", salary: 0, experienceHours: state.stats.totalHours }, true)],
    applicants: companyApplicants(),
    taskOffers: [],
    tasks: [],
    flightLogs: [],
    aircraftIds: companyAircraft ? [companyAircraft.id] : [],
    starterAircraftGranted: Boolean(companyAircraft),
    transactions: [],
    activeSection: "management"
  };
  if (companyAircraft) state.fleet.push(companyAircraft);
  state.company.taskOffers = Array.from({ length: COMPANY_TASK_OFFER_COUNT }, () => companyMissionOffer());
  recordFundTransaction({ amount: -funds, type: "company-investment", title: "公司注资", detail: `${name} · ${base}`, referenceId: `company-${airline.id}` });
  companyTransaction({ amount: funds, type: "company-investment", title: "公司启动资金", detail: `个人账户注资 · ${base}`, referenceId: `company-${airline.id}` });
  companyManagedFleet();
  saveState();
  renderAll();
  toast(`已创建 ${name}`);
}

async function closeCompany() {
  if (!state.company?.created) return;
  const companyName = String(state.company.name || "当前公司");
  if (!await showConfirmDialog(`确定关闭“${companyName}”吗？公司资金、任务、飞行员、招聘名单、公司流水和公司机库关联都会被清除，个人飞机和个人飞行记录保留。`)) return;
  writeBackup(`关闭公司前：${companyName}`);
  state.fleet = state.fleet.filter((aircraft) => !isCompanyAircraft(aircraft));
  if (!state.fleet.some((aircraft) => aircraft.selected)) selectAircraft("c172");
  const personalAirlineId = airlines.some((airline) => airline.id === state.airlineId) ? state.airlineId : airlines[0].id;
  state.company = {
    created: false,
    name: "",
    airlineId: personalAirlineId,
    base: normalizeBaseCode(state.pilot.base || "ZBAA"),
    funds: 0,
    pilots: [],
    applicants: [],
    taskOffers: [],
    tasks: [],
    flightLogs: [],
    aircraftIds: [],
    starterAircraftGranted: false,
    transactions: [],
    activeSection: "management"
  };
  saveState();
  renderAll();
  toast(`已关闭 ${companyName}，公司数据已清除`);
}

function refreshCompanyApplicants() {
  if (!state.company?.created) return;
  state.company.applicants = companyApplicants();
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast("招聘名单已刷新");
}

function refreshCompanyTasks() {
  if (!state.company?.created) return;
  state.company.taskOffers = [];
  while (state.company.taskOffers.length < COMPANY_TASK_OFFER_COUNT) state.company.taskOffers.push(companyMissionOffer());
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast("公司任务池已刷新");
}

function hireCompanyPilot(id) {
  if (!state.company?.created) return;
  const applicantIndex = state.company.applicants.findIndex((item) => item.id === id);
  const applicant = state.company.applicants[applicantIndex];
  if (!applicant) return;
  if (state.company.funds < applicant.hirePrice) {
    toast("公司资金不足，无法雇佣");
    return;
  }
  const pilot = createCompanyPilot(applicant);
  companyTransaction({ amount: -applicant.hirePrice, type: "pilot-hiring", title: "雇佣飞行员", detail: `${pilot.name} · ${pilotAircraftKinds(pilot).join("、")}`, referenceId: pilot.id });
  state.company.pilots.push(pilot);
  state.company.applicants.splice(applicantIndex, 1);
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`已雇佣 ${pilot.name}`);
}

function upgradeCompanyPilot(id) {
  if (!state.company?.created) return;
  const pilot = state.company.pilots.find((item) => item.id === id && item.status !== "fired");
  if (!pilot || pilot.skillLevel >= 5) return;
  const cost = companyPilotUpgradeCost(pilot);
  if (state.company.funds < cost) {
    toast("公司资金不足，无法提升技术水平");
    return;
  }
  companyTransaction({ amount: -cost, type: "pilot-training", title: "飞行员技术培训", detail: `${pilot.name} · 等级 ${pilot.skillLevel} → ${pilot.skillLevel + 1}`, referenceId: pilot.id });
  pilot.skillLevel += 1;
  pilot.skill = Math.min(100, Number(pilot.skill || 0) + 8);
  pilot.salary = Number(pilot.salary || 0) + 120;
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`${pilot.name} 技术等级提升至 ${pilot.skillLevel}`);
}

function fireCompanyPilot(id) {
  if (!state.company?.created) return;
  const pilot = state.company.pilots.find((item) => item.id === id);
  if (!pilot || pilot.owner || pilot.assignedTaskId) return;
  pilot.status = "fired";
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`已解雇 ${pilot.name}`);
}

function createCompanyFlightLog(task, overrides = {}) {
  if (!state.company?.created || !task) return null;
  if (!Array.isArray(state.company.flightLogs)) state.company.flightLogs = [];
  const pilot = state.company.pilots.find((item) => item.id === task.pilotId);
  const aircraft = state.fleet.find((item) => item.id === task.aircraftId);
  const log = {
    id: cryptoId("company-flight"),
    taskId: task.id,
    title: String(task.title || "公司航班任务"),
    origin: normalizeBaseCode(task.origin),
    destination: normalizeBaseCode(task.destination) || String(task.destination || "任务现场"),
    pilotId: task.pilotId,
    pilotName: pilot?.name || "未分配飞行员",
    aircraftId: task.aircraftId,
    aircraftName: aircraft?.name || "未分配飞机",
    status: "assigned",
    airportCheck: "pending",
    assignedAt: task.assignedAt || Date.now(),
    createdAt: Date.now(),
    ...overrides
  };
  state.company.flightLogs.unshift(log);
  state.company.flightLogs = state.company.flightLogs.slice(0, 300);
  task.flightLogId = log.id;
  return log;
}

function updateCompanyFlightLog(task, changes = {}) {
  if (!task) return null;
  const log = state.company?.flightLogs?.find((item) => item.id === task.flightLogId || item.taskId === task.id);
  if (!log) return createCompanyFlightLog(task, changes);
  Object.assign(log, changes);
  return log;
}

function dispatchCompanyTask(missionId) {
  if (!state.company?.created) return;
  const mission = state.company.taskOffers.find((item) => item.id === missionId && item.status === "open");
  if (!mission) {
    toast("任务已不可派遣");
    return;
  }
  const pilotSelect = document.querySelector(`[data-company-pilot-for="${missionId}"]`);
  const aircraftSelect = document.querySelector(`[data-company-aircraft-for="${missionId}"]`);
  const pilot = state.company.pilots.find((item) => item.id === pilotSelect?.value && item.status === "active");
  const aircraft = companyManagedFleet().find((item) => item.id === aircraftSelect?.value);
  if (!pilot || !aircraft) {
    toast("请选择飞行员和飞机");
    return;
  }
  if (pilot.assignedTaskId) {
    toast("该飞行员已有派遣任务");
    return;
  }
  if (!pilotCanOperateAircraft(pilot, aircraft)) {
    toast(`${pilot.name} 不具备 ${aircraft.name} 的操作资格`);
    return;
  }
  const task = {
    id: cryptoId("company-task"),
    missionId: mission.id,
    title: mission.title,
    origin: aircraftOperationalBase(aircraft, mission.origin || state.company.base),
    destination: mission.destination || mission.site?.name || "任务现场",
    distance: mission.distance,
    pilotId: pilot.id,
    aircraftId: aircraft.id,
    payout: mission.payout,
    status: "assigned",
    assignedAt: Date.now()
  };
  state.company.tasks.unshift(task);
  createCompanyFlightLog(task);
  mission.status = "assigned";
  pilot.assignedTaskId = task.id;
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`已将任务派遣给 ${pilot.name}`);
}

function refreshCompanyMissionFromAircraft(aircraft) {
  if (!state.company?.created || !aircraft || !isCompanyAircraft(aircraft)) return null;
  if (!Array.isArray(state.company.taskOffers)) state.company.taskOffers = [];
  const origin = aircraftOperationalBase(aircraft, state.company.base);
  const existing = state.company.taskOffers.find((offer) => offer.status === "open"
    && normalizeBaseCode(offer.origin) === normalizeBaseCode(origin)
    && (!offer.aircraftId || offer.aircraftId === aircraft.id));
  if (existing) return existing;
  const offer = companyMissionOffer(aircraft);
  state.company.taskOffers.unshift(offer);
  const openOffers = state.company.taskOffers.filter((item) => item.status === "open");
  if (openOffers.length > COMPANY_TASK_OFFER_COUNT) {
    const excess = openOffers
      .slice(COMPANY_TASK_OFFER_COUNT)
      .map((item) => item.id);
    state.company.taskOffers = state.company.taskOffers.filter((item) => !excess.includes(item.id));
  }
  return offer;
}

function completeCompanyTask(id) {
  if (!state.company?.created) return;
  const task = state.company.tasks.find((item) => item.id === id && item.status === "assigned");
  if (!task) return;
  task.status = "completed";
  task.completedAt = Date.now();
  const actualLog = [...state.logs].reverse().find((log) => log.source === "msfs" && log.aircraftId === task.aircraftId && Number(log.date || 0) >= Number(task.assignedAt || 0));
  const departureAirport = normalizeBaseCode(actualLog?.departureAirport || actualLog?.from || task.origin);
  const arrivalAirport = normalizeBaseCode(actualLog?.arrivalAirport || actualLog?.to || task.destination);
  const departureMatches = Boolean(departureAirport && normalizeBaseCode(task.origin) && departureAirport === normalizeBaseCode(task.origin));
  const arrivalMatches = Boolean(arrivalAirport && normalizeBaseCode(task.destination) && arrivalAirport === normalizeBaseCode(task.destination));
  const airportCheck = actualLog ? (departureMatches && arrivalMatches ? "passed" : "failed") : "pending";
  task.departureAirport = departureAirport;
  task.arrivalAirport = arrivalAirport;
  task.airportCheck = airportCheck;
  updateCompanyFlightLog(task, {
    status: airportCheck === "failed" ? "airport-mismatch" : "completed",
    completedAt: task.completedAt,
    departureAirport,
    arrivalAirport,
    airportCheck,
    landingRateFpm: actualLog?.landingRateFpm ?? null,
    landingPeakG: actualLog?.landingPeakG ?? null
  });
  const pilot = state.company.pilots.find((item) => item.id === task.pilotId);
  const companyAircraft = state.fleet.find((item) => item.id === task.aircraftId);
  if (companyAircraft && arrivalAirport) {
    companyAircraft.lastLandingAirport = arrivalAirport;
  }
  if (typeof refreshCompanyMissionFromAircraft === "function") refreshCompanyMissionFromAircraft(companyAircraft);
  if (pilot) {
    pilot.assignedTaskId = "";
    pilot.experienceHours = +(Number(pilot.experienceHours || 0) + Math.max(0.5, Number(task.distance || 0) / 160)).toFixed(1);
  }
  companyTransaction({ amount: task.payout, type: "company-mission-income", title: "公司任务收入", detail: task.title, referenceId: task.id });
  saveState();
  renderCompanyManagement();
  wireIcons();
  toast(`公司任务完成，收入 ${formatMoney(task.payout)}`);
}

