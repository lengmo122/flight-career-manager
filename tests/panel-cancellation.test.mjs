import assert from 'node:assert/strict';
import { PanelService } from '../panel-service.mjs';

let releaseMarker, reachedMarker, loads = 0, marked = false;
const entered = new Promise(resolve => { reachedMarker = resolve; });
const service = new PanelService({port:0, targets:async()=>[{pid:1,name:'test'}], discovery:{
  scan:async()=>[{id:'test',pageId:1,index:0,width:256,height:256,name:'test'}],
  mark:async(panel,marker)=>{
    if (marker) { reachedMarker(); await new Promise(resolve=>{releaseMarker=resolve;}); }
    marked=!!marker;
  }, close:async()=>{}
},native:()=>{loads++;return {stop:async()=>{}};}});
try {
  const start=service.startCapture('test');
  const cancelled=assert.rejects(start,/capture-cancelled/);
  await entered;
  await service.stopCapture();
  releaseMarker();
  await cancelled;
  assert.equal(loads,0,'A cancelled start must never load the DLL');
  assert.equal(marked,false,'Late marker completion must be cleaned up');
  assert.equal(service.captureStatus().phase,'idle');
} finally {await service.close();}
console.log('Panel cancellation: in-flight startup cancels without loading a DLL or leaving markers.');
