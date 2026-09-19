// 模飞生涯 渲染器源码 08-render-panels.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function renderSchedules() {
  renderPlanAircraftOptions();
  updatePlanAirportFields();
  const plannedRecords = state.schedules.filter((record) => record?.kind === "route-plan");
  const plannedMissions = plannedRecords
    .map((record) => state.missions.find((mission) => mission.id === record.missionId))
    .filter(Boolean);
  const totalDistance = plannedRecords.reduce((sum, record) => sum + (Number(record.distance) || 0), 0);
  els.scheduleSummary.innerHTML = `
    <div class="metric-grid schedule-metrics">
      <article class="metric-card"><span>计划航线</span><strong>${plannedRecords.length}</strong><em>已创建的指定航线</em></article>
      <article class="metric-card"><span>待执行</span><strong>${escapeHtml(plannedMissions.filter((mission) => mission.status === "open").length)}</strong><em>可在任务页接受</em></article>
      <article class="metric-card"><span>执行中</span><strong>${escapeHtml(plannedMissions.filter((mission) => mission.status === "accepted").length)}</strong><em>当前计划任务</em></article>
      <article class="metric-card"><span>计划里程</span><strong>${Math.round(totalDistance).toLocaleString("zh-CN")}</strong><em>累计海里</em></article>
    </div>`;
  els.scheduleList.innerHTML = state.schedules.map(renderScheduleBatch).join("") || `
    <article class="mission-card">
      <div class="mission-head">
        <div>
          <h3>暂无计划表记录</h3>
          <p>完成任务后，历史计划任务记录会显示在这里。</p>
        </div>
      </div>
    </article>`;
}

function renderBackups() {
  const backups = readBackups();
  els.backupList.innerHTML = backups.map((backup) => `
    <article class="backup-row">
      <div>
        <strong>${escapeHtml(backup.reason || "手动备份")}</strong>
        <span>${new Date(backup.createdAt).toLocaleString("zh-CN")}</span>
      </div>
      <button class="ghost-btn" data-action="restore-backup" data-id="${escapeHtml(backup.id)}" type="button"><i data-lucide="history"></i><span>恢复</span></button>
    </article>`).join("") || `<p class="empty-note">暂无备份。导入存档前会自动创建。</p>`;
}

function renderScheduleBatch(batch) {
  if (batch?.kind === "route-plan") {
    const mission = state.missions.find((item) => item.id === batch.missionId);
    const status = mission ? statusText(mission.status) : "历史记录";
    const statusClass = mission?.status === "completed" ? "good" : mission?.status === "accepted" ? "info" : "warn";
    return `
      <article class="mission-card planned-route-record">
        <div class="mission-head">
          <div>
            <h3>${escapeHtml(batch.origin)} → ${escapeHtml(batch.destination)}</h3>
            <p>${escapeHtml(batch.originName || batch.origin)} → ${escapeHtml(batch.destinationName || batch.destination)} · ${Math.round(Number(batch.distance) || 0)} nm</p>
          </div>
          <span class="tag ${statusClass}">${status}</span>
        </div>
        <div class="tag-row"><span class="tag">${new Date(batch.createdAt || batch.importedAt).toLocaleString("zh-CN")}</span><span class="tag info">计划任务</span>${batch.aircraftName ? `<span class="tag">机型 ${escapeHtml(batch.aircraftName)}</span>` : ""}</div>
      </article>`;
  }
  const errors = Array.isArray(batch?.errors) ? batch.errors : [];
  const errorHtml = errors.length
    ? `<div class="schedule-errors">${errors.slice(0, 5).map((error) => `<p>第 ${error.line} 行：${escapeHtml(error.reason)}</p>`).join("")}${errors.length > 5 ? `<p>还有 ${errors.length - 5} 个问题未显示</p>` : ""}</div>`
    : "";
  return `
    <article class="mission-card">
      <div class="mission-head">
        <div>
          <h3>${batch.fileName}</h3>
          <p>${new Date(batch.importedAt).toLocaleString("zh-CN")} · ${batch.airlineCode}</p>
        </div>
        <span class="tag ${errors.length ? "warn" : "good"}">${batch.imported} / ${batch.total} 已导入</span>
      </div>
      <div class="tag-row">
        <span class="tag">航司 ${batch.airlineCode}</span>
        <span class="tag">有效 ${batch.imported}</span>
        <span class="tag">失败 ${errors.length}</span>
      </div>
      ${errorHtml}
    </article>`;
}

function missionFuelBurnKgPerHour(aircraft) {
  const label = `${aircraft?.kind || ""} ${aircraft?.name || ""}`;
  if (/超大型|A380|747/.test(label)) return 9200;
  if (/宽体|A330|A340|A350|767|777|787|MD-11/.test(label)) return 6200;
  if (/军用运输|C-17|A400M/.test(label)) return 4300;
  if (/干线喷气|A319|A320|A321|737|757/.test(label)) return 2450;
  if (/支线客机|CRJ|Embraer|E-Jet|BAe|Avro|Fokker/.test(label)) return 950;
  if (/公务喷气|Citation|Pilatus PC-24/.test(label)) return 780;
  if (/重型直升机|H225|S-64|CH-47/.test(label)) return 620;
  if (/直升机|旋翼机/.test(label)) return 145;
  if (/涡桨|SkyCourier|Twin Otter|Saab/.test(label)) return 360;
  if (/双发/.test(label)) return 190;
  return 48;
}

function roundedFuelKg(value) {
  const step = value >= 1000 ? 100 : value >= 100 ? 10 : 5;
  return Math.ceil(value / step) * step;
}

function missionFuelPlan(mission) {
  const aircraft = missionAircraft(mission);
  const burnRate = missionFuelBurnKgPerHour(aircraft);
  const duration = Math.max(0.3, Number(mission.duration) || 0.6);
  const tripFuel = burnRate * duration;
  const reserveFuel = burnRate * 0.75;
  const plannedFuel = roundedFuelKg(tripFuel * 1.05 + reserveFuel);
  const capacity = Number(aircraft?.fuelCapacityKg);
  const recommendedFuel = Number.isFinite(capacity) && capacity > 0 ? Math.min(plannedFuel, Math.floor(capacity * 0.95)) : plannedFuel;
  const rawCurrentFuel = aircraft?.lastFuelKg;
  const currentFuel = Number(rawCurrentFuel);
  const hasCurrentFuel = rawCurrentFuel !== null && rawCurrentFuel !== undefined && rawCurrentFuel !== ""
    && Number.isFinite(currentFuel) && currentFuel >= 0;
  const margin = hasCurrentFuel ? currentFuel - recommendedFuel : null;
  return {
    aircraft,
    burnRate,
    tripFuel: roundedFuelKg(tripFuel),
    reserveFuel: roundedFuelKg(reserveFuel),
    recommendedFuel,
    currentFuel: hasCurrentFuel ? currentFuel : null,
    currentPercent: hasCurrentFuel && Number.isFinite(capacity) && capacity > 0 ? Math.round(currentFuel / capacity * 100) : null,
    status: margin === null ? "等待 MSFS 校验" : margin >= 0 ? `余量 ${formatFuel(margin)}` : `还需 ${formatFuel(Math.abs(margin))}`,
    statusClass: margin === null ? "is-waiting" : margin >= 0 ? "is-ready" : "is-low"
  };
}

function missionActionHtml(mission) {
  const accepted = mission.status === "accepted";
  const done = mission.status === "completed";
  const anotherAcceptedMission = !accepted && state.missions.some((item) => item.status === "accepted");
  if (done) return `<button class="ghost-btn" disabled type="button">已完成</button>`;
  if (accepted) {
    return `<button class="ghost-btn" disabled type="button">${mission.verification?.phaseLabel || "等待模拟器飞行"}</button><button class="primary-btn" data-action="manual-complete-mission" data-id="${escapeHtml(mission.id)}" type="button"><i data-lucide="circle-check-big"></i><span>手动完成</span></button>`;
  }
  if (anotherAcceptedMission) return `<button class="primary-btn" disabled type="button">已有执行中任务</button>`;
  return `<button class="primary-btn" data-action="accept-mission" data-id="${escapeHtml(mission.id)}" type="button">接受任务</button>`;
}

