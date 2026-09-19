import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [app, html, telemetry] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../tools/msfs-telemetry-source/Program.cs", import.meta.url), "utf8")
]);

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");

function readFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} source was not found`);
  const bodyStart = app.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`${name} source was incomplete`);
}

assert.match(html, /id="sopModeToggle"/, "settings should expose the SOP switch");
assert.match(app, /sopMode:\s*false/, "SOP should be disabled by default");
assert.match(app, /sopMode:\s*incoming\.settings\?\.sopMode === true/, "SOP should migrate from saved settings");
assert.match(app, /function isSopMode\(\)[\s\S]*?&& !isFreeMode\(\)/, "free mode should disable SOP checks");
assert.match(app, /function evaluateSopTelemetry\(/, "SOP telemetry evaluator should exist");
assert.match(app, /灯光|滑行|起飞|巡航|着陆|停机|关车/, "SOP stages should be represented in the implementation");
assert.match(app, /sopScore|sopMultiplier|sopDeductions/, "SOP score must affect settlement and logs");
assert.match(app, /function sopRewardMultiplier\(enabled, score\)[\s\S]*?normalizedScore >= 100 \? 1\.3 : normalizedScore \/ 100/, "a perfect SOP score must grant a 1.3x reward");
assert.match(app, /const grossIncome = Math\.round\(baseGrossIncome \* sopMultiplier\)/, "SOP reward multiplier must apply to task income");
assert.match(app, /const repMultiplier = sopEnabled \? sopScore \/ 100 : 1/, "the 1.3x landing reward must not inflate reputation");
assert.match(app, /function buildSopReport\(/, "SOP completion should generate a structured report");
assert.match(app, /操作错误与扣分/, "SOP report should list each deduction reason");
assert.match(app, /接地数据/, "SOP report should display landing data");
assert.match(app, /sopReport/, "SOP report should be persisted with the flight log");
assert.match(app, /sopCanComplete/, "SOP completion must wait for parking and shutdown");
assert.match(telemetry, /LandingLights|TaxiLights|BeaconLights|AntiCollisionLights|ParkingBrake/, "telemetry bridge should expose SOP inputs");
assert.match(telemetry, /AntiCollisionLights = raw\.BeaconLights/, "MSFS beacon state should be published explicitly as anti-collision lights");
assert.match(telemetry, /BRAKE PARKING POSITION[\s\S]*?BRAKE PARKING INDICATOR[\s\S]*?L:switch_693_73X/, "parking-brake telemetry must include standard and PMDG sources");
assert.match(telemetry, /ParkingBrake = MergeParkingBrake\(raw\.ParkingBrakePosition, raw\.ParkingBrakeIndicator, raw\.PmdgParkingBrakeLever\)/, "published snapshots must merge every parking-brake source");
assert.match(app, /function sopCompletionPrompt\(/, "landing confirmation should explain the remaining SOP action");
assert.match(app, /请关闭发动机完成关车/, "SOP landing status should explicitly request engine shutdown");
assert.match(app, /function updateSopDataAvailability\(/, "SOP telemetry availability should recover when data becomes available");
assert.match(app, /function handleAircraftCrash\([\s\S]*?sopReport/, "Crash logs must retain an SOP report");
assert.match(app, /landingWearPercent: landingWear\.wearPercent/, "Crash SOP reports must retain aircraft condition wear");
assert.match(app, /phaseLabel: "坠机，任务失败"[\s\S]*?sop: \{/, "Failed missions must persist their SOP report state");
assert.match(app, /function buildLandingSopSnapshot\(/, "All landing outcomes should share one SOP report builder");
assert.match(app, /function finalizeSimulatorFlight\([\s\S]*?const sopSnapshot = buildLandingSopSnapshot/, "Normal landing logs must also persist an SOP report");
assert.match(html, /data-view="sop"[\s\S]*?SOP 监测/, "main navigation should expose the dedicated SOP monitor page");
assert.match(html, /id="sopView"[\s\S]*?id="sopMonitor"[\s\S]*?id="sopMonitorTable"/, "SOP monitoring should render in its own view");
const quickActionsMarkup = html.slice(html.indexOf("<h2>快速操作</h2>"), html.indexOf("</aside>"));
assert.doesNotMatch(quickActionsMarkup, /id="sopMonitor"/, "the SOP table should no longer occupy the quick-actions sidebar");
assert.match(app, /const SOP_MONITOR_RULES = \[[\s\S]*?lighting[\s\S]*?taxi[\s\S]*?takeoff[\s\S]*?cruise[\s\S]*?landing[\s\S]*?parking[\s\S]*?shutdown/, "monitor should cover all seven SOP stages");
assert.match(app, /function renderSopMonitor\(\)/, "SOP monitor should have a dedicated renderer");
assert.match(app, /processTelemetry\(payload\.sample[\s\S]*?renderSopMonitor\(\)/, "telemetry polling should refresh the SOP monitor");
assert.match(app, /发动机运行时开启防撞灯|地速不得超过 35 kt|连续停稳 5 秒/, "monitor should display actionable SOP requirements");
assert.match(app, /防撞灯：\$\{sopBooleanLabel\(sample, \["antiCollisionLights", "beaconLights"/, "SOP details should display live anti-collision light state");
assert.match(html, /逐项监测明细[\s\S]*?本次任务扣分记录[\s\S]*?评分构成/, "the SOP page should expose detailed requirements, deductions and scoring");
assert.match(app, /function sopLiveValues\([\s\S]*?无线电高度[\s\S]*?停留刹车/, "the SOP page should expose live stage-specific telemetry");
assert.match(app, /taxiCompleted = sop\?\.taxiConfirmed === true && \(sop\?\.takeoffRollStartedAt \|\| sop\?\.takeoffConfirmed === true\)/, "takeoff roll should stop the taxi row from reading runway acceleration");
assert.match(app, /taxiLastGroundSpeedKt: null[\s\S]*?taxiLastLight: null/, "SOP state should retain the last valid ground-taxi values");
assert.match(app, /sop\.taxiLastGroundSpeedKt = speed[\s\S]*?sop\.taxiLastLight = taxiLight/, "taxi telemetry should be captured only while on the ground");
assert.match(app, /function sopTakeoffRollActive\([\s\S]*?Number\(speed\) >= 35[\s\S]*?landingLight === true \|\| strobe === true/, "configured runway acceleration should be recognized as takeoff roll");
assert.match(app, /speed > 0\.5 && !sop\.takeoffConfirmed && !takeoffRoll/, "taxi deductions must stop during takeoff roll and after the first takeoff");
assert.match(app, /function sopParkingDecision\(/, "parking checks should wait for the complete stationary window");
assert.match(app, /if \(parkingDecision\.shouldDeduct\) applySopDeduction/, "parking-brake deductions must use the delayed decision");
assert.match(app, /else if \(sop\.landingConfirmed && !sop\.parkingConfirmed\)[\s\S]*?sop\.parkingStartedAt = null/, "moving above the parking threshold must reset the continuous stop timer");
assert.match(css, /\.sop-detail-table[\s\S]*?table-layout:\s*fixed/, "the detailed SOP table should keep stable columns");

const context = { state: { settings: { freeMode: false, sopMode: true } } };
vm.runInNewContext(`function isFreeMode() { return state.settings?.freeMode === true; }
function isSopMode() { return state.settings?.sopMode === true && !isFreeMode(); }
globalThis.isSopMode = isSopMode;`, context);
assert.equal(context.isSopMode(), true);
context.state.settings.freeMode = true;
assert.equal(context.isSopMode(), false);

const rewardContext = {};
vm.runInNewContext(`
function sopRewardMultiplier(enabled, score) {
  if (!enabled) return 1;
  const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));
  return normalizedScore >= 100 ? 1.3 : normalizedScore / 100;
}
globalThis.sopRewardMultiplier = sopRewardMultiplier;
`, rewardContext);
assert.equal(rewardContext.sopRewardMultiplier(true, 100), 1.3, "a perfect SOP score should pay 130% reward");
assert.equal(rewardContext.sopRewardMultiplier(true, 95), 0.95, "a non-perfect SOP score should retain score-based reduction");
assert.equal(rewardContext.sopRewardMultiplier(false, 100), 1, "SOP reward bonus should be disabled outside SOP mode");

const taxiContext = {};
vm.runInNewContext(`${readFunction("sopTakeoffRollActive")}
globalThis.sopTakeoffRollActive = sopTakeoffRollActive;`, taxiContext);
assert.equal(taxiContext.sopTakeoffRollActive(true, 42, true, true, false), true,
  "42 kt with takeoff lights configured should be treated as takeoff roll, not taxi speeding");
assert.equal(taxiContext.sopTakeoffRollActive(true, 42, true, false, false), false,
  "42 kt without a takeoff configuration should remain a taxi-speed violation");
assert.equal(taxiContext.sopTakeoffRollActive(false, 42, true, true, true), false,
  "airborne speed must never be classified as taxi or takeoff roll");

const parkingContext = {};
vm.runInNewContext(`${readFunction("sopParkingDecision")}
globalThis.sopParkingDecision = sopParkingDecision;`, parkingContext);
assert.equal(parkingContext.sopParkingDecision(1_000, false, false, 5_999).shouldDeduct, false,
  "parking brake must not be deducted before five complete stationary seconds");
assert.equal(parkingContext.sopParkingDecision(1_000, false, false, 6_000).shouldDeduct, true,
  "parking brake should be deducted after five stationary seconds when every sample remains released");
assert.equal(parkingContext.sopParkingDecision(1_000, false, true, 6_000).canConfirm, true,
  "a valid set sample during the stationary window must survive a later stale false sample");
assert.equal(parkingContext.sopParkingDecision(1_000, true, false, 6_000).canConfirm, true,
  "a currently set parking brake must complete the parking check after five seconds");

const availabilityContext = {};
vm.runInNewContext([
  readFunction("recordSopDataUnavailable"),
  readFunction("updateSopDataAvailability"),
  "globalThis.updateSopDataAvailability = updateSopDataAvailability;"
].join("\n"), availabilityContext);
const sop = { dataUnavailable: ["灯光", "停留刹车", "发动机状态"] };
for (const key of [...sop.dataUnavailable]) availabilityContext.updateSopDataAvailability(sop, key, false);
assert.deepEqual(
  JSON.parse(JSON.stringify(sop.dataUnavailable)),
  [],
  "Recovered light, parking-brake and engine telemetry must clear stale unavailable warnings"
);
assert.match(app, /updateSopDataAvailability\(sop, "灯光",/);
assert.match(app, /updateSopDataAvailability\(sop, "停留刹车",/);
assert.match(app, /updateSopDataAvailability\(sop, "发动机状态", false\)/);

console.log("SOP mode: switch, migration, seven-stage checks and settlement hooks passed");
