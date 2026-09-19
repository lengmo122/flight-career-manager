// 模飞生涯 渲染器源码 10-missions.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function acceptMission(id) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || mission.status !== "open") return;
  const activeMission = state.missions.find((item) => item.status === "accepted");
  if (activeMission && activeMission.id !== mission.id) {
    toast(`当前已有执行中任务：${activeMission.title}，完成或结束后再接受新任务`);
    return;
  }
  const aircraft = currentAircraft();
  if (!isFreeMode() && !mission.permittedAircraftIds?.includes(aircraft.id)) {
    toast(`请先在机库选择适配机型：${mission.aircraftHint}`);
    return;
  }
  mission.scene = { ...missionScene(mission), phase: "active", activatedAt: Date.now() };
  mission.status = "accepted";
  mission.acceptedAt = Date.now();
  mission.verification = {
    phase: "briefed",
    phaseLabel: "等待正确机场起飞",
    detail: isFreeMode() ? `自由模式：使用 ${aircraft.name} 执行任务，不限制机型和接地` : `请在 ${mission.origin} 地面使用 ${aircraft.name} 起飞`,
    flightDistanceNm: 0,
    lastPoint: null,
    actualAircraft: "",
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    sceneState: mission.site ? "waiting" : null,
    sceneDetail: mission.site ? "接近任务现场 12 nm 后自动生成场景对象" : "",
    sceneRetryAt: 0,
    flightPlanState: "waiting",
    flightPlanDetail: "等待 MSFS 遥测连接后发送任务航路",
    flightPlanFormatVersion: 2,
    lastTelemetryTimestamp: "",
    teleportLocked: false,
    teleportReason: "",
    teleportDistanceNm: 0,
    teleportElapsedSec: 0,
    ignoredTelemetryJumps: 0,
    lastVoiceKey: "briefing",
    engineRunning: null,
    engineStartAnnounced: false,
    outboundStartPoint: null,
    departureAirport: null,
    arrivalAirport: null,
    landingDwellStartedAt: null,
    landingDwellSeconds: 0,
    targetLandingConfirmed: false,
    arrivalNoticeAnnounced: false,
    rewardEligible: null,
    fuelStartKg: null,
    fuelCurrentKg: null,
    fuelLastKg: null,
    fuelUsedKg: 0,
    fuelAddedKg: 0,
    fuelUpdatedAt: null,
    sop: { ...defaultSopState(), enabled: isSopMode() }
  };
  recordTaskEvent(mission, {
    key: "accepted",
    title: "任务已接受",
    detail: `使用 ${aircraft.name} 从 ${mission.origin} 出发，等待 MSFS 实时遥测。`,
    phase: "briefed"
  });
  queueVoice(`任务已接受。请使用${aircraft.name}前往${mission.origin}，确认停在地面后起飞。`);
  toast(`${isFreeMode() ? "自由模式：" : ""}已接受任务：${mission.title}`);
  renderAll();
  if (lastTelemetryConnected) void syncMissionFlightPlan(mission);
  showView("map");
}

let flightPlanSyncPromise = null;

async function syncMissionFlightPlan(mission) {
  if (!mission?.verification) return;
  const origin = airportByIcao(mission.origin);
  const targetAirport = airportByIcao(mission.destination);
  const target = mission.site?.lat != null
    ? {
        icao: "TASK",
        name: "任务现场",
        lat: mission.site.lat,
        lon: mission.site.lon,
        type: "UserWaypoint"
      }
    : targetAirport && {
        icao: targetAirport.icao,
        name: targetAirport.name,
        lat: targetAirport.lat,
        lon: targetAirport.lon,
        type: "Airport"
      };
  if (!origin || !target) {
    mission.verification.flightPlanState = "error";
    mission.verification.flightPlanDetail = "无法生成航路：任务机场坐标缺失";
    saveState();
    renderAll();
    return;
  }
  if (flightPlanSyncPromise) return;
  flightPlanSyncPromise = (async () => {
    mission.verification.flightPlanState = "connecting";
    mission.verification.flightPlanDetail = "正在连接 MSFS 导航系统";
    saveState();
    renderAll();
    try {
      const response = await fetch("/api/simulator/flight-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          missionId: mission.id,
          origin: { icao: origin.icao, name: origin.name, lat: origin.lat, lon: origin.lon, type: "Airport" },
          target,
          returnPoint: { icao: origin.icao, name: origin.name, lat: origin.lat, lon: origin.lon, type: "Airport" }
        })
      });
      const payload = await response.json();
      const waitingForSimulator = response.status === 409 && payload.reason === "simulator-not-connected";
      mission.verification.flightPlanState = response.ok ? payload.state || "connecting" : waitingForSimulator ? "waiting" : "error";
      mission.verification.flightPlanDetail = response.ok
        ? payload.state === "prepared"
          ? payload.message || "任务航路文件已安全生成"
          : "任务航路已发送，等待 MSFS 确认"
        : waitingForSimulator ? "等待 MSFS 遥测连接后自动发送任务航路" : payload.message || "MSFS 航路加载失败";
      await saveState();
      renderAll();
    } catch {
      mission.verification.flightPlanState = "error";
      mission.verification.flightPlanDetail = "无法连接 MSFS 航路服务";
      saveState();
      renderAll();
    }
  })().finally(() => { flightPlanSyncPromise = null; });
  await flightPlanSyncPromise;
}

