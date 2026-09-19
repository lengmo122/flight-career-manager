(function (global) {
  "use strict";

  const earthRadiusNm = 3440.065;
  let landPolygons = [];

  function pointFromAirport(airport, distanceNm, bearingDeg) {
    if (!airport) return null;
    const angular = distanceNm / earthRadiusNm;
    const heading = bearingDeg * Math.PI / 180;
    const lat1 = Number(airport.lat) * Math.PI / 180;
    const lon1 = Number(airport.lon) * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(heading));
    const lon2 = lon1 + Math.atan2(Math.sin(heading) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return {
      lat: +(lat2 * 180 / Math.PI).toFixed(5),
      lon: +((((lon2 * 180 / Math.PI) + 540) % 360) - 180).toFixed(5)
    };
  }

  function ringBounds(ring) {
    return ring.reduce((bounds, coordinate) => ({
      minLon: Math.min(bounds.minLon, coordinate[0]),
      maxLon: Math.max(bounds.maxLon, coordinate[0]),
      minLat: Math.min(bounds.minLat, coordinate[1]),
      maxLat: Math.max(bounds.maxLat, coordinate[1])
    }), { minLon: 180, maxLon: -180, minLat: 90, maxLat: -90 });
  }

  function configure(geojson) {
    const polygons = [];
    for (const feature of geojson?.features || []) {
      const geometry = feature?.geometry;
      const coordinates = geometry?.type === "Polygon"
        ? [geometry.coordinates]
        : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
      for (const rings of coordinates) {
        if (!rings?.[0]?.length) continue;
        polygons.push({ rings, bounds: ringBounds(rings[0]) });
      }
    }
    landPolygons = polygons;
    return landPolygons.length;
  }

  function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const crosses = (yi > point.lat) !== (yj > point.lat)
        && point.lon < ((xj - xi) * (point.lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function pointIsOnLand(point) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) return false;
    return landPolygons.some(({ rings, bounds }) => {
      if (point.lon < bounds.minLon || point.lon > bounds.maxLon || point.lat < bounds.minLat || point.lat > bounds.maxLat) return false;
      if (!pointInRing(point, rings[0])) return false;
      return !rings.slice(1).some((hole) => pointInRing(point, hole));
    });
  }

  function pointMatchesTerrain(point, terrain, clearanceNm = 0) {
    const expectedLand = terrain !== "water";
    if (pointIsOnLand(point) !== expectedLand) return false;
    if (!clearanceNm) return true;
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const edge = pointFromAirport(point, clearanceNm, bearing);
      if (pointIsOnLand(edge) !== expectedLand) return false;
    }
    return true;
  }

  function findMissionSite(baseAirport, minimumNm, maximumNm, terrain, random = Math.random) {
    if (!baseAirport || !landPolygons.length) return null;
    const min = Math.max(1, Number(minimumNm) || 1);
    const max = Math.max(min, Number(maximumNm) || min);
    const clearanceNm = terrain === "water" ? 3 : 1.5;
    const bearingOffset = random() * 360;
    const candidates = [];
    for (let ring = 0; ring < 12; ring += 1) {
      const distanceNm = min + ((ring + 0.5) / 12) * (max - min);
      for (let sector = 0; sector < 48; sector += 1) {
        const bearing = (bearingOffset + sector * 137.507764 + ring * 19.31) % 360;
        candidates.push({ distanceNm, bearing, point: pointFromAirport(baseAirport, distanceNm, bearing) });
      }
    }
    const strict = candidates.find((candidate) => pointMatchesTerrain(candidate.point, terrain, clearanceNm));
    const relaxed = strict || candidates.find((candidate) => pointMatchesTerrain(candidate.point, terrain, 0));
    if (!relaxed) return null;
    return {
      ...relaxed.point,
      distanceNm: Math.round(relaxed.distanceNm),
      bearing: Math.round(relaxed.bearing) % 360,
      terrain
    };
  }

  global.FlightTerrain = {
    configure,
    pointFromAirport,
    pointIsOnLand,
    pointMatchesTerrain,
    findMissionSite,
    get polygonCount() { return landPolygons.length; }
  };
})(typeof window === "undefined" ? globalThis : window);
