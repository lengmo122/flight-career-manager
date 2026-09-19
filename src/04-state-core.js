// 模飞生涯 渲染器源码 04-state-core.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function defaultState() {
  return {
    pilot: { name: "Alex Chen", base: "ZBAA", avatarDataUrl: "", avatarPreset: "preset-01", loggedIn: false, hasCompletedLogin: false },
    airlineId: airlines[0].id,
    cash: 25000,
    reputation: 12,
    stats: {
      totalHours: 0,
      totalMiles: 0,
      totalLandings: 0,
      completedMissions: 0,
      manualLogs: 0,
      totalFuelKg: 0,
      totalFuelCost: 0
    },
    missions: seedMissions(),
    schedules: [],
    backups: [],
    hangarFilter: "all",
    hangarSearch: "",
    aircraftManagementFilter: "all",
    aircraftManagementSearch: "",
    companyHangarFilter: "all",
    companyHangarSearch: "",
    missionFilters: { search: "", status: "all", category: "all", distanceSort: "near" },
    settings: {
      speechVolume: 1,
      mapAutoTrack: false,
      mapShowCompanyAircraft: true,
      mapLayer: "standard",
      darkMode: false,
      freeMode: false,
      freeModeCashSnapshot: null,
      sopMode: false
    },
    company: {
      created: false,
      airlineId: airlines[0].id,
      base: "ZBAA",
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
    },
    features: { sceneObjectsSeeded: false, starterHelicopterGranted: true, landingWearStartedAt: 0 },
    logs: [],
    taskEvents: [],
    fundTransactions: [openingFundTransaction(25000)],
    licenses: aircraftLicenseCatalog.map((license) => ({ id: license.id, purchased: false, purchasedAt: null, assessmentCompleted: false, assessmentCompletedAt: null })),
    simulatorFlight: emptySimulatorFlight(),
    fleet: aircraftCatalog.map((aircraft) => ({
      ...aircraft,
      catalogId: aircraft.id,
      owned: aircraft.id === "c172" || aircraft.id === STARTER_HELICOPTER_ID,
      rented: false,
      selected: aircraft.id === "c172",
      lastFuelKg: null,
      fuelCapacityKg: null,
      lastFuelAt: null,
      lastSeenTitle: "",
      conditionPercent: 100,
      lastMaintenanceAt: null,
      lastLandingReportAt: null,
      lastLandingRateFpm: null,
      lastLandingPeakG: null,
      lastLandingWearPercent: 0,
      lastLandingAirport: "",
      lastLandingRunway: ""
    })),
    achievements: achievementDefs.map((a) => ({ id: a.id, unlocked: false })),
    activeView: "dashboard"
  };
}

function loadState() {
  return defaultState();
}

async function hydrateStoredState() {
  const raw = await readStorageValue(STORAGE_KEY);
  if (!raw) {
    saveStorageHydrated = true;
    return;
  }
  try {
    const decoded = await decodeSavePayload(raw);
    state = mergeState(defaultState(), decoded.value);
    saveStorageHydrated = true;
    if (decoded.legacy) await saveState();
  } catch (error) {
    // Authentication failure means the stored data was edited or corrupted. Do not
    // overwrite it with a fresh default state; an explicit reset remains available.
    saveStorageError = error;
    saveStorageHydrated = true;
    state = defaultState();
  }
}

function normalizeFleetAircraft(template, found = {}) {
  return {
    ...template,
    ...found,
    catalogId: String(found.catalogId || template.catalogId || template.id || found.id || ""),
    lastFuelKg: found.lastFuelKg !== null && found.lastFuelKg !== undefined && Number.isFinite(Number(found.lastFuelKg))
      ? Math.max(0, Number(found.lastFuelKg))
      : null,
    fuelCapacityKg: found.fuelCapacityKg !== null && found.fuelCapacityKg !== undefined && Number.isFinite(Number(found.fuelCapacityKg))
      ? Math.max(0, Number(found.fuelCapacityKg))
      : null,
    lastFuelAt: Number.isFinite(Number(found.lastFuelAt)) ? Number(found.lastFuelAt) : null,
    lastSeenTitle: String(found.lastSeenTitle || ""),
    conditionPercent: Math.max(0, Math.min(100, Number(found.conditionPercent ?? 100) || 0)),
    lastMaintenanceAt: Number.isFinite(Number(found.lastMaintenanceAt)) ? Number(found.lastMaintenanceAt) : null,
    lastLandingReportAt: Number.isFinite(Number(found.lastLandingReportAt)) ? Number(found.lastLandingReportAt) : null,
    lastLandingRateFpm: Number.isFinite(Number(found.lastLandingRateFpm)) ? Math.abs(Math.round(Number(found.lastLandingRateFpm))) : null,
    lastLandingPeakG: Number.isFinite(Number(found.lastLandingPeakG)) ? Number(found.lastLandingPeakG) : null,
    lastLandingWearPercent: Math.max(0, Number(found.lastLandingWearPercent) || 0),
    lastLandingAirport: String(found.lastLandingAirport || ""),
    lastLandingRunway: String(found.lastLandingRunway || "")
  };
}

