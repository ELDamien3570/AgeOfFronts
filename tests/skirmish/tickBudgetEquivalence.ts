import { isDeepStrictEqual } from "node:util";
import { writeFileSync } from "node:fs";
import { Skirmish } from "../../src/skirmish/Simulation";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import {FIXED} from "../../src/skirmish/Protocol";
import {squadCap} from "../../src/skirmish/FactionRules";
const baselinePath="../../out/tick-budget/baseline-exports.mjs";
const baseline=await import(baselinePath) as {Skirmish:typeof Skirmish;GameMapImpl:typeof GameMapImpl};
const ticks=Number(process.argv[2]??3000);
if(!Number.isSafeInteger(ticks)||ticks<1)throw new Error("Expected a positive tick count before diagnostic flags");
const restoreOnly=process.argv.includes("--restore-only");
const dense=process.argv.includes("--dense");
const tested=process.argv.includes("--baseline-only")?baseline:{Skirmish,GameMapImpl};
for(const seed of [47,72]) {
  const width=dense?1000:240,height=dense?660:160,data=new Uint8Array(width*height).fill(133);
  data.fill(0,(dense?400:100)*width,(dense?640:140)*width);
  const options={seed,aiCount:dense?14:3,tribes:dense,tribeCount:30,humanNames:dense?["Human 1","Human 2"]:undefined,ruleset:"ages-v1" as const,startingAge:dense?"Modern" as const:"BronzeAge" as const,...DEFAULT_AI_POLICIES};
  const candidate=new tested.Skirmish(new tested.GameMapImpl(width,height,data,data.length),options);
  const control=new baseline.Skirmish(new baseline.GameMapImpl(width,height,data,data.length),options);
  if(!dense)candidate.players[0].ai=control.players[0].ai=true;
  else for(const game of [candidate,control])for(const [at,p] of game.players.filter(p=>p.kind!=="tribe").entries()) {
    const template=structuredClone(game.squadFacts().byOwner(p.id)[0]);
    for(let i=game.squadFacts().byOwner(p.id).length;i<squadCap(p,"Modern");i++)game.addSquad({...template,id:game.allocateId(),x:template.x+(i%10)*FIXED*2,y:template.y+Math.floor(i/10)*FIXED*2,order:{type:"hold"},path:[],queuedOrders:[]});
    const x=10+at*28,port=game.addBuilding({id:game.allocateId(),playerId:p.id,type:"port",tile:game.map.ref(x,398),remainingTicks:0,health:1000,age:"Modern"});
    for(let y=398;y<400;y++)for(let dx=0;dx<2;dx++)
      (game as unknown as {changeOwner(tile:number,id:number):void}).changeOwner(game.map.ref(x+dx,y),p.id);
    game.expansion!.supply.goods.set(port.id,100000);
    for(let i=0;i<64;i++)game.addShip({id:game.allocateId(),playerId:p.id,kind:"warship",definitionId:"modern-warship",x:(10+i*15+at%2+.5)*FIXED,y:(430+at*4+.5)*FIXED,health:game.expansion!.vessel({playerId:p.id,definitionId:"modern-warship",kind:"warship"} as never).health,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false,boarding:null});
    if(at>0)game.applyCommand({type:"alliance",playerId:1,otherId:p.id,action:"declare"});
  }
  for(let i=0;i<ticks;i++) {
    candidate.step();if(!restoreOnly)control.step();
    if(!restoreOnly && i%50===0 && !isDeepStrictEqual(candidate.checkpoint(),control.checkpoint())) {
      writeFileSync(`out/tick-budget/divergence-${seed}-candidate.json`,JSON.stringify(candidate.checkpoint()));
      writeFileSync(`out/tick-budget/divergence-${seed}-baseline.json`,JSON.stringify(control.checkpoint()));
      throw new Error(`Baseline behavior diverged at seed ${seed}, tick ${candidate.tick}`);
    }
    if(i%500===499) {
      const saved=candidate.checkpoint(),cold=new tested.Skirmish(candidate.map,options);cold.restore(saved);
      candidate.step();if(!restoreOnly)control.step();cold.step();
      if(!isDeepStrictEqual(candidate.checkpoint(),cold.checkpoint())) {
        writeFileSync(`out/tick-budget/cold-divergence-${seed}-hot.json`,JSON.stringify(candidate.checkpoint()));
        writeFileSync(`out/tick-budget/cold-divergence-${seed}-cold.json`,JSON.stringify(cold.checkpoint()));
        throw new Error(`Cold restore diverged at seed ${seed}, tick ${candidate.tick}`);
      }
    }
  }
  console.log(JSON.stringify({seed,dense,tick:candidate.tick,squads:candidate.squads.length,ships:candidate.ships.length,baseline:restoreOnly?"not compared (strategic cadence changed)":"equal",coldRestore:"equal",captureWork:candidate.captureWork}));
}
