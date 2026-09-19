import { readAppSource } from './helpers/app-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import WebSocket from 'ws';
import { PanelService, panelLanHosts } from '../panel-service.mjs';
import { FrameParser } from '../panel-native.mjs';

const [html, serverSource] = await Promise.all(['index.html', 'server.mjs'].map(name => readFile(new URL(`../${name}`, import.meta.url), 'utf8')));
const app = await readAppSource();
assert.doesNotMatch(html, /data-view="glassout"|id="glassoutView"|截取面板/);
assert.doesNotMatch(app, /\/api\/panels\/|glassout|glassOut|panelCapture|panelPreview/);
assert.doesNotMatch(serverSource, /api\/glassout|normalizeGlassOutTarget|glassOutStatus\(/);
assert.deepEqual(panelLanHosts({ local: [{family:'IPv4', internal:true, address:'127.0.0.1'}], ethernet:[{family:'IPv4', internal:false, address:'192.168.1.2'}] }), ['192.168.1.2']);

let panelList = [{id:'1-0',pageId:1,index:0,name:'PFD',width:256,height:256}];
let callbacks, stops = 0, marked = null;
const discovery = {scan: async () => panelList, mark: async (panel, marker) => { marked = marker; }, close: async () => { marked = null; }};
const service = new PanelService({port:0, discovery, targets: async () => [{pid:123,name:'Test'}], native: (pid, marker, handler) => {
  callbacks = handler; return {stop: async () => { stops++; }};
}});
let client;
try {
  let status = await service.status();
  assert.equal(status.independent, true); assert.equal(status.panels[0].gpuMatched, false);
  assert.equal(stops, 0, 'Scanning must not load a capture DLL');
  const base = `http://127.0.0.1:${status.port}`;
  for (const path of ['/api/panels/status', '/api/simulator/start', '/src/01-save-storage.js', '/server.mjs', '/api/save']) {
    assert.equal((await fetch(base + path)).status, 404, 'LAN service must not expose the career application');
  }
  const viewerResponse = await fetch(base + '/panel/1-0');
  assert.equal(viewerResponse.status, 200);
  assert.match(viewerResponse.headers.get('content-security-policy'), /frame-ancestors http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*/);
  const denied = new WebSocket(`ws://127.0.0.1:${status.port}/stream?token=invalid`);
  await new Promise(resolve => denied.once('error', error => {assert.match(error.message,/403/);resolve();}));
  await service.startCapture('1-0');
  assert.ok(marked); assert.equal(service.captureStarting,false);
  client = new WebSocket(`ws://127.0.0.1:${status.port}/stream?panel=1-0&token=${status.shareToken}`);
  await once(client, 'open');
  const received = new Promise(resolve => client.on('message', (data, binary) => { if(binary) resolve(data); }));
  const jpeg = Buffer.from([255,216,1,2,255,217]);
  callbacks.frame({id:1,width:256,height:256,jpeg});
  assert.deepEqual(await received, jpeg);
  status = await service.status(); assert.equal(status.panels[0].gpuMatched, true);
  assert.equal(status.phase, 'live'); assert.equal(status.fps, 1); assert.equal(status.viewers, 1);
  const heartbeat = once(client,'message'); service.sendViewerStatus([...service.clients][0]);
  assert.equal(JSON.parse((await heartbeat)[0]).clear, false, 'Live status updates must not clear the image');
  service.frameTime = Date.now()-6000;
  status = await service.status(); assert.equal(status.panels[0].gpuMatched, false, 'Stale images must never appear live');
  panelList = [];
  await service.scan(true);
  assert.equal(service.capture, null); assert.equal(marked,null); assert.equal(stops,1);
  await assert.rejects(service.startCapture('1-0'),/no-panels|panel-lost/);
  panelList = [{id:'1-0',pageId:1,index:0,name:'PFD',width:256,height:256}];
  await service.startCapture('1-0');
  panelList.push({id:'2-0',pageId:2,index:0,name:'ND',width:256,height:256});
  const oldCallbacks = callbacks;
  await service.startCapture('2-0');
  assert.equal(service.selected.id,'2-0'); assert.equal(stops,2);
  oldCallbacks.frame({id:1,width:256,height:256,jpeg});
  assert.equal(service.frame,null,'Old capture callbacks cannot feed a newly selected panel');
  const switched = new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Missing switch status')),2000);
    const listener=(bytes,binary)=>{
      if(!binary && /已切换/.test(JSON.parse(bytes).message)) {
        clearTimeout(timer);client.off('message',listener);resolve();
      }
    };
    client.on('message',listener);
  });
  service.sendViewerStatus([...service.clients][0]);await switched;
  callbacks.state(-208);
  await service.stopCapture();
  assert.equal(service.captureStatus().error,'hook-install-failed');
  assert.equal(service.captureStatus().nativeState,-208);
  assert.equal(service.captureStatus().phase,'error');
  await service.close(); assert.equal(stops,3); assert.equal(marked,null);
  await assert.rejects(fetch(base + '/panel/1-0'));
} finally { client?.terminate(); await service.close(); }

const frames = [];
const parser = new FrameParser(frame => frames.push(frame));
const header = Buffer.alloc(20); [0x314a464d,1,256,256,4].forEach((v,i)=>header.writeUInt32LE(v,i*4));
const wire = Buffer.concat([header,Buffer.from([255,216,255,217])]);
for (const byte of wire) parser.push(Buffer.from([byte]));
assert.equal(frames.length,1);
assert.throws(()=>new FrameParser(()=>{}).push(Buffer.alloc(20)),/invalid-native-frame/);

const {startServer, shutdownBridges} = await import('../server.mjs');
const application = await startServer(0);
try {
  const response = await fetch(`http://127.0.0.1:${application.port}/api/panels/capture`, {method:'POST',headers:{Origin:'http://evil.example','X-Mofei-Panel':'1'}});
  assert.equal(response.status,403);
  const missingHeader = await fetch(`http://127.0.0.1:${application.port}/api/panels/capture`, {method:'POST'});
  assert.equal(missingHeader.status,404);
} finally { await shutdownBridges(); await new Promise(resolve => application.server.close(resolve)); }
console.log('Independent panels: discovery-only scanning, token authentication, isolated LAN routes, real-time states, cleanup and fragmented frames passed.');