function renderMissionListItem(mission) {
  const accepted = mission.status === "accepted";
  const done = mission.status === "completed";
  const isAssessment = mission.kind === "license-assessment";
  const scene = missionScene(mission);
  const linkedScene = isPackagedScene(scene);
  const codes = routeAirportCodes(mission);
  const originCode = String(mission.origin || codes[0] || state.pilot.base || "----").toUpperCase();
  const destinationCode = String(mission.destination || codes[1] || "现场").toUpperCase();
  const originAirport = airportByIcao(originCode);
  const destinationAirport = airportByIcao(destinationCode);
  const originName = originAirport?.name || originCode;
  const destinationName = destinationAirport?.name || (linkedScene ? `${scene.label || "任务现场"} · ${String(mission.site?.bearing || 0).padStart(3, "0")}°` : destinationCode);
  const fuel = missionFuelPlan(mission);
  const statusClass = done ? "is-completed" : accepted ? "is-active" : "is-open";
  const briefing = isAssessment
    ? mission.assessmentBrief || `完成 ${mission.aircraftHint} 的起飞、航段和落地考核。`
    : linkedScene ? scene.objective : mission.summary;
  const verification = mission.verification;
  return `<article class="mission-list-item ${statusClass} ${isAssessment ? "is-assessment" : ""}">
    <div class="mission-list-main">
      <div class="mission-route-lockup">
        <span>${escapeHtml(mission.category)} · ${escapeHtml(mission.subtype)}</span>
        <h3><b>${escapeHtml(originCode)}</b><i data-lucide="arrow-right"></i><b>${escapeHtml(destinationCode)}</b></h3>
        <p>${escapeHtml(originName)} → ${escapeHtml(destinationName)}</p>
      </div>
      <div class="mission-list-summary">
        <strong>${escapeHtml(formatTaskRouteLabel(mission.route))}</strong>
        <span>${formatTaskDistanceNm(mission.distance)} · ${formatHours(mission.duration)} · ${escapeHtml(mission.dispatchPhase || "日间")}</span>
      </div>
      <div class="mission-list-status ${statusClass}"><span></span><b>${escapeHtml(statusText(mission.status))}</b><small>${escapeHtml(mission.risk)}风险</small></div>
      <div class="mission-list-actions">
        ${missionActionHtml(mission)}
        <button class="icon-btn danger-btn" data-action="delete-mission" data-id="${escapeHtml(mission.id)}" type="button" aria-label="删除任务" title="删除任务"><i data-lucide="trash-2"></i></button>
      </div>
    </div>
    <div class="mission-briefing-grid">
      <section class="mission-briefing-block">
        <h4><i data-lucide="clipboard-list"></i>任务简报</h4>
        <p>${escapeHtml(briefing)}</p>
        <dl class="mission-briefing-facts">
          <div><dt>机型</dt><dd>${isFreeMode() ? "不限机型" : escapeHtml(mission.aircraftHint || "待指定")}</dd></div>
          <div><dt>${isAssessment ? "结果" : "收益"}</dt><dd>${isAssessment ? "完成后取得执照" : `${formatMoney(mission.payout)} · 声望 +${mission.repGain}`}</dd></div>
          <div><dt>天气</dt><dd>${escapeHtml(mission.weather || "实时天气")}</dd></div>
        </dl>
      </section>
      <section class="mission-briefing-block mission-weather-block">
        <h4><i data-lucide="cloud-sun"></i>METAR</h4>
        ${missionMetarLine(originCode, "起飞", mission.weather)}
        ${missionMetarLine(mission.destination || codes[1], "到达", mission.weather)}
      </section>
      <section class="mission-briefing-block mission-fuel-block">
        <h4><i data-lucide="fuel"></i>燃油计划</h4>
        <div class="mission-fuel-readout">
          <div><span>建议起飞</span><strong>${formatFuel(fuel.recommendedFuel)}</strong></div>
          <div><span>当前油量</span><strong>${fuel.currentFuel === null ? "等待同步" : formatFuel(fuel.currentFuel)}</strong>${fuel.currentPercent === null ? "" : `<small>${fuel.currentPercent}%</small>`}</div>
        </div>
        <p class="mission-fuel-status ${fuel.statusClass}">${escapeHtml(fuel.status)}</p>
        <small>航段 ${formatFuel(fuel.tripFuel)} + 45 分钟储备 ${formatFuel(fuel.reserveFuel)} · 估算耗油 ${formatFuel(fuel.burnRate)}/小时</small>
      </section>
    </div>
    ${accepted ? `<div class="mission-list-progress"><i data-lucide="radio"></i><span>${escapeHtml(verification?.detail || "正在等待模拟器数据")}</span><b>实际航迹 ${Math.round(verification?.flightDistanceNm || 0)} nm</b></div>` : ""}
  </article>`;
}

function renderMissionCard(mission) {
  const accepted = mission.status === "accepted";
  const done = mission.status === "completed";
  const isAssessment = mission.kind === "license-assessment";
  const scene = missionScene(mission);
  const linkedScene = isPackagedScene(scene);
  const verification = mission.verification;
  const sceneState = done ? "已落地，任务完成" : accepted ? verification?.phaseLabel || "等待正确机场起飞" : linkedScene ? "场景任务待启动" : "待起飞";
  const sceneDetail = linkedScene ? `${scene.objectTitle} · ${scene.objective}` : `${scene.label} · ${scene.objective}`;
  const sceneRuntime = {
    waiting: { label: "接近目标后生成", className: "warn" },
    connecting: { label: "正在连接场景桥", className: "warn" },
    creating: { label: "正在生成对象", className: "info" },
    created: { label: "对象已在 MSFS 生成", className: "good" },
    error: { label: "对象生成失败", className: "bad" }
  }[verification?.sceneState];
  const actionHtml = missionActionHtml(mission);
  return `
    <article class="mission-card ${accepted ? "active" : ""} ${done ? "completed" : ""} ${isAssessment ? "license-assessment-card" : ""}">
      <div class="mission-head">
        <div>
          <h3>${escapeHtml(mission.title)}</h3>
          <p>${escapeHtml(mission.summary)}</p>
        </div>
        <span class="tag ${escapeHtml(mission.status === "completed" ? "good" : accepted ? "info" : "warn")}">${escapeHtml(statusText(mission.status))}</span>
      </div>
      <div class="mission-animation ${accepted ? "is-flying" : done ? "is-completed" : "is-open"} ${linkedScene ? "scene-linked" : ""}" aria-label="任务状态动画">
        <div class="mission-animation-icon"><i data-lucide="${scene.icon}"></i></div>
        <div class="mission-flight-track" aria-hidden="true">
          <span class="flight-dot start"></span>
          <span class="flight-line"></span>
          <span class="flight-plane"><i data-lucide="plane"></i></span>
          <span class="flight-line"></span>
          <span class="flight-dot end"></span>
        </div>
        <div class="mission-animation-copy">
          <strong>${sceneState}</strong>
          <span>${sceneDetail}</span>
        </div>
      </div>
      ${linkedScene ? `<div class="scene-briefing">
        <p><i data-lucide="crosshair"></i><span>现场目标：${scene.objective}</span></p>
        <div class="tag-row">
          ${accepted && sceneRuntime ? `<span class="tag ${sceneRuntime.className}" title="${escapeHtml(verification?.sceneDetail || "")}">${escapeHtml(sceneRuntime.label)}</span>` : ""}
          <span class="tag ${missionTerrainType(mission) === "water" ? "info" : "good"}"><i data-lucide="${missionTerrainType(mission) === "water" ? "waves" : "mountain"}"></i>${missionTerrainLabel(mission)}</span>
          <span class="tag">${scene.animated ? `自动动画 ${scene.seconds}s` : "静态场景"}</span>
          ${accepted && verification?.flightPlanState ? `<span class="tag ${["loaded", "prepared"].includes(verification.flightPlanState) ? "good" : verification.flightPlanState === "error" ? "bad" : "warn"}">MSFS 航路 ${verification.flightPlanState === "loaded" ? "已加载" : verification.flightPlanState === "prepared" ? "已生成" : verification.flightPlanState === "error" ? "失败" : "处理中"}</span>` : ""}
          <span class="tag">目标区 ${scene.radiusNm} nm</span>
          <span class="tag">${missionArrivalLabel(mission)}</span>
          ${mission.site ? `<span class="tag">基地 ${escapeHtml(mission.site.base)} · ${escapeHtml(formatTaskDistanceNm(mission.site.distanceNm))} · ${escapeHtml(String(mission.site.bearing).padStart(3, "0"))}°</span>` : ""}
          ${mission.site?.lat != null ? `<span class="tag scene-coordinate">${escapeHtml(mission.site.lat.toFixed(5))}, ${escapeHtml(mission.site.lon.toFixed(5))}</span>` : ""}
        </div>
        ${accepted && verification?.sceneDetail ? `<p class="scene-runtime-note is-${verification.sceneState || "waiting"}"><i data-lucide="${verification.sceneState === "created" ? "circle-check" : verification.sceneState === "error" ? "triangle-alert" : "loader-circle"}"></i><span>${escapeHtml(verification.sceneDetail)}</span></p>` : ""}
        ${accepted && verification?.flightPlanDetail ? `<p class="scene-runtime-note is-${verification.flightPlanState || "waiting"}"><i data-lucide="route"></i><span>${escapeHtml(verification.flightPlanDetail)}</span></p>` : ""}
      </div>` : ""}
      <div class="tag-row">
        ${isAssessment ? `<span class="tag info"><i data-lucide="badge-check"></i>机型考核</span>` : ""}
        ${isEmergencyMission(mission) ? `<span class="tag bad">紧急任务</span>` : ""}
        <span class="tag">${escapeHtml(mission.category)}</span>
        ${mission.origin ? `<span class="tag info">基地 ${escapeHtml(mission.origin)}</span>` : ""}
        <span class="tag">${escapeHtml(formatTaskRouteLabel(mission.route))}</span>
        <span class="tag">${formatTaskDistanceNm(mission.distance)}</span>
        <span class="tag info">${mission.dispatchPhase || "日间"}任务</span>
        <span class="tag">${isFreeMode() ? "自由模式 · 不限机型" : `适配 ${escapeHtml(mission.aircraftHint || "待指定")}`}</span>
        <span class="tag">${formatHours(mission.duration)}</span>
        ${isAssessment ? `<span class="tag good">完成后取得执照</span>` : `<span class="tag">奖励 ${formatMoney(mission.payout)}</span><span class="tag">声望 +${mission.repGain}</span>`}
        <span class="tag">${mission.risk} 风险</span>
        ${accepted && !linkedScene && verification?.flightPlanState ? `<span class="tag ${["loaded", "prepared"].includes(verification.flightPlanState) ? "good" : verification.flightPlanState === "error" ? "bad" : "warn"}">MSFS 航路 ${verification.flightPlanState === "loaded" ? "已加载" : verification.flightPlanState === "prepared" ? "已生成" : verification.flightPlanState === "error" ? "失败" : "处理中"}</span>` : ""}
      </div>
      ${isAssessment ? `<p class="scene-runtime-note is-waiting"><i data-lucide="clipboard-check"></i><span>${escapeHtml(mission.assessmentBrief || `完成 ${mission.aircraftHint} 的起飞、航段和落地考核，任务完成后正式发证。`)}</span></p>` : ""}
      ${accepted ? `<div class="mission-verification"><span>${escapeHtml(verification?.detail || "正在等待模拟器数据")}</span><b>实际航迹 ${Math.round(verification?.flightDistanceNm || 0)} nm</b></div>` : ""}
      ${accepted && !linkedScene && verification?.flightPlanDetail ? `<p class="scene-runtime-note is-${verification.flightPlanState || "waiting"}"><i data-lucide="route"></i><span>${escapeHtml(verification.flightPlanDetail)}</span></p>` : ""}
      <div class="card-actions">
        ${actionHtml}
        <button class="ghost-btn danger-btn mission-delete-btn" data-action="delete-mission" data-id="${escapeHtml(mission.id)}" type="button"><i data-lucide="trash-2"></i><span>删除任务</span></button>
      </div>
    </article>`;
}

