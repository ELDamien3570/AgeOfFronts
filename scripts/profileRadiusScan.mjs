import fs from "node:fs";
import path from "node:path";
import { deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { Skirmish } from "../src/skirmish/Simulation.ts";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";

const args=process.argv.slice(2),value=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const saved=deserialize(fs.readFileSync(value("--restore","out/overnight-1000/seed42-filtered/checkpoint-60000.v8")));
const loaded=await loadServerMap(defaultLobbySettings("old-world",1000)),results=[];
for(const legacy of [true,false,false,true]) {
  const map=createSkirmishMap(loaded.map.width,loaded.map.height,loaded.map.terrain,loaded.map.elevation,loaded.map.forest,loaded.map.resourceTerrain);
  const game=new Skirmish(map,saved.options);game.restore(saved);
  if(legacy)game.eachInRadius=function(center,radius,fn){
    const cx=this.map.x(center),cy=this.map.y(center);
    for(let y=Math.max(0,cy-radius);y<=Math.min(this.map.height()-1,cy+radius);y++)
      for(let x=Math.max(0,cx-radius);x<=Math.min(this.map.width()-1,cx+radius);x++){
        if((x-cx)**2+(y-cy)**2>radius**2)continue;
        const tile=this.map.ref(x,y);if(this.paths.walkable(tile))fn(tile);
      }
  };
  const capture=[],ticks=[];
  game.onPhase=(phase,ms)=>{if(phase==="capture")capture.push(ms);if(phase==="tick")ticks.push(ms);};
  const start=performance.now();for(let i=0;i<400;i++)game.step();
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  results.push({legacy,wallMs:performance.now()-start,captureMean:mean(capture),tickMean:mean(ticks),hash:createHash("sha256").update(JSON.stringify(game.snapshot())).digest("hex")});
}
if(new Set(results.map(r=>r.hash)).size!==1)throw new Error("Radial optimization changed canonical state");
const out=value("--out","out/overnight-1000/radius-comparison.json");fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({results},null,2));console.log(JSON.stringify(results));
