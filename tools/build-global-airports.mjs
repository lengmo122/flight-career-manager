import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(root, "tools", "msfs-telemetry", "data", "airport-catalog.json");
const outputPath = join(root, "assets", "data", "global-airports-zh.json");
const appSource = await readFile(join(root, "app.js"), "utf8");
const catalog = JSON.parse(await readFile(sourcePath, "utf8"));
const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region", fallback: "none" });
const knownChineseNames = new Map(
  [...appSource.matchAll(/\["([A-Z0-9]{4})",\s*-?[\d.]+,\s*-?[\d.]+,\s*"([^"]+)"\]/g)]
    .map((match) => [match[1], match[2]])
);

const airports = catalog.airports
  .filter((airport) => /^[A-Z0-9]{4}$/.test(String(airport.icao || "")))
  .map((airport) => {
    const icao = String(airport.icao).toUpperCase();
    const country = regionNames.of(String(airport.country || "").toUpperCase()) || "国际";
    return {
      icao,
      name: knownChineseNames.get(icao) || `${country}机场`,
      country,
      lat: Number(airport.lat),
      lon: Number(airport.lon),
      type: String(airport.type || "airport"),
      scheduled: Boolean(airport.scheduledService)
    };
  })
  .sort((a, b) => a.icao.localeCompare(b.icao));

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({
  source: catalog.source,
  sourceUrl: catalog.sourceUrl,
  license: catalog.license,
  generatedAt: new Date().toISOString(),
  airportCount: airports.length,
  airports
}));

console.log(`全球四字 ICAO 机场数据已生成：${airports.length} 个`);