function statusText(status) {
  if (status === "accepted") return "已接受";
  if (status === "completed") return "已完成";
  return "待接单";
}

function visibleFlightLogs(logs) {
  const selected = [];
  const missionPositions = new Map();
  const sorted = Array.isArray(logs) ? logs.slice().sort((a, b) => Number(b.date) - Number(a.date)) : [];
  sorted.forEach((log) => {
    const missionId = String(log?.missionId || "").trim();
    if (!missionId) {
      selected.push(log);
      return;
    }
    if (!missionPositions.has(missionId)) {
      missionPositions.set(missionId, selected.length);
      selected.push(log);
      return;
    }
    const position = missionPositions.get(missionId);
    const current = selected[position];
    const isSettled = Number(log?.settledAt) > 0 || log?.source === "mission";
    const currentIsSettled = Number(current?.settledAt) > 0 || current?.source === "mission";
    if (isSettled && !currentIsSettled) selected[position] = log;
  });
  return selected.sort((a, b) => Number(b.date) - Number(a.date));
}

function renderLogs() {
  const logs = visibleFlightLogs(state.logs);
  els.recentLogs.innerHTML = logs.slice(0, 3).map(renderLogCard).join("") || emptyCard("还没有飞行日志。");
  els.logsList.innerHTML = logs.map(renderLogCard).join("") || emptyCard("先完成一段飞行，日志会自动出现。");
  const events = uniqueTaskEvents(state.taskEvents).sort((a, b) => b.date - a.date);
  const activeMission = activeVerifiedMission();
  const liveProgress = activeMission ? renderLiveTaskProgress(activeMission) : "";
  const latestEvent = events.slice(0, 1).map(renderTaskEventCard).join("");
  els.sidebarLogs.innerHTML = liveProgress || latestEvent
    ? (liveProgress || latestEvent)
    : emptyCard("接受任务后会实时显示任务状态。");
}

function latestCompletedTaskLog() {
  const logs = visibleFlightLogs(state.logs);
  return logs
    .filter((log) => {
      if (!log?.missionId || log.status === "crashed") return false;
      const mission = state.missions.find((item) => item.id === log.missionId);
      return mission?.status === "completed"
        || Number(log.settledAt) > 0
        || log.source === "mission";
    })
    .sort((a, b) => Number(b.settledAt || b.date || 0) - Number(a.settledAt || a.date || 0))[0] || null;
}

function formatNullable(value, suffix = "") {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
    ? "暂无数据"
    : `${value}${suffix}`;
}

function renderSopReport(report, { compact = false } = {}) {
  if (!report) return "";
  const stages = Array.isArray(report.stages) ? report.stages : [];
  const deductions = Array.isArray(report.deductions) ? report.deductions : [];
  const landing = report.landing || {};
  const statusClass = (stage) => stage.status === "通过" ? "good" : stage.status === "有扣分" ? "warn" : "muted";
  return `
    <details class="sop-report" ${compact ? "" : "open"}>
      <summary><span>SOP 详细报告</span><strong>${Math.round(Number(report.score ?? 100))}/100</strong></summary>
      <div class="sop-report-body">
        <div class="sop-stage-grid">
          ${stages.map((stage) => `<div class="sop-stage-row"><span>${escapeHtml(stage.name)} <small>${stage.points}分</small></span><span class="tag ${statusClass(stage)}">${escapeHtml(stage.status)}</span></div>`).join("")}
        </div>
        <div class="sop-report-section">
          <strong>操作错误与扣分</strong>
          ${deductions.length
            ? `<ul class="sop-deduction-list">${deductions.map((item) => `<li><span>${escapeHtml(item.title || "SOP 违规")}</span><b>-${Number(item.points || 0).toFixed(Number(item.points) % 1 ? 1 : 0)}分</b><small>${escapeHtml(item.detail || "")}</small></li>`).join("")}</ul>`
            : `<p class="sop-report-muted">未记录操作错误。</p>`}
        </div>
        <div class="sop-report-section">
          <strong>接地数据</strong>
          <div class="sop-landing-grid">
            <span>接地率 <b>${formatNullable(landing.landingRateFpm, " fpm")}</b></span>
            <span>峰值 G <b>${formatNullable(landing.peakG, " G")}</b></span>
            <span>接地速度 <b>${formatNullable(landing.touchdownSpeedKt, " kt")}</b></span>
            <span>接地姿态 <b>${landing.touchdownPitchDeg == null ? "暂无数据" : `${Number(landing.touchdownPitchDeg).toFixed(1)}° 俯仰 / ${Number(landing.touchdownBankDeg || 0).toFixed(1)}° 横滚`}</b></span>
            <span>机场 / 跑道 <b>${escapeHtml([landing.airport, landing.runway].filter(Boolean).join(" / ") || "暂无数据")}</b></span>
            <span>机况损耗 <b>${formatNullable(landing.wearPercent, "%")}</b></span>
            <span>弹跳次数 <b>${formatNullable(landing.bounceCount)}</b></span>
            <span>数据来源 <b>${escapeHtml(landing.rateSource || landing.rateConfidence || "暂无数据")}</b></span>
          </div>
        </div>
        ${Array.isArray(report.dataUnavailable) && report.dataUnavailable.length ? `<p class="sop-report-muted">${escapeHtml(report.dataUnavailable.join("、"))}暂无遥测数据，未因缺失数据扣分。</p>` : ""}
      </div>
    </details>`;
}

function renderDashboardSettlement() {
  if (!els.dashboardSettlement) return;
  const log = latestCompletedTaskLog();
  if (!log) {
    els.dashboardSettlement.innerHTML = `
      <div class="settlement-empty">
        <i data-lucide="clipboard-list" aria-hidden="true"></i>
        <strong>暂无已完成任务</strong>
        <span>完成任务后，这里会显示最近一次飞行结算。</span>
      </div>`;
    return;
  }
  const fuelUsed = Number(log.taskFuelUsedKg) > 0 ? log.taskFuelUsedKg : log.fuelUsedKg;
  const income = Number(log.income);
  const grossIncome = Number(log.grossIncome);
  const hasGrossIncome = Number.isFinite(grossIncome) && grossIncome !== 0 && grossIncome !== income;
  const settledAt = Number(log.settledAt || log.date);
  els.dashboardSettlement.innerHTML = `
    <div class="settlement-head">
      <div>
        <p class="settlement-eyebrow">最近任务结算</p>
        <h3>${escapeHtml(log.taskTitle || `${log.from || "未知"} → ${log.to || "未知"}`)}</h3>
      </div>
      <span class="tag good">已完成</span>
    </div>
    <p class="settlement-route">${escapeHtml(log.from || "未知起飞点")} → ${escapeHtml(log.to || "未知落地点")}</p>
    <div class="settlement-grid">
      <div><span>飞行时间</span><strong>${formatHours(log.hours)}</strong></div>
      <div><span>飞行距离</span><strong>${formatDistanceNm(log.miles)}</strong></div>
      <div><span>消耗燃油</span><strong>${formatFuel(fuelUsed)}</strong></div>
      <div><span>${hasGrossIncome ? "任务收入" : "收入"}</span><strong>${formatMoney(hasGrossIncome ? grossIncome : income)}</strong></div>
      <div><span>净收入</span><strong class="is-income">${formatMoney(income)}</strong></div>
    </div>
    ${log.sopEnabled ? `<p class="settlement-meta">SOP 得分 ${Math.round(Number(log.sopScore ?? 100))}/100 · 奖励折算 ${Math.round(Number(log.sopMultiplier ?? 1) * 100)}%</p>` : ""}
    <p class="settlement-meta">${Number.isFinite(settledAt) && settledAt > 0 ? `结算于 ${new Date(settledAt).toLocaleString("zh-CN")}` : "已完成任务"}</p>`;
}

function renderLiveTaskProgress(mission) {
  const verification = mission?.verification || {};
  const sop = verification.sop;
  const sopDataHint = sop?.enabled && sop.dataUnavailable?.length
    ? ` · ${sop.dataUnavailable.join("、")}暂无遥测数据`
    : "";
  const timestamp = Date.parse(verification.lastTelemetryTimestamp || "");
  const updatedAt = Number.isFinite(timestamp) ? timestamp : Date.now();
  const distance = Math.max(0, Number(verification.flightDistanceNm || 0));
  return `
    <article class="task-event-card is-live">
      <div class="task-event-head">
        <strong><span class="task-live-dot" aria-hidden="true"></span>${escapeHtml(verification.phaseLabel || "任务进行中")}</strong>
        <time>${new Date(updatedAt).toLocaleTimeString("zh-CN")}</time>
      </div>
      <p class="task-event-mission">${escapeHtml(mission.title || "当前任务")}</p>
      <p>${escapeHtml(`${verification.detail || "正在等待 MSFS 实时遥测"}${sopDataHint}`)}</p>
      <div class="task-progress-meta"><span>实际航迹 ${Math.round(distance)} nm</span>${sop?.enabled ? `<span>SOP ${Math.round(Number(sop.score ?? 100))}/100</span>` : ""}<span>实时更新</span></div>
    </article>`;
}

function renderTaskEventCard(event) {
  return `
    <article class="task-event-card">
      <div class="task-event-head">
        <strong>${escapeHtml(event.title || "任务状态更新")}</strong>
        <time>${new Date(event.date).toLocaleTimeString("zh-CN")}</time>
      </div>
      ${event.missionTitle ? `<p class="task-event-mission">${escapeHtml(event.missionTitle)}</p>` : ""}
      <p>${escapeHtml(event.detail || "")}</p>
    </article>`;
}

