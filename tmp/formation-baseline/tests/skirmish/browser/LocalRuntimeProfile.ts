import { GameMapImpl } from "../../../src/core/game/GameMap";
import { Renderer } from "../../../src/skirmish/client/Renderer";
import { SnapshotDecoder } from "../../../src/skirmish/SnapshotCodec";
import type { SnapshotPacket } from "../../../src/skirmish/Protocol";

const run=document.querySelector<HTMLButtonElement>("#run")!,result=document.querySelector<HTMLPreElement>("#result")!,renderer=new Renderer(document.querySelector<HTMLCanvasElement>("#battlefield")!);
run.addEventListener("click",()=>void profile());
const summary=(xs:number[])=>{const s=xs.slice().sort((a,b)=>a-b);return{samples:xs.length,mean:xs.reduce((a,b)=>a+b,0)/xs.length,p95:s[Math.ceil(xs.length*.95)-1],p99:s[Math.ceil(xs.length*.99)-1],maximum:s[s.length-1],above50:xs.filter(x=>x>50).length};};
async function profile(){
  run.disabled=true;result.textContent="Running 30-second renderer/worker load; first 3 seconds excluded from steady-state metrics.";
  const worker=new Worker(new URL("./LocalRuntimeWorker.ts",import.meta.url),{type:"module"}),decoder=new SnapshotDecoder();
  renderer.setMap(new GameMapImpl(192,128,new Uint8Array(24576).fill(133),24576));
  const frames:number[]=[],intervals:number[]=[],updates:number[]=[],decode:number[]=[],steps:number[]=[],encodes:number[]=[],latencies:number[]=[],longTasks:{start:number;duration:number}[]=[],heaps:{at:number;used:number}[]=[];
  const started=performance.now(),warm=started+3000,until=started+30000;
  let previous=0,lastTick=0,squads=0,packets=0,error:string|undefined,frameId=0;
  worker.onerror=event=>{error=event.message;};
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.startTime>=warm)longTasks.push({start:entry.startTime,duration:entry.duration});});
  try { observer.observe({entryTypes:["longtask"]}); } catch { /* Unsupported browsers still expose frame timings. */ }
  worker.onmessage=(event:MessageEvent<{packet?:SnapshotPacket;stepMs:number;encodeMs:number;sentAt:number;squads:number;error?:string}>)=>{
    if(event.data.error){error=event.data.error;return;}
    try{
      const start=performance.now(),snapshot=decoder.decode(event.data.packet!,false),decoded=performance.now();renderer.update(snapshot);
      if(!packets)renderer.home();packets++;lastTick=snapshot.tick;squads=event.data.squads;
      if(start>=warm){decode.push(decoded-start);updates.push(performance.now()-decoded);steps.push(event.data.stepMs);encodes.push(event.data.encodeMs);latencies.push(performance.timeOrigin+start-event.data.sentAt);}
    }catch(e){error=String(e);}
  };
  worker.postMessage({type:"start"});
  await new Promise<void>(resolve=>{
    const frame=(now:number)=>{
      const start=performance.now(),rendered=renderer.draw(now,1,false);
      if(now>=warm){if(rendered)frames.push(performance.now()-start);if(previous)intervals.push(now-previous);
        const memory=(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory;
        if(memory&&(!heaps.length||now-heaps[heaps.length-1].at>=1000))heaps.push({at:now,used:memory.usedJSHeapSize});}
      previous=now;if(now>=until||error)resolve();else frameId=requestAnimationFrame(frame);
    };frameId=requestAnimationFrame(frame);
  });
  worker.postMessage({type:"stop"});worker.terminate();cancelAnimationFrame(frameId);observer.disconnect();
  if(!packets)error??="No simulation packets received";
  const evidence={status:error?"FAIL":"PASS",error,browser:navigator.userAgent,visibility:document.visibilityState,durationMs:performance.now()-started,warmupMs:3000,
    scene:"192x128 all land, seed 42, initial 1500 holding squads and 200 towers, 15 factions; real simulation/replication at 20Hz in worker; no AI decisions or sockets",packets,lastTick,finalSquads:squads,
    draw:summary(frames),frameInterval:summary(intervals),rendererUpdate:summary(updates),decode:summary(decode),simulation:summary(steps),encode:summary(encodes),workerDelivery:summary(latencies),longTasks,heapSamples:heaps,
    limitations:"Synthetic local render/worker load with ordinary combat/capture, fit-to-map overview; no online HUD or actual network. Draw timings count actual draw calls, excluding renderer frame-limit skips. Browser heap samples are opportunistic, not an allocation or leak proof. Frame timing depends on browser viewport/GPU and tool activity."};
  result.textContent=JSON.stringify(evidence,null,2);console.info(JSON.stringify({event:"local-runtime-profile",...evidence}));run.disabled=false;
  // Preserve the GPU scene briefly for screenshot inspection after measuring.
  const sceneUntil=performance.now()+15000;
  const preserveScene=(now:number)=>{renderer.draw(now,1,true);if(now<sceneUntil)requestAnimationFrame(preserveScene);};
  requestAnimationFrame(preserveScene);
}


