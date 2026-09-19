// 模飞生涯 渲染器源码 09-sop.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
const SOP_STAGE_POINTS = {
  lighting: 15,
  taxi: 10,
  takeoff: 15,
  cruise: 15,
  landing: 25,
  parking: 10,
  shutdown: 10
};

const SOP_MONITOR_RULES = [
  { id: "lighting", name: "灯光", flag: "lightingConfirmed", points: 15, objective: "启动后灯光配置", requirement: "发动机运行时开启防撞灯；夜间或低能见度运行时同时开启位置灯。", trigger: "发动机已运行且飞机位于地面时开始检查。", telemetry: "发动机、地面状态、防撞灯、位置灯、昼夜状态", deductions: ["防撞灯关闭：扣 5 分", "夜间位置灯关闭：扣 4 分"], penalty: "-5 / -4", codes: ["lighting-beacon", "lighting-nav"] },
  { id: "taxi", name: "滑行", flag: "taxiConfirmed", points: 10, objective: "安全地面移动", requirement: "发动机运行、飞机在地面移动，地速不得超过 35 kt，并保持滑行灯开启；起飞滑跑与降落滑跑不计入滑行速度。", trigger: "首次起飞前，地面速度超过 1 kt 后进入滑行检查。", telemetry: "地面状态、发动机、地速、滑行灯、起飞构型", deductions: ["滑行地速超过 35 kt：扣 6 分", "滑行灯关闭：扣 2 分"], penalty: "-6 / -2", codes: ["taxi-speed", "taxi-light"] },
  { id: "takeoff", name: "起飞", flag: "takeoffConfirmed", points: 15, objective: "跑道进入与离地", requirement: "起飞前完成有效滑行；进入跑道和离地阶段开启着陆灯及频闪灯。", trigger: "飞机离地且地速达到 35 kt 时判定起飞。", telemetry: "地面状态、地速、滑行阶段、着陆灯、频闪灯", deductions: ["未完成滑行即起飞：扣 8 分", "着陆灯关闭：扣 4 分", "频闪灯关闭：扣 3 分"], penalty: "-8 / -4 / -3", codes: ["takeoff-before-taxi", "takeoff-light", "takeoff-strobe"] },
  { id: "cruise", name: "巡航", flag: "cruiseConfirmed", points: 15, objective: "达到最低巡航剖面", requirement: "固定翼无线电高度达到 3000 ft，直升机或旋翼机达到 1000 ft，并连续保持至少 20 秒。", trigger: "离地后达到对应机型的最低无线电高度开始计时。", telemetry: "无线电高度、机型类别、离地状态、保持时间", deductions: ["未完成最低高度和保持时间即进近：扣 5 分"], penalty: "-5", codes: ["landing-before-cruise"] },
  { id: "landing", name: "着陆", flag: "landingConfirmed", points: 25, objective: "在任务目标有效接地", requirement: "在任务目的机场、任务区域或指定返回机场完成有效接地，并记录接地率、峰值载荷及跑道。", trigger: "任务到达条件成立并收到一次有效接地事件。", telemetry: "目标距离、地面状态、接地率、峰值 G、机场与跑道", deductions: ["此阶段不设置固定扣分；接地数据写入最终报告"], penalty: "-", codes: [] },
  { id: "parking", name: "停机", flag: "parkingConfirmed", points: 10, objective: "落地后安全停稳", requirement: "接地后将地速降低到 5 kt 以下，连续停稳 5 秒，并设置停留刹车。", trigger: "有效着陆后，飞机在地面且地速不高于 5 kt 时开始计时。", telemetry: "地面状态、地速、停稳时间、停留刹车", deductions: ["停稳后未设置停留刹车：扣 5 分"], penalty: "-5", codes: ["parking-brake"] },
  { id: "shutdown", name: "关车", flag: "shutdownConfirmed", points: 10, objective: "完成关车程序", requirement: "完成停机检查后关闭发动机；关车完成前任务不会进行最终结算。", trigger: "停机阶段通过后持续监测发动机运行状态。", telemetry: "停机阶段、发动机运行状态", deductions: ["此阶段不设置固定扣分；未关车时任务保持待完成"], penalty: "-", codes: [] }
];

function sopBooleanLabel(sample, names, onText = "开启", offText = "关闭") {
  const value = sopBoolean(sample, names);
  return value === null ? "无数据" : value ? onText : offText;
}