function renderLogCard(log) {
  const isMsfs = log.source === "msfs";
  const landingRate = Number(log.landingRateFpm);
  const landingPeakG = Number(log.landingPeakG);
  return `
    <article class="log-card">
      <div class="log-head">
        <div>
          <h3>${escapeHtml(log.from || "未知起飞点")} → ${escapeHtml(log.to || "未知落地点")}</h3>
          <p>${escapeHtml(log.aircraftName || "未知机型")}</p>
        </div>
        <span class="tag ${isMsfs ? "info" : "good"}">${isMsfs ? "MSFS 实际" : formatMoney(log.income)}</span>
      </div>
      ${log.taskTitle ? `<div class="tag-row"><span class="tag info">任务 ${escapeHtml(log.taskTitle)}</span></div>` : ""}
      <div class="log-line">
        <span>${new Date(log.date).toLocaleString("zh-CN")}</span>
        <span>${formatHours(Number(log.hours) || 0)} · ${Number(log.miles || 0).toFixed(1)} nm</span>
      </div>
      ${isMsfs && Number.isFinite(landingRate) && landingRate > 0 ? `<div class="log-line"><span>接地率 ${landingRate.toFixed(0)} fpm${Number.isFinite(landingPeakG) ? ` · ${landingPeakG.toFixed(2)} G` : ""}</span><span>机况损耗 ${Number(log.landingWearPercent || 0).toFixed(0)}%</span></div>` : ""}
      ${Number(log.fuelUsedKg) > 0 ? `<div class="log-line"><span>MSFS 实际燃油 ${formatFuel(log.fuelUsedKg)}</span><span>成本 ${formatMoney(Number(log.fuelCost) || 0)}</span></div>` : ""}
      ${isMsfs && Number(log.taskFuelUsedKg) > 0 ? `<div class="log-line"><span>任务累计燃油 ${formatFuel(log.taskFuelUsedKg)}</span><span>成本 ${formatMoney(Number(log.taskFuelCost) || 0)}</span></div>` : ""}
      ${isMsfs && log.settledAt ? `<div class="log-line"><span>任务净收入</span><span>${formatMoney(log.income)}</span></div>` : ""}
      ${log.sopEnabled ? `<div class="log-line"><span>SOP 得分</span><span>${Math.round(Number(log.sopScore ?? 100))}/100 · 奖励折算 ${Math.round(Number(log.sopMultiplier ?? 1) * 100)}%</span></div>` : ""}
      ${log.sopEnabled ? renderSopReport(log.sopReport, { compact: true }) : ""}
      ${log.notes ? `<p>${escapeHtml(log.notes)}</p>` : ""}
    </article>`;
}

