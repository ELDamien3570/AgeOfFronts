import {GameMapImpl} from "../src/core/game/GameMap";
import {Skirmish} from "../src/skirmish/Simulation";
import {AGES,RESOURCES} from "../src/skirmish/domain/Definitions";
const data=new Uint8Array(64*64).fill(133);
const m=new Skirmish(new GameMapImpl(64,64,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:true,aiEconomy:true,ruleset:"ages-v1",technologySpeed:3});
const e=m.expansion!,p=m.players[1];p.personalityId="scholar";
e.diplomacy.action(m.players[0],p,"offer",0);e.diplomacy.action(p,m.players[0],"accept",0);
let previous="",start=performance.now();
for(let tick=0;tick<30000;tick++){
 if(tick%100===0){p.gold=10000000;p.reserves=200000;for(const r of RESOURCES)e.supply.inventories[p.id][r]=50000;for(const age of AGES)for(const suffix of ["","-siege","-vehicle"])e.supply.inventories[p.id][`equipment:${age.toLowerCase()}${suffix}`]=1000;}
 // This progression-only sandbox continues after conquest; victory qualification is a separate test.
 m.winner=null;e.winners.length=0;
 m.step();const state=e.progression.states[p.id];
 if(state.age!==previous || tick%4000===0){console.log(JSON.stringify({tick:m.tick,age:state.age,completed:state.completed.length,research:state.research,seconds:Math.round((performance.now()-start)/1000)}));previous=state.age;}
 if(state.age==="Modern"){console.log("PASS: AI reached Modern through paid research and age advancement");process.exit(0);}
}
console.log(JSON.stringify(e.progression.states[p.id]));throw new Error("AI did not reach Modern within the bounded progression smoke");
