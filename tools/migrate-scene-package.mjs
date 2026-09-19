import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const source = resolve(process.argv[2] || "D:/Neofly/addons/neofly-neofly-objects");
const destination = resolve(process.argv[3] || "D:/Neofly/addons/flight-career-manager-objects");
const textExtensions = new Set([".cfg", ".gltf", ".json", ".txt", ".xml"]);

try {
  await stat(destination);
  throw new Error(`Destination already exists: ${destination}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true, preserveTimestamps: true });

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory()) paths.push(...await walk(path));
  }
  return paths;
}

function migratedName(name) {
  if (/^neofly-neofly-objects$/i.test(name)) return "flight-career-manager-objects";
  return name.replace(/neofly/gi, "FCM");
}

const originalPaths = await walk(destination);
for (const path of originalPaths.filter((item) => textExtensions.has(extname(item).toLowerCase()))) {
  const original = await readFile(path, "utf8");
  const migrated = original.replace(/neofly/gi, "FCM");
  if (migrated !== original) await writeFile(path, migrated, "utf8");
}

for (const path of originalPaths.sort((a, b) => b.length - a.length)) {
  const nextName = migratedName(basename(path));
  if (nextName !== basename(path)) await rename(path, join(dirname(path), nextName));
}

const manifestPath = join(destination, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.title = "Flight Career Manager Objects";
manifest.creator = "Flight Career Manager";
manifest.package_version = "1.0.0";
manifest.release_notes = {
  neutral: {
    LastUpdate: "Authorized namespace migration to the FCM object identifiers.",
    OlderHistory: "Derived from the licensed source object package."
  }
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const noticePath = join(destination, "THIRD_PARTY_NOTICES.txt");
await writeFile(noticePath, [
  "Flight Career Manager Objects",
  "",
  "This package contains assets migrated from NeoFly Objects 0.6.0 under authorization from the rights holder.",
  "The FCM namespace migration does not transfer ownership of the underlying third-party assets.",
  "Redistribution and publication remain subject to the applicable authorization terms.",
  ""
].join("\r\n"), "utf8");

const layoutPath = join(destination, "layout.json");
const allPaths = (await walk(destination)).filter((path) => extname(path) && path !== layoutPath);
const content = [];
for (const path of allPaths) {
  const info = await stat(path);
  const fileTime = Math.trunc((info.mtimeMs + 11644473600000) * 10000);
  content.push({
    path: relative(destination, path).split(sep).join("/"),
    size: info.size,
    date: fileTime
  });
}
content.sort((a, b) => a.path.localeCompare(b.path, "en"));
await writeFile(layoutPath, `${JSON.stringify({ content }, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ source, destination, files: content.length }, null, 2));
