import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const {_electron} = await import(process.env.FCM_PLAYWRIGHT_MODULE || 'playwright');
const profile = await mkdtemp(join(tmpdir(),'mofei-panel-package-test-'));
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const directory = fileURLToPath(new URL(`../release-fast-${version}/模飞生涯-win32-x64/`,import.meta.url));
let app;
try {
  for (const name of ['MofeiCaptureHost.exe','MofeiCapture.dll','MinHook-LICENSE.txt']) assert.ok((await stat(join(directory,'resources','panel-capture',name))).size>0);
  app=await _electron.launch({executablePath:join(directory,'模飞生涯.exe'),env:{...process.env,APPDATA:profile,LOCALAPPDATA:profile,FLIGHT_MANAGER_PERSISTENCE_TEST:'1',FLIGHT_MANAGER_TEST_USER_DATA:profile}});
  const paths=await app.evaluate(({app})=>({data:app.getPath('userData'),version:app.getVersion(),path:app.getAppPath()}));
  assert.ok(paths.data.startsWith(profile),'Package smoke test must never use the user career save');
  assert.equal(paths.version,version);assert.ok(paths.path.endsWith('app.asar'));
  const window=await app.firstWindow();
  const errors=[];window.on('pageerror',error=>errors.push(error.message));
  await window.waitForFunction(()=>document.body?.dataset.appReady==='true');
  const result=await window.evaluate(async()=> {
    const response=await fetch('/api/panels/status');return {code:response.status,body:await response.json()};
  });
  assert.equal(result.code,200);assert.equal(result.body.independent,true);
  assert.equal(result.body.capturing,false,'Package smoke test must not load capture DLL into the game');
  assert.ok(result.body.message!=='抓取组件缺失，请重新安装完整软件。');
  assert.deepEqual(errors,[]);
  const lanPort=result.body.port;
  await app.close();app=null;
  await assert.rejects(fetch(`http://127.0.0.1:${lanPort}/panel/test`),'Quit must release the panel service port');
  console.log(`Packaged ${version}: startup, isolated profile, bundled native components, independent panel service and quit cleanup passed (${result.body.panels.length} discovered panels).`);
} finally {await app?.close();await rm(profile,{recursive:true,force:true});}