function renderHangar() {
  const families = [...new Set(aircraftCatalog.map(aircraftManufacturerFamily))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const kinds = [...new Set(aircraftCatalog.map((aircraft) => aircraft.kind))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const current = families.includes(state.hangarFilter) ? state.hangarFilter : "all";
  const currentKind = kinds.includes(state.hangarKindFilter) ? state.hangarKindFilter : "all";
  const query = String(state.hangarSearch || "").trim().toUpperCase();
  state.hangarFilter = current;
  state.hangarKindFilter = currentKind;
  els.hangarFilter.innerHTML = `<option value="all">全部制造商</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}`;
  els.hangarFilter.value = current;
  if (els.hangarKindFilter) {
    els.hangarKindFilter.innerHTML = `<option value="all">全部类型</option>${kinds.map((kind) => `<option value="${escapeHtml(kind)}">${escapeHtml(kind)}</option>`).join("")}`;
    els.hangarKindFilter.value = currentKind;
  }
  els.hangarSearch.value = state.hangarSearch || "";
  const visibleFleet = aircraftCatalog.filter((aircraft) => {
    const matchesFamily = current === "all" || aircraftManufacturerFamily(aircraft) === current;
    const matchesKind = currentKind === "all" || aircraft.kind === currentKind;
    const searchable = `${aircraft.name} ${aircraftManufacturerFamily(aircraft)} ${aircraft.kind} ${aircraft.pace} ${aircraft.note}`.toUpperCase();
    return matchesFamily && matchesKind && (!query || searchable.includes(query));
  });
  els.hangarGrid.innerHTML = visibleFleet.map(renderAircraftCard).join("") || emptyCard("没有符合条件的机型。");
}

function renderAircraftCard(aircraft) {
  const unlockable = isFreeMode() || state.stats.totalHours >= aircraft.unlockHours;
  const managedCount = state.fleet.filter((item) => !isCompanyAircraft(item)
    && (item.owned || item.rented)
    && (item.catalogId || item.id) === aircraft.id).length;
  const actions = [
    `<button class="primary-btn" data-action="buy-aircraft" data-id="${escapeHtml(aircraft.id)}" type="button" ${unlockable ? "" : "disabled"}><i data-lucide="shopping-cart"></i><span>购买</span></button>`,
    `<button class="ghost-btn" data-action="rent-aircraft" data-id="${escapeHtml(aircraft.id)}" type="button" ${unlockable ? "" : "disabled"}><i data-lucide="calendar-plus"></i><span>租赁</span></button>`
  ];
  return `
    <article class="hangar-card">
      <div class="hangar-head">
        <div>
          <h3>${escapeHtml(aircraft.name)}</h3>
          <p>${escapeHtml(aircraftManufacturerFamily(aircraft))} · ${escapeHtml(aircraft.kind)}</p>
        </div>
        <span class="tag ${unlockable ? "good" : "warn"}">${isFreeMode() ? "自由模式" : unlockable ? "已解锁" : `需 ${aircraft.unlockHours} 小时`}</span>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(aircraft.pace)}</span>
        <span class="tag">航程 ${aircraft.range} nm</span>
        <span class="tag good">在售 · 可重复购买/租赁</span>
        ${managedCount ? `<span class="tag info">个人机队已有 ${managedCount} 架</span>` : ""}
      </div>
      <p>${escapeHtml(aircraft.note)}</p>
      <div class="tag-row">
        <span class="tag">购买 ${formatMoney(aircraft.price)}</span>
        <span class="tag">租金 ${formatMoney(aircraft.rent)}</span>
      </div>
      <div class="card-actions">${actions.join("")}</div>
    </article>`;
}

function renderAircraftManagement() {
  const allManagedFleet = state.fleet.filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented));
  const families = [...new Set(allManagedFleet.map(aircraftManufacturerFamily))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const currentFilter = families.includes(state.aircraftManagementFilter) ? state.aircraftManagementFilter : "all";
  const query = String(state.aircraftManagementSearch || "").trim().toUpperCase();
  state.aircraftManagementFilter = currentFilter;
  if (els.aircraftManagementFilter) {
    els.aircraftManagementFilter.innerHTML = `<option value="all">全部制造商</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}`;
    els.aircraftManagementFilter.value = currentFilter;
  }
  if (els.aircraftManagementSearch) els.aircraftManagementSearch.value = state.aircraftManagementSearch || "";
  const managedFleet = allManagedFleet.filter((aircraft) => {
    const matchesFamily = currentFilter === "all" || aircraftManufacturerFamily(aircraft) === currentFilter;
    const searchable = `${aircraft.name} ${aircraftManufacturerFamily(aircraft)} ${aircraft.kind} ${aircraftFleetNumber(aircraft)} ${aircraft.catalogId || ""}`.toUpperCase();
    return matchesFamily && (!query || searchable.includes(query));
  });
  const liveAircraft = lastTelemetryConnected ? telemetryFleetAircraft(lastTelemetry) : null;
  const liveFuel = liveAircraft ? telemetryFuelKg(lastTelemetry) : null;
  els.aircraftManagementSummary.innerHTML = `
    <div class="hangar-summary-item">
      <span>机队规模</span>
      <strong>${managedFleet.length} 架</strong>
      <small>购买 ${managedFleet.filter((aircraft) => aircraft.owned).length} · 租用 ${managedFleet.filter((aircraft) => aircraft.rented).length}</small>
    </div>
    <div class="hangar-summary-item">
      <span>当前任务机型</span>
      <strong>${escapeHtml(currentAircraft().name)}</strong>
      <small>${escapeHtml(getAircraftHours(currentAircraft().id).toFixed(1))} 小时运营记录</small>
    </div>
    <div class="hangar-summary-item ${liveFuel !== null ? "is-live" : ""}">
      <span>MSFS 实际燃油</span>
      <strong>${liveFuel !== null ? formatFuel(liveFuel) : "等待遥测"}</strong>
      <small>${liveAircraft ? escapeHtml(liveAircraft.name) : "连接后自动匹配机型"}</small>
    </div>
    <div class="hangar-summary-item">
      <span>累计实际消耗</span>
      <strong>${formatFuel(state.stats.totalFuelKg)}</strong>
      <small>燃油成本 ${formatMoney(Math.round(state.stats.totalFuelCost))}</small>
    </div>`;
  els.aircraftManagementGrid.innerHTML = managedFleet.map((aircraft) => renderManagedAircraftCard(aircraft)).join("")
    || emptyCard("当前没有已购买或租用的飞机。");
}

function renderManagedAircraftCard(aircraft, controlPrefix = "") {
  const selected = aircraft.selected;
  const liveInMsfs = lastTelemetryConnected && telemetryFleetAircraft(lastTelemetry)?.id === aircraft.id;
  const logs = state.logs.filter((log) => log.aircraftId === aircraft.id);
  const fuelUsedKg = logs.reduce((sum, log) => sum + Math.max(0, Number(log.fuelUsedKg) || 0), 0);
  const fuelKg = liveInMsfs ? telemetryFuelKg(lastTelemetry) : aircraft.lastFuelKg;
  const capacityKg = liveInMsfs ? telemetryFuelCapacityKg(lastTelemetry) || aircraft.fuelCapacityKg : aircraft.fuelCapacityKg;
  const currentFuelPercent = fuelKg !== null && Number(capacityKg) > 0
    ? Math.max(0, Math.min(100, Number(fuelKg) / Number(capacityKg) * 100))
    : null;
  const sliderState = fuelSliderState(
    currentFuelPercent,
    fuelTargetPercents.get(aircraft.id),
    fuelTargetBaselines.get(aircraft.id)
  );
  const minimumFuelPercent = sliderState.minimumPercent;
  const targetFuelPercent = sliderState.targetPercent;
  const controlId = controlPrefix ? `${controlPrefix}-${aircraft.id}` : aircraft.id;
  if (fuelTargetPercents.has(aircraft.id) && !sliderState.usesRequestedTarget) {
    fuelTargetPercents.delete(aircraft.id);
    fuelTargetBaselines.delete(aircraft.id);
  }
  const onGround = liveInMsfs && telemetryBoolean(lastTelemetry?.onGround);
  const engineRunning = liveInMsfs && telemetryBoolean(lastTelemetry?.engineRunning);
  const canUseFuelSlider = liveInMsfs && onGround && !engineRunning && Number(capacityKg) > 0;
  const refuelPending = refuelPendingIds.has(aircraft.id);
  const refuelBlockedReason = !liveInMsfs
    ? "请先在 MSFS 切换到此机型"
    : !onGround ? "飞机必须停在地面"
    : engineRunning ? "请先关闭发动机"
    : !(Number(capacityKg) > 0) ? "等待 MSFS 返回油箱容量"
    : "";
  const condition = aircraftCondition(aircraft);
  const conditionLevel = aircraftConditionLevel(aircraft);
  const maintenanceCost = aircraftMaintenanceCost(aircraft);
  const landingRate = Number(aircraft.lastLandingRateFpm);
  const landingPeakG = Number(aircraft.lastLandingPeakG);
  const hasLandingData = Number.isFinite(landingRate) && landingRate > 0;
  const landingLocation = [aircraft.lastLandingAirport, aircraft.lastLandingRunway].filter(Boolean).join(" ");
  const landingConditionDetail = hasLandingData
    ? `最近落地 ${landingRate.toFixed(0)} fpm${Number.isFinite(landingPeakG) ? ` · ${landingPeakG.toFixed(2)} G` : ""} · 损耗 ${Number(aircraft.lastLandingWearPercent || 0).toFixed(0)}%${landingLocation ? ` · ${escapeHtml(landingLocation)}` : ""}`
    : "等待 MSFS 落地数据";
  const maintenanceBlocked = aircraftHasActiveMission(aircraft);
  const actions = isCompanyAircraft(aircraft)
    ? [`<button class="primary-btn" type="button" disabled>公司机型</button>`]
    : [`<button class="primary-btn" data-action="select-aircraft" data-id="${escapeHtml(aircraft.id)}" type="button">${selected ? "当前机型" : "设为默认"}</button>`];
  actions.push(`<button class="ghost-btn" data-action="refuel-aircraft" data-id="${escapeHtml(aircraft.id)}" data-control-prefix="${escapeHtml(controlPrefix)}" type="button" ${!canUseFuelSlider || targetFuelPercent <= minimumFuelPercent || refuelPending ? "disabled" : ""} title="${escapeHtml(refuelBlockedReason || "将 MSFS 实际油量加注到目标值")}"><i data-lucide="fuel"></i><span>${refuelPending ? "加注中" : "确认加注"}</span></button>`);
  actions.push(`<button class="ghost-btn" data-action="repair-aircraft" data-id="${escapeHtml(aircraft.id)}" type="button" ${maintenanceCost <= 0 || maintenanceBlocked ? "disabled" : ""} title="${maintenanceBlocked ? "执行任务期间不能维修" : maintenanceCost <= 0 ? "飞机状态良好" : `维修费用 ${formatMoney(maintenanceCost)}`}"><i data-lucide="wrench"></i><span>维修${maintenanceCost > 0 ? ` ${formatMoney(maintenanceCost)}` : ""}</span></button>`);
  if (aircraft.rented) actions.push(`<button class="ghost-btn" data-action="return-aircraft" data-id="${escapeHtml(aircraft.id)}" type="button">归还</button>`);
  if (aircraft.owned && (!isStarterAircraft(aircraft.id) || isCompanyAircraft(aircraft))) actions.push(`<button class="ghost-btn" data-action="sell-aircraft" data-id="${escapeHtml(aircraft.id)}" type="button">出售</button>`);
  return `
    <article class="hangar-card ${selected ? "is-current" : ""} ${liveInMsfs ? "is-msfs-live" : ""}">
      <div class="hangar-head">
        <div>
          <h3>${escapeHtml(aircraft.name)}</h3>
          <p>${escapeHtml(aircraftManufacturerFamily(aircraft))} · ${escapeHtml(aircraft.kind)} · ${isCompanyAircraft(aircraft) ? "公司配备" : aircraft.owned ? "已购买" : "已租用"} · 机队编号 ${aircraftFleetNumber(aircraft)}</p>
        </div>
        <div class="hangar-statuses">
          ${liveInMsfs ? `<span class="tag good">MSFS 当前机型</span>` : ""}
          ${selected ? `<span class="tag info">任务默认</span>` : ""}
          ${isCompanyAircraft(aircraft) ? `<span class="tag good">公司专属</span>` : ""}
        </div>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHtml(aircraft.pace)}</span>
        <span class="tag">航程 ${aircraft.range} nm</span>
        <span class="tag">${aircraft.owned ? `资产 ${formatMoney(aircraft.price)}` : `租金 ${formatMoney(aircraft.rent)}`}</span>
      </div>
      <div class="aircraft-ops">
        <div><span>飞行记录</span><strong>${logs.length} 航段</strong><small>${escapeHtml(getAircraftHours(aircraft.id).toFixed(1))} 小时</small></div>
        <div><span>实际消耗</span><strong>${formatFuel(fuelUsedKg)}</strong><small>已结算任务累计</small></div>
        <div><span>最近实际油量</span><strong>${formatFuel(aircraft.lastFuelKg)}</strong><small>${formatFuelTimestamp(aircraft.lastFuelAt)}</small></div>
      </div>
      <div class="aircraft-service-grid">
        <div class="aircraft-service-control">
          <div class="aircraft-service-label">
            <span>加注燃油</span>
          <output id="fuelTarget-${controlId}" for="fuelSlider-${controlId}">${targetFuelPercent.toFixed(0)}%</output>
        </div>
          <input id="fuelSlider-${controlId}" class="fuel-slider" data-action="fuel-target" data-id="${escapeHtml(aircraft.id)}" data-control-prefix="${escapeHtml(controlPrefix)}" data-minimum="${minimumFuelPercent}" type="range" min="0" max="100" step="1" value="${targetFuelPercent}" aria-label="${escapeHtml(aircraft.name)} 加注燃油目标" ${canUseFuelSlider && !refuelPending ? "" : "disabled"}>
          <small>${canUseFuelSlider ? `当前 ${currentFuelPercent.toFixed(0)}% · ${formatFuel(fuelKg)} / ${formatFuel(capacityKg)}` : refuelBlockedReason}</small>
        </div>
        <div class="aircraft-service-control">
          <div class="aircraft-service-label"><span>飞机机况</span><strong>${condition.toFixed(1)}%</strong></div>
          <div class="condition-meter ${conditionLevel.className}" role="meter" aria-label="${escapeHtml(aircraft.name)} 机况" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${condition}"><span style="width:${condition}%"></span></div>
          <small>${escapeHtml(conditionLevel.label)} · ${landingConditionDetail}${maintenanceCost > 0 ? ` · 维修费用 ${formatMoney(maintenanceCost)}` : ""}</small>
        </div>
      </div>
      <div class="card-actions">${actions.join("")}</div>
    </article>`;
}

function companyPilotUpgradeCost(pilot) {
  return 4500 * Math.max(1, Number(pilot?.skillLevel) || 1);
}

function companyEmpty(message = "请先在公司管理中创建航空公司。") {
  return `<article class="company-empty"><i data-lucide="building-2"></i><strong>${message}</strong></article>`;
}

function setCompanySection(section) {
  if (!state.company) return;
  state.company.activeSection = ["management", "tasks", "pilots", "recruitment", "hangar", "finance", "flight-log"].includes(section) ? section : "management";
  renderCompanyManagement();
  saveState();
  wireIcons();
}

function renderCompanyManagement() {
  const company = state.company;
  const created = company?.created === true;
  const section = company?.activeSection || "management";
  document.querySelectorAll("[data-company-section]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.companySection === section);
  });
  document.querySelectorAll("[data-company-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.companyPanel === section);
  });
  if (!created) {
    els.companyIdentity.innerHTML = `<span class="tag warn">尚未创建公司</span>`;
    els.companyManagementPanel.innerHTML = `
      <section class="panel company-create-panel">
        <div class="company-create-copy">
          <span class="company-kicker">公司初始化</span>
          <h3>创建你的航空公司</h3>
          <p>输入航空公司三字码自动匹配公司名称，设置运营基地、初始飞机和启动资金。启动资金从个人账户转入公司账户。</p>
          <p class="company-requirement ${canCreateCompany() ? "is-ready" : ""}">${companyCreationRequirementText()}</p>
        </div>
        <div class="form-grid company-form-grid">
          <label class="field company-name-field"><span>公司名称（三字码）</span><input id="companyNameInput" type="text" inputmode="latin" minlength="3" maxlength="3" pattern="[A-Za-z]{3}" autocomplete="off" spellcheck="false" value="${escapeHtml(currentAirline().code)}" placeholder="输入三字码，例如 CCA"><output id="companyNameResult" class="company-airline-result"></output></label>
          <label class="field company-base-field"><span>公司基地</span><input id="companyBaseInput" type="text" inputmode="text" minlength="4" maxlength="4" pattern="[A-Za-z]{4}" autocomplete="off" spellcheck="false" value="${escapeHtml(normalizeAirportInputCode(state.pilot.base || "ZBAA"))}" placeholder="输入四字 ICAO"><output id="companyBaseResult" class="company-base-result"></output></label>
          <label class="field company-aircraft-field"><span>公司初始飞机</span><select id="companyAircraftSelect" class="select" aria-label="选择公司初始飞机">${aircraftCatalog.filter((aircraft) => aircraft.kind === "干线喷气").map((aircraft) => `<option value="${escapeHtml(aircraft.id)}">${escapeHtml(aircraft.name)} · ${escapeHtml(aircraft.pace)}</option>`).join("")}</select><small class="field-hint">创建后归公司所有，可在机库管理中维护。</small></label>
          <label class="field"><span>启动资金</span><input id="companyFundsInput" type="number" min="${COMPANY_STARTUP_FUNDS_MIN}" max="${COMPANY_STARTUP_FUNDS_MAX}" step="1000" value="${COMPANY_STARTUP_FUNDS_MIN}"><small class="field-hint">最多 ${formatMoney(COMPANY_STARTUP_FUNDS_MAX)}</small></label>
        </div>
        <div class="company-create-preview" id="companyCreatePreview"></div>
        <div class="card-actions"><button class="primary-btn" data-action="create-company" type="button" ${canCreateCompany() ? "" : "disabled"}><i data-lucide="building-2"></i><span>创建航空公司</span></button></div>
      </section>`;
    renderCompanyPlaceholderPanels();
    updateCompanyCreatePreview();
    return;
  }
  const airline = companyAirline();
  const base = companyBase();
  const pilots = company.pilots.filter((pilot) => pilot.status !== "fired");
  const managedFleet = companyManagedFleet();
  els.companyIdentity.innerHTML = `<div class="company-identity-main">${airlineLogo(airline, "airline-logo mini")}<strong>${escapeHtml(company.name || airline.name)}</strong><span>${escapeHtml(airline.code)}</span></div>`;
  els.companyManagementPanel.innerHTML = `
    <div class="company-overview-grid">
      <section class="panel company-profile-card">
        <div class="company-profile-head">
          ${airlineLogo(airline)}
          <div><h3>${escapeHtml(company.name || airline.name)}</h3><p>${escapeHtml(airline.name)} · ${escapeHtml(airline.type)}</p></div>
          <span class="tag good">运营中</span>
        </div>
        <div class="tag-row"><span class="tag">基地 ${escapeHtml(company.base)}</span><span class="tag">${escapeHtml(base?.name || "未知机场")}</span><span class="tag">${pilots.length} 名飞行员</span><span class="tag">${managedFleet.length} 架飞机</span></div>
        <div class="company-management-actions"><small>关闭公司会清除全部公司数据，个人飞机和个人飞行记录不受影响。</small><button class="action-btn danger" data-action="close-company" type="button"><i data-lucide="power"></i><span>关闭公司</span></button></div>
      </section>
      <section class="panel company-cash-card"><span>公司可用资金</span><strong>${formatMoney(company.funds)}</strong><small>独立于个人账户 · ${company.transactions.length} 条流水</small></section>
    </div>
    <div class="company-summary">
      <div><span>公司任务</span><strong>${company.tasks.length}</strong><small>已派遣任务</small></div>
      <div><span>在岗飞行员</span><strong>${escapeHtml(pilots.filter((pilot) => pilot.status === "active").length)}</strong><small>可接受派遣</small></div>
      <div><span>公司机库</span><strong>${managedFleet.length}</strong><small>含公司初始飞机</small></div>
      <div><span>合作航司</span><strong>${escapeHtml(airline.code)}</strong><small>${escapeHtml(airline.region)}</small></div>
    </div>`;
  renderCompanyTasks();
  renderCompanyPilots();
  renderCompanyApplicants();
  renderCompanyHangar();
  renderCompanyFinance();
  renderCompanyFlightLogs();
}