function completeMission(id, actual = {}) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || mission.status !== "accepted") return;
  const aircraft = missionAircraft(mission);
  const hours = Number.isFinite(actual.hours) ? actual.hours : +(mission.duration * rand(0.95, 1.08)).toFixed(1);
  const miles = Number.isFinite(actual.miles) ? Math.round(actual.miles) : Math.round(mission.distance * rand(0.95, 1.05));
  const rewardEligible = actual.rewardEligible !== false;
  const missionSop = mission.verification?.sop || {};
  const sopEnabled = (state.settings?.sopMode === true && state.settings?.freeMode !== true) || missionSop.enabled === true;
  const sopScore = sopEnabled ? Math.max(0, Math.min(100, Number(actual.sopScore ?? missionSop.score ?? 100) || 0)) : 100;
  const sopMultiplier = sopRewardMultiplier(sopEnabled, sopScore);
  const baseGrossIncome = rewardEligible ? Math.round(mission.payout * (aircraft.rented ? 0.8 : 1)) : 0;
  const grossIncome = Math.round(baseGrossIncome * sopMultiplier);
  const fuelStartCandidate = actual.fuelStartKg ?? mission.verification?.fuelStartKg;
  const fuelEndCandidate = actual.fuelEndKg ?? mission.verification?.fuelCurrentKg;
  const fuelStartKg = fuelStartCandidate !== null && fuelStartCandidate !== "" && Number.isFinite(Number(fuelStartCandidate))
    ? Math.max(0, Number(fuelStartCandidate))
    : null;
  const fuelEndKg = fuelEndCandidate !== null && fuelEndCandidate !== "" && Number.isFinite(Number(fuelEndCandidate))
    ? Math.max(0, Number(fuelEndCandidate))
    : null;
  const fuelUsedKg = Math.max(0, Number(actual.fuelUsedKg ?? mission.verification?.fuelUsedKg) || 0);
  const fuelCost = Math.round(fuelUsedKg * FUEL_PRICE_PER_KG);
  const landingRateFpm = Number.isFinite(Number(actual.landingRateFpm)) ? Math.abs(Number(actual.landingRateFpm)) : null;
  const landingPeakG = Number.isFinite(Number(actual.landingPeakG)) ? Number(actual.landingPeakG) : null;
  const landingWear = Number.isFinite(Number(actual.landingWearPercent)) ? Math.max(0, Number(actual.landingWearPercent)) : null;
  const landingReportAt = Number.isFinite(Number(actual.landingReportAt)) ? Number(actual.landingReportAt) : null;
  const sopReport = typeof buildSopReport === "function"
    ? buildSopReport(missionSop, { ...actual, ...(typeof landingReportActual === "function" ? landingReportActual(actual.landingReport || null, aircraft) : {}), landingWearPercent: landingWear, landingReportAt })
    : { score: sopScore, multiplier: sopMultiplier, stages: [], deductions: missionSop.deductions || [], dataUnavailable: [], landing: { landingRateFpm, peakG: landingPeakG, wearPercent: landingWear, airport: String(actual.landingAirport || actual.arrivalAirport || ""), runway: String(actual.landingRunway || ""), reportAt: landingReportAt } };
  const income = grossIncome - fuelCost;
  const baseRepGain = rewardEligible ? mission.repGain + (mission.category === "医疗" ? 4 : 0) : 0;
  const repMultiplier = sopEnabled ? sopScore / 100 : 1;
  const repGain = Math.round(baseRepGain * repMultiplier);
  const assessmentPassed = mission.kind === "license-assessment" && rewardEligible;
  const scene = missionScene(mission);
  const manualCompletion = actual.manualCompletion === true;
  const actualLog = state.logs.find((log) => log.source === "msfs"
    && log.missionId === mission.id
    && log.aircraftId === aircraft.id);
  mission.status = "completed";
  mission.completedAt = Date.now();
  mission.manualCompleted = manualCompletion;
  mission.scene = { ...scene, phase: "completed", completedAt: mission.completedAt };
  if (mission.verification) {
    mission.verification.phase = "completed";
    mission.verification.phaseLabel = "已落地，任务完成";
    mission.verification.rewardEligible = rewardEligible;
    mission.verification.sop = {
      ...missionSop,
      enabled: sopEnabled,
      score: sopScore,
      multiplier: sopMultiplier,
      report: sopReport,
      settledAt: Date.now()
    };
    mission.verification.detail = rewardEligible
      ? `已在 ${actual.arrivalAirport || mission.origin} 关车，机场检查通过。`
      : `已在 ${actual.arrivalAirport || "未知机场"} 结束任务，但出发或到达机场不符合要求，本次无奖励。`;
  }
  if (mission.kind === "license-assessment" && mission.licenseAssessmentId) {
    const record = state.licenses.find((item) => item.id === mission.licenseAssessmentId);
    if (record?.purchased && assessmentPassed) {
      record.assessmentCompleted = true;
      record.assessmentCompletedAt = Date.now();
      record.assessmentMissionId = mission.id;
    }
    mission.assessmentResult = assessmentPassed ? "passed" : "failed";
  }
  recordTaskEvent(mission, {
    key: "completed",
    title: "任务完成，结算信息",
    detail: rewardEligible
      ? `已从 ${actual.departureAirport || mission.origin} 起飞并在 ${actual.arrivalAirport || mission.destination || mission.origin} 关车。${sopEnabled ? `SOP 得分 ${Math.round(sopScore)}/100，奖励折算 ${Math.round(sopMultiplier * 100)}%，声望按 ${Math.round(repMultiplier * 100)}% 结算。` : ""}任务收入 ${formatMoney(grossIncome)}，实际燃油 ${formatFuel(fuelUsedKg)}，燃油成本 ${formatMoney(fuelCost)}，净收入 ${formatMoney(income)}，声望 +${repGain}。`
      : `出发机场 ${actual.departureAirport || "未知"} 或到达机场 ${actual.arrivalAirport || "未知"} 与任务不一致，本次无奖励。实际燃油 ${formatFuel(fuelUsedKg)}，成本 ${formatMoney(fuelCost)}。`,
    voiceText: rewardEligible ? "任务完成，已安全到达目的机场。" : "任务已结束，但机场校验未通过，本次没有奖励。",
    phase: "completed"
  });
  if (grossIncome > 0) {
    recordFundTransaction({
      amount: grossIncome,
      type: "mission-income",
      title: "任务收入",
      detail: mission.title,
      referenceId: mission.id
    });
  }
  if (fuelCost > 0) {
    recordFundTransaction({
      amount: -fuelCost,
      type: "fuel-expense",
      title: "任务燃油支出",
      detail: `${mission.title} · ${formatFuel(fuelUsedKg)}`,
      referenceId: mission.id
    });
  }
  state.reputation += repGain;
  state.stats.completedMissions += 1;
  if (!actualLog) {
    state.stats.totalHours = +(Number(state.stats.totalHours || 0) + hours).toFixed(2);
    state.stats.totalMiles = +(Number(state.stats.totalMiles || 0) + miles).toFixed(1);
    state.stats.totalLandings = Number(state.stats.totalLandings || 0) + 2;
    state.stats.totalFuelKg = +(Number(state.stats.totalFuelKg || 0) + fuelUsedKg).toFixed(2);
    state.stats.totalFuelCost = +(Number(state.stats.totalFuelCost || 0) + fuelCost).toFixed(2);
  }
  if (fuelEndKg !== null) {
    aircraft.lastFuelKg = +fuelEndKg.toFixed(2);
    aircraft.lastFuelAt = Date.now();
  }
  const completedArrivalAirport = normalizeBaseCode(actual.arrivalAirport || actual.landingAirport || mission.destination || mission.origin);
  if (completedArrivalAirport) {
    aircraft.lastLandingAirport = completedArrivalAirport;
  }
  const sopNotes = sopEnabled
    ? `SOP 得分 ${Math.round(sopScore)}/100，奖励按 ${Math.round(sopMultiplier * 100)}% 结算，声望按 ${Math.round(repMultiplier * 100)}% 结算。${missionSop.deductions?.length ? `扣分原因：${missionSop.deductions.map((item) => `${item.title}(-${item.points})`).join("、")}。` : ""}`
    : "";
  const settlementNotes = `${actual.notes || "已通过 MSFS 实际飞行校验。"} ${sopNotes} ${fuelUsedKg > 0 ? `任务累计燃油消耗 ${formatFuel(fuelUsedKg)}，成本 ${formatMoney(fuelCost)}。` : ""}${isPackagedScene(scene) ? `现场对象：${scene.objectTitle}。` : ""}${rewardEligible ? "" : " 机场不一致，无奖励。"}`;
  if (actualLog) {
    actualLog.taskTitle = mission.title;
    actualLog.departureAirport = normalizeBaseCode(actual.departureAirport || actualLog.departureAirport || mission.origin);
    actualLog.arrivalAirport = normalizeBaseCode(actual.arrivalAirport || actualLog.arrivalAirport || mission.destination || mission.origin);
    actualLog.from = actualLog.departureAirport || actualLog.from;
    actualLog.to = actualLog.arrivalAirport || actualLog.to;
    actualLog.airportCheck = rewardEligible ? "passed" : "failed";
    actualLog.income = income;
    actualLog.grossIncome = grossIncome;
    actualLog.taskFuelUsedKg = +fuelUsedKg.toFixed(2);
    actualLog.taskFuelCost = fuelCost;
    actualLog.rewardEligible = rewardEligible;
    actualLog.manualCompletion = manualCompletion;
    actualLog.sopEnabled = sopEnabled;
    actualLog.sopScore = sopScore;
    actualLog.sopMultiplier = sopMultiplier;
    actualLog.sopDeductions = missionSop.deductions || [];
    actualLog.sopReport = sopReport;
    actualLog.settledAt = Date.now();
    if (landingRateFpm !== null) actualLog.landingRateFpm = landingRateFpm;
    if (landingPeakG !== null) actualLog.landingPeakG = landingPeakG;
    if (landingWear !== null) actualLog.landingWearPercent = landingWear;
    if (actual.landingAirport) actualLog.landingAirport = actual.landingAirport;
    if (actual.landingRunway) actualLog.landingRunway = actual.landingRunway;
    if (landingReportAt !== null) actualLog.landingReportAt = landingReportAt;
    actualLog.notes = `${actualLog.notes || ""} ${settlementNotes}`.trim();
  } else {
    state.logs.unshift({
      id: cryptoId("log"),
      source: "mission",
      missionId: mission.id,
      taskTitle: mission.title,
      date: Date.now(),
      from: mission.origin || mission.title.split(" → ")[0],
      to: mission.destination || mission.site?.base || mission.title.split(" → ")[1],
      aircraftId: aircraft.id,
      aircraftName: aircraft.name,
      hours,
      miles,
      income,
      grossIncome,
      fuelStartKg,
      fuelEndKg,
      fuelUsedKg: +fuelUsedKg.toFixed(2),
      fuelCost,
      landingRateFpm,
      landingPeakG,
      landingWearPercent: landingWear,
      landingAirport: String(actual.landingAirport || actual.arrivalAirport || ""),
      landingRunway: String(actual.landingRunway || ""),
      landingReportAt,
      rewardEligible,
      manualCompletion,
      sopEnabled,
      sopScore,
      sopMultiplier,
      sopDeductions: missionSop.deductions || [],
      sopReport,
      notes: settlementNotes
    });
  }
  if (typeof refreshMissionFromAircraft === "function") refreshMissionFromAircraft(aircraft);
  if (assessmentPassed) {
    toast(`考核通过：已取得 ${mission.aircraftHint} 机型执照`);
  } else if (mission.kind === "license-assessment") {
    const license = aircraftLicense(mission.licenseAssessmentId);
    const retry = license && !hasAircraftLicense(license.id) && !activeLicenseAssessment(license.id)
      ? createLicenseAssessmentMission(license)
      : null;
    if (retry) state.missions.unshift(retry);
    toast("考核未通过，请按指定机场重新完成考核");
  } else {
    toast(rewardEligible
      ? `结算完成：净收入 ${formatMoney(income)}，实际燃油 ${formatFuel(fuelUsedKg)}`
      : `任务无奖励，实际燃油成本 ${formatMoney(fuelCost)}`);
  }
  maybeAutoUnlockAircraft();
  maybeAutoCreateMission();
  renderAll();
}

