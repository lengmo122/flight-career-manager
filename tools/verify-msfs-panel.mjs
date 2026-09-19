import { PanelService } from '../panel-service.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startNativeCapture } from '../panel-native.mjs';

// Explicit opt-in only: this script loads the capture DLL into the running simulator.
if (!process.argv.includes('--allow-live-capture')) throw new Error('Live simulator capture requires --allow-live-capture');
const nativeDirectory = process.argv.find(arg=>arg.startsWith('--native-directory='))?.slice('--native-directory='.length);
const service=new PanelService({port:0, ...(nativeDirectory ? {native:(pid,marker,callbacks)=>startNativeCapture(pid,marker,callbacks,nativeDirectory)} : {})});
let viewer;
const output=join(import.meta.dirname,'panel-verification');
try {
  await mkdir(output,{recursive:true});
  const status=await service.status();
  console.log(JSON.stringify({phase:status.phase,message:status.message,panels:status.panels.map(p=>({id:p.id,name:p.name}))}));
  const selected=status.panels.find(p=>/PFD|DU LeftOutboard|MCDU|CDUScreen/i.test(p.name)) || status.panels[0];
  if (!selected) throw new Error('No visible simulator panel');
  let frames=0, first;
  viewer=new WebSocket(`ws://127.0.0.1:${status.port}/stream?panel=${selected.id}&token=${status.shareToken}`);
  viewer.on('error',error=>console.log(error.message));
  viewer.on('message',(data,binary)=>{if(binary){frames++;first ||= Buffer.from(data);}});
  console.log(`Capturing ${selected.id}: ${selected.name}`);
  await service.startCapture(selected.id);
  for(let i=0;i<18;i++) {
    await new Promise(resolve=>setTimeout(resolve,1000));
    const current=service.captureStatus();
    console.log(JSON.stringify({second:i+1,frames,...current}));
    if(current.phase==='error' || frames>=10) break;
  }
  if(first) await writeFile(join(output,'msfs-panel-first.jpg'),first);
  await writeFile(join(output,'msfs-panel-result.json'),JSON.stringify({panel:selected,frames,...service.captureStatus()},null,2));
} finally {viewer?.terminate();await service.close();console.log('Capture stopped; simulator left running.');}