function mergeState(base, incoming) {
  const merged = structuredClone(base);
  if (!incoming || typeof incoming !== "object") return merged;
  merged.pilot = { ...merged.pilot, ...(incoming.pilot || {}) };
  merged.pilot.name = String(merged.pilot.name || base.pilot.name).trim() || base.pilot.name;
  merged.pilot.base = String(merged.pilot.base || base.pilot.base).trim().toUpperCase() || base.pilot.base;
  merged.pilot.avatarDataUrl = isAvatarDataUrl(merged.pilot.avatarDataUrl) ? merged.pilot.avatarDataUrl : "";
  merged.pilot.avatarPreset = AVATAR_PRESETS.some((avatar) => avatar.id === incoming.pilot?.avatarPreset)
    ? incoming.pilot.avatarPreset
    : merged.pilot.avatarDataUrl ? "" : base.pilot.avatarPreset;
  merged.pilot.loggedIn = incoming.pilot?.loggedIn === true;
  merged.pilot.hasCompletedLogin = incoming.pilot?.hasCompletedLogin === true;
  merged.airlineId = airlines.some((airline) => airline.id === incoming.airlineId) ? incoming.airlineId : merged.airlineId;
  merged.cash = Number.isFinite(incoming.cash) ? incoming.cash : merged.cash;
  merged.reputation = Number.isFinite(incoming.reputation) ? incoming.reputation : merged.reputation;
  merged.stats = { ...merged.stats, ...(incoming.stats || {}) };
  merged.stats.totalFuelKg = Math.max(0, Number(merged.stats.totalFuelKg) || 0);
  merged.stats.totalFuelCost = Math.max(0, Number(merged.stats.totalFuelCost) || 0);
  merged.missions = (Array.isArray(incoming.missions) ? incoming.missions : merged.missions)
    .filter((mission) => mission && typeof mission === "object")
    .map(normalizeMission);
  // Re-send an in-progress route after the route format changed from
  // base -> task -> base to the active first leg base -> task.
  merged.missions = merged.missions.map((mission) => {
    if (mission?.status !== "accepted" || !mission.verification) return mission;
    if (Number(mission.verification.flightPlanFormatVersion || 0) >= 2) return mission;
    return {
      ...mission,
      verification: {
        ...mission.verification,
        flightPlanFormatVersion: 2,
        flightPlanState: "waiting",
        flightPlanDetail: "航路格式已更新，等待 MSFS 连接后重新发送任务点"
      }
    };
  });
  merged.schedules = Array.isArray(incoming.schedules) ? incoming.schedules : merged.schedules;
  merged.backups = Array.isArray(incoming.backups) ? incoming.backups : merged.backups;
  merged.hangarFilter = typeof incoming.hangarFilter === "string" ? incoming.hangarFilter : merged.hangarFilter;
  merged.hangarSearch = typeof incoming.hangarSearch === "string" ? incoming.hangarSearch : merged.hangarSearch;
  merged.aircraftManagementFilter = typeof incoming.aircraftManagementFilter === "string" ? incoming.aircraftManagementFilter : merged.aircraftManagementFilter;
  merged.aircraftManagementSearch = typeof incoming.aircraftManagementSearch === "string" ? incoming.aircraftManagementSearch : merged.aircraftManagementSearch;
  merged.companyHangarFilter = typeof incoming.companyHangarFilter === "string" ? incoming.companyHangarFilter : merged.companyHangarFilter;
  merged.companyHangarSearch = typeof incoming.companyHangarSearch === "string" ? incoming.companyHangarSearch : merged.companyHangarSearch;
  merged.missionFilters = { ...merged.missionFilters, ...(incoming.missionFilters || {}) };
  const incomingSpeechVolume = Number(incoming.settings?.speechVolume);
  const incomingFreeModeCashSnapshot = incoming.settings?.freeModeCashSnapshot;
  const hasFreeModeCashSnapshot = incomingFreeModeCashSnapshot !== null
    && incomingFreeModeCashSnapshot !== undefined
    && Number.isFinite(Number(incomingFreeModeCashSnapshot));
  let migratedLegacyFreeModeCash = false;
  merged.settings = {
    ...merged.settings,
    speechVolume: Number.isFinite(incomingSpeechVolume)
      ? Math.max(0, Math.min(1, incomingSpeechVolume))
      : merged.settings.speechVolume,
    mapAutoTrack: incoming.settings?.mapAutoTrack === true,
    mapShowCompanyAircraft: incoming.settings?.mapShowCompanyAircraft !== false,
    mapLayer: normalizeMapLayer(incoming.settings?.mapLayer || merged.settings.mapLayer),
    darkMode: incoming.settings?.darkMode === true,
    freeMode: incoming.settings?.freeMode === true,
    freeModeCashSnapshot: hasFreeModeCashSnapshot
      ? Math.max(0, Number(incoming.settings.freeModeCashSnapshot))
      : null,
    sopMode: incoming.settings?.sopMode === true
  };
  if (merged.settings.freeMode) {
    if (merged.settings.freeModeCashSnapshot === null) {
      merged.settings.freeModeCashSnapshot = Math.max(0, Number(merged.cash) || 0);
      migratedLegacyFreeModeCash = merged.cash !== FREE_MODE_CASH;
      merged.cash = FREE_MODE_CASH;
    }
  } else {
    merged.settings.freeModeCashSnapshot = null;
  }
  const incomingCompany = incoming.company && typeof incoming.company === "object" ? incoming.company : {};
  merged.company = {
    ...merged.company,
    ...incomingCompany,
    created: incomingCompany.created === true,
    airlineId: airlines.some((airline) => airline.id === incomingCompany.airlineId) ? incomingCompany.airlineId : merged.company.airlineId,
    base: airportByIcao(incomingCompany.base) ? String(incomingCompany.base).toUpperCase() : merged.company.base,
    funds: Math.max(0, Number(incomingCompany.funds) || 0),
    pilots: Array.isArray(incomingCompany.pilots) ? incomingCompany.pilots.map(normalizeCompanyPilot) : [],
    applicants: Array.isArray(incomingCompany.applicants) ? normalizeCompanyApplicants(incomingCompany.applicants) : [],
    taskOffers: Array.isArray(incomingCompany.taskOffers) ? incomingCompany.taskOffers : [],
    tasks: Array.isArray(incomingCompany.tasks) ? incomingCompany.tasks : [],
    flightLogs: Array.isArray(incomingCompany.flightLogs) ? incomingCompany.flightLogs : [],
    aircraftIds: Array.isArray(incomingCompany.aircraftIds) ? incomingCompany.aircraftIds : [],
    starterAircraftGranted: incomingCompany.starterAircraftGranted === true,
    transactions: Array.isArray(incomingCompany.transactions) ? incomingCompany.transactions : [],
    activeSection: ["management", "tasks", "pilots", "recruitment", "hangar", "finance", "flight-log"].includes(incomingCompany.activeSection)
      ? incomingCompany.activeSection
      : "management"
  };
  merged.features = { ...merged.features, ...(incoming.features || {}) };
  if (!Object.prototype.hasOwnProperty.call(incoming.features || {}, "starterHelicopterGranted")) {
    merged.features.starterHelicopterGranted = false;
  }
  merged.logs = Array.isArray(incoming.logs) ? incoming.logs : merged.logs;
  merged.taskEvents = Array.isArray(incoming.taskEvents) ? incoming.taskEvents : merged.taskEvents;
  merged.fundTransactions = normalizeFundTransactions(incoming.fundTransactions, merged.cash);
  if (migratedLegacyFreeModeCash) {
    merged.fundTransactions.unshift({
      id: `fund-free-mode-migration-${Date.now()}`,
      date: Date.now(),
      type: "free-mode-adjustment",
      title: "自由模式临时资金",
      detail: "升级后自由模式个人余额临时调整为 100 万",
      amount: +(FREE_MODE_CASH - merged.settings.freeModeCashSnapshot).toFixed(2),
      balance: FREE_MODE_CASH,
      referenceId: ""
    });
    merged.fundTransactions = merged.fundTransactions.slice(0, 200);
  }
  merged.licenses = normalizeAircraftLicenses(incoming.licenses);
  merged.simulatorFlight = normalizeSimulatorFlight(incoming.simulatorFlight);
  if (Array.isArray(incoming.fleet)) {
    const catalogFleet = aircraftCatalog.map((aircraft) => {
      const found = incoming.fleet.find((item) => item.id === aircraft.id);
      return found
        ? normalizeFleetAircraft(aircraft, found)
        : normalizeFleetAircraft({ ...aircraft, owned: false, rented: false, selected: false });
    });
    const catalogIds = new Set(aircraftCatalog.map((aircraft) => aircraft.id));
    const customFleet = incoming.fleet
      .filter((item) => !catalogIds.has(item.id))
      .map((item) => {
        const template = aircraftCatalog.find((aircraft) => aircraft.id === item.catalogId) || {
          id: String(item.id),
          name: String(item.name || "公司飞机"),
          kind: String(item.kind || "干线喷气"),
          price: Number(item.price) || 0,
          rent: Number(item.rent) || 0,
          range: Number(item.range) || 0,
          pace: String(item.pace || "公司机队"),
          unlockHours: 0,
          note: String(item.note || "公司专属飞机")
        };
        return normalizeFleetAircraft(template, item);
      });
    merged.fleet = [...catalogFleet, ...customFleet];
  }
  if (Array.isArray(incoming.achievements)) {
    merged.achievements = achievementDefs.map((a) => {
      const found = incoming.achievements.find((item) => item.id === a.id);
      return found ? { id: a.id, unlocked: Boolean(found.unlocked) } : { id: a.id, unlocked: false };
    });
  }
  merged.activeView = ["dashboard", "missions", "map", "monitor", "schedules", "logs", "achievements", "profile", "hangar", "aircraft-management", "company"].includes(incoming.activeView) ? incoming.activeView : merged.activeView;
  return merged;
}

