import fs from "node:fs";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";
import { DEFAULT_AI_POLICIES } from "../src/skirmish/content/AiPolicies.ts";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";
const terrain=(await loadServerMap(defaultLobbySettings("old-world",1000))).map;
const game=new Skirmish(createSkirmishMap(terrain.width,terrain.height,terrain.terrain,terrain.elevation,terrain.forest,terrain.resourceTerrain),{
  ...DEFAULT_AI_POLICIES,seed:42,humanNames:["A","B","C","D","E","F"],aiCount:10,tribes:true,tribeCount:25,
  ruleset:"ages-v1",startingAge:"Modern",runAi:false,
});
const outcomes=[];game.commandApplications.onOutcome=outcome=>outcomes.push({...outcome});
const origins=new Map(game.squads.map(s=>[s.id,{x:s.x,y:s.y}]));
for(let playerId=1;playerId<=6;playerId++){
  const squads=game.squads.filter(s=>s.playerId===playerId),s=squads[0],goals=[];
  for(let tile=0;tile<game.owners.length;tile++)if(game.owners[tile]===playerId&&game.paths.walkable(tile)){
    const distance=Math.hypot((game.map.x(tile)+.5)*256-s.x,(game.map.y(tile)+.5)*256-s.y);
    if(distance>=4*256&&distance<=8*256)goals.push({tile,distance});
  }
  goals.sort((a,b)=>a.distance-b.distance||a.tile-b.tile);
  game.commandApplications.apply(`trace-${playerId}`,{type:"order",playerId,squadIds:squads.map(s=>s.id),order:{type:"move",tile:goals[0].tile}});
}
const rows=[];
for(let at=0;at<10;at++){
  game.step();
  rows.push({tick:game.tick,outcomes:outcomes.splice(0),planner:{...game.routePlanner.diagnostics},
    admissions:game.movementAdmission.checkpoint().pending.filter(([,a])=>a.playerId<=6).map(([id,a])=>({id,player:a.playerId,phase:a.phase,
      formationPhase:a.formation.phase,formationCandidate:a.formation.candidate,members:a.members.map(m=>({id:m.id,requested:m.requested,path:m.path?.length,shared:m.shared?.stage}))})),
    motion:game.squads.filter(s=>s.playerId<=6).map(s=>({id:s.id,player:s.playerId,distance:Math.hypot(s.x-origins.get(s.id).x,s.y-origins.get(s.id).y)}))});
}
fs.mkdirSync("out/responsiveness",{recursive:true});fs.writeFileSync("out/responsiveness/admission-trace.json",JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(row=>({tick:row.tick,outcomes:row.outcomes,admissions:row.admissions.map(a=>({player:a.player,phase:a.phase,formation:a.formationPhase,members:a.members})),moved:row.motion.filter(s=>s.distance>8).map(s=>s.id)})),null,2));