async function manualCompleteMission(id) {
  const mission = state.missions.find((item) => item.id === id);
  if (!mission || mission.status !== "accepted" || endingMissionIds.has(id)) return;
  const aircraft = missionAircraft(mission);
  const verification = mission.verification || {};
  const sample = lastTelemetryConnected ? lastTelemetry : null;
  if (sample && sample.onGround !== undefined && sample.onGround !== null && !telemetryBoolean(sample.onGround)) {
    toast("检测到飞机仍在空中，落地后才能手动完成任务");
    return;
  }

  const expectedArrival = normalizeBaseCode(mission.destination || mission.origin);
  const observedAirport = normalizeBaseCode(sample ? telemetryAirport(sample)?.airport?.icao : "");
  const arrivalAirport = observedAirport
    || normalizeBaseCode(verification.arrivalAirport)
    || normalizeBaseCode(aircraft?.lastLandingAirport)
    || expectedArrival;
  const departureAirport = normalizeBaseCode(verification.departureAirport || mission.origin);
  const departureMatches = departureAirport === normalizeBaseCode(mission.origin);
  const arrivalMatches = arrivalAirport === expectedArrival;
  const rewardEligible = departureMatches && arrivalMatches;
  const confirmation = rewardEligible
    ? `确定手动完成“${mission.title}”吗？系统将使用当前航迹、燃油和接地数据进行结算。`
    : `当前识别到出发 ${departureAirport || "未知"}、到达 ${arrivalAirport || "未知"}，与任务要求不一致。仍要手动结束任务吗？本次不会获得奖励。`;
  if (!await showConfirmDialog(confirmation)) return;

  const departedAt = Number(verification.departedAt) || 0;
  const hours = departedAt > 0
    ? Math.max(0.1, +((Date.now() - departedAt) / 3600000).toFixed(2))
    : Math.max(0.1, Number(mission.duration) || 0.1);
  const landingReportAt = Number(aircraft?.lastLandingReportAt) || null;
  endingMissionIds.add(id);
  try {
    writeBackup(`手动完成任务前：${mission.title}`);
    await fetch("/api/simulator/scene", { method: "DELETE" }).catch(() => {});
    await fetch("/api/simulator/flight-plan", { method: "DELETE" }).catch(() => {});
    completeMission(id, {
      hours,
      miles: Math.max(0, Number(verification.flightDistanceNm) || 0),
      departureAirport,
      arrivalAirport,
      rewardEligible,
      fuelStartKg: verification.fuelStartKg,
      fuelEndKg: sample ? telemetryFuelKg(sample) : verification.fuelCurrentKg,
      fuelUsedKg: verification.fuelUsedKg,
      landingRateFpm: Number.isFinite(Number(aircraft?.lastLandingRateFpm)) ? Number(aircraft.lastLandingRateFpm) : null,
      landingPeakG: Number.isFinite(Number(aircraft?.lastLandingPeakG)) ? Number(aircraft.lastLandingPeakG) : null,
      landingWearPercent: Number.isFinite(Number(aircraft?.lastLandingWearPercent)) ? Number(aircraft.lastLandingWearPercent) : null,
      landingAirport: arrivalAirport,
      landingRunway: String(aircraft?.lastLandingRunway || ""),
      landingReportAt,
      manualCompletion: true,
      notes: `用户在落地后手动完成任务：出发 ${departureAirport || "未知"}，到达 ${arrivalAirport || "未知"}。`
    });
  } finally {
    endingMissionIds.delete(id);
  }
}

function activeVerifiedMission() {
  return state.missions.find((mission) => mission.status === "accepted" && mission.verification);
}

function telemetryAirport(sample) {
  const mission = activeVerifiedMission();
  const missionAirports = [airportByIcao(mission?.origin), airportByIcao(mission?.destination)].filter(Boolean);
  if (missionAirports.length && Number.isFinite(Number(sample?.latitude)) && Number.isFinite(Number(sample?.longitude))) {
    const point = { lat: Number(sample.latitude), lon: Number(sample.longitude) };
    const nearbyMissionAirport = missionAirports
      .map((airport) => ({ airport, distance: distanceNm(point, airport) }))
      .filter((item) => item.distance <= 4)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearbyMissionAirport) return nearbyMissionAirport;
  }
  const nearby = nearestKnownAirport(Number(sample?.latitude), Number(sample?.longitude));
  if (nearby) return nearby;
  const reported = String(sample?.runwayAirport || "").toUpperCase();
  return airportByIcao(reported) ? { airport: airportByIcao(reported), distance: Number.POSITIVE_INFINITY } : null;
}