function normalizeBaseCode(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeAirportInputCode(value) {
  return String(value || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
}

function normalizeMission(mission, index = 0) {
  const category = String(mission?.category || "客运");
  const subtype = String(mission?.subtype || "常规航线");
  const origin = normalizeBaseCode(mission?.origin || "ZBAA");
  const destination = mission?.destination ? normalizeBaseCode(mission.destination) : "";
  const distance = Number(mission?.distance);
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 100;
  const duration = Number(mission?.duration);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Math.max(0.6, +(safeDistance / 220).toFixed(1));
  return {
    ...mission,
    id: String(mission?.id || `mission-${index}`),
    title: String(mission?.title || `${origin}${destination ? ` → ${destination}` : " · 任务"}`),
    category,
    subtype,
    origin,
    destination: destination || null,
    route: String(mission?.route || (destination ? `${origin} → ${destination}` : `${origin} 基地周边航段`)),
    distance: safeDistance,
    duration: safeDuration,
    payout: Number.isFinite(Number(mission?.payout)) ? Number(mission.payout) : Math.round(1200 + safeDistance * 20),
    repGain: Number.isFinite(Number(mission?.repGain)) ? Number(mission.repGain) : Math.max(2, Math.round(safeDuration * 2)),
    risk: String(mission?.risk || "中"),
    weather: String(mission?.weather || "晴朗"),
    dispatchPhase: String(mission?.dispatchPhase || "日间"),
    aircraftHint: String(mission?.aircraftHint || "待指定"),
    summary: String(mission?.summary || `${category}任务 · ${subtype}`),
    priority: String(mission?.priority || (emergencyMissionCategories.includes(category) ? "emergency" : "standard")),
    refreshable: mission?.refreshable !== false,
    createdAt: Number.isFinite(Number(mission?.createdAt)) ? Number(mission.createdAt) : Date.now(),
    scene: mission?.scene || buildMissionScene(category, subtype)
  };
}

function normalizeAirlineCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
}

function missionBelongsToBase(mission, base = state?.pilot?.base) {
  return normalizeBaseCode(mission?.origin) === normalizeBaseCode(base);
}

function missionBelongsToAircraftLocation(mission) {
  const permitted = Array.isArray(mission?.permittedAircraftIds) ? mission.permittedAircraftIds : [];
  return permitted.some((id) => {
    const aircraft = state?.fleet?.find((item) => item.id === id);
    return aircraft && normalizeBaseCode(mission.origin) === normalizeBaseCode(aircraftOperationalBase(aircraft));
  });
}

function missionAircraftLocationMatches(mission) {
  if (mission?.originMode === "pilot-base") return true;
  const permitted = Array.isArray(mission?.permittedAircraftIds) ? mission.permittedAircraftIds : [];
  if (!permitted.length) return true;
  return permitted.some((id) => {
    const aircraft = state?.fleet?.find((item) => item.id === id);
    return aircraft && normalizeBaseCode(mission.origin) === normalizeBaseCode(aircraftOperationalBase(aircraft));
  });
}

function missionVisibleForBase(mission, base = state?.pilot?.base) {
  // Do not discard an accepted/completed mission when the pilot changes base.
  // Assessment and schedule records are fixed records, not refreshable offers.
  return mission?.status !== "open"
    || mission?.kind === "license-assessment"
    || mission?.refreshable === false
    || (missionAircraftLocationMatches(mission) && missionBelongsToBase(mission, base))
    || missionBelongsToAircraftLocation(mission);
}

function removeOpenMissionsOutsideBase(base = state?.pilot?.base) {
  const before = state.missions.length;
  state.missions = state.missions.filter((mission) => missionVisibleForBase(mission, base));
  return before - state.missions.length;
}

function isEmergencyMission(mission) {
  return emergencyMissionCategories.includes(mission?.category);
}

function refreshableMissionOffers(missions = state.missions, base = state?.pilot?.base) {
  return missions.filter((mission) => mission?.status === "open"
    && mission.refreshable !== false
    && missionAircraftLocationMatches(mission)
    && (missionBelongsToBase(mission, base) || missionBelongsToAircraftLocation(mission)));
}

function oldestExpiredMission(offers, now = Date.now()) {
  return offers
    .filter((mission) => now - Number(mission.createdAt || 0) >= MISSION_OFFER_LIFETIME_MS)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0] || null;
}

