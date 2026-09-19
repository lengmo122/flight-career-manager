// 模飞生涯 渲染器源码 07-map-plan.js（原 app.js 按顺序拆分；经典脚本共享全局作用域，加载顺序见 index.html）
function missionMapRoute(mission) {
  const codes = routeAirportCodes(mission);
  const origin = airportByIcao(mission.origin || codes[0] || state.pilot.base);
  const scenePoint = mission.site?.lat != null && mission.site?.lon != null
    ? { lat: mission.site.lat, lon: mission.site.lon, icao: "现场", name: "任务现场" }
    : null;
  const destination = scenePoint || airportByIcao(mission.destination || codes[1]);
  if (!origin || !destination) return null;
  return {
    mission,
    origin,
    destination,
    isScene: Boolean(scenePoint),
    label: scenePoint ? `${mission.title} · 任务现场` : `${origin.icao} -> ${destination.icao}`
  };
}

function mapZoomForPoints(points) {
  const span = points.reduce((largest, point, index) => Math.max(largest, ...points.slice(index + 1).map((other) => distanceNm(point, other))), 0);
  if (span < 18) return 11;
  if (span < 55) return 9;
  if (span < 160) return 8;
  if (span < 420) return 7;
  if (span < 900) return 6;
  return 4;
}

function loadLeaflet() {
  if (window.L?.map) return Promise.resolve(window.L);
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./assets/vendor/leaflet/leaflet.js";
    script.async = true;
    script.onload = () => window.L?.map ? resolve(window.L) : reject(new Error("Leaflet 未初始化"));
    script.onerror = () => reject(new Error("Leaflet 脚本资源加载失败"));
    document.head.appendChild(script);
  }).catch((error) => {
    leafletLoadPromise = null;
    throw error;
  });
  return leafletLoadPromise;
}

function activeMissionMapRoutes() {
  return state.missions
    .filter((mission) => mission.status === "accepted")
    .sort((a, b) => b.acceptedAt - a.acceptedAt)
    .map(missionMapRoute)
    .filter(Boolean);
}

function companyTaskMapPoint(task, now = Date.now()) {
  const origin = companyAirportByIcao(task?.origin || state.company?.base);
  const destination = companyAirportByIcao(task?.destination);
  if (!origin) return null;
  if (!destination || !Number.isFinite(Number(task?.assignedAt))) {
    return { lat: origin.lat, lon: origin.lon, heading: null, progress: 0, origin, destination: null };
  }
  const distance = Math.max(20, Number(task.distance) || distanceNm(origin, destination));
  const durationMs = Math.max(15 * 60 * 1000, Math.min(8 * 3600 * 1000, distance / 380 * 3600 * 1000));
  const progress = Math.max(0, Math.min(0.98, (now - Number(task.assignedAt)) / durationMs));
  return {
    lat: origin.lat + (destination.lat - origin.lat) * progress,
    lon: origin.lon + (destination.lon - origin.lon) * progress,
    heading: bearingBetweenPoints(origin, destination),
    progress,
    origin,
    destination
  };
}

function activeCompanyMapFlights(now = Date.now()) {
  if (!state.company?.created) return [];
  const base = companyAirportByIcao(state.company.base);
  const fleet = companyManagedFleet();
  if (!base || !fleet.length) return [];
  const pilots = state.company.pilots.filter((pilot) => pilot.status === "active");
  return pilots.map((pilot, index) => {
    const task = state.company.tasks.find((item) => item.id === pilot.assignedTaskId && item.status === "assigned") || null;
    const aircraft = task
      ? state.fleet.find((item) => item.id === task.aircraftId)
      : fleet[index % fleet.length];
    const position = task ? companyTaskMapPoint(task, now) : { lat: base.lat, lon: base.lon, heading: null, progress: 0 };
    if (!aircraft || !position) return null;
    return { id: pilot.id, pilot, aircraft, task, ...position };
  }).filter(Boolean);
}

