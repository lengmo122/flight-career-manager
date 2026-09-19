import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PanelService } from '../panel-service.mjs';
import WebSocket from 'ws';

const root = new URL('../', import.meta.url);
const target = spawn(fileURLToPath(new URL('tools/panel-capture-source/MofeiCaptureTest.exe', root)), [], { windowsHide: true });
let service, client, browser;
const watchdog = setTimeout(() => { target.kill(); void service?.close(); }, 25000);
try {
  const [line] = await once(target.stdout, 'data');
  const pid = Number(line.toString().trim());
  assert.equal(pid, target.pid, 'Never load the test capture DLL into a user simulator');
  service = new PanelService({ port: 0, targets: async () => [{pid, name:'MofeiCaptureTest.exe'}], discovery: {
    scan: async () => [{id:'test-pfd', pageId:1, index:0, name:'Real D3D12 Test', width:256, height:256}],
    mark: async () => {}, close: async () => {}
  }});
  let status = await service.status();
  const base = `http://127.0.0.1:${status.port}`;
  const wsUrl = `ws://127.0.0.1:${status.port}/stream?panel=test-pfd&token=${status.shareToken}`;
  client = new WebSocket(wsUrl);
  await once(client,'open');
  const hashes = new Set();
  const frames = new Promise((resolve,reject) => {
    const timer = setTimeout(()=>reject(new Error(`No live frames: ${service.error}`)),10000);
    client.on('message',(bytes,binary) => {
      if (!binary) return;
      assert.equal(bytes.readUInt16BE(0),0xffd8);
      hashes.add(createHash('sha256').update(bytes).digest('hex'));
      if(hashes.size>=5) {clearTimeout(timer);resolve();}
    });
  });
  await service.startCapture('test-pfd');
  await frames;
  assert.equal((await service.status()).panels[0].gpuMatched,true);
  if (process.env.FCM_PLAYWRIGHT_MODULE) {
    const {chromium} = await import(process.env.FCM_PLAYWRIGHT_MODULE);
    browser = await chromium.launch({channel:'msedge',headless:true});
    await mkdir(new URL('tools/panel-verification/',root),{recursive:true});
    for (const [name,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]) {
      const page = await browser.newPage({viewport});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`${base}/panel/test-pfd?fit=contain&fps=30#token=${status.shareToken}`);
      await page.waitForFunction(()=>document.getElementById('panel').naturalWidth===256);
      const readPixel = () => page.evaluate(()=> {
        const img=document.getElementById('panel');
        const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
        const context=canvas.getContext('2d');context.drawImage(img,0,0);
        return Array.from(context.getImageData(128,128,1,1).data);
      });
      const pixel=await readPixel();
      assert.ok(Math.abs(pixel[0]-31)<12 && Math.abs(pixel[1]-89)<12 && pixel[3]===255,`JPEG must contain actual test texture pixels: ${pixel}`);
      await page.waitForTimeout(200);
      const nextPixel=await readPixel();
      assert.notDeepEqual(pixel,nextPixel,'Live viewer image must change');
      const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
      assert.ok(fits,'Mobile viewer must not overflow horizontally');
      await page.screenshot({path:fileURLToPath(new URL(`tools/panel-verification/native-${name}.png`,root))});
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }
  await service.stopCapture();
  assert.equal(service.capture,null);
  await service.startCapture('test-pfd');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Restart produced no frames')),5000);
    const listener=(data,binary)=>{if(binary){clearTimeout(timer);client.off('message',listener);resolve();}};
    client.on('message',listener);
  });
  await service.close();
  assert.equal(service.capture,null);
  console.log(`Native-to-LAN: ${hashes.size} distinct real GPU JPEGs; stop/restart/close passed${browser ? '; desktop/mobile decoded pixels and screenshots passed' : ''}.`);
} finally {
  clearTimeout(watchdog);client?.terminate();await browser?.close();await service?.close();
  if (target.exitCode===null) {const exited=once(target,'exit');target.kill();await exited;}
}
