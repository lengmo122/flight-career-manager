// 模飞生涯 渲染器源码 03-dom-refs.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
const els = {
  appShell: document.getElementById("appShell"),
  loginGate: document.getElementById("loginGate"),
  supportBtn: document.getElementById("supportBtn"),
  supportModal: document.getElementById("supportModal"),
  themeModeBtn: document.getElementById("themeModeBtn"),
  contactAuthorBtn: document.getElementById("contactAuthorBtn"),
  contactModal: document.getElementById("contactModal"),
  authorQqGroup: document.getElementById("authorQqGroup"),
  copyAuthorQqBtn: document.getElementById("copyAuthorQqBtn"),
  thankSupportBtn: document.getElementById("thankSupportBtn"),
  aboutBtn: document.getElementById("aboutBtn"),
  aboutModal: document.getElementById("aboutModal"),
  viewButtons: [...document.querySelectorAll("[data-view]")],
  views: {
    dashboard: document.getElementById("dashboardView"),
    missions: document.getElementById("missionsView"),
    map: document.getElementById("mapView"),
    monitor: document.getElementById("monitorView"),
    sop: document.getElementById("sopView"),
    schedules: document.getElementById("schedulesView"),
    logs: document.getElementById("logsView"),
    achievements: document.getElementById("achievementsView"),
    profile: document.getElementById("profileView"),
    hangar: document.getElementById("hangarView"),
    "aircraft-management": document.getElementById("aircraftManagementView"),
    company: document.getElementById("companyView")
  },
  pilotInitials: document.getElementById("pilotInitials"),
  pilotAvatarPreview: document.getElementById("pilotAvatarPreview"),
  avatarChoiceGrid: document.getElementById("avatarChoiceGrid"),
  avatarChoiceStatus: document.getElementById("avatarChoiceStatus"),
  pilotAvatarFile: document.getElementById("pilotAvatarFile"),
  uploadAvatarBtn: document.getElementById("uploadAvatarBtn"),
  pilotName: document.getElementById("pilotName"),
  loginPilotBtn: document.getElementById("loginPilotBtn"),
  pilotRank: document.getElementById("pilotRank"),
  nextRankLabel: document.getElementById("nextRankLabel"),
  rankProgressText: document.getElementById("rankProgressText"),
  rankMeter: document.getElementById("rankMeter"),
  totalHours: document.getElementById("totalHours"),
  reputation: document.getElementById("reputation"),
  balance: document.getElementById("balance"),
  totalMiles: document.getElementById("totalMiles"),
  milesTrend: document.getElementById("milesTrend"),
  totalLandings: document.getElementById("totalLandings"),
  topAircraft: document.getElementById("topAircraft"),
  topAircraftHours: document.getElementById("topAircraftHours"),
  completedCount: document.getElementById("completedCount"),
  activeMissionCount: document.getElementById("activeMissionCount"),
  careerGoal: document.getElementById("careerGoal"),
  careerGoalText: document.getElementById("careerGoalText"),
  dashboardSettlement: document.getElementById("dashboardSettlement"),
  airlinePanelTitle: document.getElementById("airlinePanelTitle"),
  airlinePanel: document.getElementById("airlinePanel"),
  airlineMeta: document.getElementById("airlineMeta"),
  recommendedMissions: document.getElementById("recommendedMissions"),
  missionsList: document.getElementById("missionsList"),
  missionSearch: document.getElementById("missionSearch"),
  missionDistanceSort: document.getElementById("missionDistanceSort"),
  missionStatusFilter: document.getElementById("missionStatusFilter"),
  missionCategoryButtons: [...document.querySelectorAll("[data-mission-category]")],
  refreshMissionsBtn: document.getElementById("refreshMissionsBtn"),
  missionResultCount: document.getElementById("missionResultCount"),
  careerMap: document.getElementById("careerMap"),
  mapPageTitle: document.getElementById("mapPageTitle"),
  mapPageSummary: document.getElementById("mapPageSummary"),
  mapPageCount: document.getElementById("mapPageCount"),
  mapTaskList: document.getElementById("mapTaskList"),
  mapLayerControls: [...document.querySelectorAll("[data-map-layer]")],
  followAircraftBtn: document.getElementById("followAircraftBtn"),
  toggleCompanyAircraftBtn: document.getElementById("toggleCompanyAircraftBtn"),
  scheduleSummary: document.getElementById("scheduleSummary"),
  scheduleList: document.getElementById("scheduleList"),
  planOriginInput: document.getElementById("planOriginInput"),
  planOriginResult: document.getElementById("planOriginResult"),
  planDestinationInput: document.getElementById("planDestinationInput"),
  planDestinationResult: document.getElementById("planDestinationResult"),
  planAircraftSelect: document.getElementById("planAircraftSelect"),
  planAircraftHint: document.getElementById("planAircraftHint"),
  generatePlannedMissionBtn: document.getElementById("generatePlannedMissionBtn"),
  backupList: document.getElementById("backupList"),
  confirmModal: document.getElementById("confirmModal"),
  confirmMessage: document.getElementById("confirmMessage"),
  recentLogs: document.getElementById("recentLogs"),
  logsList: document.getElementById("logsList"),
  sidebarLogs: document.getElementById("sidebarLogs"),
  simulatorStatus: document.getElementById("simulatorStatus"),
  simulatorAircraft: document.getElementById("simulatorAircraft"),
  simulatorPosition: document.getElementById("simulatorPosition"),
  simulatorFuel: document.getElementById("simulatorFuel"),
  simulatorMissionState: document.getElementById("simulatorMissionState"),
  hangarGrid: document.getElementById("hangarGrid"),
  hangarFilter: document.getElementById("hangarFilter"),
  hangarSearch: document.getElementById("hangarSearch"),
  aircraftManagementSummary: document.getElementById("aircraftManagementSummary"),
  aircraftManagementGrid: document.getElementById("aircraftManagementGrid"),
  aircraftManagementFilter: document.getElementById("aircraftManagementFilter"),
  aircraftManagementSearch: document.getElementById("aircraftManagementSearch"),
  companyIdentity: document.getElementById("companyIdentity"),
  companyManagementPanel: document.getElementById("companyManagementPanel"),
  companyTaskList: document.getElementById("companyTaskList"),
  companyPilotSummary: document.getElementById("companyPilotSummary"),
  companyPilotList: document.getElementById("companyPilotList"),
  companyApplicantList: document.getElementById("companyApplicantList"),
  companyHangarSummary: document.getElementById("companyHangarSummary"),
  companyHangarGrid: document.getElementById("companyHangarGrid"),
  companyHangarFilter: document.getElementById("companyHangarFilter"),
  companyHangarSearch: document.getElementById("companyHangarSearch"),
  companyFinanceSummary: document.getElementById("companyFinanceSummary"),
  companyTransactionList: document.getElementById("companyTransactionList"),
  companyFlightLogList: document.getElementById("companyFlightLogList"),
  achievementList: document.getElementById("achievementList"),
  profileOverview: document.getElementById("profileOverview"),
  fundSummary: document.getElementById("fundSummary"),
  fundTransactionList: document.getElementById("fundTransactionList"),
  profileRankTimeline: document.getElementById("profileRankTimeline"),
  aircraftLicenseList: document.getElementById("aircraftLicenseList"),
  licenseProgress: document.getElementById("licenseProgress"),
  refreshLicenseAssessmentsBtn: document.getElementById("refreshLicenseAssessmentsBtn"),
  toast: document.getElementById("toast"),
  pilotForm: document.getElementById("pilotForm"),
  pilotSubmitBtn: document.getElementById("pilotSubmitBtn"),
  pilotNameInput: document.getElementById("pilotNameInput"),
  pilotBaseInput: document.getElementById("pilotBaseInput"),
  logModal: document.getElementById("logModal"),
  logForm: document.getElementById("logForm"),
  logModalTitle: document.getElementById("logModalTitle"),
  logFrom: document.getElementById("logFrom"),
  logTo: document.getElementById("logTo"),
  logAircraft: document.getElementById("logAircraft"),
  logHours: document.getElementById("logHours"),
  logMiles: document.getElementById("logMiles"),
  logIncome: document.getElementById("logIncome"),
  logNotes: document.getElementById("logNotes"),
  importFile: document.getElementById("importFile"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsModal: document.getElementById("settingsModal"),
  settingsForm: document.getElementById("settingsForm"),
  speechVolumeRange: document.getElementById("speechVolumeRange"),
  speechVolumeValue: document.getElementById("speechVolumeValue"),
  freeModeToggle: document.getElementById("freeModeToggle"),
  sopModeToggle: document.getElementById("sopModeToggle"),
  sopMonitor: document.getElementById("sopMonitor"),
  sopMonitorScore: document.getElementById("sopMonitorScore"),
  sopMonitorSummary: document.getElementById("sopMonitorSummary"),
  sopMonitorTable: document.getElementById("sopMonitorTable"),
  sopModeStatus: document.getElementById("sopModeStatus"),
  sopMissionName: document.getElementById("sopMissionName"),
  sopCurrentStage: document.getElementById("sopCurrentStage"),
  sopCompletedCount: document.getElementById("sopCompletedCount"),
  sopDeductionTotal: document.getElementById("sopDeductionTotal"),
  sopTelemetryStatus: document.getElementById("sopTelemetryStatus"),
  sopStageTrack: document.getElementById("sopStageTrack"),
  sopDeductionList: document.getElementById("sopDeductionList"),
  monitorConnection: document.getElementById("monitorConnection"),
  monitorConnectionTitle: document.getElementById("monitorConnectionTitle"),
  monitorConnectionDetail: document.getElementById("monitorConnectionDetail"),
  monitorUpdatedAt: document.getElementById("monitorUpdatedAt"),
  runtimeLogStatus: document.getElementById("runtimeLogStatus"),
  runtimeLogList: document.getElementById("runtimeLogList"),
  refreshRuntimeLogBtn: document.getElementById("refreshRuntimeLogBtn"),
  clearRuntimeLogBtn: document.getElementById("clearRuntimeLogBtn"),
  exportRuntimeLogBtn: document.getElementById("exportRuntimeLogBtn")
};

let logMode = "manual";
let leafletLoadPromise = null;
let leafletMap = null;
let liveAircraftMarker = null;
let liveTrackLine = null;
const companyAircraftMarkers = new Map();
let liveTrackPoints = [];
let lastLiveTrackTimestamp = "";
let lastLiveHeadingDeg = 0;
let simulatorPollTimer = null;
let lastTelemetry = null;
let lastTelemetryConnected = false;
let lastSimulatorPayload = {};
let simulatorStartPromise = null;
let nextSimulatorAutoConnectAt = 0;
let simulatorAutoConnectFailures = 0;
let lastFleetTelemetryPersistAt = 0;
let lastAircraftManagementRenderAt = 0;
const fuelTargetPercents = new Map();
const fuelTargetBaselines = new Map();
const refuelPendingIds = new Set();
const missionMetarCache = new Map();
let missionMetarPromise = null;
const missionMetarClientTtlMs = 5 * 60 * 1000;
let sceneSyncPromise = null;
let speechQueue = [];
let speechPlaying = false;
let speechServiceErrorNotified = false;
let lastMonitorConnectionState = "";
let runtimeLogRequestPromise = null;
let lastRuntimeLogSignature = "";
let lastRuntimeLogAt = 0;
let settingsDraftSpeechVolume = 1;
let missionRefreshTimer = null;
const endingMissionIds = new Set();
const FREE_MODE_CASH = 1_000_000;
const preferredVoiceName = "zh-CN-XiaoxiaoNeural";
const taskLogEventKeys = new Set([
  "accepted",
  "engine-started",
  "origin-confirmed",
  "departure-mismatch",
  "takeoff",
  "target-confirmed",
  "returning",
  "simulator-disconnected",
  "sop-violation",
  "sop-stage",
  "completed"
]);