function applySceneBridgeStatus(mission, status) {
  if (!mission?.verification || (status.missionId && status.missionId !== mission.id)) return;
  const verification = mission.verification;
  if (status.state === "created") {
    verification.sceneState = "created";
    verification.sceneDetail = status.smokeCreated
      ? `${missionScene(mission).objectTitle} 与任务烟雾已生成，对象编号 ${status.objectId} / ${status.smokeObjectId}`
      : `${missionScene(mission).objectTitle} 已生成，MSFS 对象编号 ${status.objectId}`;
    verification.sceneObjectId = status.objectId;
    verification.sceneSmokeObjectId = status.smokeObjectId || null;
  } else if (status.state === "error") {
    verification.sceneState = "error";
    verification.sceneRetryAt = Date.now() + 30_000;
    verification.sceneDetail = Number(status.exception) === 22
      ? "MSFS 未加载任务对象或烟雾包，请重启 MSFS 后软件会自动重试"
      : `对象生成失败：${status.message || "SimConnect 未确认对象"}`;
  } else if (status.state === "connecting") {
    verification.sceneState = "connecting";
    verification.sceneDetail = "正在连接 MSFS 场景桥";
  } else if (status.state === "waiting") {
    verification.sceneState = "waiting";
    verification.sceneRetryAt = Date.now() + Math.max(500, Number(status.retryAfterMs) || 2000);
    verification.sceneDetail = status.message || "正在等待 MSFS 连接稳定";
  } else {
    verification.sceneState = "creating";
    verification.sceneDetail = "正在任务坐标生成场景对象";
  }
  saveState();
}

async function syncMissionScene(mission, sample) {
  const scene = missionScene(mission);
  if (!mission.site || !isPackagedScene(scene) || !mission.verification) return;
  const currentPoint = { lat: Number(sample?.latitude), lon: Number(sample?.longitude) };
  if (!Number.isFinite(currentPoint.lat) || !Number.isFinite(currentPoint.lon)) return;
  const proximityNm = distanceNm(currentPoint, mission.site);
  mission.verification.sceneDistanceNm = proximityNm;
  if (proximityNm > Math.max(12, Number(scene.radiusNm || 0) * 2)) {
    if (mission.verification.sceneState !== "created") {
      mission.verification.sceneState = "waiting";
      mission.verification.sceneDetail = `距离任务现场 ${proximityNm.toFixed(1)} nm，进入 12 nm 范围后自动生成`;
    }
    return;
  }
  if (sceneSyncPromise) return;
  sceneSyncPromise = (async () => {
    const verification = mission.verification;
    if (["connecting", "creating", "created"].includes(verification.sceneState)) {
      const response = await fetch("/api/simulator/scene", { cache: "no-store" });
      if (!response.ok) throw new Error("Scene bridge status unavailable");
      const status = await response.json();
      if (status.state !== "idle") {
        applySceneBridgeStatus(mission, status);
        return;
      }
      verification.sceneState = "waiting";
      verification.sceneDetail = "场景桥已重启，正在恢复任务现场与烟雾";
    }
    if (["error", "waiting"].includes(verification.sceneState)
        && Date.now() < Number(verification.sceneRetryAt || 0)) return;
    verification.sceneState = "connecting";
    verification.sceneDetail = "正在连接 MSFS 场景桥";
    const response = await fetch("/api/simulator/scene", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        missionId: mission.id,
        objectTitle: scene.objectTitle,
        smokeTitle: missionSmokeTitle(scene),
        latitude: mission.site.lat,
        longitude: mission.site.lon,
        altitudeFt: 0,
        headingDeg: mission.site.bearing || 0
      })
    });
    applySceneBridgeStatus(mission, await response.json());
  })().catch(() => {
    mission.verification.sceneState = "error";
    mission.verification.sceneRetryAt = Date.now() + 30_000;
    mission.verification.sceneDetail = "场景桥暂时不可用，软件将在 30 秒后重试";
  }).finally(() => { sceneSyncPromise = null; });
  await sceneSyncPromise;
}

