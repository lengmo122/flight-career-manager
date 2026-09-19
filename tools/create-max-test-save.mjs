import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const source = await readFile(join(root, "app.js"), "utf8");
const catalogSource = source.slice(source.indexOf("const aircraftCatalog = ["), source.indexOf("];", source.indexOf("const aircraftCatalog = [")));
const aircraftCatalog = [...catalogSource.matchAll(/\{ id: "([^"]+)", name: "([^"]+)", kind: "([^"]+)", price: ([\d.]+), rent: ([\d.]+), range: ([\d.]+), pace: "([^"]+)", unlockHours: ([\d.]+), note: "([^"]*)" \}/g)]
  .map(([, id, name, kind, price, rent, range, pace, unlockHours, note]) => ({
    id, name, kind, price: Number(price), rent: Number(rent), range: Number(range), pace, unlockHours: Number(unlockHours), note
  }));
if (aircraftCatalog.length < 50) throw new Error(`飞机目录解析异常：仅找到 ${aircraftCatalog.length} 架`);

const now = Date.now();
const maxCash = 9_999_999_999_999;
const achievementIds = [
  "first-flight", "ten-hours", "twenty-hours", "fifty-hours", "hundred-landings", "five-hundred-landings",
  "fleet-owner", "fleet-master", "captain", "senior-instructor", "flight-veteran", "long-distance",
  "mission-veteran", "mission-commander", "fuel-manager", "fuel-budget", "logbook-keeper", "medical-response",
  "type-rated", "company-founder", "company-fleet", "company-crew"
];
const maxStats = {
  totalHours: 999_999,
  totalMiles: 999_999_999,
  totalLandings: 999_999,
  completedMissions: 999_999,
  manualLogs: 999_999,
  totalFuelKg: 999_999_999,
  totalFuelCost: 999_999_999
};
const transaction = (id, amount, balance, title, type = "test-max") => ({
  id, date: now, type, title, detail: "全满测试存档", amount, balance, referenceId: "max-test-save"
});

const fleet = aircraftCatalog.map((aircraft, index) => ({
  ...aircraft,
  owned: true,
  rented: false,
  selected: index === 0,
  lastFuelKg: 100_000,
  fuelCapacityKg: 100_000,
  lastFuelAt: now,
  lastSeenTitle: aircraft.name,
  conditionPercent: 100,
  lastMaintenanceAt: now,
  lastLandingReportAt: now,
  lastLandingRateFpm: 0,
  lastLandingPeakG: 1,
  lastLandingWearPercent: 0,
  lastLandingAirport: "ZBAA",
  lastLandingRunway: "18L"
}));

const companyAircraft = ["b738", "a320", "b738-bdsf", "b738-bcf", "b787"].map((catalogId, index) => {
  const template = aircraftCatalog.find((aircraft) => aircraft.id === catalogId) || aircraftCatalog[0];
  const id = `company-aircraft-max-${index + 1}`;
  return {
    ...template,
    id,
    catalogId: template.id,
    companyOwned: true,
    owned: true,
    rented: false,
    selected: false,
    lastFuelKg: 100_000,
    fuelCapacityKg: 100_000,
    lastFuelAt: now,
    lastSeenTitle: template.name,
    conditionPercent: 100,
    lastMaintenanceAt: now,
    lastLandingReportAt: now,
    lastLandingRateFpm: 0,
    lastLandingPeakG: 1,
    lastLandingWearPercent: 0,
    lastLandingAirport: "ZBAA",
    lastLandingRunway: "18L"
  };
});
fleet.push(...companyAircraft);

const companyPilots = Array.from({ length: 20 }, (_, index) => ({
  id: `max-test-pilot-${index + 1}`,
  name: ["林浩", "周岚", "陈默", "赵航", "王宁", "叶晨", "韩雪", "许安", "高远", "沈飞", "Alex Carter", "Emma Wilson", "Liam Chen", "Olivia Zhang", "Noah Smith", "Mia Taylor", "Ethan Lee", "Sophia Brown", "Lucas Wang", "Ava Miller"][index],
  skillLevel: 5,
  skill: 100,
  aircraftKind: index % 2 ? "干线喷气" : "货运喷气",
  salary: 999_999,
  experienceHours: 999_999,
  status: "active",
  owner: index === 0,
  assignedTaskId: "",
  hiredAt: now
}));

const missions = [
  { id: "max-test-mission-completed", title: "全满测试航班", summary: "客运任务 · 区域通勤", category: "客运", subtype: "区域通勤", route: "ZBAA → ZSPD", origin: "ZBAA", destination: "ZSPD", distance: 580, duration: 2.4, payout: 999_999, repGain: 999, risk: "低", weather: "晴朗", dispatchPhase: "日间", aircraftHint: "干线喷气", status: "completed", createdAt: now, acceptedAt: now - 7_200_000, completedAt: now - 3_600_000, progress: 100 },
  { id: "max-test-mission-emergency", title: "全满测试紧急任务", summary: "医疗任务 · 医疗后送", category: "医疗", subtype: "医疗后送", route: "ZBAA → ZBNY", origin: "ZBAA", destination: "ZBNY", distance: 320, duration: 1.8, payout: 999_999, repGain: 999, risk: "高", weather: "全天候", dispatchPhase: "全天候", aircraftHint: "直升机", status: "open", createdAt: now, priority: "emergency", refreshable: true }
];

const companyTask = {
  id: "max-test-company-task",
  title: "公司全满测试航班",
  origin: "ZBAA",
  destination: "ZSPD",
  category: "货运",
  distance: 580,
  payout: 999_999,
  status: "completed",
  pilotId: companyPilots[1].id,
  aircraftId: companyAircraft[0].id,
  assignedAt: now - 7_200_000,
  completedAt: now - 3_600_000
};

const save = {
  pilot: { name: "测试机长", base: "ZBAA", avatarDataUrl: "", loggedIn: true, hasCompletedLogin: true },
  airlineId: "gti",
  cash: maxCash,
  reputation: 999_999,
  stats: maxStats,
  missions,
  schedules: [],
  backups: [],
  hangarFilter: "all",
  hangarSearch: "",
  missionFilters: { search: "", status: "all", category: "all", distanceSort: "near" },
  settings: { speechVolume: 1, mapAutoTrack: true, mapShowCompanyAircraft: true, darkMode: true },
  company: {
    created: true,
    name: "全满测试航空",
    airlineId: "gti",
    base: "ZBAA",
    funds: maxCash,
    pilots: companyPilots,
    applicants: Array.from({ length: 6 }, (_, index) => ({ id: `max-test-applicant-${index + 1}`, name: `测试候选人${index + 1}`, skillLevel: 5, skill: 100, aircraftKind: "干线喷气", hirePrice: 0, salary: 0, experienceHours: 999_999, generatedAt: now })),
    taskOffers: Array.from({ length: 12 }, (_, index) => ({ id: `max-test-offer-${index + 1}`, title: `货运 · ZBAA → ZSPD 测试任务 ${index + 1}`, origin: "ZBAA", destination: "ZSPD", category: "货运", distance: 580, payout: 999_999, status: "open", createdAt: now })),
    tasks: [companyTask],
    flightLogs: [{ id: "max-test-company-log", taskId: companyTask.id, title: companyTask.title, origin: "ZBAA", destination: "ZSPD", pilotId: companyPilots[1].id, pilotName: companyPilots[1].name, aircraftId: companyAircraft[0].id, aircraftName: companyAircraft[0].name, status: "completed", airportCheck: "passed", assignedAt: now - 7_200_000, createdAt: now - 7_200_000, completedAt: now - 3_600_000 }],
    aircraftIds: companyAircraft.map((aircraft) => aircraft.id),
    starterAircraftGranted: true,
    transactions: [transaction("company-max-opening", maxCash, maxCash, "公司测试资金", "opening")],
    activeSection: "management"
  },
  features: { sceneObjectsSeeded: true, starterHelicopterGranted: true, landingWearStartedAt: now },
  logs: [{ id: "max-test-log", date: now, from: "ZBAA", to: "ZSPD", aircraft: "Boeing 737-800", hours: 999_999, miles: 999_999, income: 999_999, notes: "全满测试存档" }],
  taskEvents: [{ id: "max-test-event", missionId: missions[0].id, missionTitle: missions[0].title, key: "completed", title: "任务完成", detail: "全满测试存档", timestamp: now }],
  fundTransactions: [transaction("fund-max-opening", maxCash, maxCash, "个人测试资金", "opening")],
  licenses: aircraftCatalog.map((aircraft) => ({ id: aircraft.id, purchased: true, purchasedAt: now, assessmentCompleted: true, assessmentCompletedAt: now })),
  simulatorFlight: { active: false, aircraftId: "", aircraftName: "", missionId: "", departedAt: null, origin: "", destination: "", phase: "ground", lastPosition: null, distanceNm: 0, lastSampleAt: null },
  fleet,
  achievements: achievementIds.map((id) => ({ id, unlocked: true })),
  activeView: "dashboard"
};

const outputPath = join(root, "全满测试存档.json");
await writeFile(outputPath, JSON.stringify(save, null, 2), "utf8");
console.log(`已生成：${outputPath}`);
console.log(`个人飞机 ${aircraftCatalog.length} 架，公司飞机 ${companyAircraft.length} 架，公司飞行员 ${companyPilots.length} 名`);