function sopLiveValues(rule, sample, sop, aircraft) {
  if (!sample && rule.id !== "landing") return ["等待 MSFS 遥测"];
  const speed = Number(sample?.groundSpeedKt);
  const radioAltitude = Number(sample?.radioAltitudeFt);
  const onGround = sample ? sopBooleanLabel(sample, ["onGround"], "在地面", "已离地") : "无数据";
  const elapsed = (startedAt, limit) => startedAt ? `${Math.min(limit, Math.max(0, Math.floor((Date.now() - Number(startedAt)) / 1000)))} / ${limit} 秒` : `0 / ${limit} 秒`;
  if (rule.id === "lighting") return [
    `发动机：${sopBooleanLabel(sample, ["engineRunning"], "运行", "关闭")}`,
    `防撞灯：${sopBooleanLabel(sample, ["antiCollisionLights", "beaconLights", "beaconLightOn", "lights.beacon"])}`,
    `位置灯：${sopBooleanLabel(sample, ["navigationLights", "navLights", "navLightOn", "lights.nav"])}`,
    `昼夜：${sopBooleanLabel(sample, ["isNight", "environment.isNight"], "夜间", "日间")}`
  ];
  if (rule.id === "taxi") {
    const taxiCompleted = sop?.taxiConfirmed === true && (sop?.takeoffRollStartedAt || sop?.takeoffConfirmed === true);
    const taxiSpeed = taxiCompleted ? Number(sop.taxiLastGroundSpeedKt) : speed;
    const taxiLight = taxiCompleted && sop.taxiLastLight !== null && sop.taxiLastLight !== undefined
      ? (sop.taxiLastLight ? "开启" : "关闭")
      : sopBooleanLabel(sample, ["taxiLights", "taxiLightOn", "lights.taxi"]);
    return [
      taxiCompleted ? (sop?.takeoffConfirmed ? "地面阶段已结束" : "起飞滑跑已开始") : onGround,
      `地面速度：${Number.isFinite(taxiSpeed) ? taxiSpeed.toFixed(1) : "--"} kt`,
      `滑行灯：${taxiLight}`
    ];
  }
  if (rule.id === "takeoff") return [onGround, `地速：${Number.isFinite(speed) ? speed.toFixed(1) : "--"} kt`, `着陆灯：${sopBooleanLabel(sample, ["landingLights", "landingLightOn", "lights.landing"])}`, `频闪灯：${sopBooleanLabel(sample, ["strobeLights", "strobeLightOn", "lights.strobe"])}`];
  if (rule.id === "cruise") {
    const minimum = sopAircraftIsRotorcraft(aircraft) ? 1000 : 3000;
    return [onGround, `无线电高度：${Number.isFinite(radioAltitude) ? radioAltitude.toFixed(0) : "--"} ft`, `最低要求：${minimum} ft`, `保持时间：${elapsed(sop.cruiseStartedAt, 20)}`];
  }
  if (rule.id === "landing") {
    const landing = sop.landingData || {};
    return [onGround, `接地率：${Number.isFinite(Number(landing.landingRateFpm)) ? `-${Math.abs(Number(landing.landingRateFpm)).toFixed(0)}` : "--"} fpm`, `峰值载荷：${Number.isFinite(Number(landing.peakG)) ? Number(landing.peakG).toFixed(2) : "--"} G`, `跑道：${landing.runway || "--"}`];
  }
  if (rule.id === "parking") return [onGround, `地速：${Number.isFinite(speed) ? speed.toFixed(1) : "--"} kt`, `停稳时间：${elapsed(sop.parkingStartedAt, 5)}`, `停留刹车：${sopBooleanLabel(sample, ["parkingBrake", "parkingBrakeSet", "brakes.parking"], "已设置", "未设置")}`];
  return [`停机阶段：${sop.parkingConfirmed ? "已完成" : "未完成"}`, `发动机：${sopBooleanLabel(sample, ["engineRunning"], "运行", "已关闭")}`];
}