function processTelemetry(sample, landing, simulatorFlightAtLanding = state.simulatorFlight) {
  const mission = activeVerifiedMission();
  if (!mission || !sample) return;
  const verification = mission.verification;
  let aircraft = missionAircraft(mission);
  const airport = telemetryAirport(sample);
  const currentPoint = { lat: Number(sample.latitude), lon: Number(sample.longitude) };
  const sampleTimestamp = Date.parse(sample.timestamp || "");
  const onGround = telemetryBoolean(sample.onGround);
  void syncMissionScene(mission, sample);

  if (verification.teleportLocked && verification.teleportReason !== "slew") {
    verification.teleportLocked = false;
    verification.teleportReason = "";
    verification.teleportDistanceNm = 0;
    verification.teleportElapsedSec = 0;
  }

  if (verification.teleportLocked) {
    const resetAtBase = onGround
      && airport?.airport.icao === mission.origin
      && Number(sample.groundSpeedKt || 0) <= 30;
    if (resetAtBase) {
      verification.teleportLocked = false;
      verification.teleportReason = "";
      verification.teleportDistanceNm = 0;
      verification.teleportElapsedSec = 0;
      verification.flightDistanceNm = 0;
      verification.departedAt = null;
      verification.lastPoint = currentPoint;
      verification.lastTelemetryTimestamp = Number.isFinite(sampleTimestamp) ? sampleTimestamp : "";
      setMissionStatus(mission, {
        phase: "briefed",
        label: "快速位移锁定已清除",
        detail: `已回到 ${mission.origin}，请从基地重新起飞。`,
        voiceKey: "teleport-reset",
        voiceText: "快速位移锁定已清除，请从基地重新起飞。"
      });
    } else {
      setMissionStatus(mission, {
        phase: verification.phase,
        label: "检测到快速位移模式",
        detail: `MSFS 报告 SLEW/快速位移模式，任务已暂停。请回到 ${mission.origin} 地面并重新起飞。`,
        voiceKey: "teleport-locked",
        voiceText: `检测到快速位移模式，任务已暂停。请回到${mission.origin}地面并重新起飞。`
      });
      saveState();
      renderMissions();
      renderLogs();
      wireIcons();
      return;
    }
  }

  const movement = assessTelemetryMovement(
    verification.lastPoint,
    currentPoint,
    verification.lastTelemetryTimestamp,
    sampleTimestamp,
    sample
  );
  const activeSlew = movement.kind === "slew" && verification.phase !== "briefed";
  if (activeSlew) {
      verification.teleportLocked = true;
      verification.teleportReason = "slew";
      verification.teleportDistanceNm = movement.stepNm;
      verification.teleportElapsedSec = movement.elapsedSec;
      setMissionStatus(mission, {
        phase: verification.phase,
        label: "检测到快速位移模式",
        detail: "检测到模拟器 SLEW/快速位移模式，任务已暂停。",
        voiceKey: "teleport-locked",
        voiceText: "检测到模拟器快速位移模式，任务已暂停。请关闭该模式并回到基地重新起飞。"
      });
      verification.lastPoint = currentPoint;
      verification.lastTelemetryTimestamp = Number.isFinite(sampleTimestamp) ? sampleTimestamp : "";
      saveState();
      renderMissions();
      renderLogs();
      wireIcons();
      return;
  }
  if (movement.kind === "jump") {
    verification.ignoredTelemetryJumps = Number(verification.ignoredTelemetryJumps || 0) + 1;
  } else if (movement.kind === "normal") {
    verification.flightDistanceNm = accumulateFlightDistance(verification.flightDistanceNm, movement.stepNm);
  }
  verification.lastPoint = currentPoint;
  verification.lastTelemetryTimestamp = Number.isFinite(sampleTimestamp) ? sampleTimestamp : verification.lastTelemetryTimestamp || "";
  verification.actualAircraft = telemetryAircraftLabel(sample) || "";
  if (!verification.actualAircraft && !isFreeMode()) {
    setMissionStatus(mission, {
      phase: verification.phase,
      label: "正在识别机型",
      detail: `SimConnect 已连接，正在读取任务机型 ${aircraft.name} 的 TITLE / ATC MODEL。`
    });
    saveState();
    renderLogs();
    return;
  }
  const detectedMissionAircraft = isFreeMode()
    ? (state.fleet.find((item) => !isCompanyAircraft(item) && telemetryMatchesAircraft(sample, item)) || aircraft)
    : telemetryMissionAircraft(sample, mission);
  if (!detectedMissionAircraft) {
    const permittedNames = missionPermittedAircraft(mission).map((item) => item.name).join(" / ") || aircraft.name;
    setMissionStatus(mission, {
      phase: verification.phase,
      label: "机型不匹配",
      detail: `检测到 ${verification.actualAircraft}，任务支持 ${permittedNames}`,
      voiceKey: "aircraft-mismatch",
      voiceText: `任务机型不匹配。当前检测到${verification.actualAircraft}，请切换到任务支持的机型。`
    });
    saveState();
    renderLogs();
    return;
  }
  if (verification.aircraftId !== detectedMissionAircraft.id) {
    verification.aircraftId = detectedMissionAircraft.id;
    verification.aircraftName = detectedMissionAircraft.name;
  }
  aircraft = detectedMissionAircraft;
  updateMissionFuel(verification, sample);
  const landingFlight = normalizeSimulatorFlight(simulatorFlightAtLanding);
  // The mission departure is the authoritative lower bound for its landing
  // report. The generic simulator flight can be restarted after touchdown
  // (or restored without a mission id), which must not invalidate this task's
  // already-recorded landing.
  const missionDepartedAt = Number(verification.departedAt);
  const activeFlightDepartedAt = landingFlight.active && landingFlight.aircraftId === aircraft.id
    ? Number(landingFlight.departedAt)
    : 0;
  const landingDepartedAt = Number.isFinite(missionDepartedAt) && missionDepartedAt > 0
    ? missionDepartedAt
    : activeFlightDepartedAt;
  const expectedLandingAirport = verification.phase === "returning"
    ? mission.origin
    : mission.destination || "";
  const careerLanding = !isFreeMode()
    && landingReportMatchesTouchdown(
      landing,
      sample,
      aircraft,
      landingDepartedAt,
      12 * 60 * 60_000,
      expectedLandingAirport
    )
    ? landing
    : null;
  const careerLandingActual = landingReportActual(careerLanding, aircraft);
  const sop = evaluateSopTelemetry(mission, sample, aircraft, { landing: careerLanding });
  const sopCanComplete = !isSopMode() || sop?.shutdownConfirmed === true;
  if (sample.engineRunning !== undefined && sample.engineRunning !== null) {
    const engineRunning = telemetryBoolean(sample.engineRunning);
    const phaseAllowsEngineNotice = !["target-confirmed", "returning", "completed"].includes(verification.phase);
    const shouldAnnounceEngineStart = engineRunning
      && !verification.engineStartAnnounced
      && phaseAllowsEngineNotice;
    if (shouldAnnounceEngineStart) {
      recordTaskEvent(mission, {
        key: "engine-started",
        title: "发动机启动",
        detail: `已检测到 ${aircraft.name} 发动机运行，等待确认起飞机场。`,
        voiceText: "发动机已启动，请确认起飞机场。",
        phase: verification.phase
      });
      verification.engineStartAnnounced = true;
    }
    verification.engineRunning = engineRunning;
  }
  const beginOutbound = (departureAirport) => {
    verification.departedAt = Date.now();
    verification.departureAirport = departureAirport || verification.departureAirport || null;
    // Start the outbound meter at the actual takeoff sample. Taxiing and parking
    // movement must not count toward reaching the mission site.
    verification.flightDistanceNm = 0;
    verification.outboundStartPoint = currentPoint;
    verification.lastPoint = currentPoint;
    setMissionStatus(mission, {
      phase: "outbound",
      label: "前往任务点",
      detail: `已从 ${verification.departureAirport || "未知机场"} 离地，飞往 ${mission.destination || "任务现场"}。`,
      voiceKey: "departed",
      voiceText: `已从${verification.departureAirport || "当前机场"}起飞，正在前往任务点。`,
      eventKey: "takeoff",
      eventTitle: "起飞"
    });
  };
  if (verification.phase === "briefed") {
    if (isFreeMode()) {
      const departed = !onGround && Number(sample.groundSpeedKt || 0) >= 20;
      if (departed) beginOutbound(airport?.airport?.icao || verification.departureAirport || mission.origin);
      else setMissionStatus(mission, {
        phase: "briefed",
        label: "自由模式待起飞",
        detail: `自由模式：不限机型和执照，使用 ${aircraft.name} 执行任务。`
      });
      if (!departed) {
        saveState();
        renderMissions();
        renderLogs();
        wireIcons();
        return;
      }
    }
    else if (onGround && airport?.airport.icao === mission.origin) {
      verification.departureAirport = airport.airport.icao;
      setMissionStatus(mission, {
        phase: "origin-confirmed",
        label: "出发机场已确认",
        detail: `已在 ${mission.origin} 地面确认，等待离地。`,
        voiceKey: "origin-confirmed",
        voiceText: `已确认${mission.origin}为起飞机场，可以起飞。`,
        eventKey: "origin-confirmed",
        eventTitle: "确认起飞机场"
      });
    } else if (onGround && airport?.airport.icao) {
      verification.departureAirport = airport.airport.icao;
      setMissionStatus(mission, {
        phase: "briefed",
        label: "起飞机场不一致",
        detail: `当前位于 ${airport.airport.icao}，任务要求 ${mission.origin}。允许继续飞行，但机场不一致将无法获得奖励。`,
        voiceKey: `wrong-origin-${airport.airport.icao}`,
        voiceText: `起飞机场不一致。当前是${airport.airport.icao}，任务要求${mission.origin}。继续飞行将没有奖励。`,
        eventKey: "departure-mismatch",
        eventTitle: "起飞机场不一致"
      });
    } else if (!onGround && Number(sample.groundSpeedKt) >= 35 && verification.departureAirport) {
      beginOutbound(verification.departureAirport);
    } else {
      setMissionStatus(mission, {
        phase: "briefed",
        label: "等待起飞",
        detail: `请将 ${aircraft.name} 停放在 ${mission.origin} 后起飞。`
      });
    }
  } else if (verification.phase === "origin-confirmed" && !onGround && Number(sample.groundSpeedKt) >= 35) {
    beginOutbound(verification.departureAirport || mission.origin);
  } else if (verification.phase === "outbound" || verification.phase === "airborne") {
    if (verification.phase === "airborne") verification.phase = "outbound";
    const target = mission.destination || "任务现场";
    const isSceneMission = Boolean(mission.site && !mission.destination);
    const arrivalRule = missionArrivalRule(mission);
    const targetRadius = arrivalRule.radiusNm;
    const targetDistance = isSceneMission ? distanceNm(currentPoint, mission.site) : null;

    if (mission.destination) {
      const arrivedAtAirport = isFreeMode()
        ? Boolean(airport?.airport?.icao === mission.destination)
        : onGround
        && Number(sample.groundSpeedKt || 0) <= 5
        && Boolean(airport?.airport?.icao)
        && Boolean(careerLanding)
        && sopCanComplete;
      if (arrivedAtAirport) {
        verification.arrivalAirport = airport.airport.icao;
        const departureMatches = normalizeBaseCode(verification.departureAirport) === normalizeBaseCode(mission.origin);
        const arrivalMatches = normalizeBaseCode(verification.arrivalAirport) === normalizeBaseCode(mission.destination);
        const rewardEligible = departureMatches && arrivalMatches;
        const flightHours = Math.max(0.1, +((Date.now() - verification.departedAt) / 3600000).toFixed(2));
        completeMission(mission.id, {
          hours: flightHours,
          miles: verification.flightDistanceNm,
          departureAirport: verification.departureAirport,
          arrivalAirport: verification.arrivalAirport,
          rewardEligible,
          ...careerLandingActual,
          notes: `MSFS 校验：出发 ${verification.departureAirport || "未知"}，已在 ${verification.arrivalAirport} 落地。`
        });
        return;
      } else {
        setMissionStatus(mission, {
          phase: "outbound",
          label: !isFreeMode() && onGround && Number(sample.groundSpeedKt || 0) <= 5 ? "正在确认着陆" : "前往目的机场",
          detail: !isFreeMode() && onGround && Number(sample.groundSpeedKt || 0) <= 5
            ? Boolean(careerLanding) && isSopMode() && !sopCanComplete
              ? sopCompletionPrompt(sop, sample)
              : "已检测到飞机接地，正在等待本次接地率和跑道数据。"
            : `实际航迹 ${Math.round(verification.flightDistanceNm || 0)} nm，目标 ${mission.destination}。到达后落地并关闭发动机。`
        });
      }
    } else {
      setMissionStatus(mission, {
        phase: "outbound",
        label: "前往任务点",
        detail: `实际航迹 ${Math.round(verification.flightDistanceNm || 0)} nm，距任务点 ${targetDistance.toFixed(1)} nm。`
      });
      const sceneArrivalMode = missionArrivalMode(mission);
      const minimumOutboundDistance = Math.max(5, Number(mission.distance || mission.site?.distanceNm || 0) - targetRadius);
      const enoughDistance = Number(verification.flightDistanceNm || 0) >= minimumOutboundDistance;
      const stationaryAtLandingSite = !isFreeMode() && sceneArrivalMode === "landing"
        && targetDistance <= targetRadius
        && onGround
        && Number(sample.groundSpeedKt || 0) <= arrivalRule.speedLimitKt
        && Boolean(careerLanding);
      let targetReached = false;
      if (sceneArrivalMode === "landing") {
        if (stationaryAtLandingSite) {
          verification.landingDwellStartedAt ||= Date.now();
          verification.landingDwellSeconds = Math.max(0, Math.floor((Date.now() - verification.landingDwellStartedAt) / 1000));
          if (verification.landingDwellSeconds < arrivalRule.dwellSeconds) {
            setMissionStatus(mission, {
              phase: "outbound",
              label: "任务点停留中",
              detail: `已在任务点 ${targetRadius} nm 内停稳，停留 ${verification.landingDwellSeconds} / ${arrivalRule.dwellSeconds} 秒。`
            });
          } else {
            targetReached = enoughDistance;
            if (!enoughDistance) {
              setMissionStatus(mission, {
                phase: "outbound",
                label: "等待有效航迹",
                detail: `已在任务点停稳，但有效航迹仅 ${Math.round(verification.flightDistanceNm || 0)} nm，还需达到 ${Math.round(minimumOutboundDistance)} nm。`
              });
            }
          }
        } else {
          verification.landingDwellStartedAt = null;
          verification.landingDwellSeconds = 0;
          if (!isFreeMode()
            && targetDistance <= targetRadius
            && onGround
            && Number(sample.groundSpeedKt || 0) <= arrivalRule.speedLimitKt) {
            setMissionStatus(mission, {
              phase: "outbound",
              label: "正在确认任务点着陆",
              detail: "已检测到飞机在任务点接地，正在等待本次接地数据。"
            });
          }
        }
      } else if (!isFreeMode()) {
        targetReached = targetDistance <= targetRadius
          && !onGround
          && Number(sample.groundSpeedKt || 0) <= arrivalRule.speedLimitKt
          && Number(sample.radioAltitudeFt || 0) <= 800;
      }

      // Scene tasks must cover nearly the full base-to-site distance before
      // the target radius can trigger. This blocks early confirmation from
      // stale coordinates or a short takeoff.
      if ((isFreeMode() && targetDistance <= targetRadius) || (targetReached && enoughDistance)) {
        const requiresLanding = !isFreeMode() && sceneArrivalMode === "landing";
        verification.targetLandingConfirmed = requiresLanding;
        setMissionStatus(mission, {
          phase: "target-confirmed",
          label: requiresLanding ? "任务点已落地确认" : "任务点已确认",
          detail: requiresLanding
            ? `已在 ${target} 安全落地并停稳，请完成现场作业后再次起飞返航。`
            : `已到达 ${target}，请完成目标后返回 ${mission.origin}。`,
          voiceKey: "target-confirmed",
          voiceText: requiresLanding
            ? "已在任务点安全落地，任务目标已确认。完成现场作业后，请再次起飞返航。"
            : `已到达任务点，任务目标已确认，请返回${mission.origin}。`,
          eventKey: "target-confirmed",
          eventTitle: requiresLanding ? "任务点落地确认" : "到达任务点，请返回机场"
        });
      }
    }
  } else if (verification.phase === "airport-arrived") {
    const arrivedAtAirport = isFreeMode()
      ? Boolean(airport?.airport?.icao === mission.destination)
      : onGround
      && Number(sample.groundSpeedKt || 0) <= 5
      && Boolean(airport?.airport?.icao)
      && Boolean(careerLanding)
      && sopCanComplete;
    if (arrivedAtAirport) {
      verification.arrivalAirport = airport.airport.icao;
      const rewardEligible = normalizeBaseCode(verification.departureAirport) === normalizeBaseCode(mission.origin)
        && normalizeBaseCode(verification.arrivalAirport) === normalizeBaseCode(mission.destination);
      const flightHours = Math.max(0.1, +((Date.now() - verification.departedAt) / 3600000).toFixed(2));
      completeMission(mission.id, {
        hours: flightHours,
        miles: verification.flightDistanceNm,
        departureAirport: verification.departureAirport,
        arrivalAirport: verification.arrivalAirport,
        rewardEligible,
        ...careerLandingActual,
        notes: `MSFS 校验：出发 ${verification.departureAirport || "未知"}，已在 ${verification.arrivalAirport} 落地。`
      });
      return;
    } else if (!onGround) {
      setMissionStatus(mission, {
        phase: "outbound",
        label: "前往目的机场",
        detail: `已离开 ${verification.arrivalAirport || "机场"}，请在 ${mission.destination} 落地。`
      });
    }
  } else if (verification.phase === "target-confirmed") {
    const readyToReturn = isFreeMode() || hasDepartedTaskSite(onGround, sample.groundSpeedKt);
    if (readyToReturn) {
      setMissionStatus(mission, {
        phase: "returning",
        label: "返航中",
        detail: `任务点已确认，请返回 ${mission.origin} 并落地。`,
        voiceKey: "returning",
        voiceText: `任务点已确认，请返航${mission.origin}。`,
        eventKey: "returning",
        eventTitle: "返航"
      });
    } else {
      setMissionStatus(mission, {
        phase: "target-confirmed",
        label: "现场作业中，等待返航起飞",
        detail: `任务点落地已确认。完成现场作业后再次起飞，系统才会发布返回 ${mission.origin} 的指令。`
      });
    }
  } else if (verification.phase === "returning") {
    const landedAtBase = isFreeMode()
      ? Boolean(airport?.airport?.icao === mission.origin)
      : onGround
      && airport?.airport.icao === mission.origin
      && Number(sample.groundSpeedKt || 0) <= 30
      && Boolean(careerLanding)
      && sopCanComplete;
    if (landedAtBase) {
      const flightHours = Math.max(0.1, +((Date.now() - verification.departedAt) / 3600000).toFixed(2));
      completeMission(mission.id, {
        hours: flightHours,
        miles: verification.flightDistanceNm,
        departureAirport: verification.departureAirport || mission.origin,
        arrivalAirport: mission.origin,
        rewardEligible: (verification.departureAirport || mission.origin) === mission.origin,
        ...careerLandingActual,
        notes: `MSFS 校验通过：已从 ${mission.origin} 起飞，抵达${mission.destination || "任务现场"}并返回基地${careerLanding?.runway ? `，跑道 ${careerLanding.runway}` : ""}。`
      });
      return;
    }
    setMissionStatus(mission, {
      phase: "returning",
      label: !isFreeMode() && onGround && airport?.airport.icao === mission.origin ? "正在确认着陆" : "返航中",
      detail: !isFreeMode() && onGround && airport?.airport.icao === mission.origin
        ? Boolean(careerLanding) && isSopMode() && !sopCanComplete
          ? sopCompletionPrompt(sop, sample)
          : "已检测到飞机返回基地接地，正在等待本次接地率和跑道数据。"
        : airport?.airport.icao && airport.airport.icao !== mission.origin
        ? `当前位于 ${airport.airport.icao}，请返回 ${mission.origin} 并落地。`
        : `请返回 ${mission.origin}，落地并将速度降到地面状态。`
    });
  }
  saveState();
  renderMissions();
  renderLogs();
  wireIcons();
}