function renderCompanyPlaceholderPanels() {
  els.companyTaskList.innerHTML = companyEmpty();
  els.companyPilotSummary.innerHTML = "";
  els.companyPilotList.innerHTML = companyEmpty();
  els.companyApplicantList.innerHTML = companyEmpty();
  els.companyHangarSummary.innerHTML = "";
  els.companyHangarGrid.innerHTML = companyEmpty();
  els.companyFinanceSummary.innerHTML = "";
  els.companyTransactionList.innerHTML = `<p class="fund-empty">创建公司后显示公司资金流水。</p>`;
  els.companyFlightLogList.innerHTML = companyEmpty("创建公司后显示公司航班日志。");
}

function updateCompanyCreatePreview() {
  const preview = document.getElementById("companyCreatePreview");
  if (!preview) return;
  updateCompanyBasePreview();
  const input = document.getElementById("companyNameInput");
  const result = document.getElementById("companyNameResult");
  const code = normalizeAirlineCode(input?.value);
  if (input && input.value !== code) input.value = code;
  const airline = airlines.find((item) => item.code === code) || currentAirline();
  if (result) {
    result.textContent = code.length < 3 ? "请输入三字航空公司代码" : airlines.some((item) => item.code === code) ? `${airline.code} · ${airline.name}` : "未找到对应航空公司";
    result.classList.toggle("is-valid", code.length === 3 && airlines.some((item) => item.code === code));
    result.classList.toggle("is-invalid", code.length === 3 && !airlines.some((item) => item.code === code));
  }
  preview.innerHTML = `${airlineLogo(airline)}<div><strong>${escapeHtml(airline.name)}</strong><span>${escapeHtml(airline.code)} · ${escapeHtml(airline.region)} · ${escapeHtml(airline.type)}</span></div>`;
}

function updateCompanyBasePreview() {
  const input = document.getElementById("companyBaseInput");
  const result = document.getElementById("companyBaseResult");
  if (!input || !result) return;
  const code = normalizeAirportInputCode(input.value);
  if (input.value !== code) input.value = code;
  const airport = code.length === 4 ? companyAirportByIcao(code) : null;
  result.textContent = code.length < 4 ? "请输入四字 ICAO 代码" : companyAirportLabel(airport);
  result.classList.toggle("is-valid", Boolean(airport));
  result.classList.toggle("is-invalid", code.length === 4 && !airport);
}

function companyTaskSelection(missionId) {
  const pilotSelect = els.companyTaskList?.querySelector(`[data-company-pilot-for="${missionId}"]`);
  const aircraftSelect = els.companyTaskList?.querySelector(`[data-company-aircraft-for="${missionId}"]`);
  return { pilotId: String(pilotSelect?.value || ""), aircraftId: String(aircraftSelect?.value || "") };
}

function setCompanyTaskSelectOptions(select, items, selectedId, emptyLabel, renderOption) {
  if (!select) return "";
  const validSelectedId = items.some((item) => item.id === selectedId) ? selectedId : "";
  const options = items.map((item) => renderOption(item, item.id === validSelectedId)).join("");
  select.innerHTML = `<option value=""${items.length ? "" : " disabled"}>${escapeHtml(emptyLabel)}</option>${options}`;
  select.value = validSelectedId;
  return validSelectedId;
}

function updateCompanyTaskSelectors(row, changedBy = "") {
  if (!row) return;
  const pilotSelect = row.querySelector("[data-company-pilot-for]");
  const aircraftSelect = row.querySelector("[data-company-aircraft-for]");
  const dispatchButton = row.querySelector('[data-action="dispatch-company-task"]');
  if (!pilotSelect || !aircraftSelect) return;
  const pilots = state.company.pilots.filter((pilot) => pilot.status === "active");
  const aircraft = companyManagedFleet();
  let pilotId = String(pilotSelect.value || "");
  let aircraftId = String(aircraftSelect.value || "");
  let pilot = pilots.find((item) => item.id === pilotId);
  let plane = aircraft.find((item) => item.id === aircraftId);

  if (pilot && plane && !pilotCanOperateAircraft(pilot, plane)) {
    if (changedBy === "aircraft") {
      pilotId = "";
      pilot = null;
    } else {
      aircraftId = "";
      plane = null;
    }
  }

  const visibleAircraft = pilot ? aircraft.filter((item) => pilotCanOperateAircraft(pilot, item)) : aircraft;
  const visiblePilots = plane ? pilots.filter((item) => pilotCanOperateAircraft(item, plane)) : pilots;
  const pilotPlaceholder = pilots.length && !visiblePilots.length ? "无匹配飞行员" : "选择飞行员";
  const aircraftPlaceholder = aircraft.length && !visibleAircraft.length ? "无匹配飞机" : "选择飞机";
  pilotId = setCompanyTaskSelectOptions(
    pilotSelect,
    visiblePilots,
    pilotId,
    pilotPlaceholder,
    (item, selected) => `<option value="${escapeHtml(item.id)}"${selected ? " selected" : ""}${item.assignedTaskId ? " disabled" : ""}>${escapeHtml(item.name)} · 技能 ${item.skillLevel}</option>`
  );
  aircraftId = setCompanyTaskSelectOptions(
    aircraftSelect,
    visibleAircraft,
    aircraftId,
    aircraftPlaceholder,
    (item, selected) => `<option value="${escapeHtml(item.id)}"${selected ? " selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(item.kind)} · 编号 ${escapeHtml(aircraftFleetNumber(item))}</option>`
  );
  if (dispatchButton) dispatchButton.disabled = !pilotId || !aircraftId;
}