function syncMapTrackingControl() {
  if (!els.followAircraftBtn) return;
  const enabled = state.settings?.mapAutoTrack === true;
  els.followAircraftBtn.classList.toggle("is-active", enabled);
  els.followAircraftBtn.setAttribute("aria-pressed", String(enabled));
  els.followAircraftBtn.setAttribute("aria-label", enabled ? "关闭自动跟踪飞机" : "自动跟踪飞机");
  els.followAircraftBtn.title = enabled ? "关闭自动跟踪飞机" : "自动跟踪飞机";
}

function syncCompanyAircraftControl() {
  if (!els.toggleCompanyAircraftBtn) return;
  const enabled = state.settings?.mapShowCompanyAircraft !== false;
  els.toggleCompanyAircraftBtn.classList.toggle("is-active", enabled);
  els.toggleCompanyAircraftBtn.setAttribute("aria-pressed", String(enabled));
  els.toggleCompanyAircraftBtn.setAttribute("aria-label", enabled ? "隐藏公司飞机" : "显示公司飞机");
  els.toggleCompanyAircraftBtn.title = enabled ? "隐藏公司飞机" : "显示公司飞机";
}

function toggleCompanyAircraft() {
  state.settings.mapShowCompanyAircraft = state.settings?.mapShowCompanyAircraft === false;
  saveState();
  syncCompanyAircraftControl();
  updateCompanyAircraftOnMap();
  toast(state.settings.mapShowCompanyAircraft ? "已显示公司飞机" : "已隐藏公司飞机");
}

function toggleMapTracking() {
  const enabled = state.settings?.mapAutoTrack !== true;
  state.settings.mapAutoTrack = enabled;
  saveState();
  syncMapTrackingControl();
  const point = telemetryMapPoint(lastTelemetry);
  if (enabled && leafletMap && point) {
    leafletMap.setView([point.lat, point.lon], leafletMap.getZoom(), { animate: false });
  }
  toast(enabled ? "已开启自动跟踪飞机" : "已关闭自动跟踪飞机");
}

