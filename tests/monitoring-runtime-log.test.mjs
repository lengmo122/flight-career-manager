import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const [html, app, styles, serverSource] = await Promise.all(['index.html', 'app.js', 'styles.css', 'server.mjs']
  .map((name) => readFile(new URL(name, root), 'utf8')));

assert.match(html, /data-view="monitor"/);
assert.match(html, /id="monitorView"/);
assert.equal((html.match(/data-monitor-light="[^"]+"/g) || []).length, 9);
for (const key of ['antiCollisionLights', 'parkingBrake', 'flapsPercent', 'spoilersPercent', 'gearPercent']) {
  assert.match(html, new RegExp(`data-monitor-light="${key}"`));
}
assert.match(html, /id="runtimeLogList"/);
assert.match(app, /function updateMonitor\(payload/);
assert.match(app, /function monitorEquipmentState\(key, value\)/);
assert.match(app, /转换中 \$\{Math\.round\(percent\)\}%/);
assert.match(app, /monitorControlKeys = \["navigationLights"[\s\S]*?"gearPercent"\]/);
assert.match(app, /sample\?\.antiCollisionLights \?\? sample\?\.beaconLights/,
  'anti-collision monitoring should support current and legacy telemetry bridges');
assert.match(app, /pollSimulator\(\)[\s\S]*?updateMonitor\(payload\)/);
assert.match(app, /window\.addEventListener\("unhandledrejection"/);
assert.match(styles, /\.monitor-light-state\.is-on[\s\S]*?var\(--success\)/);
assert.match(styles, /\.monitor-light-state\.is-off[\s\S]*?var\(--danger\)/);
assert.match(styles, /data-monitor-state="transition"[\s\S]*?var\(--warning\)/);
assert.match(serverSource, /url\.pathname === "\/api\/runtime-log"/);

const isolatedLocalAppData = await mkdtemp(join(tmpdir(), 'mofei-runtime-log-test-'));
process.env.LOCALAPPDATA = isolatedLocalAppData;
const { startServer, shutdownBridges } = await import('../server.mjs');
const application = await startServer(0);
const base = `http://127.0.0.1:${application.port}`;
try {
  let response = await fetch(`${base}/api/runtime-log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ level: 'error', message: 'monitor test failure', context: { screen: 'monitor' } })
  });
  assert.equal(response.status, 201);

  response = await fetch(`${base}/api/runtime-log`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.ok(payload.logs.some((entry) => entry.level === 'error' && /monitor test failure/.test(entry.message)));

  response = await fetch(`${base}/api/runtime-log`, { method: 'DELETE', headers: { origin: 'http://evil.example' } });
  assert.equal(response.status, 403);

  response = await fetch(`${base}/api/runtime-log`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).logs, []);
} finally {
  await shutdownBridges();
  await new Promise((resolve) => application.server.close(resolve));
  await rm(isolatedLocalAppData, { recursive: true, force: true });
}

console.log('Monitoring and runtime log: live fields, light states, local logging API and access controls passed.');