async function pollSimulator() {
  try {
    const response = await fetch("/api/simulator/status", { cache: "no-store" });
    if (!response.ok) throw new Error("status unavailable");
    const payload = await response.json();
    lastSimulatorPayload = payload;
    lastTelemetry = payload.sample || null;
    lastTelemetryConnected = payload.connected;
    updateMonitor(payload);
    const fleetAircraft = payload.connected ? syncFleetTelemetry(payload.sample) : null;
    if (payload.connected && fleetAircraft) updateSimulatorFlight(payload.sample, fleetAircraft);
    const simulatorFlightAtLanding = normalizeSimulatorFlight(state.simulatorFlight);
    const landingWear = payload.connected && !isFreeMode() ? syncFleetLandingWear(payload.landing) : null;
    const crashLog = landingWear && isCrashLanding(landingWear)
      ? handleAircraftCrash(landingWear, payload.landing, payload.sample)
      : null;
    const actualFlightLog = landingWear && !crashLog
      ? finalizeSimulatorFlight(landingWear, payload.landing, payload.sample)
      : null;
    if (landingWear) {
      saveState();
      renderLogs();
      renderProfile();
      renderCompanyManagement();
      wireIcons();
      toast(crashLog
        ? `${landingWear.aircraft.name} 接地峰值 ${Number(landingWear.peakG).toFixed(2)}G，判定坠机，飞机已从机库删除`
        : actualFlightLog
        ? `${landingWear.aircraft.name} 实际飞行已记录，落地 ${landingWear.landingRateFpm} fpm，机况损耗 ${landingWear.wearPercent}%`
        : `${landingWear.aircraft.name} 落地 ${landingWear.landingRateFpm} fpm，机况损耗 ${landingWear.wearPercent}%`);
    }
    const bridgeFailed = !payload.connected && !payload.bridgeRunning && (payload.bridgeError || payload.bridgeExit);
    els.simulatorStatus.textContent = payload.connected ? "已连接" : bridgeFailed ? "连接失败" : payload.bridgeRunning ? "等待 MSFS" : "未连接";
    els.simulatorStatus.className = `tag ${payload.connected ? "good" : bridgeFailed ? "bad" : "warn"}`;
    els.simulatorAircraft.textContent = payload.connected
      ? (payload.sample.aircraftTitle || payload.sample.aircraftModel || "已连接 MSFS")
      : bridgeFailed ? (payload.bridgeError?.message || payload.bridgeExit?.message || "遥测桥启动失败") : "等待 Microsoft Flight Simulator";
    const airport = telemetryAirport(payload.sample);
    const heading = payload.sample ? aircraftHeading(payload.sample, telemetryMapPoint(payload.sample) || { lat: 0, lon: 0 }) : null;
    const displaySpeed = aircraftDisplaySpeed(payload.sample);
    els.simulatorPosition.textContent = payload.connected ? `${airport?.airport.icao || "空中"} · ${displaySpeed.label} ${Math.round(displaySpeed.value)} kt · 航向 ${String(Math.round(heading ?? 0)).padStart(3, "0")}° · ${payload.sample.onGround ? "地面" : "飞行中"}` : "未检测到飞行数据";
    const fuelKg = telemetryFuelKg(payload.sample);
    els.simulatorFuel.textContent = payload.connected && fuelKg !== null
      ? `实际燃油：${formatFuel(fuelKg)}${fleetAircraft ? ` · ${fleetAircraft.name}` : " · 未匹配机库"}`
      : "实际燃油：等待遥测";
    if (payload.connected && fleetAircraft && Date.now() - lastFleetTelemetryPersistAt >= 15_000) {
      lastFleetTelemetryPersistAt = Date.now();
      saveState();
    }
    if (state.activeView === "aircraft-management" && Date.now() - lastAircraftManagementRenderAt >= 2_000) {
      lastAircraftManagementRenderAt = Date.now();
      renderAircraftManagement();
    }
    const mission = activeVerifiedMission();
    if (payload.connected && mission?.verification?.flightPlanState === "waiting") {
      void syncMissionFlightPlan(mission);
    }
    if (mission?.verification?.flightPlanState && !["loaded", "prepared"].includes(mission.verification.flightPlanState)) {
      void pollFlightPlanStatus(mission);
    }
    els.simulatorMissionState.textContent = mission?.verification?.detail || "接受任务后将自动校验真实飞行。";
    const connectButton = document.getElementById("connectSimulatorBtn");
    if (connectButton && !connectButton.disabled) {
      connectButton.querySelector("span").textContent = payload.connected
        ? "已连接 MSFS"
        : payload.bridgeRunning ? "等待 MSFS" : "连接 MSFS";
    }
    if (state.activeView === "map") {
      if (payload.sample) updateLiveAircraftOnMap(payload.sample, payload.connected);
      updateCompanyAircraftOnMap();
    }
    if (payload.connected) {
      simulatorAutoConnectFailures = 0;
      processTelemetry(payload.sample, payload.landing, simulatorFlightAtLanding);
    } else if (mission?.verification) {
      setMissionStatus(mission, {
        phase: mission.verification.phase,
        label: "等待 MSFS 连接",
        detail: payload.bridgeError?.message || payload.bridgeExit?.message || "未连接 MSFS，软件会在检测到模拟器后自动连接。",
        voiceKey: "simulator-disconnected",
        voiceText: "未连接微软模拟飞行，请启动模拟器并连接 MSFS。",
        eventKey: "simulator-disconnected",
        eventTitle: "等待 MSFS 连接"
      });
      saveState();
      renderMissions();
      renderLogs();
      wireIcons();
    }
    renderSopMonitor();
    if (!payload.connected && !payload.bridgeRunning) void ensureSimulatorAutoConnection(payload);
    return payload;
  } catch (error) {
    els.simulatorStatus.textContent = "服务不可用";
    els.simulatorStatus.className = "tag bad";
    els.simulatorFuel.textContent = "实际燃油：服务不可用";
    lastSimulatorPayload = { connected: false, bridgeError: { message: "遥测服务不可用" } };
    updateMonitor(lastSimulatorPayload);
    renderSopMonitor();
    void reportRuntimeLog("error", "读取 MSFS 遥测失败", { error: error?.message || "unknown" });
    return null;
  }
}

