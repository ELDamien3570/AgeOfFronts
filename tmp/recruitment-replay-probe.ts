import {createSkirmishMap} from "../src/skirmish/Elevation";
import {Skirmish} from "../src/skirmish/Simulation";
const w=160,h=100;const cover=new Uint8Array(w*h).map((_,i)=>(i*7919)%13<5?255:0);
const map=()=>createSkirmishMap(w,h,new Uint8Array(w*h).fill(133),undefined,{cover:cover.slice()});
const options={seed:1234,aiCount:5,tribes:false,ruleset:"ages-v1" as const};
const host=new Skirmish(map(),options);for(let i=0;i<600;i++)host.step();
const follower=new Skirmish(map(),options);follower.restore(host.checkpoint());
const json=(v:unknown)=>JSON.stringify(v,(_,v)=>v instanceof Map?[...v]:v instanceof Set?[...v]:v);
for(let t=600;t<=800;t++){
 const a=host.checkpoint(),b=follower.checkpoint();const keys=Object.keys(a).filter(k=>json((a as any)[k])!==json((b as any)[k]));
 if(keys.length){console.log("first divergence",t,keys);console.log("squads",a.squads.filter((s,i)=>json(s)!==json(b.squads[i])).map(s=>({id:s.id,host:s,follower:b.squads.find(x=>x.id===s.id)})));break;}
 host.step();follower.step();
}