function renderCompanyTasks() {
  if (!state.company.created) return;
  if (!Array.isArray(state.company.taskOffers)) state.company.taskOffers = [];
  while (state.company.taskOffers.filter((offer) => offer.status === "open").length < COMPANY_TASK_OFFER_COUNT) {
    state.company.taskOffers.push(companyMissionOffer());
  }
  const pilots = state.company.pilots.filter((pilot) => pilot.status === "active");
  const aircraft = companyManagedFleet();
  const selections = new Map([...els.companyTaskList.querySelectorAll("[data-company-pilot-for]")].map((select) => {
    const missionId = select.dataset.companyPilotFor;
    return [missionId, { pilotId: select.value, aircraftId: els.companyTaskList.querySelector(`[data-company-aircraft-for="${missionId}"]`)?.value || "" }];
  }));
  const assigned = state.company.tasks.map((task) => {
    const pilot = state.company.pilots.find((item) => item.id === task.pilotId);
    const plane = state.fleet.find((item) => item.id === task.aircraftId);
    const flightLog = state.company.flightLogs?.find((log) => log.taskId === task.id);
    const resultLabel = task.status === "assigned" ? "已派遣" : companyFlightStatusLabel(flightLog?.status || task.status);
    return `<article class="company-row company-task-row"><div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.origin)} → ${escapeHtml(task.destination)} · ${escapeHtml(resultLabel)} · ${escapeHtml(companyAirportCheckLabel(flightLog || task))}</p></div><div class="company-row-meta"><span class="tag info">${escapeHtml(pilot?.name || "未分配")}</span><span class="tag">${escapeHtml(plane?.name || "未分配飞机")} · 编号 ${escapeHtml(aircraftFleetNumber(plane))}</span>${task.status === "assigned" ? `<button class="ghost-btn" data-action="complete-company-task" data-id="${escapeHtml(task.id)}" type="button"><i data-lucide="circle-check"></i><span>完成派遣</span></button>` : `<span class="tag ${escapeHtml(flightLog?.status === "airport-mismatch" ? "bad" : "good")}">收入 ${formatMoney(task.payout || 0)}</span>`}</div></article>`;
  }).join("");
  const available = state.company.taskOffers.filter((mission) => mission.status === "open");
  const availableHtml = available.map((mission) => `
    <article class="company-row company-task-row">
      <div><strong>${escapeHtml(mission.title)}</strong><p>${escapeHtml(mission.category)} · ${escapeHtml(mission.origin || state.company.base)} → ${escapeHtml(mission.destination || "任务现场")} · ${formatTaskDistanceNm(mission.distance)} · 奖励 ${formatMoney(mission.payout)}</p><small>建议机型：${escapeHtml(mission.aircraftHint || "公司机队可用机型")}</small></div>
      <div class="company-dispatch-controls" data-company-dispatch-for="${escapeHtml(mission.id)}">
        <select data-company-pilot-for="${escapeHtml(mission.id)}" aria-label="${escapeHtml(mission.title)} 派遣飞行员"><option value="">选择飞行员</option>${pilots.map((pilot) => `<option value="${escapeHtml(pilot.id)}"${escapeHtml(selections.get(mission.id)?.pilotId === pilot.id ? " selected" : "")}${pilot.assignedTaskId ? " disabled" : ""}>${escapeHtml(pilot.name)} · 技能 ${pilot.skillLevel}</option>`).join("")}</select>
        <select data-company-aircraft-for="${escapeHtml(mission.id)}" aria-label="${escapeHtml(mission.title)} 派遣飞机"><option value="">选择飞机</option>${aircraft.map((plane) => `<option value="${escapeHtml(plane.id)}"${escapeHtml(selections.get(mission.id)?.aircraftId === plane.id ? " selected" : "")}>${escapeHtml(plane.name)} · ${escapeHtml(plane.kind)} · 编号 ${escapeHtml(aircraftFleetNumber(plane))}</option>`).join("")}</select>
        <button class="primary-btn" data-action="dispatch-company-task" data-id="${escapeHtml(mission.id)}" type="button" ${!pilots.length || !aircraft.length ? "disabled" : ""}><i data-lucide="send"></i><span>派遣任务</span></button>
      </div>
    </article>`).join("");
  els.companyTaskList.innerHTML = `<div class="company-list-heading"><span>已派遣</span><small>${state.company.tasks.length} 条</small></div>${assigned || `<p class="company-muted">暂无已派遣任务。</p>`}<div class="company-list-heading"><span>可派遣任务</span><small>${available.length} 条</small></div>${availableHtml || `<p class="company-muted">暂无可派遣任务，请先刷新任务。</p>`}`;
  available.forEach((mission) => updateCompanyTaskSelectors(els.companyTaskList.querySelector(`[data-company-dispatch-for="${mission.id}"]`)));
}

function renderCompanyPilots() {
  if (!state.company.created) return;
  const pilots = state.company.pilots.filter((pilot) => pilot.status !== "fired");
  els.companyPilotSummary.innerHTML = `<div><span>在岗</span><strong>${escapeHtml(pilots.filter((pilot) => pilot.status === "active").length)}</strong><small>可派遣</small></div><div><span>平均技能</span><strong>${pilots.length ? Math.round(pilots.reduce((sum, pilot) => sum + Number(pilot.skill || 0), 0) / pilots.length) : 0}</strong><small>技能评分</small></div><div><span>月度薪资</span><strong>${formatMoney(pilots.reduce((sum, pilot) => sum + Number(pilot.salary || 0), 0))}</strong><small>预计支出</small></div>`;
  els.companyPilotList.innerHTML = pilots.map((pilot) => {
    const assigned = state.company.tasks.find((task) => task.id === pilot.assignedTaskId);
    const cost = companyPilotUpgradeCost(pilot);
    return `<article class="company-row company-pilot-row"><div class="pilot-avatar">${escapeHtml((pilot.name || "飞").slice(0, 1))}</div><div class="company-row-main"><strong>${escapeHtml(pilot.name)} ${pilot.owner ? "· 公司负责人" : ""}</strong><p>${escapeHtml(pilotAircraftKinds(pilot).join("、"))} · 技能等级 ${pilot.skillLevel} · 评分 ${pilot.skill} · ${pilot.experienceHours.toFixed(1)} 小时</p><small>${assigned ? `已派遣：${escapeHtml(assigned.title)}` : "当前空闲，可接受派遣"}</small></div><div class="card-actions company-inline-actions"><button class="ghost-btn" data-action="upgrade-company-pilot" data-id="${escapeHtml(pilot.id)}" type="button" ${pilot.skillLevel >= 5 || state.company.funds < cost ? "disabled" : ""}><i data-lucide="arrow-up-circle"></i><span>提升 ${formatMoney(cost)}</span></button><button class="ghost-btn danger-btn" data-action="fire-company-pilot" data-id="${escapeHtml(pilot.id)}" type="button" ${pilot.owner || assigned ? "disabled" : ""}>解雇</button><button class="text-btn" data-action="open-company-tasks" type="button">派遣任务</button></div></article>`;
  }).join("") || companyEmpty("还没有在岗飞行员，请先招聘。");
}

function renderCompanyApplicants() {
  if (!state.company.created) return;
  els.companyApplicantList.innerHTML = state.company.applicants.map((applicant) => `<article class="company-row company-applicant-row"><div class="pilot-avatar is-applicant">${escapeHtml((applicant.name || "候").slice(0, 1))}</div><div class="company-row-main"><strong>${escapeHtml(applicant.name)}</strong><p>技能等级 ${applicant.skillLevel} · 评分 ${applicant.skill} · 可操作 ${escapeHtml(normalizeAircraftKinds(applicant.aircraftKinds || applicant.aircraftKind).join("、"))}</p><small>经验 ${applicant.experienceHours.toFixed(1)} 小时 · 月薪 ${formatMoney(applicant.salary)}</small></div><div class="company-inline-actions"><span class="tag warn">雇佣 ${formatMoney(applicant.hirePrice)}</span><button class="primary-btn" data-action="hire-company-pilot" data-id="${escapeHtml(applicant.id)}" type="button" ${state.company.funds < applicant.hirePrice ? "disabled" : ""}><i data-lucide="user-plus"></i><span>雇佣</span></button></div></article>`).join("") || companyEmpty("暂无候选人，请刷新招聘名单。");
}