let flightPlanStatusPromise = null;

async function pollFlightPlanStatus(mission) {
  if (!mission?.verification || flightPlanStatusPromise) return;
  flightPlanStatusPromise = (async () => {
    try {
      const response = await fetch("/api/simulator/flight-plan", { cache: "no-store" });
      const status = await response.json();
      if (status.missionId !== mission.id) return;
      const nextState = status.state || "connecting";
      const nextDetail = nextState === "loaded"
        ? "任务航路已加载到 MSFS 导航系统，任务点可在机内导航地图查看"
        : nextState === "prepared"
          ? status.message || "任务航路文件已安全生成"
        : nextState === "error"
          ? status.message || "MSFS 拒绝加载任务航路"
          : "正在等待 MSFS 确认任务航路";
      if (mission.verification.flightPlanState === nextState && mission.verification.flightPlanDetail === nextDetail) return;
      mission.verification.flightPlanState = nextState;
      mission.verification.flightPlanDetail = nextDetail;
      saveState();
      renderMissions();
      wireIcons();
    } catch {
      // The simulator bridge may still be starting; the next poll retries.
    }
  })().finally(() => { flightPlanStatusPromise = null; });
  await flightPlanStatusPromise;
}

async function requestSimulatorBridgeStart() {
  if (simulatorStartPromise) return simulatorStartPromise;
  simulatorStartPromise = (async () => {
    const response = await fetch("/api/simulator/start", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      const error = new Error(result.reason || "bridge-start-failed");
      error.result = result;
      throw error;
    }
    return result;
  })().finally(() => { simulatorStartPromise = null; });
  return simulatorStartPromise;
}

