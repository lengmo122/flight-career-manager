// 模飞生涯 渲染器源码 05-aircraft-telemetry.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function compactAircraftName(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function aircraftIdentityTokens(value) {
  const compact = compactAircraftName(value);
  if (!compact) return [];
  const tokens = [compact];
  // Ignore vendor prefixes and paint/package suffixes such as FenixA319 CFM SL HD.
  const modelCodes = ["A319NEO", "A321NEO", "A320NEO", "A319", "A320", "A321"];
  modelCodes.forEach((code) => {
    const baseFamilyCode = /^(A319|A320|A321)$/.test(code);
    const hasNeoVariant = /A(?:319|320|321)(?:NEO|LR)/.test(compact);
    if (compact.includes(code) && !(baseFamilyCode && hasNeoVariant)) tokens.push(code);
  });
  return [...new Set(tokens)];
}

function telemetryAircraftValues(sample) {
  return [
    sample?.aircraftTypeCode, sample?.aircraftModel, sample?.aircraftTitle, sample?.loadedAircraftName,
    sample?.AircraftTypeCode, sample?.AircraftModel, sample?.AircraftTitle, sample?.LoadedAircraftName
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function telemetryAircraftLabel(sample) {
  return String(sample?.aircraftTitle || sample?.aircraftModel || sample?.aircraftTypeCode || sample?.loadedAircraftName || "").trim();
}

const aircraftVariantFamilies = [
  { base: ["A319", "AIRBUSA319"], neo: ["A19N", "A319NEO", "AIRBUSA319NEO"] },
  { base: ["A320", "AIRBUSA320"], neo: ["A20N", "A320NEO", "AIRBUSA320NEO"] },
  { base: ["A321", "AIRBUSA321"], neo: ["A21N", "A321NEO", "A321LR", "AIRBUSA321NEO", "AIRBUSA321LR"] }
];

function aircraftVariantConflict(actual, alias) {
  const pittsVariant = actual.includes("S1S") ? "S1S" : actual.includes("S2S") ? "S2S" : "";
  if (pittsVariant && alias === "PITTS") return true;
  if (actual.includes("AEROBAT") && ["C152", "CESSNA152"].includes(alias)) return true;
  return aircraftVariantFamilies.some((family) => {
    const actualVariant = family.neo.some((token) => actual.includes(token)) ? "neo" : family.base.some((token) => actual.includes(token)) ? "base" : "";
    const aliasVariant = family.neo.some((token) => alias.includes(token)) ? "neo" : family.base.some((token) => alias.includes(token)) ? "base" : "";
    return actualVariant && aliasVariant && actualVariant !== aliasVariant;
  });
}

function telemetryBoolean(value) {
  if (typeof value === "string") return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  return value === true || value === 1;
}

function telemetryMatchesAircraft(sample, aircraft) {
  const actualTokens = telemetryAircraftValues(sample).flatMap(aircraftIdentityTokens);
  if (!actualTokens.length) return false;
  const identityId = aircraft?.catalogId || aircraft?.id;
  const aliases = [
    ...(aircraftIdentityRules[identityId] || []),
    compactAircraftName(aircraft?.name),
    compactAircraftName(identityId)
  ].flatMap(aircraftIdentityTokens).filter((value) => value.length >= 3);
  return aliases.some((alias) => actualTokens.some((actual) => !aircraftVariantConflict(actual, alias) && (actual === alias || (alias.length >= 4 && actual.includes(alias)))));
}

function telemetryFuelKg(sample) {
  if (sample?.fuelKg === null || sample?.fuelKg === undefined || sample?.fuelKg === "") return null;
  const value = Number(sample.fuelKg);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function telemetryFuelCapacityKg(sample) {
  if (sample?.fuelCapacityKg === null || sample?.fuelCapacityKg === undefined || sample?.fuelCapacityKg === "") return null;
  const value = Number(sample.fuelCapacityKg);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function fuelSliderState(currentFuelPercent, requestedTargetPercent, targetBaselinePercent) {
  const minimumPercent = currentFuelPercent === null || currentFuelPercent === undefined
    ? 0
    : Math.max(0, Math.min(100, Math.ceil(Number(currentFuelPercent) || 0)));
  const hasRequestedTarget = requestedTargetPercent !== null
    && requestedTargetPercent !== undefined
    && Number.isFinite(Number(requestedTargetPercent));
  const baselineMatches = Number.isFinite(Number(targetBaselinePercent))
    && Number(targetBaselinePercent) === minimumPercent;
  const usesRequestedTarget = hasRequestedTarget && baselineMatches;
  const targetPercent = usesRequestedTarget
    ? Math.max(minimumPercent, Math.min(100, Number(requestedTargetPercent)))
    : minimumPercent;
  return { minimumPercent, targetPercent, usesRequestedTarget };
}

function telemetryFleetAircraft(sample) {
  if (!sample || !state?.fleet?.length) return null;
  const matches = state.fleet.filter((aircraft) => telemetryMatchesAircraft(sample, aircraft));
  return matches.find((aircraft) => aircraft.selected)
    || matches.find((aircraft) => aircraft.owned || aircraft.rented)
    || matches[0]
    || null;
}

function syncFleetTelemetry(sample) {
  const aircraft = telemetryFleetAircraft(sample);
  const fuelKg = telemetryFuelKg(sample);
  if (!aircraft || fuelKg === null) return aircraft;
  aircraft.lastFuelKg = +fuelKg.toFixed(2);
  const capacityKg = telemetryFuelCapacityKg(sample);
  if (capacityKg !== null) aircraft.fuelCapacityKg = +capacityKg.toFixed(2);
  aircraft.lastFuelAt = Date.now();
  aircraft.lastSeenTitle = telemetryAircraftLabel(sample);
  return aircraft;
}

function updateMissionFuel(verification, sample) {
  const fuelKg = telemetryFuelKg(sample);
  if (!verification || fuelKg === null) return null;
  const preflight = !verification.departedAt
    && ["briefed", "origin-confirmed"].includes(verification.phase);
  const previous = Number(verification.fuelLastKg);
  if (preflight || !Number.isFinite(previous)) {
    verification.fuelStartKg = fuelKg;
    verification.fuelUsedKg = 0;
    verification.fuelAddedKg = 0;
  } else {
    const change = previous - fuelKg;
    const plausibleDrop = Math.max(50, previous * 0.25);
    if (change > 0 && change <= plausibleDrop) {
      verification.fuelUsedKg = +(Number(verification.fuelUsedKg || 0) + change).toFixed(2);
    } else if (change < 0) {
      verification.fuelAddedKg = +(Number(verification.fuelAddedKg || 0) + Math.abs(change)).toFixed(2);
    }
  }
  verification.fuelCurrentKg = fuelKg;
  verification.fuelLastKg = fuelKg;
  verification.fuelUpdatedAt = Date.now();
  return fuelKg;
}

function missionAircraft(mission) {
  const aircraftId = mission?.verification?.aircraftId || mission?.permittedAircraftIds?.[0];
  return state.fleet.find((aircraft) => aircraft.id === aircraftId) || currentAircraft();
}

function missionPermittedAircraft(mission) {
  const permittedIds = new Set([
    ...(Array.isArray(mission?.permittedAircraftIds) ? mission.permittedAircraftIds : []),
    mission?.verification?.aircraftId
  ].filter(Boolean));
  // Once a mission is accepted, the assigned aircraft may be anywhere along
  // the route. Do not re-filter it by its current airport after takeoff.
  return state.fleet.filter((aircraft) => permittedIds.has(aircraft.id));
}

function telemetryMissionAircraft(sample, mission) {
  return missionPermittedAircraft(mission).find((aircraft) => telemetryMatchesAircraft(sample, aircraft)) || null;
}

function pointFromAirport(airport, distance, bearing) {
  return window.FlightTerrain.pointFromAirport(airport, distance, bearing);
}

function missionRange(category, aircraft = currentAircraft()) {
  const policy = missionPolicies[category] || missionPolicies.客运;
  const aircraftCap = Math.max(45, Math.floor(Number(aircraft?.range || 300) * 0.52));
  return [policy.min, Math.max(policy.min + 8, Math.min(policy.max, aircraftCap))];
}

function isAircraftCompatible(category, aircraft = currentAircraft()) {
  const policy = missionPolicies[category] || missionPolicies.客运;
  const kindAllowed = policy.kinds.includes(aircraft?.kind);
  const capabilityAllowed = category === "客运" ? hasMissionCapability(category, aircraft) : kindAllowed;
  return (kindAllowed || capabilityAllowed) && missionRange(category, aircraft)[1] >= policy.min;
}

function isHelicopterAircraft(aircraft) {
  return ["直升机", "重型直升机"].includes(aircraft?.kind);
}

function isHelicopterEmergencyMission(mission) {
  if (!isEmergencyMission(mission)) return false;
  return (mission.permittedAircraftIds || []).some((id) => isHelicopterAircraft(state.fleet?.find((aircraft) => aircraft.id === id)));
}

function compatibleCategories(aircraft = currentAircraft()) {
  return Object.keys(missionPolicies).filter((category) => isAircraftCompatible(category, aircraft));
}

function dispatchPhase() {
  const hour = new Date().getHours();
  if (hour >= 20 || hour < 5) return "夜间";
  if (hour >= 16) return "傍晚";
  return "日间";
}

function pickBaseRoute(category, aircraft = currentAircraft(), baseOverride = "") {
  const requestedBase = normalizeBaseCode(baseOverride);
  const base = requestedBase && airportByIcao(requestedBase)
    ? requestedBase
    : aircraftOperationalBase(aircraft);
  const baseAirport = airportByIcao(base);
  const [minDistance, maxDistance] = missionRange(category, aircraft);
  const candidates = baseAirport
    ? airportDatabase.map((airport) => ({ ...airport, distance: distanceNm(baseAirport, airport) }))
      .filter((airport) => airport.icao !== base && airport.distance >= minDistance && airport.distance <= maxDistance)
    : [];
  if (candidates.length) {
    const destination = pick(candidates);
    return {
      from: base,
      to: destination.icao,
      route: `${baseAirport.name}基地 · ${destination.name}`,
      distance: destination.distance,
      base,
      baseAirport,
      destination
    };
  }
  // Keep the route anchored to the selected base even when the aircraft or
  // airport database has no candidate in the policy range.
  const fallbackDestination = baseAirport
    ? airportDatabase
      .map((airport) => ({ ...airport, distance: distanceNm(baseAirport, airport) }))
      .filter((airport) => airport.icao !== base)
      .sort((a, b) => a.distance - b.distance)[0]
    : null;
  const fallback = fallbackDestination
    ? { from: base, to: fallbackDestination.icao, route: `${base} 基地周边航段`, distance: fallbackDestination.distance }
    : pickRoute(category);
  return {
    ...fallback,
    from: base,
    base,
    baseAirport,
    distance: fallbackDestination?.distance || fallback.distance || null,
    destination: fallbackDestination || airportByIcao(fallback.to)
  };
}

function makeMission(category, subtype, offsetHours = 0, aircraftOverride = null, baseOverride = "") {
  const aircraft = aircraftOverride || currentAircraft();
  if (!aircraftOverride && !isAircraftCompatible(category, aircraft)) category = compatibleCategories(aircraft)[0] || "包机";
  const scene = buildMissionScene(category, subtype);
  const specialMission = isPackagedScene(scene);
  const airportPair = pickBaseRoute(category, aircraft, baseOverride);
  const [sceneMin, sceneMax] = missionRange(category, aircraft);
  const site = specialMission
    ? window.FlightTerrain.findMissionSite(airportPair.baseAirport, sceneMin, sceneMax, scene.terrain)
    : null;
  if (specialMission && !site) return null;
  const baseMiles = Math.round(specialMission ? site.distanceNm : (airportPair.distance || rand(sceneMin, sceneMax)));
  const cruiseSpeed = specialMission ? rand(105, 165) : rand(180, 260);
  const hours = Math.max(0.6, +(baseMiles / cruiseSpeed).toFixed(1));
  const payoutRate = specialMission ? rand(42, 68) : rand(18, 36);
  // Mission rewards are independent of the pilot's selected airline.
  const payout = Math.round(baseMiles * payoutRate + 500 * rand(2, specialMission ? 7 : 5));
  const repGain = Math.max(2, Math.round(hours * rand(1, 3)));
  const risk = pick(["低", "中", "高"], specialMission ? [0.12, 0.5, 0.38] : [0.48, 0.36, 0.16]);
  const phase = specialMission && category === "医疗" ? "全天候" : dispatchPhase();
  const weather = phase === "夜间" ? pick(["夜航", "侧风", "云底较低"], [0.5, 0.25, 0.25]) : pick(["晴朗", "侧风", "雷雨", "云底较低"], [0.42, 0.24, 0.14, 0.2]);
  const bearing = specialMission ? site.bearing : rand(0, 359);
  const routeTitle = specialMission ? `${airportPair.base} → 航向 ${String(bearing).padStart(3, "0")}°` : `${airportPair.from} → ${airportPair.to}`;
  const routeLabel = specialMission ? `${airportPair.base} 基地周边 ${formatTaskDistanceNm(baseMiles)}` : airportPair.route;
  return {
    id: cryptoId("mission"),
    category,
    subtype,
    title: routeTitle,
    route: routeLabel,
    origin: airportPair.base,
    destination: specialMission ? null : airportPair.to,
    site: specialMission ? { base: airportPair.base, ...site, distanceNm: baseMiles } : null,
    aircraftHint: aircraft.name,
    permittedAircraftIds: [aircraft.id],
    originMode: normalizeBaseCode(baseOverride) ? "pilot-base" : "aircraft-location",
    dispatchPhase: phase,
    recommendedPhases: missionPolicies[category]?.phases || ["日间"],
    distance: baseMiles,
    duration: hours,
    payout,
    repGain,
    risk,
    weather,
    scene,
    summary: `${category}任务 · ${subtype} · ${weather}`,
    status: "open",
    priority: emergencyMissionCategories.includes(category) ? "emergency" : "standard",
    refreshable: true,
    createdAt: Date.now() - offsetHours * 3600 * 1000
  };
}

function refreshMissionFromAircraft(aircraft) {
  if (!aircraft || isCompanyAircraft(aircraft) || !(aircraft.owned || aircraft.rented)) return null;
  const eligibleCategories = compatibleCategories(aircraft);
  if (!eligibleCategories.length) return null;
  const origin = aircraftOperationalBase(aircraft);
  const currentOffers = refreshableMissionOffers();
  const existing = currentOffers.find((mission) => mission.permittedAircraftIds?.includes(aircraft.id)
    && normalizeBaseCode(mission.origin) === normalizeBaseCode(origin));
  if (existing) return existing;
  if (currentOffers.length >= MISSION_OFFER_TARGET_COUNT) {
    const replaceable = currentOffers
      .filter((mission) => !isEmergencyMission(mission))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))[0];
    if (replaceable) state.missions = state.missions.filter((mission) => mission.id !== replaceable.id);
  }
  const category = randomCategory(eligibleCategories);
  const mission = makeMission(category, randomSubtype(category), 0, aircraft);
  if (!mission) return null;
  mission.permittedAircraftIds = [aircraft.id];
  mission.aircraftHint = aircraft.name;
  state.missions.unshift(mission);
  return mission;
}

function pickRoute(category) {
  const routePools = {
    客运: [
      { from: "ZBAA", to: "ZSPD", route: "华北干线" },
      { from: "ZGGG", to: "ZPPP", route: "南方走廊" },
      { from: "RJTT", to: "RJCC", route: "东亚航段" },
      { from: "EGLL", to: "LFPG", route: "欧洲短干线" }
    ],
    货运: [
      { from: "ZSPD", to: "ZUCK", route: "华东物流" },
      { from: "KDFW", to: "KORD", route: "北美货运" },
      { from: "EDDF", to: "EHAM", route: "欧洲快件" }
    ],
    包机: [
      { from: "ZSSS", to: "ZWSH", route: "商务包机" },
      { from: "KLAX", to: "KLAS", route: "VIP往返" },
      { from: "RJBB", to: "ROAH", route: "观光飞行" }
    ],
    医疗: [
      { from: "ZPPP", to: "ZUNZ", route: "医疗转运" },
      { from: "KDEN", to: "KSLC", route: "紧急航段" },
      { from: "EHAM", to: "EBBR", route: "急救支援" }
    ],
    搜救: [
      { from: "ZUUU", to: "ZUXC", route: "川西山区搜救" },
      { from: "KDEN", to: "KASE", route: "落基山地搜救" },
      { from: "PAJN", to: "PAGS", route: "冰川搜索区" }
    ],
    海上救援: [
      { from: "VHHH", to: "VMMC", route: "珠江口救援区" },
      { from: "RJTT", to: "RJBB", route: "太平洋沿岸搜救" },
      { from: "PHNL", to: "PHOG", route: "夏威夷岛链救援" }
    ],
    事故调查: [
      { from: "ZBAA", to: "ZBSJ", route: "华北调查航段" },
      { from: "EGLL", to: "EGKK", route: "事故调查运输" },
      { from: "KLAX", to: "KPSP", route: "现场勘察航段" }
    ]
  };
  return pick(routePools[category] || routePools.客运);
}

function chooseMissionAircraft(category) { return currentAircraft().name; }

function pick(list, weights) {
  if (!weights) {
    return list[Math.floor(Math.random() * list.length)];
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  return list[list.length - 1];
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatMoney(value) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-US")}`;
}

function formatCompactMoney(value) {
  const amount = Number(value) || 0;
  const absolute = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  // Keep high-value balances within the narrow profile card. In the UI,
  // one billion is intentionally shown as 1B (10 亿), followed by T for
  // trillion-scale values.
  if (absolute >= 1_000_000_000_000) return `$${sign}${trimCompactDecimal(absolute / 1_000_000_000_000)}T`;
  if (absolute >= 1_000_000_000) return `$${sign}${trimCompactDecimal(absolute / 1_000_000_000)}B`;
  if (absolute >= 10000) return `$${sign}${trimCompactDecimal(absolute / 10000)}W`;
  if (absolute >= 1000) return `$${sign}${trimCompactDecimal(absolute / 1000)}K`;
  return formatMoney(amount);
}

function trimCompactDecimal(value) {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatHours(value) {
  const hours = Number(value);
  return `${(Number.isFinite(hours) ? hours : 0).toFixed(1)} 小时`;
}

function formatFuel(value) {
  if (value === null || value === undefined || value === "") return "暂无数据";
  const fuel = Number(value);
  return Number.isFinite(fuel) ? `${fuel.toFixed(1)} kg` : "暂无数据";
}

function formatDistanceNm(value) {
  const distance = Number(value);
  return Number.isFinite(distance)
    ? `${distance.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} nm`
    : "暂无数据";
}

function formatTaskDistanceNm(value) {
  const distance = Number(value);
  return Number.isFinite(distance)
    ? `${Math.max(0, Math.round(distance)).toLocaleString("zh-CN")} nm`
    : "0 nm";
}

function formatTaskRouteLabel(value) {
  return String(value || "").replace(/(\d+(?:\.\d+)?)\s*nm\b/gi, (_, distance) => formatTaskDistanceNm(distance));
}

function formatFuelTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "尚未从 MSFS 同步";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return "刚刚从 MSFS 同步";
  if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前同步`;
  return new Date(timestamp).toLocaleString("zh-CN");
}

function aircraftCondition(aircraft) {
  return Math.max(0, Math.min(100, Number(aircraft?.conditionPercent ?? 100) || 0));
}

function aircraftMaintenanceCost(aircraft) {
  const missingCondition = 100 - aircraftCondition(aircraft);
  if (missingCondition < 0.05) return 0;
  const referenceValue = Math.max(50_000, Number(aircraft?.price) || Number(aircraft?.rent || 0) * 100);
  return Math.max(50, Math.round(missingCondition * referenceValue * 0.00002));
}

function aircraftConditionLevel(aircraft) {
  const condition = aircraftCondition(aircraft);
  if (condition < 40) return { className: "is-critical", label: "严重损坏" };
  if (condition < 75) return { className: "is-damaged", label: "需要维修" };
  if (condition < 95) return { className: "is-worn", label: "轻度磨损" };
  return { className: "is-good", label: "状态良好" };
}

function landingWearPercent(landing) {
  const verticalSpeed = Math.abs(Number(landing?.landingRateFpm));
  if (!Number.isFinite(verticalSpeed) || verticalSpeed <= 0) return 0;
  if (verticalSpeed > 650) return Math.min(35, 18 + Math.round((verticalSpeed - 650) / 100));
  if (verticalSpeed > 450) return 10;
  if (verticalSpeed > 250) return 5;
  if (verticalSpeed > 120) return 2;
  return 1;
}

function applyLandingWear(aircraft, landing, startedAt = 0) {
  const reportTimestamp = Date.parse(landing?.timestamp || "");
  const previousReportAt = Number(aircraft?.lastLandingReportAt) || 0;
  if (!aircraft || !Number.isFinite(reportTimestamp) || reportTimestamp <= Number(startedAt || 0) || reportTimestamp <= previousReportAt) return null;
  const wearPercent = landingWearPercent(landing);
  const peakG = Number.isFinite(Number(landing?.peakG)) ? +Number(landing.peakG).toFixed(2) : null;
  if (wearPercent <= 0 && !(peakG > 3)) return null;
  const previousCondition = aircraftCondition(aircraft);
  aircraft.conditionPercent = +Math.max(0, previousCondition - wearPercent).toFixed(1);
  aircraft.lastLandingReportAt = reportTimestamp;
  aircraft.lastLandingRateFpm = Math.abs(Math.round(Number(landing.landingRateFpm)));
  aircraft.lastLandingPeakG = peakG;
  aircraft.lastLandingWearPercent = wearPercent;
  aircraft.lastLandingAirport = String(landing.airport || "");
  aircraft.lastLandingRunway = String(landing.runway || "");
  return {
    aircraft,
    previousCondition,
    conditionPercent: aircraft.conditionPercent,
    wearPercent,
    landingRateFpm: aircraft.lastLandingRateFpm,
    peakG: aircraft.lastLandingPeakG
  };
}

function isCrashLanding(landingOrWear) {
  return Number(landingOrWear?.peakG ?? landingOrWear?.landingPeakG) > 3;
}

function syncFleetLandingWear(landing) {
  if (!landing) return null;
  const aircraft = state.fleet.find((item) => (item.owned || item.rented) && telemetryMatchesAircraft(landing, item));
  if (!aircraft) return null;
  return applyLandingWear(aircraft, landing, state.features?.landingWearStartedAt);
}

function telemetryEventTime(value, fallback = Date.now()) {
  const parsed = typeof value === "number" ? value : Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function landingReportMatchesTouchdown(landing, sample, aircraft, departedAt = 0, maximumAgeMs = 10 * 60_000, expectedAirport = "") {
  if (!landing || !sample || !aircraft || !telemetryBoolean(sample.onGround)) return false;
  const reportAt = telemetryEventTime(landing.timestamp ?? landing.Timestamp, Number.NaN);
  const sampleAt = telemetryEventTime(sample.timestamp ?? sample.Timestamp, Number.NaN);
  if (!Number.isFinite(reportAt) || !Number.isFinite(sampleAt)) return false;
  if (Number(departedAt) > 0 && reportAt < Number(departedAt) - 1000) return false;
  if (reportAt > sampleAt + 5000 || sampleAt - reportAt > maximumAgeMs) return false;
  const expectedAirportCode = String(expectedAirport || "").trim().toUpperCase();
  const reportAirportCode = String(landing.airport ?? landing.Airport ?? landing.runwayAirport ?? landing.RunwayAirport ?? "").trim().toUpperCase();
  // A few aircraft do not expose a runway identity to the detector. In that
  // case the live sample's airport plus the touchdown coordinates still bind
  // the report to the mission airport; a non-empty conflicting report code is
  // always rejected.
  const sampleAirportCode = String(sample.runwayAirport ?? sample.RunwayAirport ?? "").trim().toUpperCase();
  if (expectedAirportCode && reportAirportCode && reportAirportCode !== expectedAirportCode) return false;
  if (expectedAirportCode && !reportAirportCode && sampleAirportCode && sampleAirportCode !== expectedAirportCode) return false;
  if (!telemetryMatchesAircraft(landing, aircraft)) return false;
  const landingPoint = {
    lat: Number(landing.touchdownLatitude ?? landing.TouchdownLatitude),
    lon: Number(landing.touchdownLongitude ?? landing.TouchdownLongitude)
  };
  const samplePoint = { lat: Number(sample.latitude), lon: Number(sample.longitude) };
  if (Object.values(landingPoint).every(Number.isFinite)
    && Object.values(samplePoint).every(Number.isFinite)
    && distanceNm(landingPoint, samplePoint) > 2) return false;
  return true;
}

function landingReportActual(landing, aircraft) {
  if (!landing) return {};
  const reportAt = Date.parse(landing.timestamp || "");
  const landingRateFpm = Math.abs(Number(landing.landingRateFpm));
  const landingPeakG = Number(landing.peakG);
  const appliedToAircraft = Number(aircraft?.lastLandingReportAt) === reportAt;
  return {
    landingRateFpm: Number.isFinite(landingRateFpm) ? landingRateFpm : null,
    landingPeakG: Number.isFinite(landingPeakG) ? landingPeakG : null,
    landingWearPercent: appliedToAircraft
      ? Number(aircraft.lastLandingWearPercent || 0)
      : landingWearPercent(landing),
    landingAirport: String(landing.airport || ""),
    landingRunway: String(landing.runway || ""),
    landingReportAt: Number.isFinite(reportAt) ? reportAt : null
  };
}

function simulatorFlightMission(aircraft) {
  const mission = activeVerifiedMission();
  return mission?.verification?.aircraftId === aircraft?.id ? mission : null;
}

function handleAircraftCrash(landingWear, landing, sample) {
  const aircraft = landingWear?.aircraft;
  if (!aircraft || !isCrashLanding(landingWear)) return null;
  const flight = normalizeSimulatorFlight(state.simulatorFlight);
  const reportAt = telemetryEventTime(landing?.timestamp);
  const arrival = normalizeBaseCode(landing?.airport || telemetryAirport(sample)?.airport?.icao || flight.lastGroundAirport);
  const departure = normalizeBaseCode(flight.origin || flight.lastGroundAirport);
  const mission = state.missions.find((item) => item.id === flight.missionId && item.status === "accepted");
  const missionSop = mission?.verification?.sop || {};
  const sopSnapshot = buildLandingSopSnapshot(mission, landingWear, landing, aircraft, reportAt, arrival);
  const { sopEnabled, sopScore, sopMultiplier, sopDeductions, sopReport } = sopSnapshot;
  const crashLog = {
    id: cryptoId("crash-log"),
    source: "msfs",
    status: "crashed",
    missionId: flight.missionId,
    taskTitle: state.missions.find((mission) => mission.id === flight.missionId)?.title || "",
    date: reportAt,
    from: departure || "未知起飞点",
    to: arrival || "未知落地点",
    departureAirport: departure,
    arrivalAirport: arrival,
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    hours: 0,
    miles: +Math.max(0, Number(flight.distanceNm) || 0).toFixed(1),
    income: 0,
    grossIncome: 0,
    landingRateFpm: landingWear.landingRateFpm,
    landingPeakG: landingWear.peakG,
    landingAirport: arrival,
    landingRunway: String(landing?.runway || ""),
    landingWearPercent: landingWear.wearPercent,
    landingReportAt: reportAt,
    sopEnabled,
    sopScore,
    sopMultiplier,
    sopDeductions,
    sopReport,
    crashReason: `接地峰值 ${Number(landingWear.peakG).toFixed(2)}G，超过 3G 安全上限`,
    notes: `坠机记录：${departure || "未知起飞点"} → ${arrival || "未知落地点"}。飞机已从机库移除。`
  };
  state.logs.unshift(crashLog);
  const companyTask = state.company?.tasks?.find((task) => task.aircraftId === aircraft.id && task.status === "assigned");
  if (companyTask) {
    companyTask.status = "crashed";
    companyTask.completedAt = reportAt;
    companyTask.departureAirport = departure;
    companyTask.arrivalAirport = arrival;
    companyTask.airportCheck = "failed";
    updateCompanyFlightLog(companyTask, {
      status: "crashed",
      completedAt: reportAt,
      departureAirport: departure,
      arrivalAirport: arrival,
      airportCheck: "failed",
      landingRateFpm: landingWear.landingRateFpm,
      landingPeakG: landingWear.peakG,
      crashReason: crashLog.crashReason
    });
    const pilot = state.company.pilots.find((item) => item.id === companyTask.pilotId);
    if (pilot) pilot.assignedTaskId = "";
  }
  if (mission) {
    mission.status = "failed";
    mission.completedAt = reportAt;
    mission.verification = {
      ...(mission.verification || {}),
      phase: "crashed",
      phaseLabel: "坠机，任务失败",
      detail: `${crashLog.crashReason}${sopEnabled ? `，SOP 得分 ${Math.round(sopScore)}/100` : ""}`,
      arrivalAirport: arrival,
      sop: {
        ...missionSop,
        enabled: sopEnabled,
        score: sopScore,
        multiplier: sopMultiplier,
        report: sopReport,
        settledAt: reportAt
      }
    };
    recordTaskEvent(mission, { key: "crashed", title: "飞机坠机，任务失败", detail: crashLog.crashReason, phase: "crashed" });
  }
  state.fleet = state.fleet.filter((item) => item.id !== aircraft.id);
  if (Array.isArray(state.company?.aircraftIds)) state.company.aircraftIds = state.company.aircraftIds.filter((id) => id !== aircraft.id);
  if (!state.fleet.some((item) => item.selected && !isCompanyAircraft(item))) {
    const fallback = state.fleet.find((item) => !isCompanyAircraft(item) && (item.owned || item.rented));
    if (fallback) state.fleet.forEach((item) => { item.selected = item.id === fallback.id; });
  }
  state.simulatorFlight = emptySimulatorFlight(arrival, flight.lastFuelKg);
  return crashLog;
}

function updateSimulatorFlight(sample, aircraft, now = Date.now()) {
  if (!sample || !aircraft) return false;
  const eventAt = telemetryEventTime(sample.timestamp, now);
  const onGround = telemetryBoolean(sample.onGround);
  const point = Number.isFinite(Number(sample.latitude)) && Number.isFinite(Number(sample.longitude))
    ? { lat: Number(sample.latitude), lon: Number(sample.longitude) }
    : null;
  const airportCode = telemetryAirport(sample)?.airport?.icao || "";
  const fuelKg = telemetryFuelKg(sample);
  let flight = normalizeSimulatorFlight(state.simulatorFlight);

  if (flight.active && flight.aircraftId !== aircraft.id) {
    if (onGround) state.simulatorFlight = emptySimulatorFlight(airportCode, fuelKg);
    return false;
  }

  if (!flight.active) {
    if (onGround) {
      flight.lastGroundAirport = airportCode || flight.lastGroundAirport;
      if (fuelKg !== null) flight.lastGroundFuelKg = fuelKg;
      flight.lastSampleAt = eventAt;
      state.simulatorFlight = flight;
      return true;
    }
    const mission = simulatorFlightMission(aircraft);
    const startFuelKg = flight.lastGroundFuelKg ?? fuelKg;
    flight = {
      ...emptySimulatorFlight(flight.lastGroundAirport, flight.lastGroundFuelKg),
      active: true,
      aircraftId: aircraft.id,
      aircraftName: aircraft.name,
      missionId: mission?.id || "",
      departedAt: eventAt,
      origin: flight.lastGroundAirport || mission?.verification?.departureAirport || mission?.origin || "未知起飞点",
      fuelStartKg: startFuelKg,
      lastFuelKg: fuelKg,
      lastPoint: point,
      lastSampleAt: eventAt
    };
    state.simulatorFlight = flight;
    return true;
  }

  if (flight.lastPoint && point) {
    const elapsedSec = (eventAt - Number(flight.lastSampleAt || eventAt)) / 1000;
    const step = distanceNm(flight.lastPoint, point);
    const speedKt = Math.max(
      Number(sample.groundSpeedKt) || 0,
      Number(sample.indicatedAirspeedKt) || 0,
      Number(sample.trueAirspeedKt) || 0
    );
    const plausibleStep = Math.max(2, speedKt * Math.max(1, Math.min(elapsedSec, 60)) / 3600 * 4);
    if (!telemetryBoolean(sample.slewActive) && elapsedSec > 0 && elapsedSec <= 120 && step <= 20 && step <= plausibleStep) {
      flight.distanceNm = accumulateFlightDistance(flight.distanceNm, step);
    }
  }

  if (fuelKg !== null) {
    const previousFuelKg = Number(flight.lastFuelKg);
    if (Number.isFinite(previousFuelKg)) {
      const change = previousFuelKg - fuelKg;
      const plausibleDrop = Math.max(50, previousFuelKg * 0.25);
      if (change > 0 && change <= plausibleDrop) {
        flight.fuelUsedKg = +(flight.fuelUsedKg + change).toFixed(2);
      } else if (change < 0) {
        flight.fuelAddedKg = +(flight.fuelAddedKg + Math.abs(change)).toFixed(2);
      }
    }
    flight.lastFuelKg = fuelKg;
  }
  if (onGround) {
    flight.lastGroundAirport = airportCode || flight.lastGroundAirport;
    if (fuelKg !== null) flight.lastGroundFuelKg = fuelKg;
  }
  flight.lastPoint = point || flight.lastPoint;
  flight.lastSampleAt = eventAt;
  state.simulatorFlight = flight;
  return true;
}

function finalizeSimulatorFlight(landingWear, landing, sample, now = Date.now()) {
  const flight = normalizeSimulatorFlight(state.simulatorFlight);
  if (!flight.active || !landingWear?.aircraft || flight.aircraftId !== landingWear.aircraft.id) return null;
  const mission = state.missions.find((item) => item.id === flight.missionId) || null;
  const reportAt = telemetryEventTime(landing?.timestamp, now);
  const nearbyAirport = telemetryAirport(sample)?.airport?.icao || "";
  const missionArrival = mission?.verification?.phase === "returning"
    ? mission.origin
    : mission?.destination || mission?.site?.name || "任务现场";
  const arrival = String(landing?.airport || nearbyAirport || flight.lastGroundAirport || (mission ? missionArrival : "未知落地点")).toUpperCase();
  const fuelUsedKg = +Math.max(0, Number(flight.fuelUsedKg) || 0).toFixed(2);
  const fuelCost = Math.round(fuelUsedKg * FUEL_PRICE_PER_KG);
  const elapsedHours = (reportAt - Number(flight.departedAt || reportAt)) / 3600000;
  const hours = +Math.max(0.01, Number.isFinite(elapsedHours) ? elapsedHours : 0).toFixed(2);
  const miles = +Math.max(0, Number(flight.distanceNm) || 0).toFixed(1);
  const runway = String(landing?.runway || "").trim();
  const sopSnapshot = buildLandingSopSnapshot(mission, landingWear, landing, landingWear.aircraft, reportAt, arrival);
  const log = {
    id: cryptoId("log"),
    source: "msfs",
    missionId: flight.missionId,
    taskTitle: mission?.title || "",
    date: reportAt,
    from: flight.origin || "未知起飞点",
    to: arrival,
    departureAirport: String(flight.origin || "").toUpperCase(),
    arrivalAirport: arrival,
    airportCheck: mission
      ? (String(flight.origin || "").trim().toUpperCase() === String(mission.origin || "").trim().toUpperCase()
        && String(arrival || "").trim().toUpperCase() === String(mission.destination || mission.origin || "").trim().toUpperCase() ? "passed" : "failed")
      : "pending",
    aircraftId: flight.aircraftId,
    aircraftName: flight.aircraftName || landingWear.aircraft.name,
    hours,
    miles,
    income: 0,
    grossIncome: 0,
    fuelStartKg: flight.fuelStartKg,
    fuelEndKg: flight.lastFuelKg,
    fuelUsedKg,
    fuelCost,
    landingRateFpm: landingWear.landingRateFpm,
    landingPeakG: landingWear.peakG,
    landingWearPercent: landingWear.wearPercent,
    landingAirport: arrival,
    landingRunway: runway,
    landingReportAt: reportAt,
    ...sopSnapshot,
    notes: `MSFS 实际飞行：${flight.origin || "未知起飞点"} → ${arrival}${runway ? ` 跑道 ${runway}` : ""}，接地率 ${landingWear.landingRateFpm} fpm。`
  };
  state.logs.unshift(log);
  const companyTask = state.company?.tasks?.find((task) => task.aircraftId === flight.aircraftId && task.status === "assigned");
  if (companyTask) {
    const departureMatches = normalizeBaseCode(flight.origin) === normalizeBaseCode(companyTask.origin);
    const arrivalMatches = normalizeBaseCode(arrival) === normalizeBaseCode(companyTask.destination);
    companyTask.departureAirport = normalizeBaseCode(flight.origin);
    companyTask.arrivalAirport = arrival;
    companyTask.airportCheck = departureMatches && arrivalMatches ? "passed" : "failed";
    companyTask.status = "completed";
    companyTask.completedAt = reportAt;
    updateCompanyFlightLog(companyTask, {
      status: companyTask.airportCheck === "passed" ? "completed" : "airport-mismatch",
      completedAt: reportAt,
      departureAirport: companyTask.departureAirport,
      arrivalAirport: arrival,
      airportCheck: companyTask.airportCheck,
      landingRateFpm: landingWear.landingRateFpm,
      landingPeakG: landingWear.peakG
    });
    const companyAircraft = state.fleet.find((item) => item.id === companyTask.aircraftId);
    if (companyAircraft && arrival) companyAircraft.lastLandingAirport = arrival;
    if (typeof refreshCompanyMissionFromAircraft === "function") refreshCompanyMissionFromAircraft(companyAircraft);
    const pilot = state.company.pilots.find((item) => item.id === companyTask.pilotId);
    if (pilot) pilot.assignedTaskId = "";
  }
  state.stats.totalHours = +(Number(state.stats.totalHours || 0) + hours).toFixed(2);
  state.stats.totalMiles = +(Number(state.stats.totalMiles || 0) + miles).toFixed(1);
  state.stats.totalLandings = Number(state.stats.totalLandings || 0) + 1;
  state.stats.totalFuelKg = +(Number(state.stats.totalFuelKg || 0) + fuelUsedKg).toFixed(2);
  state.stats.totalFuelCost = +(Number(state.stats.totalFuelCost || 0) + fuelCost).toFixed(2);
  state.simulatorFlight = emptySimulatorFlight(arrival, flight.lastFuelKg);
  return log;
}

function aircraftHasActiveMission(aircraft) {
  return state.missions.some((mission) => mission.status === "accepted"
    && mission.verification?.aircraftId === aircraft?.id);
}