function renderCompanyHangar() {
  if (!state.company.created) return;
  const fleet = companyManagedFleet();
  const families = [...new Set(fleet.map(aircraftManufacturerFamily))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const currentFilter = families.includes(state.companyHangarFilter) ? state.companyHangarFilter : "all";
  const query = String(state.companyHangarSearch || "").trim().toUpperCase();
  state.companyHangarFilter = currentFilter;
  if (els.companyHangarFilter) {
    els.companyHangarFilter.innerHTML = `<option value="all">全部制造商</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}`;
    els.companyHangarFilter.value = currentFilter;
  }
  if (els.companyHangarSearch) els.companyHangarSearch.value = state.companyHangarSearch || "";
  const visibleFleet = fleet.filter((aircraft) => {
    const matchesFamily = currentFilter === "all" || aircraftManufacturerFamily(aircraft) === currentFilter;
    const searchable = `${aircraft.name} ${aircraftManufacturerFamily(aircraft)} ${aircraft.kind} ${aircraftFleetNumber(aircraft)} ${aircraft.catalogId || ""}`.toUpperCase();
    return matchesFamily && (!query || searchable.includes(query));
  });
  els.companyHangarSummary.innerHTML = `<div><span>机队规模</span><strong>${fleet.length} 架</strong><small>含公司初始飞机</small></div><div><span>当前筛选</span><strong>${visibleFleet.length} 架</strong><small>按机型或编号查看</small></div><div><span>公司配备</span><strong>${fleet.filter((aircraft) => isCompanyAircraft(aircraft)).length}</strong><small>公司专属飞机</small></div><div><span>维修状态</span><strong>${fleet.filter((aircraft) => aircraftCondition(aircraft) < 95).length}</strong><small>需要关注</small></div>`;
  els.companyHangarGrid.innerHTML = visibleFleet.map((aircraft) => renderManagedAircraftCard(aircraft, "company")).join("") || companyEmpty("没有符合条件的公司飞机。");
}

function renderCompanyFinance() {
  if (!state.company.created) return;
  const transactions = Array.isArray(state.company.transactions) ? state.company.transactions : [];
  const income = transactions.reduce((sum, transaction) => sum + Math.max(0, Number(transaction.amount) || 0), 0);
  const expense = transactions.reduce((sum, transaction) => sum + Math.max(0, -(Number(transaction.amount) || 0)), 0);
  els.companyFinanceSummary.innerHTML = `<div><span>公司余额</span><strong>${formatMoney(state.company.funds)}</strong><small>当前可用</small></div><div><span>累计收入</span><strong class="is-income">+${formatMoney(income)}</strong><small>注资和经营收入</small></div><div><span>累计支出</span><strong class="is-expense">-${formatMoney(expense)}</strong><small>招聘与培训</small></div><div><span>净变动</span><strong>${formatMoney(income - expense)}</strong><small>公司账户累计</small></div>`;
  els.companyTransactionList.innerHTML = transactions.map((transaction) => {
    const amount = Number(transaction.amount) || 0;
    const positive = amount >= 0;
    return `<article class="fund-transaction"><span class="fund-transaction-icon ${positive ? "is-income" : "is-expense"}" aria-hidden="true"><i data-lucide="${positive ? "arrow-down-left" : "arrow-up-right"}"></i></span><div class="fund-transaction-detail"><strong>${escapeHtml(transaction.title)}</strong><span>${escapeHtml(transaction.detail || "公司资金记录")} · ${new Date(transaction.date).toLocaleString("zh-CN")}</span></div><div class="fund-transaction-amount"><strong class="${positive ? "is-income" : "is-expense"}">${positive ? "+" : "-"}${formatMoney(Math.abs(amount))}</strong><span>余额 ${formatMoney(transaction.balance)}</span></div></article>`;
  }).join("") || `<p class="fund-empty">暂无公司资金记录。</p>`;
}

function companyFlightStatusLabel(status) {
  return ({ assigned: "已派遣", completed: "已完成", crashed: "坠机", "airport-mismatch": "机场不符" })[status] || "待校验";
}

function companyAirportCheckLabel(log) {
  if (log?.airportCheck === "passed") return "起降机场已通过";
  if (log?.airportCheck === "failed") return "起降机场不符";
  return "等待实际起降数据";
}

function renderCompanyFlightLogs() {
  if (!els.companyFlightLogList) return;
  if (!state.company?.created) {
    els.companyFlightLogList.innerHTML = companyEmpty("创建公司后显示公司航班日志。");
    return;
  }
  const logs = Array.isArray(state.company.flightLogs) ? state.company.flightLogs : [];
  els.companyFlightLogList.innerHTML = logs.map((log) => {
    const status = companyFlightStatusLabel(log.status);
    const statusClass = log.status === "crashed" || log.status === "airport-mismatch" ? "bad" : log.status === "completed" ? "good" : "info";
    const planned = `${escapeHtml(log.origin || "未知")} → ${escapeHtml(log.destination || "未知")}`;
    const actual = log.departureAirport || log.arrivalAirport
      ? `${escapeHtml(log.departureAirport || "未知")} → ${escapeHtml(log.arrivalAirport || "未知")}`
      : "实际机场：尚未记录";
    const safety = Number.isFinite(Number(log.landingPeakG)) ? `接地峰值 ${Number(log.landingPeakG).toFixed(2)}G` : "接地峰值：尚未记录";
    return `<article class="company-row company-flight-log-row"><div class="company-row-main"><strong>${escapeHtml(log.title || "公司航班任务")}</strong><p>${planned} · ${escapeHtml(log.pilotName || "未分配飞行员")} · ${escapeHtml(log.aircraftName || "未分配飞机")}</p><small>${actual} · ${escapeHtml(companyAirportCheckLabel(log))} · ${safety}</small></div><div class="company-row-meta"><span class="tag ${statusClass}">${status}</span><small>${log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN") : ""}</small></div></article>`;
  }).join("") || `<p class="company-muted">暂无公司航班任务记录。</p>`;
}

function renderAchievements() {
  const rows = achievementDefs.map((def) => {
    const unlocked = state.achievements.find((item) => item.id === def.id)?.unlocked;
    return `
      <article class="achievement-card">
        <div class="mission-head">
          <div>
            <h3>${escapeHtml(def.title)}</h3>
            <p>${def.desc}</p>
          </div>
          <span class="tag ${unlocked ? "good" : "warn"}">${unlocked ? "已达成" : "未完成"}</span>
        </div>
      </article>`;
  }).join("");
  els.achievementList.innerHTML = rows;
}

function renderRankTimeline() {
  const currentHours = state.stats.totalHours;
  els.profileRankTimeline.innerHTML = rankRules.map((rank, index) => {
    const reached = currentHours >= rank.minHours;
    return `
      <article class="rank-card">
        <div class="mission-head">
          <div>
            <h3>${rank.rank}</h3>
            <p>${rank.minHours}${rank.nextHours ? ` - ${rank.nextHours} 小时` : "以上"}</p>
          </div>
          <span class="tag ${reached ? "good" : "warn"}">${reached ? "已到达" : "未到达"}</span>
        </div>
      </article>`;
  }).join("");
}

function renderAircraftLicenses() {
  if (!els.aircraftLicenseList) return;
  const records = normalizeAircraftLicenses(state.licenses);
  state.licenses = records;
  const licensedCount = records.filter((record) => record.purchased && record.assessmentCompleted).length;
  els.licenseProgress.textContent = `${licensedCount} / ${records.length}`;
  els.aircraftLicenseList.innerHTML = records.map((record) => {
    const license = aircraftLicense(record.id);
    if (!license) return "";
    const purchased = record.purchased;
    const licensed = purchased && record.assessmentCompleted;
    const pendingAssessment = purchased && !licensed;
    const affordable = state.cash >= license.cost;
    return `<article class="aircraft-license-row ${licensed ? "is-licensed" : pendingAssessment ? "is-pending" : ""}">
      <div class="aircraft-license-icon"><i data-lucide="${licensed ? "badge-check" : pendingAssessment ? "clipboard-check" : "plane"}"></i></div>
      <div class="aircraft-license-main"><strong>${escapeHtml(license.name)}</strong><span>${escapeHtml(license.kind)} · ${licensed ? "已取得执照" : pendingAssessment ? "待完成机型考核" : "需要购买考核资格"}</span></div>
      <div class="aircraft-license-action">${licensed
        ? `<span class="tag good">已拥有</span>`
        : pendingAssessment
          ? `<span class="tag warn">考核任务进行中</span>`
        : `<button class="ghost-btn license-buy-btn" data-action="buy-aircraft-license" data-id="${escapeHtml(license.id)}" type="button" ${affordable ? "" : "disabled"}><i data-lucide="credit-card"></i><span>${formatMoney(license.cost)}</span></button>`}</div>
    </article>`;
  }).join("");
}

function renderProfileOverview() {
  const rank = getRankInfo(state.stats.totalHours);
  const base = airportByIcao(state.pilot.base);
  els.profileOverview.innerHTML = `
    <div class="mission-head">
      <div>
        <h3>${escapeHtml(state.pilot.name)}</h3>
        <p>${escapeHtml(state.pilot.base)}${base ? ` · ${escapeHtml(base.name)}` : ""}</p>
      </div>
      <span class="tag info">${rank.rank}</span>
    </div>
    <div class="tag-row">
      <span class="tag">飞行 ${state.stats.totalHours.toFixed(1)} 小时</span>
      <span class="tag">声望 ${state.reputation}</span>
      <span class="tag">完成 ${state.stats.completedMissions} 次任务</span>
      <span class="tag">资产 ${formatMoney(state.cash)}</span>
    </div>`;
}

function renderFundTransactions() {
  const transactions = normalizeFundTransactions(state.fundTransactions, state.cash);
  const operatingTransactions = transactions.filter((transaction) => transaction.type !== "opening");
  const totalIncome = operatingTransactions.reduce((sum, transaction) => sum + Math.max(0, Number(transaction.amount) || 0), 0);
  const totalExpense = operatingTransactions.reduce((sum, transaction) => sum + Math.max(0, -(Number(transaction.amount) || 0)), 0);
  els.fundSummary.innerHTML = `
    <div><span>当前余额</span><strong>${formatMoney(state.cash)}</strong><small>所有收支后的可用资金</small></div>
    <div><span>累计收入</span><strong class="is-income">+${formatMoney(totalIncome)}</strong><small>任务、航段与出售收入</small></div>
    <div><span>累计支出</span><strong class="is-expense">-${formatMoney(totalExpense)}</strong><small>燃油、飞机与维修支出</small></div>`;
  els.fundTransactionList.innerHTML = transactions.map((transaction) => {
    const amount = Number(transaction.amount) || 0;
    const isOpening = transaction.type === "opening";
    const isIncome = amount > 0 && !isOpening;
    const amountClass = isOpening ? "is-opening" : isIncome ? "is-income" : "is-expense";
    const icon = isOpening ? "wallet-cards" : isIncome ? "arrow-down-left" : "arrow-up-right";
    const amountText = isOpening ? formatMoney(amount) : `${isIncome ? "+" : "-"}${formatMoney(Math.abs(amount))}`;
    return `
      <article class="fund-transaction">
        <span class="fund-transaction-icon ${amountClass}" aria-hidden="true"><i data-lucide="${icon}"></i></span>
        <div class="fund-transaction-detail">
          <strong>${escapeHtml(transaction.title)}</strong>
          <span>${escapeHtml(transaction.detail || "资金记录")} · ${new Date(transaction.date).toLocaleString("zh-CN")}</span>
        </div>
        <div class="fund-transaction-amount">
          <strong class="${amountClass}">${amountText}</strong>
          <span>余额 ${formatMoney(Number(transaction.balance) || 0)}</span>
        </div>
      </article>`;
  }).join("") || `<p class="fund-empty">暂无资金使用记录。</p>`;
}

function emptyCard(text) {
  return `<article class="mission-card"><p>${text}</p></article>`;
}

function renderAll() {
  updateRankAndAchievements();
  renderProfile();
  renderAirline();
  renderSopMonitor();
  renderMissions();
  renderSchedules();
  renderLogs();
  renderDashboardSettlement();
  renderHangar();
  renderAircraftManagement();
  renderCompanyManagement();
  renderAchievements();
  renderProfileOverview();
  renderFundTransactions();
  renderRankTimeline();
  renderAircraftLicenses();
  showView(state.activeView);
  saveState();
  wireIcons();
}

function wireIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { width: 16, height: 16 } });
  }
}

