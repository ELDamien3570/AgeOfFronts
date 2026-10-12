import {generateMigration} from '../../../src/skirmish/MigrationMap';
import {Renderer} from '../../../src/skirmish/client/Renderer';
import {installTroopPresentation} from '../../../src/skirmish/client/troops/TroopPresentation';
import {SnapshotDecoder} from '../../../src/skirmish/SnapshotCodec';
import {DEFAULT_AI_POLICIES} from '../../../src/skirmish/content/AiPolicies';
import {FORMATION_MOVEMENT} from '../../../src/skirmish/content/FormationMovement';
import type {WorkerRequest,WorkerResponse} from '../../../src/skirmish/Protocol';
const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector<HTMLPreElement>('#status')!,canvas=document.querySelector<HTMLCanvasElement>('canvas')!;
const summary=(xs:number[])=>{const s=xs.slice().sort((a,b)=>a-b);return{n:s.length,mean:xs.reduce((n,x)=>n+x,0)/Math.max(1,xs.length),p95:s[Math.ceil(s.length*.95)-1],max:s[s.length-1]};};
button.onclick=async()=>{
 button.disabled=true;status.textContent='Generating exact map…';await new Promise(r=>requestAnimationFrame(r));
 const loaded=generateMigration(1000,504565698),renderer=new Renderer(canvas),actors=installTroopPresentation(renderer),decoder=new SnapshotDecoder();renderer.setMap(loaded.map,loaded.geography,loaded.environment);
 const worker=new Worker(new URL('../../../src/skirmish/Worker.ts',import.meta.url),{type:'module'});
 let tick=0,packets=0,previous=0,start=0,lastMessage=0,lastStatus=0,frame=0,error:string|undefined;
 const draws:number[]=[],updates:number[]=[],decodes:number[]=[],deliveries:number[]=[],tasks:number[]=[],heaps:number[]=[];
 const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())tasks.push(e.duration);});observer.observe({entryTypes:['longtask']});
 const stop=()=>{worker.terminate();cancelAnimationFrame(frame);observer.disconnect();const result={tick,packets,error,draw:summary(draws),update:summary(updates),decode:summary(decodes),packetGap:summary(deliveries),longTasks:summary(tasks),heap:heaps,limitations:'Production worker, renderer and troop presentation; 60-second opening, no HUD or sockets. Map/setup time excluded. Separate headless profile is running concurrently.'};status.textContent=JSON.stringify(result,null,2);console.info('migration-browser-profile',JSON.stringify(result));};
 worker.onerror=e=>{error=e.message;stop();};
 worker.onmessage=(e:MessageEvent<WorkerResponse>)=>{if(e.data.type==='error'){error=e.data.message;stop();return;}if(e.data.type!=='state')return;
 const at=performance.now(),snapshot=decoder.decode(e.data.packet,false),decoded=performance.now();renderer.update(snapshot);actors.update(snapshot);
 if(packets){deliveries.push(at-previous);}else{start=at;renderer.draw(at,1,false);renderer.focusStartingLocation(snapshot.players[0].base);renderer.zoom(3,canvas.clientWidth/2,canvas.clientHeight/2);}
 previous=at;lastMessage=at;tick=snapshot.tick;packets++;decodes.push(decoded-at);updates.push(performance.now()-decoded);};
 worker.postMessage({type:'start',width:1000,height:1000,terrain:loaded.terrain,elevation:loaded.elevation,forest:loaded.forest,resourceTerrain:loaded.resourceTerrain,
 options:{...DEFAULT_AI_POLICIES,...FORMATION_MOVEMENT,seed:504565698,aiCount:14,tribes:true,ruleset:'ages-v1',startingAge:'StoneAge',territoryIncomeScale:loaded.territoryIncomeScale}} satisfies WorkerRequest);
 const render=(now:number)=>{const at=performance.now();actors.beginFrame(now,1,false);const drawn=renderer.draw(now,1,false);actors.endFrame(now,0);if(drawn)draws.push(performance.now()-at);
 if(start&&now-start>=60000){stop();return;}if(start&&now-lastStatus>=1000){lastStatus=now;status.textContent=`tick ${tick} · packets ${packets} · last update ${(now-lastMessage).toFixed(0)} ms ago · draw p95 ${summary(draws).p95?.toFixed(1)} ms`;}
 const memory=(performance as Performance&{memory?:{usedJSHeapSize:number}}).memory;if(memory&&draws.length%60===0)heaps.push(memory.usedJSHeapSize);
 frame=requestAnimationFrame(render);};frame=requestAnimationFrame(render);
};