function syncMapLayerControls() {
  const activeLayer = normalizeMapLayer(state.settings?.mapLayer);
  els.mapLayerControls.forEach((button) => {
    const active = button.dataset.mapLayer === activeLayer;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setMapLayer(layer) {
  state.settings.mapLayer = normalizeMapLayer(layer);
  saveState();
  syncMapLayerControls();
  renderMapPage();
}

function renderMapPage() {
  const routes = activeMissionMapRoutes();
  syncMapTrackingControl();
  syncCompanyAircraftControl();
  syncMapLayerControls();
  const base = airportByIcao(state.pilot.base);
  const mapRoutes = routes.length ? routes : base ? [{ origin: base, destination: base, isBase: true, label: `基地 ${base.icao}` }] : [];
  els.mapPageTitle.textContent = routes.length ? (routes.length === 1 ? "当前执行任务" : "执行任务") : "基地机场";
  els.mapPageSummary.textContent = routes.length ? "已接任务会显示起点、任务点和航线。" : (base ? `${base.icao} · ${base.name}` : "请先在飞行员档案中设置有效 ICAO 基地机场。");
  els.mapPageCount.textContent = routes.length ? `${routes.length} 个执行中` : "基地定位";
  els.mapTaskList.innerHTML = mapRoutes.map((route) => `
    <div class="map-task-item">
      <b>${route.isBase ? "基地" : route.isScene ? "现场" : "航线"}</b>
      <span>${escapeHtml(route.label)}</span>
      ${route.isBase ? "" : `<small>${escapeHtml(route.mission.category)} · ${formatTaskDistanceNm(route.mission.distance)}</small>`}
    </div>
  `).join("") || `<p class="empty-note">当前基地没有匹配坐标，无法定位地图。</p>`;
  if (state.activeView !== "map") return;
  if (window.location.protocol === "file:") {
    els.careerMap.innerHTML = `<div class="mission-map-loading is-error">正在打开本地地图服务...</div>`;
    window.location.replace("http://localhost:4174/");
    return;
  }
  if (!mapRoutes.length) {
    els.careerMap.innerHTML = `<div class="mission-map-loading is-error">无法定位基地机场，请检查 ICAO 代码。</div>`;
    return;
  }
  els.careerMap.innerHTML = `<div class="mission-map-loading">正在加载地图...</div>`;
  loadLeaflet()
    .then(() => drawLeafletMap(els.careerMap, mapRoutes))
    .catch(() => {
      els.careerMap.innerHTML = `<div class="mission-map-loading is-error">地图暂时无法加载，请检查网络或地图服务配置。</div>`;
    });
}

function mapMarkerIcon(kind, label) {
  return window.L.divIcon({
    className: "career-map-marker-wrap",
    html: `<span class="career-map-marker is-${kind}"></span><span class="career-map-marker-label">${escapeHtml(label)}</span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5]
  });
}

function telemetryMapPoint(sample) {
  const lat = Number(sample?.latitude);
  const lon = Number(sample?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function normalizeHeading(value) {
  const heading = Number(value);
  return Number.isFinite(heading) ? ((heading % 360) + 360) % 360 : null;
}

function bearingBetweenPoints(from, to) {
  if (!from || !to) return null;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const deltaLon = (to.lon - from.lon) * Math.PI / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeHeading(Math.atan2(y, x) * 180 / Math.PI);
}

function aircraftHeading(sample, point) {
  // Match the cockpit HDG indication (magnetic). True heading remains in the
  // telemetry payload for route/geospatial calculations.
  const reported = normalizeHeading(sample?.magneticHeadingDeg ?? sample?.headingMagneticDeg ?? sample?.headingDeg ?? sample?.trueHeadingDeg);
  if (reported != null) return reported;
  const previous = liveTrackPoints.at(-1);
  const moved = previous && Math.abs(previous.lat - point.lat) + Math.abs(previous.lon - point.lon) >= 0.00003;
  return moved ? bearingBetweenPoints(previous, point) ?? lastLiveHeadingDeg : lastLiveHeadingDeg;
}

function aircraftDisplaySpeed(sample) {
  const candidates = [
    ["TAS", sample?.trueAirspeedKt],
    ["IAS", sample?.indicatedAirspeedKt],
    ["GS", sample?.groundSpeedKt]
  ];
  const selected = candidates.find(([, value]) => value != null && value !== "" && Number.isFinite(Number(value)));
  return selected
    ? { label: selected[0], value: Math.max(0, Number(selected[1])) }
    : { label: "GS", value: 0 };
}

function aircraftIconRotation(headingDeg) {
  if (headingDeg == null || headingDeg === "") return -45;
  const heading = normalizeHeading(headingDeg);
  return heading == null ? -45 : normalizeHeading(heading - 45);
}

function liveAircraftIcon(connected, headingDeg) {
  const iconRotation = aircraftIconRotation(headingDeg);
  return window.L.divIcon({
    className: "live-aircraft-marker-wrap",
    html: `<span class="live-aircraft-marker ${connected ? "is-live" : "is-stale"}"><i data-lucide="plane" class="live-aircraft-symbol" style="transform: rotate(${iconRotation}deg)" aria-hidden="true"></i></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function companyAircraftIcon(headingDeg) {
  const iconRotation = aircraftIconRotation(headingDeg);
  return window.L.divIcon({
    className: "company-aircraft-marker-wrap",
    html: `<span class="company-aircraft-marker"><i data-lucide="plane" class="live-aircraft-symbol" style="transform: rotate(${iconRotation}deg)" aria-hidden="true"></i></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
}

function updateCompanyAircraftOnMap(now = Date.now()) {
  if (!leafletMap || !window.L?.marker) return;
  const enabled = state.settings?.mapShowCompanyAircraft !== false;
  const flights = enabled ? activeCompanyMapFlights(now) : [];
  const activeIds = new Set(flights.map((flight) => flight.id));
  companyAircraftMarkers.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      marker.remove();
      companyAircraftMarkers.delete(id);
    }
  });
  flights.forEach((flight) => {
    const latLng = [flight.lat, flight.lon];
    const status = flight.task
      ? `派遣中 · ${Math.round(flight.progress * 100)}% · ${flight.task.origin} → ${flight.task.destination}`
      : "基地待命";
    const label = `${flight.pilot.name} · ${flight.aircraft.name}`;
    let marker = companyAircraftMarkers.get(flight.id);
    if (!marker) {
      marker = window.L.marker(latLng, {
        icon: companyAircraftIcon(flight.heading),
        keyboard: false,
        zIndexOffset: 850
      }).addTo(leafletMap);
      companyAircraftMarkers.set(flight.id, marker);
    } else {
      marker.setLatLng(latLng);
      marker.setIcon(companyAircraftIcon(flight.heading));
    }
    marker.bindTooltip(`<strong>${escapeHtml(label)}</strong><br>${escapeHtml(status)}`, {
      direction: "top",
      offset: [0, -14]
    });
  });
  wireIcons();
}

function updateLiveAircraftOnMap(sample, connected = true) {
  if (!leafletMap || !window.L?.marker) return;
  const point = telemetryMapPoint(sample);
  if (!point) return;
  const latLng = [point.lat, point.lon];
  const timestamp = String(sample?.timestamp || "");
  const heading = aircraftHeading(sample, point);
  lastLiveHeadingDeg = heading;
  if (!liveAircraftMarker) {
    liveAircraftMarker = window.L.marker(latLng, {
      icon: liveAircraftIcon(connected, heading),
      keyboard: false,
      zIndexOffset: 1000
    }).addTo(leafletMap);
  } else {
    liveAircraftMarker.setLatLng(latLng);
    liveAircraftMarker.setIcon(liveAircraftIcon(connected, heading));
  }
  wireIcons();
  const speed = aircraftDisplaySpeed(sample);
  const altitude = Math.round(Number(sample?.altitudeFt) || 0);
  liveAircraftMarker.bindTooltip(`${connected ? "MSFS 实时位置" : "MSFS 最后位置"}<br>${escapeHtml(speed.label)} ${Math.round(speed.value)} kt · ${altitude} ft · 航向 ${String(Math.round(heading)).padStart(3, "0")}°`, {
    direction: "top",
    offset: [0, -14]
  });
  if (connected && timestamp && timestamp !== lastLiveTrackTimestamp) {
    const previous = liveTrackPoints.at(-1);
    if (!previous || Math.abs(previous.lat - point.lat) + Math.abs(previous.lon - point.lon) >= 0.00003) {
      liveTrackPoints.push(point);
      if (liveTrackPoints.length > 240) liveTrackPoints.shift();
    }
    lastLiveTrackTimestamp = timestamp;
  }
  if (liveTrackPoints.length > 1) {
    const trackLatLngs = liveTrackPoints.map((trackPoint) => [trackPoint.lat, trackPoint.lon]);
    if (!liveTrackLine) {
      liveTrackLine = window.L.polyline(trackLatLngs, {
        color: "#087f8c",
        weight: 3,
        opacity: 0.85
      }).addTo(leafletMap);
    } else {
      liveTrackLine.setLatLngs(trackLatLngs);
    }
  }
  if (state.settings?.mapAutoTrack === true) {
    leafletMap.setView(latLng, leafletMap.getZoom(), { animate: false });
  }
}

function addMapMarker(map, point, kind, label) {
  return window.L.marker([point.lat, point.lon], { icon: mapMarkerIcon(kind, label), keyboard: false })
    .addTo(map)
    .bindTooltip(escapeHtml(label), { direction: "top", offset: [0, -7] });
}

function drawLeafletMap(host, routes) {
  if (state.activeView !== "map" || !window.L?.map) return;
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    liveAircraftMarker = null;
    liveTrackLine = null;
    companyAircraftMarkers.clear();
  }
  host.replaceChildren();
  const mapLayer = normalizeMapLayer(state.settings?.mapLayer);
  host.classList.toggle("map-layer-dark", mapLayer === "dark");
  const map = window.L.map(host, { zoomControl: true, attributionControl: true, preferCanvas: true });
  leafletMap = map;
  const tilePrefix = mapLayer === "satellite" ? "img" : "vec";
  const labelPrefix = mapLayer === "satellite" ? "cia" : "cva";
  window.L.tileLayer(`/api/map/tianditu/${tilePrefix}/{z}/{x}/{y}`, {
    maxZoom: 18,
    attribution: "&copy; 天地图"
  }).addTo(map);
  window.L.tileLayer(`/api/map/tianditu/${labelPrefix}/{z}/{x}/{y}`, {
    maxZoom: 18
  }).addTo(map);
  const points = [];
  routes.forEach((route) => {
    points.push(route.origin);
    addMapMarker(map, route.origin, route.isBase ? "base" : "origin", route.isBase ? `基地 ${route.origin.icao}` : `起点 ${route.origin.icao}`);
    if (route.isBase) return;
    points.push(route.destination);
    addMapMarker(map, route.destination, route.isScene ? "scene" : "destination", route.isScene ? "任务现场" : `终点 ${route.destination.icao}`);
    window.L.polyline([[route.origin.lat, route.origin.lon], [route.destination.lat, route.destination.lon]], {
      color: route.isScene ? "#bc6b13" : "#1f63d0",
      weight: 3,
      opacity: 0.9,
      dashArray: route.isScene ? "7 6" : null
    }).addTo(map).bindTooltip(escapeHtml(route.label), { sticky: true });
  });
  const livePoint = telemetryMapPoint(lastTelemetry);
  if (livePoint) points.push(livePoint);
  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lon], mapZoomForPoints(points));
  } else {
    map.fitBounds(points.map((point) => [point.lat, point.lon]), { padding: [48, 48], maxZoom: 10 });
  }
  if (livePoint) updateLiveAircraftOnMap(lastTelemetry, lastTelemetryConnected);
  updateCompanyAircraftOnMap();
}

function updatePlanAirportFields() {
  const originCode = normalizeAirportInputCode(els.planOriginInput?.value);
  const destinationCode = normalizeAirportInputCode(els.planDestinationInput?.value);
  if (els.planOriginInput) els.planOriginInput.value = originCode;
  if (els.planDestinationInput) els.planDestinationInput.value = destinationCode;
  const origin = originCode.length === 4 ? companyAirportByIcao(originCode) : null;
  const destination = destinationCode.length === 4 ? companyAirportByIcao(destinationCode) : null;
  const updateResult = (output, code, airport) => {
    if (!output) return;
    output.textContent = code.length < 4 ? "" : airport ? `${airport.name} · ${airport.city || airport.country || "全球机场"}` : "未找到对应机场";
    output.classList.toggle("is-valid", Boolean(airport));
    output.classList.toggle("is-invalid", code.length === 4 && !airport);
  };
  updateResult(els.planOriginResult, originCode, origin);
  updateResult(els.planDestinationResult, destinationCode, destination);
  const aircraft = selectedPlanAircraft();
  if (els.generatePlannedMissionBtn) {
    els.generatePlannedMissionBtn.disabled = !origin || !destination || origin.icao === destination.icao || !aircraft;
  }
  return { origin, destination, aircraft };
}

function availablePlanAircraft() {
  return (Array.isArray(state?.fleet) ? state.fleet : [])
    .filter((aircraft) => !isCompanyAircraft(aircraft) && (aircraft.owned || aircraft.rented));
}

function selectedPlanAircraft() {
  const available = availablePlanAircraft();
  const selectedId = String(els.planAircraftSelect?.value || "");
  if (selectedId) return available.find((aircraft) => aircraft.id === selectedId) || null;
  return available.find((aircraft) => aircraft.selected)
    || available[0]
    || null;
}

function renderPlanAircraftOptions() {
  if (!els.planAircraftSelect) return;
  const previousId = String(els.planAircraftSelect.value || "");
  const available = availablePlanAircraft();
  const preferred = available.find((aircraft) => aircraft.id === previousId)
    || available.find((aircraft) => aircraft.selected)
    || available[0]
    || null;
  els.planAircraftSelect.innerHTML = available.length
    ? available.map((aircraft) => `<option value="${escapeHtml(aircraft.id)}">${escapeHtml(aircraft.name)} · ${escapeHtml(aircraft.kind)} · ${aircraft.owned ? "已购买" : "租赁"}</option>`).join("")
    : `<option value="">暂无已购买或租赁飞机</option>`;
  els.planAircraftSelect.disabled = available.length === 0;
  els.planAircraftSelect.value = preferred?.id || "";
  if (els.planAircraftHint) {
    els.planAircraftHint.textContent = available.length ? `可选 ${available.length} 架个人飞机（含租赁）` : "请先到飞机市场购买或租赁飞机";
    els.planAircraftHint.classList.toggle("is-empty", available.length === 0);
  }
}

function plannedMissionCruiseSpeed(aircraft) {
  if (isHelicopterAircraft(aircraft)) return 115;
  if (/喷气|客机|运输/.test(String(aircraft?.kind || ""))) return 430;
  if (/涡桨/.test(String(aircraft?.kind || ""))) return 260;
  return 145;
}

function generatePlannedMission() {
  const { origin, destination, aircraft } = updatePlanAirportFields();
  if (!origin || !destination) {
    toast("请输入有效的起飞和降落机场四字码");
    return null;
  }
  if (origin.icao === destination.icao) {
    toast("起飞机场和降落机场不能相同");
    return null;
  }
  if (!aircraft) {
    toast("请选择已购买或租赁的个人飞机后再创建计划任务");
    return null;
  }
  const standardCategories = compatibleCategories(aircraft).filter((category) => ["客运", "货运", "包机", "医疗"].includes(category));
  const category = standardCategories.includes("包机") ? "包机" : standardCategories[0] || "包机";
  const distance = Math.round(distanceNm(origin, destination));
  const duration = +Math.max(0.2, distance / plannedMissionCruiseSpeed(aircraft)).toFixed(1);
  const mission = {
    id: cryptoId("plan-mission"),
    kind: "planned-route",
    category,
    subtype: "计划航线",
    title: `${origin.icao} → ${destination.icao}`,
    route: `${origin.name} → ${destination.name}`,
    origin: origin.icao,
    destination: destination.icao,
    site: null,
    aircraftHint: aircraft.name,
    permittedAircraftIds: [aircraft.id],
    dispatchPhase: "全天候",
    recommendedPhases: ["全天候"],
    distance,
    duration,
    payout: Math.round(1200 + distance * 24),
    repGain: Math.max(2, Math.round(duration * 2)),
    risk: distance > 1800 ? "高" : distance > 600 ? "中" : "低",
    weather: "实时天气",
    scene: buildMissionScene(category, "计划航线"),
    summary: `计划任务 · ${origin.name} 至 ${destination.name}`,
    status: "open",
    priority: "standard",
    refreshable: false,
    createdAt: Date.now()
  };
  state.missions.unshift(mission);
  state.schedules.unshift({
    id: cryptoId("route-plan"),
    kind: "route-plan",
    missionId: mission.id,
    origin: origin.icao,
    originName: origin.name,
    destination: destination.icao,
    destinationName: destination.name,
    aircraftId: aircraft.id,
    aircraftName: aircraft.name,
    distance,
    createdAt: mission.createdAt,
    importedAt: mission.createdAt,
    imported: 1,
    total: 1,
    errors: []
  });
  state.missionFilters = { search: mission.title, status: "all", category: "all", distanceSort: "newest" };
  saveState();
  renderAll();
  toast(`已生成计划任务：${mission.title}`);
  showView("missions");
  return mission;
}