function uniqueTaskEvents(events) {
  const seen = new Set();
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (!event || typeof event !== "object") return false;
    const eventKeyValue = String(event.key || "").trim();
    if (!taskLogEventKeys.has(eventKeyValue) && !eventKeyValue.startsWith("sop-")) return false;
    const missionKey = String(event.missionTitle || event.missionId || "unknown").trim();
    const rawKey = String(event.key || event.title || event.detail || "unknown").trim();
    const eventKey = rawKey.startsWith("sop-") ? `${rawKey}:${String(event.detail || "").trim()}` : rawKey;
    const signature = `${missionKey}:${eventKey}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

// Renders call saveState() on every state change, including the 2s simulator poll.
// Writes are debounced so repeated calls coalesce into one clone+encrypt+disk write;
// awaiting saveState() still resolves only after the coalesced write has completed.
const SAVE_STATE_DEBOUNCE_MS = 800;
let saveStateTimer = 0;
let saveStateWaiters = [];

function persistStateNow() {
  if (saveStateTimer) {
    window.clearTimeout(saveStateTimer);
    saveStateTimer = 0;
  }
  if (!(saveStorageError && saveStorageHydrated)) {
    const snapshot = structuredClone(state);
    saveWriteChain = saveWriteChain
      .catch(() => {})
      .then(async () => {
        await writeStorageValue(STORAGE_KEY, await encryptSaveText(JSON.stringify(snapshot)));
      })
      .catch((error) => {
        saveStorageError = error;
      });
  }
  const waiters = saveStateWaiters;
  saveStateWaiters = [];
  for (const resolve of waiters) resolve(saveWriteChain);
  return saveWriteChain;
}

function saveState() {
  if (saveStorageError && saveStorageHydrated) return saveWriteChain;
  if (!saveStateTimer) saveStateTimer = window.setTimeout(persistStateNow, SAVE_STATE_DEBOUNCE_MS);
  return new Promise((resolve) => saveStateWaiters.push(resolve));
}

window.addEventListener("beforeunload", () => {
  if (saveStateTimer) persistStateNow();
});

function openingFundTransaction(balance, date = Date.now()) {
  const amount = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  return {
    id: "fund-opening",
    date,
    type: "opening",
    title: "初始资金",
    detail: "职业生涯初始可用资金",
    amount,
    balance: amount,
    referenceId: ""
  };
}

function normalizeFundTransactions(transactions, currentBalance) {
  if (!Array.isArray(transactions) || !transactions.length) {
    return [{
      ...openingFundTransaction(currentBalance),
      title: "历史余额",
      detail: "升级前累计资金"
    }];
  }
  return transactions.slice(0, 200).map((transaction, index) => ({
    id: String(transaction?.id || `fund-history-${index}`),
    date: Number.isFinite(Number(transaction?.date)) ? Number(transaction.date) : Date.now(),
    type: String(transaction?.type || (Number(transaction?.amount) >= 0 ? "income" : "expense")),
    title: String(transaction?.title || "资金变动"),
    detail: String(transaction?.detail || ""),
    amount: Number.isFinite(Number(transaction?.amount)) ? Number(transaction.amount) : 0,
    balance: Number.isFinite(Number(transaction?.balance)) ? Number(transaction.balance) : Number(currentBalance) || 0,
    referenceId: String(transaction?.referenceId || "")
  }));
}

function normalizeAircraftLicenses(licenses) {
  const incoming = new Map((Array.isArray(licenses) ? licenses : []).map((license) => [String(license?.id || ""), license]));
  return aircraftLicenseCatalog.map((license) => {
    const found = incoming.get(license.id);
    // Saves from 1.0.95 treated payment as a completed rating. Preserve those
    // historical ratings while requiring the new assessment for fresh purchases.
    const legacyLicensed = found?.purchased === true
      && !Object.prototype.hasOwnProperty.call(found || {}, "assessmentCompleted");
    return {
      id: license.id,
      purchased: found?.purchased === true,
      purchasedAt: Number.isFinite(Number(found?.purchasedAt)) ? Number(found.purchasedAt) : null,
      assessmentCompleted: found?.assessmentCompleted === true || legacyLicensed,
      assessmentCompletedAt: Number.isFinite(Number(found?.assessmentCompletedAt))
        ? Number(found.assessmentCompletedAt)
        : legacyLicensed ? (Number.isFinite(Number(found?.purchasedAt)) ? Number(found.purchasedAt) : null) : null,
      assessmentMissionId: String(found?.assessmentMissionId || "")
    };
  });
}

function aircraftLicense(id) {
  return aircraftLicenseCatalog.find((license) => license.id === id) || null;
}

function hasAircraftLicense(id) {
  return state.licenses?.some((license) => license.id === id && license.purchased && license.assessmentCompleted) === true;
}

function isFreeMode() {
  return state.settings?.freeMode === true;
}

function applyFreeModeFinancialState(enabled) {
  const nextEnabled = enabled === true;
  if (nextEnabled === isFreeMode()) return false;
  if (nextEnabled) {
    state.settings.freeModeCashSnapshot = Math.max(0, Number(state.cash) || 0);
    state.settings.freeMode = true;
    const adjustment = +(FREE_MODE_CASH - Number(state.cash || 0)).toFixed(2);
    if (adjustment !== 0) {
      recordFundTransaction({
        amount: adjustment,
        type: "free-mode-adjustment",
        title: "自由模式临时资金",
        detail: "自由模式开启，个人余额临时调整为 100 万"
      });
    }
    return true;
  }
  const restoredCash = state.settings.freeModeCashSnapshot !== null
    && state.settings.freeModeCashSnapshot !== undefined
    && Number.isFinite(Number(state.settings.freeModeCashSnapshot))
    ? Math.max(0, Number(state.settings.freeModeCashSnapshot))
    : 25_000;
  state.settings.freeMode = false;
  state.settings.freeModeCashSnapshot = null;
  const adjustment = +(restoredCash - Number(state.cash || 0)).toFixed(2);
  if (adjustment !== 0) {
    recordFundTransaction({
      amount: adjustment,
      type: "free-mode-adjustment",
      title: "恢复职业模式资金",
      detail: "自由模式关闭，恢复开启前的个人余额"
    });
  }
  return true;
}

function isSopMode() {
  return state.settings?.sopMode === true && !isFreeMode();
}

function missionEligibleAircraft() {
  if (isFreeMode()) {
    return aircraftCatalog;
  }
  return (Array.isArray(state.fleet) ? state.fleet : [])
    .filter((aircraft) => !isCompanyAircraft(aircraft)
      && (aircraft.owned || aircraft.rented)
      && (hasAircraftLicense(aircraft.catalogId || aircraft.id)
        || (aircraft.catalogId || aircraft.id) === "c172"
        || (aircraft.catalogId || aircraft.id) === STARTER_HELICOPTER_ID));
}

function activeLicenseAssessment(id) {
  const record = state.licenses.find((license) => license.id === id);
  return state.missions.find((mission) => mission?.kind === "license-assessment"
    && (mission.licenseAssessmentId === id || (record?.assessmentMissionId && mission.id === record.assessmentMissionId))
    && mission.status !== "completed") || null;
}

function createLicenseAssessmentMission(license) {
  const aircraft = state.fleet.find((item) => !isCompanyAircraft(item)
    && (item.owned || item.rented)
    && (item.catalogId || item.id) === license.id)
    || state.fleet.find((item) => item.id === license.id);
  if (!aircraft) return null;
  const mission = makeMission("包机", `${license.name} 型别考核`, 0, aircraft);
  if (!mission) return null;
  mission.kind = "license-assessment";
  mission.licenseAssessmentId = license.id;
  mission.assessmentAircraftId = license.id;
  mission.title = `${license.name} 型别考核`;
  mission.summary = `机型执照考核 · 使用 ${license.name} 完成指定机场航段`;
  mission.aircraftHint = license.name;
  mission.permittedAircraftIds = [aircraft.id];
  mission.payout = 0;
  mission.repGain = 0;
  mission.priority = "assessment";
  mission.refreshable = false;
  mission.assessmentBrief = `使用 ${license.name} 从 ${mission.origin} 起飞，在 ${mission.destination} 落地并关车。`;
  return mission;
}

function ensureLicenseAssessmentMissions() {
  let added = 0;
  state.licenses.forEach((record) => {
    if (!record?.purchased || record.assessmentCompleted || activeLicenseAssessment(record.id)) return;
    const license = aircraftLicense(record.id);
    const assessment = license && createLicenseAssessmentMission(license);
    if (!assessment) return;
    state.missions.unshift(assessment);
    record.assessmentMissionId = assessment.id;
    added += 1;
  });
  return added;
}

function refreshLicenseAssessmentMissions() {
  const pending = state.licenses.filter((record) => record?.purchased && !record.assessmentCompleted);
  if (!pending.length) {
    toast("当前没有待完成的机型考核");
    return;
  }

  const added = ensureLicenseAssessmentMissions();
  const available = pending.map((record) => {
    const mission = activeLicenseAssessment(record.id);
    if (mission) {
      record.assessmentMissionId = mission.id;
      mission.licenseAssessmentId = record.id;
      mission.assessmentAircraftId ||= record.id;
    }
    return mission;
  }).filter(Boolean);

  saveState();
  if (!available.length) {
    renderAircraftLicenses();
    wireIcons();
    toast("未能生成考核任务，请先确认已拥有或租用对应机型");
    return;
  }

  state.missionFilters = { ...state.missionFilters, search: "", status: "all", category: "all" };
  state.activeView = "missions";
  renderAll();
  toast(added > 0
    ? `已恢复 ${added} 个考核任务，已打开任务列表`
    : `考核任务已刷新，共 ${available.length} 个，已打开任务列表`);
}

function purchaseAircraftLicense(id) {
  const license = aircraftLicense(id);
  const record = state.licenses.find((item) => item.id === id);
  if (!license || !record) return;
  if (hasAircraftLicense(id)) {
    toast(`${license.name} 已取得正式执照`);
    return;
  }
  if (record.purchased) {
    if (!activeLicenseAssessment(id)) {
      const assessment = createLicenseAssessmentMission(license);
      if (assessment) {
        state.missions.unshift(assessment);
        record.assessmentMissionId = assessment.id;
        renderAll();
      }
    }
    toast(`${license.name} 考核任务尚未完成`);
    return;
  }
  if (state.cash < license.cost) {
    toast("资金不足，无法购买执照");
    return;
  }
  recordFundTransaction({
    amount: -license.cost,
    type: "license-expense",
    title: "购买机型执照",
    detail: `${license.name} · ${license.kind}`,
    referenceId: license.id
  });
  record.purchased = true;
  record.purchasedAt = Date.now();
  record.assessmentCompleted = false;
  record.assessmentCompletedAt = null;
  const assessment = createLicenseAssessmentMission(license);
  if (assessment) {
    state.missions.unshift(assessment);
    record.assessmentMissionId = assessment.id;
    toast(`已购买 ${license.name} 考核资格，请完成机型考核任务`);
  } else {
    toast(`已购买 ${license.name} 考核资格，但暂时无法生成任务，请稍后重试`);
  }
  renderAll();
}

function recordFundTransaction({ amount, type, title, detail = "", referenceId = "", date = Date.now() }) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return null;
  state.cash = +(Number(state.cash || 0) + value).toFixed(2);
  const transaction = {
    id: cryptoId("fund"),
    date,
    type: type || (value > 0 ? "income" : "expense"),
    title: String(title || "资金变动"),
    detail: String(detail || ""),
    amount: +value.toFixed(2),
    balance: state.cash,
    referenceId: String(referenceId || "")
  };
  if (!Array.isArray(state.fundTransactions)) state.fundTransactions = [];
  state.fundTransactions.unshift(transaction);
  state.fundTransactions = state.fundTransactions.slice(0, 200);
  return transaction;
}

function emptySimulatorFlight(lastGroundAirport = "", lastGroundFuelKg = null) {
  return {
    active: false,
    aircraftId: "",
    aircraftName: "",
    missionId: "",
    departedAt: null,
    origin: "",
    lastGroundAirport: String(lastGroundAirport || ""),
    lastGroundFuelKg: Number.isFinite(Number(lastGroundFuelKg)) ? Math.max(0, Number(lastGroundFuelKg)) : null,
    fuelStartKg: null,
    lastFuelKg: null,
    fuelUsedKg: 0,
    fuelAddedKg: 0,
    lastPoint: null,
    distanceNm: 0,
    lastSampleAt: null
  };
}

function normalizeSimulatorFlight(value) {
  const base = emptySimulatorFlight(value?.lastGroundAirport, value?.lastGroundFuelKg);
  if (!value || typeof value !== "object") return base;
  const point = value.lastPoint;
  return {
    ...base,
    active: value.active === true,
    aircraftId: String(value.aircraftId || ""),
    aircraftName: String(value.aircraftName || ""),
    missionId: String(value.missionId || ""),
    departedAt: Number.isFinite(Number(value.departedAt)) ? Number(value.departedAt) : null,
    origin: String(value.origin || ""),
    fuelStartKg: Number.isFinite(Number(value.fuelStartKg)) ? Math.max(0, Number(value.fuelStartKg)) : null,
    lastFuelKg: Number.isFinite(Number(value.lastFuelKg)) ? Math.max(0, Number(value.lastFuelKg)) : null,
    fuelUsedKg: Math.max(0, Number(value.fuelUsedKg) || 0),
    fuelAddedKg: Math.max(0, Number(value.fuelAddedKg) || 0),
    lastPoint: Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lon))
      ? { lat: Number(point.lat), lon: Number(point.lon) }
      : null,
    distanceNm: Math.max(0, Number(value.distanceNm) || 0),
    lastSampleAt: Number.isFinite(Number(value.lastSampleAt)) ? Number(value.lastSampleAt) : null
  };
}

function isStarterAircraft(aircraftId) {
  return aircraftId === "c172" || aircraftId === STARTER_HELICOPTER_ID;
}

function grantStarterHelicopter(targetState) {
  const helicopter = targetState.fleet.find((aircraft) => aircraft.id === STARTER_HELICOPTER_ID);
  let changed = false;
  if (helicopter) {
    if (helicopter.price !== 0 || helicopter.rent !== 0 || helicopter.unlockHours !== 0) {
      helicopter.price = 0;
      helicopter.rent = 0;
      helicopter.unlockHours = 0;
      changed = true;
    }
  }
  if (targetState.features?.starterHelicopterGranted) return changed;
  if (helicopter) {
    if (!helicopter.owned || helicopter.rented) changed = true;
    helicopter.owned = true;
    helicopter.rented = false;
  }
  targetState.features = { ...(targetState.features || {}), starterHelicopterGranted: true };
  return true;
}

function seedMissions() {
  return [
    makeMission("客运", "区域通勤", 0),
    makeMission("货运", "轻货转运", 0),
    makeMission("包机", "商务包机", 8)
  ].map((mission, index) => ({
    ...mission,
    id: cryptoId(`seed-${index}`),
    status: index === 0 ? "open" : "open",
    acceptedAt: null,
    completedAt: null
  }));
}

function cryptoId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function aircraftCatalogId(aircraft) {
  return String(aircraft?.catalogId || aircraft?.id || "");
}

function createPersonalAircraft(catalogId, ownership = "owned") {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === catalogId);
  if (!template) return null;
  return normalizeFleetAircraft(template, {
    id: cryptoId(`personal-${template.id}`),
    catalogId: template.id,
    companyOwned: false,
    owned: ownership === "owned",
    rented: ownership === "rented",
    selected: false,
    conditionPercent: 100
  });
}

function aircraftFleetNumber(aircraft) {
  const suffix = String(aircraft?.id || "").split("-").at(-1).slice(-6).toUpperCase();
  return suffix || aircraftCatalogId(aircraft).toUpperCase() || "未编号";
}

function getRankInfo(hours) {
  for (let i = rankRules.length - 1; i >= 0; i--) {
    if (hours >= rankRules[i].minHours) return rankRules[i];
  }
  return rankRules[0];
}

function currentAirline() {
  const airlineId = state?.airlineId || airlines[0].id;
  return airlines.find((item) => item.id === airlineId) || airlines[0];
}

function companyAirline() {
  const airlineId = state?.company?.airlineId || state?.airlineId || airlines[0].id;
  return airlines.find((item) => item.id === airlineId) || airlines[0];
}

function companyBase() {
  return companyAirportByIcao(state?.company?.base || state?.pilot?.base || "ZBAA");
}

function companyAirportByIcao(icao) {
  return globalAirportIndex.get(String(icao || "").trim().toUpperCase()) || null;
}

function aircraftOperationalBase(aircraft, fallback = state?.pilot?.base || "ZBAA") {
  const lastAirport = normalizeBaseCode(aircraft?.lastLandingAirport);
  if (lastAirport && airportByIcao(lastAirport)) return lastAirport;
  const fallbackCode = normalizeBaseCode(fallback);
  return airportByIcao(fallbackCode) ? fallbackCode : "ZBAA";
}

function companyAirportLabel(airport) {
  return airport ? `${airport.icao} · ${airport.name}` : "请输入有效的四字 ICAO 机场代码";
}

function companyMissionDestinations(base) {
  const operationalTypes = new Set(["large_airport", "medium_airport", "small_airport", "seaplane_base"]);
  const nearby = globalAirportDatabase
    .filter((airport) => airport.icao !== base.icao && operationalTypes.has(airport.type))
    .map((airport) => ({ ...airport, distance: distanceNm(base, airport) }))
    .filter((airport) => airport.distance >= 20 && airport.distance <= 1200);
  const scheduled = nearby.filter((airport) => airport.scheduled);
  return scheduled.length >= 20 ? scheduled : nearby.length ? nearby : airportDatabase.filter((airport) => airport.icao !== base.icao);
}

function companyManagedFleet() {
  if (!state?.company?.created) return [];
  const available = state.fleet.filter((aircraft) => aircraft.companyOwned || aircraft.owned || aircraft.rented);
  const availableIds = new Set(available.map((aircraft) => aircraft.id));
  state.company.aircraftIds = [...new Set([
    ...(Array.isArray(state.company.aircraftIds) ? state.company.aircraftIds : []),
    ...available.map((aircraft) => aircraft.id)
  ])].filter((id) => availableIds.has(id));
  return state.company.aircraftIds.map((id) => state.fleet.find((aircraft) => aircraft.id === id)).filter(Boolean);
}

function isCompanyAircraft(aircraft) {
  return aircraft?.companyOwned === true;
}

function createCompanyAircraft(selectedId = "") {
  const candidates = aircraftCatalog.filter((aircraft) => aircraft.kind === "干线喷气");
  const template = candidates.find((aircraft) => aircraft.id === selectedId) || pick(candidates);
  if (!template) return null;
  return normalizeFleetAircraft(template, {
    id: `company-aircraft-${template.id}-${cryptoId("fleet")}`,
    catalogId: template.id,
    companyOwned: true,
    owned: true,
    rented: false,
    selected: false,
    price: template.price,
    conditionPercent: 100
  });
}

function companyHangarIsActive() {
  return state.activeView === "company" && state.company?.created === true && state.company?.activeSection === "hangar";
}

function companyTransaction({ amount, type, title, detail = "", referenceId = "", date = Date.now() }) {
  if (!state.company?.created) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return null;
  state.company.funds = +(Math.max(0, Number(state.company.funds || 0) + value)).toFixed(2);
  const transaction = {
    id: cryptoId("company-fund"),
    date,
    type: type || (value > 0 ? "income" : "expense"),
    title: String(title || "公司资金变动"),
    detail: String(detail || ""),
    amount: +value.toFixed(2),
    balance: state.company.funds,
    referenceId: String(referenceId || "")
  };
  state.company.transactions.unshift(transaction);
  state.company.transactions = state.company.transactions.slice(0, 200);
  return transaction;
}

function companyApplicantName(usedNames = new Set()) {
  const available = companyPilotNames.filter((name) => !usedNames.has(name));
  const name = pick(available.length ? available : companyPilotNames);
  usedNames.add(name);
  return name;
}

function normalizeAircraftKinds(value, fallback = "训练机") {
  const rawValues = Array.isArray(value) ? value : String(value || "").split(/[、,，/|]+/);
  const values = [...new Set(rawValues.map((item) => String(item || "").trim()).filter(Boolean))];
  return values.length ? values : [fallback];
}

function pilotAircraftKinds(pilot) {
  return normalizeAircraftKinds(pilot?.aircraftKinds || pilot?.aircraftKind);
}

function pilotCanOperateAircraft(pilot, aircraft) {
  const kind = String(aircraft?.kind || "").trim();
  return Boolean(kind) && pilotAircraftKinds(pilot).includes(kind);
}

function selectApplicantAircraftKinds(skillLevel) {
  const level = Math.max(1, Math.min(5, Number(skillLevel) || 1));
  const maxKinds = Math.min(companyPilotKinds.length, level >= 4 ? 3 : 2);
  const count = rand(2, maxKinds);
  const kinds = [];
  while (kinds.length < count) {
    const kind = pick(companyPilotKinds);
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

function companyApplicant(usedNames = new Set()) {
  const skillLevel = rand(1, 5);
  const aircraftKinds = selectApplicantAircraftKinds(skillLevel);
  const name = companyApplicantName(usedNames);
  return {
    id: cryptoId("applicant"),
    name: `${name}${rand(1, 9)}`,
    skillLevel,
    skill: 45 + skillLevel * 10 + rand(0, 9),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    hirePrice: 4000 + skillLevel * 3500,
    salary: 500 + skillLevel * 180,
    experienceHours: skillLevel * 18 + rand(0, 20),
    generatedAt: Date.now()
  };
}

function companyApplicants(count = 6) {
  const usedNames = new Set();
  return Array.from({ length: count }, () => companyApplicant(usedNames));
}

function companyMissionOffer(aircraft = null) {
  const fleet = state?.company?.created
    ? state.fleet.filter((item) => isCompanyAircraft(item) && (item.owned || item.rented))
    : [];
  const selectedAircraft = aircraft || pick(fleet) || null;
  const baseCode = aircraftOperationalBase(selectedAircraft, state.company?.base || state.pilot?.base || "ZBAA");
  const base = companyAirportByIcao(baseCode) || companyBase() || airportDatabase[0];
  const destinations = companyMissionDestinations(base);
  const destination = pick(destinations);
  const category = pick(companyTaskCategories);
  const miles = Math.max(20, Math.round(distanceNm(base, destination)));
  const multiplier = { 货运: 18, 医疗: 20, 搜救: 22, 观光: 12, 包机: 16, 客运: 14 }[category] || 14;
  return {
    id: cryptoId("company-offer"),
    title: `${category} · ${base.icao} → ${destination.icao}`,
    origin: base.icao,
    destination: destination.icao,
    aircraftId: selectedAircraft?.id || "",
    aircraftHint: selectedAircraft?.name || "公司机队可用机型",
    category,
    distance: miles,
    payout: Math.round(1200 + miles * multiplier),
    status: "open",
    createdAt: Date.now()
  };
}

function createCompanyPilot(applicant, owner = false) {
  const aircraftKinds = normalizeAircraftKinds(applicant.aircraftKinds || applicant.aircraftKind);
  return {
    id: cryptoId("pilot"),
    name: String(applicant.name || "公司飞行员"),
    skillLevel: Math.max(1, Number(applicant.skillLevel) || 1),
    skill: Math.max(1, Number(applicant.skill) || 50),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    salary: Math.max(0, Number(applicant.salary) || 500),
    experienceHours: Math.max(0, Number(applicant.experienceHours) || 0),
    status: "active",
    owner,
    assignedTaskId: "",
    hiredAt: Date.now()
  };
}

function normalizeCompanyPilot(pilot, index = 0) {
  const aircraftKinds = normalizeAircraftKinds(pilot?.aircraftKinds || pilot?.aircraftKind);
  return {
    id: String(pilot?.id || `pilot-${index}`),
    name: String(pilot?.name || "公司飞行员"),
    skillLevel: Math.max(1, Math.min(5, Number(pilot?.skillLevel) || 1)),
    skill: Math.max(1, Math.min(100, Number(pilot?.skill) || 50)),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    salary: Math.max(0, Number(pilot?.salary) || 500),
    experienceHours: Math.max(0, Number(pilot?.experienceHours) || 0),
    status: pilot?.status === "fired" ? "fired" : "active",
    owner: pilot?.owner === true,
    assignedTaskId: String(pilot?.assignedTaskId || ""),
    hiredAt: Number.isFinite(Number(pilot?.hiredAt)) ? Number(pilot.hiredAt) : Date.now()
  };
}

function normalizeCompanyApplicant(applicant, index = 0, usedNames = new Set()) {
  const rawName = String(applicant?.name || "候选飞行员").trim().replace(/\d+$/, "").trim() || "候选飞行员";
  const alternatives = [...companyPilotNames, ...companyPilotFallbackNames].filter((name) => !usedNames.has(name));
  const name = usedNames.has(rawName) ? pick(alternatives) || rawName : rawName;
  usedNames.add(name);
  const aircraftKinds = normalizeAircraftKinds(applicant?.aircraftKinds || applicant?.aircraftKind);
  return {
    id: String(applicant?.id || `applicant-${index}`),
    name,
    skillLevel: Math.max(1, Math.min(5, Number(applicant?.skillLevel) || 1)),
    skill: Math.max(1, Math.min(100, Number(applicant?.skill) || 50)),
    aircraftKinds,
    aircraftKind: aircraftKinds[0],
    hirePrice: Math.max(0, Number(applicant?.hirePrice) || 4000),
    salary: Math.max(0, Number(applicant?.salary) || 500),
    experienceHours: Math.max(0, Number(applicant?.experienceHours) || 0),
    generatedAt: Number.isFinite(Number(applicant?.generatedAt)) ? Number(applicant.generatedAt) : Date.now()
  };
}

function normalizeCompanyApplicants(applicants) {
  const usedNames = new Set();
  return (Array.isArray(applicants) ? applicants : []).map((applicant, index) => normalizeCompanyApplicant(applicant, index, usedNames));
}

function currentAircraft() {
  const personalFleet = state?.fleet?.filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented)) || [];
  if (!personalFleet.length) {
    return aircraftCatalog.find((aircraft) => aircraft.id === "c172") || aircraftCatalog[0];
  }
  return personalFleet.find((item) => item.selected) || personalFleet[0];
}

function selectedMissions() {
  return state.missions.filter((mission) => mission.status !== "completed");
}

function buildMissionScene(category, subtype) {
  const packagedScene = flightCareerMissionScenes[subtype];
  if (packagedScene) {
    const modelPolicy = missionSceneModelPolicies[packagedScene.objectTitle] || {};
    const requiresLanding = packagedScene.requiresLanding ?? modelPolicy.requiresLanding ?? packagedScene.arrivalMode === "landing";
    return {
      ...modelPolicy,
      ...packagedScene,
      requiresLanding,
      arrivalMode: requiresLanding ? "landing" : "low-altitude",
      source: "Flight Career Objects 1.0.0",
      animated: packagedScene.seconds > 0,
      phase: "briefed"
    };
  }
  const standard = standardMissionScenes[category] || standardMissionScenes.客运;
  return {
    ...standard,
    source: "航路任务",
    objectTitle: "",
    clip: "航路状态动画",
    seconds: 2.5,
    radiusNm: 0,
    animated: true,
    phase: "briefed"
  };
}

function missionScene(mission) {
  return mission.scene || buildMissionScene(mission.category, mission.subtype);
}

function missionSceneModelPolicy(mission) {
  const packaged = flightCareerMissionScenes[mission?.subtype] || {};
  const scene = mission?.scene || {};
  return missionSceneModelPolicies[packaged.objectTitle || scene.objectTitle] || {};
}

function missionTerrainType(mission) {
  if (mission?.destination) return "airport";
  const packaged = flightCareerMissionScenes[mission?.subtype] || {};
  const scene = mission?.scene || {};
  return packaged.terrain || missionSceneModelPolicy(mission).terrain || scene.terrain || mission?.site?.terrain || "land";
}

function missionRequiresLanding(mission) {
  if (mission?.destination) return true;
  const packaged = flightCareerMissionScenes[mission?.subtype] || {};
  const modelPolicy = missionSceneModelPolicy(mission);
  const scene = mission?.scene || {};
  if (typeof packaged.requiresLanding === "boolean") return packaged.requiresLanding;
  if (typeof modelPolicy.requiresLanding === "boolean") return modelPolicy.requiresLanding;
  if (typeof scene.requiresLanding === "boolean") return scene.requiresLanding;
  return (packaged.arrivalMode || scene.arrivalMode || "landing") === "landing";
}

function missionArrivalMode(mission) {
  return missionRequiresLanding(mission) ? "landing" : "low-altitude";
}

function hasDepartedTaskSite(onGround, groundSpeedKt) {
  return !onGround && Number(groundSpeedKt || 0) >= 20;
}

function missionArrivalRule(mission) {
  if (mission?.destination) return { kind: "airport", radiusNm: 4, dwellSeconds: 0, speedLimitKt: 30 };
  return missionArrivalRules[missionArrivalMode(mission)] || missionArrivalRules.landing;
}

function missionArrivalLabel(mission) {
  const rule = missionArrivalRule(mission);
  if (rule.kind === "airport") return "目的机场落地并关车";
  if (missionArrivalMode(mission) === "low-altitude") return `低空进入 ${rule.radiusNm} nm 内触发`;
  return `落地后 ${rule.radiusNm} nm 内停留 ${rule.dwellSeconds} 秒`;
}

function missionTerrainLabel(mission) {
  const terrain = missionTerrainType(mission);
  if (terrain === "airport") return "机场任务 · 必须降落";
  if (terrain === "water") return `海上模型 · ${missionRequiresLanding(mission) ? "必须水面降落" : "低空作业"}`;
  return `地面模型 · ${missionRequiresLanding(mission) ? "必须降落" : "低空作业"}`;
}

function isPackagedScene(scene) {
  return Boolean(scene?.objectTitle);
}

function missionSmokeTitle(scene) {
  return scene?.animated && scene?.objectTitle ? (scene.smokeTitle || "FCMsmoke1") : "";
}

function airportByIcao(icao) {
  const code = String(icao || "").trim().toUpperCase();
  return globalAirportIndex.get(code) || airportDatabase.find((airport) => airport.icao === code) || null;
}

function distanceNm(from, to) {
  const radiusNm = 3440.065;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLat = (to.lat - from.lat) * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function assessTelemetryMovement(previousPoint, currentPoint, previousTimestamp, currentTimestamp, sample = {}) {
  if (!previousPoint || !currentPoint) return { kind: "unavailable", stepNm: 0, elapsedSec: 0, plausibleStepNm: 0 };
  const coordinates = [previousPoint.lat, previousPoint.lon, currentPoint.lat, currentPoint.lon].map(Number);
  if (!coordinates.every(Number.isFinite)) return { kind: "unavailable", stepNm: 0, elapsedSec: 0, plausibleStepNm: 0 };
  const stepNm = distanceNm(previousPoint, currentPoint);
  const previousAt = Number(previousTimestamp);
  const currentAt = Number(currentTimestamp);
  const elapsedSec = Number.isFinite(previousAt) && Number.isFinite(currentAt) ? (currentAt - previousAt) / 1000 : 0;
  const speedKt = Math.max(
    Number(sample.groundSpeedKt) || 0,
    Number(sample.indicatedAirspeedKt) || 0,
    Number(sample.trueAirspeedKt) || 0
  );
  const plausibleStepNm = Math.max(3, speedKt * Math.max(1, elapsedSec) / 3600 * 5 + 1);
  if (telemetryBoolean(sample.slewActive)) return { kind: "slew", stepNm, elapsedSec, plausibleStepNm };
  if (!(elapsedSec > 0) || elapsedSec > 120) return { kind: "gap", stepNm, elapsedSec, plausibleStepNm };
  if (stepNm > 8 && stepNm > plausibleStepNm) return { kind: "jump", stepNm, elapsedSec, plausibleStepNm };
  return { kind: "normal", stepNm, elapsedSec, plausibleStepNm };
}

function accumulateFlightDistance(current, step) {
  const total = Math.max(0, Number(current) || 0);
  const increment = Number(step);
  if (!Number.isFinite(increment) || increment <= 0) return total;
  return +(total + increment).toFixed(6);
}

function nearestKnownAirport(lat, lon, maximumNm = 4) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const point = { lat, lon };
  const nearest = airportDatabase.reduce((best, airport) => {
    const distance = distanceNm(point, airport);
    return !best || distance < best.distance ? { airport, distance } : best;
  }, null);
  return nearest?.distance <= maximumNm ? nearest : null;
}

