import {parentPort} from 'node:worker_threads';
import {createHash} from 'node:crypto';
const hashes=new Map(),states=new Map();let comparedFrames=0,processed=0;
parentPort.on('message',message=>{
 if(message.type==='drain'){parentPort.postMessage({type:'drained',comparedFrames,processed,retainedFrames:hashes.size});return;}
 const {key,index,tick,snapshot:snap}=message;
 const sections=[snap.squads,snap.ships,snap.buildings,snap.traders,snap.armies,snap.players];
 const canonical=JSON.stringify(sections.map(section=>section&&[...section].sort((a,b)=>a.id-b.id)),(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
 const digest=createHash('sha256').update(snap.owners).update(canonical).digest('hex');
 const row=hashes.get(key)??new Map(),previousSize=row.size;row.set(index,digest);hashes.set(key,row);
 const samples=states.get(key)??new Map();samples.set(index,{tick,packetTick:snap.tick,ownersHash:createHash('sha256').update(snap.owners).digest('hex'),sections:sections.map(section=>JSON.stringify(section)??'null')});states.set(key,samples);
 if(previousSize<2&&row.size>=2)comparedFrames++;processed++;
 if(new Set(row.values()).size>1)parentPort.postMessage({type:'disagreement',key,states:[...samples]});
 while(hashes.size>32){const first=hashes.keys().next().value;hashes.delete(first);states.delete(first);}
 parentPort.postMessage({type:'compared',comparedFrames,processed});
});