function renderSopMonitor() {
  if (!els.sopMonitor || !els.sopMonitorScore || !els.sopMonitorSummary || !els.sopMonitorTable) return;
  const mission = activeVerifiedMission();
  const enabled = isSopMode();
  const sop = mission?.verification?.sop || defaultSopState();
  const deductions = Array.isArray(sop.deductions) ? sop.deductions : [];
  const score = Math.max(0, Math.min(100, Number(sop.score ?? 100) || 0));
  const currentRule = enabled && mission ? SOP_MONITOR_RULES.find((rule) => sop[rule.flag] !== true) : null;
  const completedRules = SOP_MONITOR_RULES.filter((rule) => sop[rule.flag] === true);
  const lostPointsTotal = deductions.reduce((total, item) => total + Math.max(0, Number(item.points) || 0), 0);
  const sample = lastTelemetryConnected ? (lastSimulatorPayload?.sample || lastTelemetry) : null;
  const aircraft = mission ? missionAircraft(mission) : currentAircraft();

  els.sopMonitor.classList.toggle("is-disabled", !enabled);
  els.sopMonitor.classList.toggle("is-live", enabled && Boolean(mission) && lastTelemetryConnected);
  els.sopMonitorScore.textContent = enabled ? `${Math.round(score)}/100` : "未开启";
  els.sopMonitorScore.className = deductions.length ? "is-penalty" : enabled && mission ? "is-good" : "";
  els.sopMonitorSummary.textContent = isFreeMode()
    ? "自由模式下 SOP 检测暂停。"
    : !enabled
      ? "在设置中开启 SOP 模式后开始监测。"
      : !mission
        ? "接受任务后按 100 分制实时监测。"
        : !lastTelemetryConnected
          ? "任务已接受，正在等待 MSFS 遥测。"
          : `${mission.origin || "任务起点"} → ${mission.destination || "任务现场"} · ${completedRules.length}/7 项完成`;

  if (els.sopModeStatus) {
    els.sopModeStatus.textContent = isFreeMode() ? "自由模式暂停" : enabled ? mission ? "考核进行中" : "已开启" : "未开启";
    els.sopModeStatus.className = `sop-page-mode ${enabled && !isFreeMode() ? "is-enabled" : ""}`;
  }
  if (els.sopMissionName) els.sopMissionName.textContent = mission ? `${mission.title || mission.category || "飞行任务"} · ${mission.origin || "起点"} → ${mission.destination || "任务现场"}` : "尚未接受任务";
  if (els.sopCurrentStage) els.sopCurrentStage.textContent = currentRule?.name || (mission && completedRules.length === SOP_MONITOR_RULES.length ? "全部完成" : "等待开始");
  if (els.sopCompletedCount) els.sopCompletedCount.textContent = `${completedRules.length} / ${SOP_MONITOR_RULES.length}`;
  if (els.sopDeductionTotal) els.sopDeductionTotal.textContent = `${lostPointsTotal} 分`;
  if (els.sopTelemetryStatus) els.sopTelemetryStatus.textContent = lastTelemetryConnected ? "MSFS 已连接" : "等待 MSFS";

  if (els.sopStageTrack) {
    els.sopStageTrack.innerHTML = SOP_MONITOR_RULES.map((rule, index) => {
      const stageDeductions = deductions.filter((item) => rule.codes.includes(String(item.code || "")));
      const className = stageDeductions.length ? "is-penalty" : sop[rule.flag] === true ? "is-pass" : currentRule?.id === rule.id ? "is-current" : "is-waiting";
      return `<div class="sop-stage-step ${className}"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${stageDeductions.length ? `已扣 ${stageDeductions.reduce((sum, item) => sum + Number(item.points || 0), 0)} 分` : sop[rule.flag] === true ? "已通过" : currentRule?.id === rule.id ? lastTelemetryConnected ? "监测中" : "等待遥测" : "待检查"}</small></div><b>${rule.points}</b></div>`;
    }).join("");
  }

  const rows = SOP_MONITOR_RULES.map((rule, index) => {
    const stageDeductions = deductions.filter((item) => rule.codes.includes(String(item.code || "")));
    const lostPoints = stageDeductions.reduce((total, item) => total + Math.max(0, Number(item.points) || 0), 0);
    const confirmed = sop[rule.flag] === true;
    const status = !enabled || !mission
      ? "待检查"
      : lostPoints > 0
        ? `已扣 ${lostPoints} 分`
        : confirmed
          ? "通过"
          : currentRule?.id === rule.id
            ? lastTelemetryConnected ? "监测中" : "等待遥测"
            : "待检查";
    const statusClass = lostPoints > 0 ? "is-penalty" : confirmed ? "is-pass" : currentRule?.id === rule.id && enabled && mission ? "is-current" : "is-waiting";
    const liveValues = sopLiveValues(rule, sample, sop, aircraft);
    return `<tr class="${statusClass}">
      <th scope="row"><span class="sop-stage-number">${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(rule.name)}</strong><small>阶段权重 ${rule.points} 分</small></th>
      <td data-label="状态"><span class="sop-status-label">${escapeHtml(status)}</span></td>
      <td data-label="操作要求"><strong>${escapeHtml(rule.objective)}</strong><p>${escapeHtml(rule.requirement)}</p><small><b>触发：</b>${escapeHtml(rule.trigger)}</small></td>
      <td data-label="实时监测"><p class="sop-telemetry-source">监测：${escapeHtml(rule.telemetry)}</p><div class="sop-live-values">${liveValues.map((value) => `<span>${escapeHtml(value)}</span>`).join("")}</div></td>
      <td data-label="扣分规则"><ul>${rule.deductions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></td>
    </tr>`;
  }).join("");
  els.sopMonitorTable.innerHTML = `<table class="sop-detail-table">
    <thead><tr><th>阶段</th><th>状态</th><th>操作要求与触发条件</th><th>实时监测数据</th><th>扣分规则</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  if (els.sopDeductionList) {
    const unavailable = Array.isArray(sop.dataUnavailable) ? sop.dataUnavailable : [];
    const warning = unavailable.length ? `<div class="sop-data-warning"><span class="sop-list-indicator" aria-hidden="true"></span><div><strong>部分遥测不可用</strong><span>${escapeHtml(unavailable.join("、"))}暂时无法读取，相关检查将按可用数据继续。</span></div></div>` : "";
    els.sopDeductionList.innerHTML = warning + (deductions.length ? deductions.map((item) => `<article class="sop-deduction-item"><time>${new Date(Number(item.at) || Date.now()).toLocaleTimeString("zh-CN")}</time><div><strong>${escapeHtml(item.title || "SOP 操作扣分")}</strong><p>${escapeHtml(item.detail || "未提供详细说明")}</p></div><b>-${Math.max(0, Number(item.points) || 0)}</b></article>`).join("") : `<div class="sop-deduction-empty"><span class="sop-list-indicator" aria-hidden="true"></span><div><strong>暂无扣分记录</strong><span>${mission ? "保持规范操作，违规记录会实时出现在这里。" : "接受任务并开启 SOP 模式后开始记录。"}</span></div></div>`);
  }
}

function defaultSopState() {
  return {
    enabled: false,
    score: 100,
    deductions: [],
    phase: "lighting",
    lightingConfirmed: false,
    taxiConfirmed: false,
    takeoffConfirmed: false,
    cruiseConfirmed: false,
    landingConfirmed: false,
    parkingConfirmed: false,
    shutdownConfirmed: false,
    taxiStartedAt: null,
    taxiLastGroundSpeedKt: null,
    taxiLastLight: null,
    takeoffRollStartedAt: null,
    cruiseStartedAt: null,
    parkingStartedAt: null,
    parkingBrakeSeenSet: false,
    lastEngineRunning: null,
    lastOnGround: null,
    lastSampleAt: null,
    dataUnavailable: []
  };
}

function ensureSopState(verification) {
  verification.sop = { ...defaultSopState(), ...(verification.sop || {}) };
  verification.sop.score = Math.max(0, Math.min(100, Number(verification.sop.score ?? 100) || 0));
  verification.sop.deductions = Array.isArray(verification.sop.deductions) ? verification.sop.deductions : [];
  verification.sop.dataUnavailable = Array.isArray(verification.sop.dataUnavailable) ? verification.sop.dataUnavailable : [];
  return verification.sop;
}

function sopSampleValue(sample, names) {
  for (const name of names) {
    const value = name.split(".").reduce((current, key) => current?.[key], sample);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function sopBoolean(sample, names) {
  const value = sopSampleValue(sample, names);
  if (value === undefined) return null;
  if (typeof value === "boolean") return value;
  return Number(value) > 0.5 || ["true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

function recordSopDataUnavailable(sop, key) {
  if (!sop.dataUnavailable.includes(key)) sop.dataUnavailable.push(key);
}

function updateSopDataAvailability(sop, key, unavailable) {
  if (unavailable) {
    recordSopDataUnavailable(sop, key);
    return;
  }
  sop.dataUnavailable = sop.dataUnavailable.filter((item) => item !== key);
}

function applySopDeduction(mission, code, title, points, detail) {
  if (!isSopMode() || !mission?.verification) return false;
  const sop = ensureSopState(mission.verification);
  if (sop.deductions.some((item) => item.code === code)) return false;
  const deduction = Math.max(0, Number(points) || 0);
  sop.score = Math.max(0, Math.round((Number(sop.score || 100) - deduction) * 10) / 10);
  sop.deductions.push({ code, title, points: deduction, detail, at: Date.now() });
  recordTaskEvent(mission, {
    key: "sop-violation",
    title: "SOP 操作扣分",
    detail: `${title}，扣 ${deduction} 分：${detail}。当前 SOP 得分 ${sop.score}/100。`,
    phase: mission.verification.phase
  });
  return true;
}

function sopAircraftIsRotorcraft(aircraft) {
  return /直升机|旋翼机/.test(String(aircraft?.kind || ""));
}

function sopTakeoffRollActive(onGround, speed, taxiConfirmed, landingLight, strobe) {
  return onGround === true
    && taxiConfirmed === true
    && Number(speed) >= 35
    && (landingLight === true || strobe === true);
}

function sopParkingDecision(startedAt, parkingBrake, brakeSeenSet, now = Date.now()) {
  const parkedLongEnough = Number.isFinite(Number(startedAt)) && now - Number(startedAt) >= 5_000;
  const brakeConfirmed = parkingBrake === null || parkingBrake === true || brakeSeenSet === true;
  return {
    parkedLongEnough,
    shouldDeduct: parkedLongEnough && parkingBrake === false && brakeSeenSet !== true,
    canConfirm: parkedLongEnough && brakeConfirmed
  };
}

function evaluateSopTelemetry(mission, sample, aircraft, { landing = null, arrived = false } = {}) {
  if (!isSopMode() || !mission?.verification || !sample) return null;
  const verification = mission.verification;
  const sop = ensureSopState(verification);
  sop.enabled = true;
  const onGround = telemetryBoolean(sample.onGround);
  const engineRunning = sample.engineRunning === undefined || sample.engineRunning === null ? null : telemetryBoolean(sample.engineRunning);
  const speed = Math.max(0, Number(sample.groundSpeedKt) || 0);
  const radioAltitude = Math.max(0, Number(sample.radioAltitudeFt) || 0);
  const landingLight = sopBoolean(sample, ["landingLights", "landingLightOn", "lights.landing"]);
  const antiCollision = sopBoolean(sample, ["antiCollisionLights", "beaconLights", "beaconLightOn", "lights.beacon"]);
  const nav = sopBoolean(sample, ["navigationLights", "navLights", "navLightOn", "lights.nav"]);
  const strobe = sopBoolean(sample, ["strobeLights", "strobeLightOn", "lights.strobe"]);
  const taxiLight = sopBoolean(sample, ["taxiLights", "taxiLightOn", "lights.taxi"]);
  const parkingBrake = sopBoolean(sample, ["parkingBrake", "parkingBrakeSet", "brakes.parking"]);
  const night = (() => {
    const explicit = sopBoolean(sample, ["isNight", "environment.isNight"]);
    return explicit === null ? null : explicit;
  })();
  updateSopDataAvailability(sop, "灯光", [landingLight, antiCollision, nav, strobe, taxiLight].every((value) => value === null));
  updateSopDataAvailability(sop, "停留刹车", parkingBrake === null);
  if (engineRunning !== null) updateSopDataAvailability(sop, "发动机状态", false);

  if (engineRunning === true && onGround && !sop.lightingConfirmed) {
    if (antiCollision === false) applySopDeduction(mission, "lighting-beacon", "防撞灯未开启", 5, "发动机运行时应开启防撞灯");
    if (nav === false && night !== false) applySopDeduction(mission, "lighting-nav", "位置灯未开启", 4, "夜间或低能见度运行应开启位置灯");
    if (antiCollision !== false && nav !== false) {
      sop.lightingConfirmed = antiCollision !== null || nav !== null ? true : sop.lightingConfirmed;
      if (sop.lightingConfirmed) recordTaskEvent(mission, { key: "sop-stage", title: "SOP 灯光检查完成", detail: "已完成发动机启动后的灯光检查。", phase: "lighting" });
    }
  }

  const takeoffRoll = sopTakeoffRollActive(onGround, speed, sop.taxiConfirmed, landingLight, strobe);
  if (takeoffRoll) {
    sop.takeoffRollStartedAt ||= Date.now();
    sop.phase = "takeoff";
  }

  if (engineRunning === true && onGround && speed > 0.5 && !sop.takeoffConfirmed && !takeoffRoll) {
    sop.taxiStartedAt ||= Date.now();
    sop.taxiLastGroundSpeedKt = speed;
    if (taxiLight !== null) sop.taxiLastLight = taxiLight;
    if (speed > 35) applySopDeduction(mission, "taxi-speed", "滑行速度过高", 6, `地面速度 ${speed.toFixed(0)} kt，超过 35 kt 的通用滑行上限`);
    if (taxiLight === false) applySopDeduction(mission, "taxi-light", "滑行灯未开启", 2, "滑行阶段应开启滑行灯");
    if (!sop.taxiConfirmed && speed <= 35) {
      sop.taxiConfirmed = true;
      recordTaskEvent(mission, { key: "sop-stage", title: "SOP 滑行检查完成", detail: "已检测到发动机运行、地面移动和合理滑行速度。", phase: "taxi" });
    }
  }

  const airborne = !onGround && speed >= 35;
  if (airborne && !sop.takeoffConfirmed) {
    if (!sop.taxiConfirmed) applySopDeduction(mission, "takeoff-before-taxi", "未完成滑行程序即起飞", 8, "起飞前未检测到有效滑行阶段");
    if (landingLight === false) applySopDeduction(mission, "takeoff-light", "起飞灯光配置错误", 4, "起飞阶段应开启着陆灯或等效起飞灯光");
    if (strobe === false) applySopDeduction(mission, "takeoff-strobe", "频闪灯未开启", 3, "进入跑道和起飞阶段应开启防撞频闪灯");
    sop.takeoffConfirmed = true;
    sop.takeoffRollStartedAt ||= Date.now();
    sop.phase = "cruise";
    recordTaskEvent(mission, { key: "sop-stage", title: "SOP 起飞检查完成", detail: "已检测到离地并开始爬升。", phase: "takeoff" });
  }

  const cruiseAltitude = sopAircraftIsRotorcraft(aircraft) ? 1000 : 3000;
  if (!onGround && radioAltitude >= cruiseAltitude) {
    sop.cruiseStartedAt ||= Date.now();
    if (!sop.cruiseConfirmed && Date.now() - sop.cruiseStartedAt >= 20_000) {
      sop.cruiseConfirmed = true;
      sop.phase = "cruise";
      recordTaskEvent(mission, { key: "sop-stage", title: "SOP 巡航检查完成", detail: `已达到 ${cruiseAltitude} ft 以上并保持巡航。`, phase: "cruise" });
    }
  }

  if (landing || arrived) {
    if (!sop.cruiseConfirmed && sop.takeoffConfirmed) applySopDeduction(mission, "landing-before-cruise", "未完成巡航阶段即进近", 5, "未达到最低巡航高度或保持时间");
    if (landing) {
      sop.landingData = {
        landingRateFpm: Number.isFinite(Number(landing.landingRateFpm)) ? Math.abs(Number(landing.landingRateFpm)) : null,
        peakG: Number.isFinite(Number(landing.peakG)) ? Number(landing.peakG) : null,
        airport: String(landing.airport || ""),
        runway: String(landing.runway || ""),
        touchdownSpeedKt: Number.isFinite(Number(landing.touchdownSpeedKt)) ? Number(landing.touchdownSpeedKt) : null,
        touchdownPitchDeg: Number.isFinite(Number(landing.touchdownPitchDeg)) ? Number(landing.touchdownPitchDeg) : null,
        touchdownBankDeg: Number.isFinite(Number(landing.touchdownBankDeg)) ? Number(landing.touchdownBankDeg) : null,
        bounceCount: Number.isFinite(Number(landing.bounceCount)) ? Number(landing.bounceCount) : null,
        rateSource: String(landing.rateSource || ""),
        rateConfidence: String(landing.rateConfidence || ""),
        reportAt: Date.parse(landing.timestamp || "") || null
      };
      sop.landingConfirmed = true;
      sop.phase = "parking";
      recordTaskEvent(mission, { key: "sop-stage", title: "SOP 着陆检查完成", detail: "已检测到任务机场或任务点的有效接地数据。", phase: "landing" });
    }
  }

  if (onGround && speed <= 5 && (landing || arrived || sop.landingConfirmed)) {
    sop.parkingStartedAt ||= Date.now();
    if (parkingBrake === true) sop.parkingBrakeSeenSet = true;
    const parkingDecision = sopParkingDecision(sop.parkingStartedAt, parkingBrake, sop.parkingBrakeSeenSet);
    if (parkingDecision.shouldDeduct) applySopDeduction(mission, "parking-brake", "停机未设置停留刹车", 5, "飞机连续停稳 5 秒后仍未设置停留刹车");
    if (parkingDecision.canConfirm) {
      if (!sop.parkingConfirmed) recordTaskEvent(mission, { key: "sop-stage", title: "SOP 停机检查完成", detail: "飞机已在地面停稳并完成停机检查。", phase: "parking" });
      sop.parkingConfirmed = true;
      sop.phase = "shutdown";
    }
  } else if (sop.landingConfirmed && !sop.parkingConfirmed) {
    sop.parkingStartedAt = null;
    sop.parkingBrakeSeenSet = false;
  }

  if (sop.parkingConfirmed && engineRunning === false) {
    if (!sop.shutdownConfirmed) recordTaskEvent(mission, { key: "sop-stage", title: "SOP 关车检查完成", detail: "已停稳、设置停留刹车并关闭发动机。", phase: "shutdown" });
    sop.shutdownConfirmed = true;
    sop.phase = "complete";
  } else if (sop.parkingConfirmed && engineRunning === null) {
    updateSopDataAvailability(sop, "发动机状态", true);
    sop.shutdownConfirmed = true;
    sop.phase = "complete";
  }
  sop.lastEngineRunning = engineRunning;
  sop.lastOnGround = onGround;
  sop.lastSampleAt = Date.now();
  return sop;
}

function sopCompletionPrompt(sop, sample) {
  const score = Math.round(Number(sop?.score ?? 100));
  if (!sop?.parkingConfirmed) {
    const elapsed = sop?.parkingStartedAt ? Math.floor((Date.now() - Number(sop.parkingStartedAt)) / 1000) : 0;
    const remaining = Math.max(0, 5 - elapsed);
    const parkingBrake = sopBoolean(sample, ["parkingBrake", "parkingBrakeSet", "brakes.parking"]);
    const brakeInstruction = parkingBrake === false ? "，并设置停留刹车" : "";
    return `已检测到有效着陆，请保持地面速度不超过 5 kt 并停稳 ${remaining} 秒${brakeInstruction}。当前得分 ${score}/100。`;
  }
  const engineRunning = sample?.engineRunning == null ? null : telemetryBoolean(sample.engineRunning);
  if (engineRunning === true) return `停机检查已完成，请关闭发动机完成关车。当前得分 ${score}/100。`;
  return `停机和关车检查即将完成。当前得分 ${score}/100。`;
}

function buildSopReport(sop = {}, landing = {}) {
  const deductions = Array.isArray(sop.deductions) ? sop.deductions : [];
  const stageDefinitions = [
    ["lighting", "灯光", "lightingConfirmed", 15],
    ["taxi", "滑行", "taxiConfirmed", 10],
    ["takeoff", "起飞", "takeoffConfirmed", 15],
    ["cruise", "巡航", "cruiseConfirmed", 15],
    ["landing", "着陆", "landingConfirmed", 25],
    ["parking", "停机", "parkingConfirmed", 10],
    ["shutdown", "关车", "shutdownConfirmed", 10]
  ];
  const stages = stageDefinitions.map(([id, name, flag, points]) => {
    const stageDeductions = deductions.filter((item) => String(item.code || "").startsWith(`${id}-`)
      || (id === "lighting" && String(item.code || "").includes("light"))
      || (id === "takeoff" && String(item.code || "").includes("takeoff"))
      || (id === "landing" && String(item.code || "").includes("landing"))
      || (id === "parking" && String(item.code || "").includes("parking")));
    const confirmed = sop[flag] === true;
    return {
      id,
      name,
      points,
      confirmed,
      status: stageDeductions.length ? "有扣分" : confirmed ? "通过" : "未完成",
      deductions: stageDeductions
    };
  });
  const landingData = {
    landingRateFpm: Number.isFinite(Number(landing.landingRateFpm ?? sop.landingData?.landingRateFpm)) ? Math.abs(Number(landing.landingRateFpm ?? sop.landingData.landingRateFpm)) : null,
    peakG: Number.isFinite(Number(landing.landingPeakG ?? landing.peakG ?? sop.landingData?.peakG)) ? Number(landing.landingPeakG ?? landing.peakG ?? sop.landingData.peakG) : null,
    wearPercent: Number.isFinite(Number(landing.landingWearPercent)) ? Number(landing.landingWearPercent) : null,
    airport: String(landing.landingAirport ?? landing.airport ?? sop.landingData?.airport ?? ""),
    runway: String(landing.landingRunway ?? landing.runway ?? sop.landingData?.runway ?? ""),
    touchdownSpeedKt: Number.isFinite(Number(landing.touchdownSpeedKt ?? sop.landingData?.touchdownSpeedKt)) ? Number(landing.touchdownSpeedKt ?? sop.landingData.touchdownSpeedKt) : null,
    touchdownPitchDeg: Number.isFinite(Number(landing.touchdownPitchDeg ?? sop.landingData?.touchdownPitchDeg)) ? Number(landing.touchdownPitchDeg ?? sop.landingData.touchdownPitchDeg) : null,
    touchdownBankDeg: Number.isFinite(Number(landing.touchdownBankDeg ?? sop.landingData?.touchdownBankDeg)) ? Number(landing.touchdownBankDeg ?? sop.landingData.touchdownBankDeg) : null,
    bounceCount: Number.isFinite(Number(landing.bounceCount ?? sop.landingData?.bounceCount)) ? Number(landing.bounceCount ?? sop.landingData.bounceCount) : null,
    rateSource: String(landing.rateSource ?? sop.landingData?.rateSource ?? ""),
    rateConfidence: String(landing.rateConfidence ?? sop.landingData?.rateConfidence ?? ""),
    reportAt: Number.isFinite(Number(landing.landingReportAt ?? sop.landingData?.reportAt)) ? Number(landing.landingReportAt ?? sop.landingData.reportAt) : null
  };
  const score = Math.max(0, Math.min(100, Number(sop.score ?? 100) || 0));
  return {
    score,
    multiplier: sopRewardMultiplier(true, score),
    stages,
    deductions,
    dataUnavailable: Array.isArray(sop.dataUnavailable) ? sop.dataUnavailable : [],
    landing: landingData
  };
}

function sopRewardMultiplier(enabled, score) {
  if (!enabled) return 1;
  const normalizedScore = Math.max(0, Math.min(100, Number(score) || 0));
  return normalizedScore >= 100 ? 1.3 : normalizedScore / 100;
}

function buildLandingSopSnapshot(mission, landingWear, landing, aircraft, reportAt, arrival = "") {
  const missionSop = mission?.verification?.sop || {};
  const sopEnabled = (typeof isSopMode === "function" && isSopMode()) || missionSop.enabled === true;
  const sopScore = sopEnabled ? Math.max(0, Math.min(100, Number(missionSop.score ?? 100) || 0)) : 100;
  const sopMultiplier = sopRewardMultiplier(sopEnabled, sopScore);
  if (!sopEnabled) return { sopEnabled: false, sopScore: 100, sopMultiplier: 1, sopDeductions: [], sopReport: null };
  const landingActual = typeof landingReportActual === "function"
    ? landingReportActual(landing, aircraft)
    : {};
  const sopReport = typeof buildSopReport === "function"
    ? buildSopReport(missionSop, {
      ...landingActual,
      landingRateFpm: landingWear?.landingRateFpm,
      landingPeakG: landingWear?.peakG,
      landingWearPercent: landingWear?.wearPercent,
      landingAirport: arrival || landingActual.landingAirport,
      landingRunway: String(landing?.runway || landingActual.landingRunway || ""),
      landingReportAt: reportAt,
      landingReport: landing
    })
    : null;
  return {
    sopEnabled: true,
    sopScore,
    sopMultiplier,
    sopDeductions: missionSop.deductions || [],
    sopReport
  };
}