async function ensureSimulatorAutoConnection(payload = null) {
  if (payload?.connected || payload?.bridgeRunning || Date.now() < nextSimulatorAutoConnectAt) return false;
  nextSimulatorAutoConnectAt = Date.now() + 10_000;
  try {
    await requestSimulatorBridgeStart();
    simulatorAutoConnectFailures = 0;
    return true;
  } catch {
    simulatorAutoConnectFailures += 1;
    nextSimulatorAutoConnectAt = Date.now() + Math.min(60_000, 10_000 * (2 ** Math.min(3, simulatorAutoConnectFailures)));
    return false;
  }
}

async function connectSimulator() {
  const button = document.getElementById("connectSimulatorBtn");
  if (button?.disabled) return;
  if (button) {
    button.disabled = true;
    button.querySelector("span").textContent = "正在连接...";
  }
  try {
    const result = await requestSimulatorBridgeStart();
    const startMessage = result.reason === "already-connected"
      ? "MSFS 遥测已经连接"
      : ["already-running", "external-running"].includes(result.reason)
        ? "遥测桥正在运行，等待 MSFS"
        : "已启动遥测桥，正在等待 MSFS SimConnect";
    toast(startMessage);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await pollSimulator();
      if (status?.connected) {
        toast("MSFS 已连接");
        return;
      }
      if (status && !status.bridgeRunning && (status.bridgeError || status.bridgeExit)) {
        toast(status.bridgeError?.message || status.bridgeExit?.message || "遥测桥已退出，请确认 MSFS 已启动");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    toast("等待超时：请确认 MSFS 已进入飞行界面，再点击连接 MSFS");
  } catch (error) {
    toast(error?.result?.reason === "bridge-not-found" ? "未找到 MSFS 遥测桥，请重新打包软件" : "无法连接本地服务，请重启软件");
  } finally {
    if (button) {
      button.disabled = false;
      button.querySelector("span").textContent = "连接 MSFS";
    }
  }
}

function maybeAutoCreateMission() {
  autoRefreshMissions({ silent: true });
}

function autoRefreshMissions({ silent = true, rotateExpired = false, forceRefresh = false } = {}) {
  const generationBase = normalizeBaseCode(state?.pilot?.base);
  removeOpenMissionsOutsideBase();
  let added = 0;
  let removed = 0;
  let attempts = 0;

  if (forceRefresh) {
    const refreshableIds = new Set(refreshableMissionOffers().map((mission) => mission.id));
    if (refreshableIds.size) {
      state.missions = state.missions.filter((mission) => !refreshableIds.has(mission.id));
      removed += refreshableIds.size;
    }
  }

  let offers = refreshableMissionOffers();
  const expiredMission = rotateExpired ? oldestExpiredMission(offers) : null;
  if (expiredMission) {
    state.missions = state.missions.filter((mission) => mission.id !== expiredMission.id);
    removed += 1;
    offers = refreshableMissionOffers();
  }

  let emergencyCount = offers.filter(isEmergencyMission).length;
  const hasManagedHelicopter = state.fleet?.some((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented) && isHelicopterAircraft(aircraft)) === true;
  let hasHelicopterEmergency = offers.some(isHelicopterEmergencyMission);
  while ((emergencyCount < MISSION_EMERGENCY_TARGET_COUNT || (hasManagedHelicopter && !hasHelicopterEmergency)) && attempts < MISSION_OFFER_TARGET_COUNT * 2) {
    attempts += 1;
    if (offers.length >= MISSION_OFFER_TARGET_COUNT) {
      const replaceable = offers
        .filter((mission) => !isEmergencyMission(mission))
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
      if (!replaceable) break;
      state.missions = state.missions.filter((mission) => mission.id !== replaceable.id);
      removed += 1;
      offers = refreshableMissionOffers();
    }
    const mission = makeEmergencyMission(
      hasManagedHelicopter && !hasHelicopterEmergency ? "helicopter" : "",
      generationBase
    );
    if (!mission) break;
    state.missions.unshift(mission);
    offers.unshift(mission);
    emergencyCount += 1;
    hasHelicopterEmergency ||= isHelicopterEmergencyMission(mission);
    added += 1;
  }

  attempts = 0;
  // Put the selected aircraft first so a manual refresh immediately produces
  // a mission from its actual last landing airport, even when the fleet has
  // more aircraft than the 50-offer pool can display.
  const selected = currentAircraft();
  const eligibleAircraft = [...missionEligibleAircraft()].sort((a, b) => {
    if (a.id === selected?.id) return -1;
    if (b.id === selected?.id) return 1;
    return 0;
  });
  const coveredAircraftIds = new Set(offers.flatMap((mission) => mission.permittedAircraftIds || []));
  for (const aircraft of eligibleAircraft) {
    if (offers.length >= MISSION_OFFER_TARGET_COUNT || coveredAircraftIds.has(aircraft.id)) continue;
    const categories = compatibleCategories(aircraft);
    const category = randomCategory(categories);
    const mission = makeMission(category, randomSubtype(category), 0, aircraft, generationBase);
    if (!mission) continue;
    mission.permittedAircraftIds = [aircraft.id];
    mission.aircraftHint = aircraft.name;
    state.missions.unshift(mission);
    offers.unshift(mission);
    coveredAircraftIds.add(aircraft.id);
    added += 1;
  }
  while (offers.length < MISSION_OFFER_TARGET_COUNT && attempts < MISSION_OFFER_TARGET_COUNT * 4) {
    attempts += 1;
    const aircraft = pick(eligibleAircraft) || currentAircraft();
    const category = randomCategory(compatibleCategories(aircraft));
    const mission = makeMission(category, randomSubtype(category), 0, aircraft, generationBase);
    if (!mission) continue;
    mission.permittedAircraftIds = [aircraft.id];
    mission.aircraftHint = aircraft.name;
    state.missions.unshift(mission);
    offers.unshift(mission);
    added += 1;
  }
  if (!added && !removed) return 0;
  saveState();
  renderMissions();
  renderProfile();
  wireIcons();
  if (!silent) toast(`任务列表已刷新，当前提供 ${refreshableMissionOffers().length} 个任务`);
  return added;
}

