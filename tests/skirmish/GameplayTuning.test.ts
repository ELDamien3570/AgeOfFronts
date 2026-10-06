import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FIXED, type Building, type BuildingType } from "../../src/skirmish/Protocol";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS, defaultUnit } from "../../src/skirmish/content/Units";
import { buildingCost } from "../../src/skirmish/content/Buildings";
import { sortieCommand } from "../../src/skirmish/client/Controls";
import { WallPresentation } from "../../src/skirmish/client/WallPresentation";
import { PlacementPreview } from "../../src/skirmish/client/PlacementPreview";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { impactSize } from "../../src/skirmish/client/CombatEffectsViewModel";

function fixture() {
  const data = new Uint8Array(160*96).fill(133);
  const game = new Skirmish(new GameMapImpl(160,96,data,data.length), {
    seed:47, aiCount:2, tribes:false, runAi:false, ruleset:"ages-v1",
  });
  const e = game.expansion!;
  for (const p of game.players) {
    p.gold = 1e7;
    e.progression.states[p.id].age = "Modern";
    e.progression.states[p.id].completed = TECHNOLOGIES.map(t => t.id);
  }
  return {game,e};
}
function building(game: Skirmish,type: BuildingType,x: number,y: number,playerId=1): Building {
  return game.addBuilding({id:game.allocateId(),playerId,type,tile:game.map.ref(x,y),
    age:"Modern",remainingTicks:0,health:5000,maxHealth:5000});
}
function plane(game:Skirmish,field:Building,definitionId: "fighter" | "bomber" = "bomber") {
  const a = {id:game.allocateId(),playerId:field.playerId,definitionId,
    airfieldId:field.id,x:(game.map.x(field.tile)+.5)*FIXED,y:(game.map.y(field.tile)+.5)*FIXED,
    health:1000,target:null,state:"ready" as const,reloadTick:0,fuelTicks:1200};
  game.expansion!.aircraft.push(a);
  return a;
}
describe("sortie dispatch", () => {
  it("launches one closest ready bomber without selection, Shift launches at most five", () => {
    const {game,e} = fixture(), near = building(game,"airstrip",20,20), far = building(game,"airstrip",80,20);
    const farther = plane(game,far), planes = Array.from({length:6},()=>plane(game,near));
    plane(game,near,"fighter"); plane(game,building(game,"airstrip",19,20,2));
    const x=30*FIXED,y=20*FIXED;
    const one = sortieCommand(game.snapshot(),1,x,y)!;
    expect(one.aircraftIds).toEqual([planes[0].id]);
    expect(game.applyCommand(one)).toBeNull();
    expect(e.aircraft.filter(a=>a.state==="outbound").map(a=>a.id)).toEqual([planes[0].id]);
    const five = sortieCommand(game.snapshot(),1,x,y,true)!;
    expect(five.aircraftIds).toEqual(planes.slice(1).map(a=>a.id));
    expect(game.applyCommand(five)).toBeNull();
    const short = sortieCommand(game.snapshot(),1,x,y,true)!;
    expect(short.aircraftIds).toEqual([farther.id]);
  });
  it("honors selected aircraft and rejects lost, unfinished or destroyed runways atomically", () => {
    const {game,e} = fixture(), field = building(game,"airstrip",20,20), fighter=plane(game,field,"fighter");
    const bomber=plane(game,field);
    expect(sortieCommand(game.snapshot(),1,0,0,false,new Set([fighter.id]))!.aircraftIds).toEqual([fighter.id]);
    for (const changes of [{remainingTicks:10},{remainingTicks:0,health:0},{health:5000,playerId:2}]) {
      game.updateBuilding(field.id,changes);
      expect(sortieCommand(game.snapshot(),1,0,0)).toBeNull();
      expect(game.applyCommand({type:"sortie",playerId:1,aircraftIds:[bomber.id],x:0,y:0})).not.toBeNull();
      expect(e.aircraft.every(a=>a.state==="ready")).toBe(true);
    }
  });
});
describe("equipment and strategic weapons", () => {
  it("charges two troop equipment for all post-Stone mounted units, keeping tanks and Stone unchanged", () => {
    for (const u of UNITS.filter(u=>u.tags.includes("mounted")&&u.age!=="StoneAge")) {
      expect(u.cost.items![u.equipment!],u.id).toBe(2);
    }
    expect(defaultUnit("cavalry","StoneAge").equipment).toBeUndefined();
    const tank=defaultUnit("cavalry","Modern");
    expect(tank.cost.items![tank.equipment!]).toBe(1);
    const {game,e}=fixture(), cavalry=defaultUnit("cavalry","BronzeAge");
    const stable=building(game,"stables",20,20);
    game.owners[stable.tile]=1;
    game.owners[stable.tile]=1;
    e.supply.inventories[1]={...cavalry.cost.items,[cavalry.equipment!]:1};
    const command={type:"recruit" as const,playerId:1,buildingId:stable.id,definitionId:cavalry.id};
    const gold=game.player(1)!.gold;
    expect(game.applyCommand(command)).not.toBeNull();
    expect(game.player(1)!.gold).toBe(gold);
    e.supply.inventories[1][cavalry.equipment!]=2;
    expect(game.applyCommand(command)).toBeNull();
    expect(e.supply.inventories[1][cavalry.equipment!]).toBe(0);
  });
  it.each([0,3,10])("targets eight nearest hostile buildings, cycling when only %i exist", count => {
    const {game,e}=fixture(), launcher=building(game,"mirv-launcher",10,10);
    // Remove starter buildings so this tests the exact nearest-target set.
    for(const b of [...game.buildings]) if(b.id!==launcher.id) game.removeBuilding(b.id);
    const targets=Array.from({length:count},(_,i)=>building(game,"factory",50+i,40,2));
    building(game,"city",50,39); // A closer friendly building must be ignored.
    e.supply.inventories[1]["payload:mirv"]=1;
    expect(game.applyCommand({type:"launch",playerId:1,launcherId:launcher.id,payload:"mirv",x:50.5*FIXED,y:40.5*FIXED})).toBeNull();
    expect(e.battle.projectiles[0].warheads).toBe(8);
    game.tick=360; e.battle.advanceProjectiles();
    const shots=e.battle.projectiles.filter(p=>p.kind==="warhead");
    expect(shots).toHaveLength(8);
    expect(shots.map(p=>[p.toX,p.toY])).toEqual(Array.from({length:8},(_,i)=>
      targets.length ? [(50+i%Math.min(count,8)+.5)*FIXED,40.5*FIXED] : [50.5*FIXED,40.5*FIXED]));
    expect(shots.reduce((sum,p)=>sum+p.damage,0)).toBe(24000);
  });
  it("keeps all eight focused on an explicit building through checkpoint and snapshot restore", () => {
    const {game,e}=fixture(),launcher=building(game,"mirv-launcher",10,10),target=building(game,"factory",70,40,2);
    building(game,"city",50,40,2);
    e.supply.inventories[1]["payload:mirv"]=1;
    expect(game.applyCommand({type:"launch",playerId:1,launcherId:launcher.id,payload:"mirv",x:0,y:0,buildingId:target.id})).toBeNull();
    const restored=fixture().game; restored.restore(game.checkpoint());
    const decoded=new SnapshotDecoder().decode(new SnapshotEncoder().encode(restored.snapshot()));
    expect(decoded.expansion!.projectiles[0].targetBuildingId).toBe(target.id);
    restored.tick=360; restored.expansion!.battle.advanceProjectiles();
    expect(restored.expansion!.battle.projectiles.filter(p=>p.kind==="warhead").map(p=>[p.toX,p.toY]))
      .toEqual(Array.from({length:8},()=>[70.5*FIXED,40.5*FIXED]));
  });
  it("reserves all eight warhead slots so other shots cannot truncate a MIRV at capacity", () => {
    const {game,e}=fixture(),launcher=building(game,"mirv-launcher",10,10);
    e.supply.inventories[1]["payload:mirv"]=1;
    expect(game.applyCommand({type:"launch",playerId:1,launcherId:launcher.id,payload:"mirv",x:50*FIXED,y:40*FIXED})).toBeNull();
    const parent=e.battle.projectiles[0];
    while(e.battle.projectiles.length<4088) e.battle.projectiles.push({...parent,
      id:game.allocateId(),kind:"shell",warheads:0,impacted:true,impactAt:0});
    const restored=fixture().game;restored.restore(game.checkpoint());
    const battle=restored.expansion!.battle;
    expect(battle.canFire()).toBe(false);
    expect(battle.fire(restored.squads[0],{x:0,y:0},defaultUnit("infantry").attack,100)).toBe(false);
    restored.tick=360; battle.advanceProjectiles();
    expect(battle.projectiles.filter(p=>p.kind==="warhead")).toHaveLength(8);
  });
  it("damages enemies within the enlarged hydrogen radius and leaves enemies beyond it intact", () => {
    const {game,e}=fixture(), launcher=building(game,"missile-silo",10,10);
    const inside=game.squads.find(s=>s.playerId===2)!,outside=game.squads.find(s=>s.playerId===3)!;
    game.updateSquad(inside.id,{x:60.5*FIXED,y:40.5*FIXED});
    game.updateSquad(outside.id,{x:79.5*FIXED,y:40.5*FIXED});
    e.supply.inventories[1]["payload:hydrogen"]=1;
    expect(game.applyCommand({type:"launch",playerId:1,launcherId:launcher.id,payload:"hydrogen",x:50.5*FIXED,y:40.5*FIXED})).toBeNull();
    const p=e.battle.projectiles[0]; expect(p.blastRadius).toBe(28*FIXED);
    expect(impactSize("impact-hydrogen",p.blastRadius,10)).toBe(4*impactSize("impact-hydrogen",7*FIXED,10));
    game.tick=720; e.battle.advanceProjectiles();
    expect(game.squad(inside.id)).toBeUndefined();
    expect(game.squad(outside.id)!.troops).toBe(1000);
  });
  it("bombs a ground squad three tiles away using the doubled bomber radius", () => {
    const {game,e}=fixture(),field=building(game,"airstrip",50,40),bomber=plane(game,field);
    const victim=game.squads.find(s=>s.playerId===2)!;
    game.updateSquad(victim.id,{x:53.5*FIXED,y:40.5*FIXED});
    expect(game.applyCommand({type:"sortie",playerId:1,aircraftIds:[bomber.id],x:bomber.x,y:bomber.y})).toBeNull();
    e.afterMovement();
    const p=e.battle.projectiles.find(p=>p.kind==="bomb")!;
    expect(p.blastRadius).toBe(4*FIXED);
    game.tick=p.impactTick; e.battle.advanceProjectiles();
    expect(game.squad(victim.id)?.troops ?? 0).toBeLessThan(1000);
  });
});
describe("connected trench runs", () => {
  it("uses shared paid placement quotes, provides cover, stays passable, and replicates/restores", () => {
    const {game,e}=fixture(); game.owners.fill(1);
    for(const b of [...game.buildings]) game.removeBuilding(b.id);
    const a=building(game,"trench",20,20),tile=game.map.ref(26,20);
    const plan=e.fortifications.towerPlan(tile,1,"Modern",game.buildingFacts(),"trench",t=>game.owners[t]===1);
    expect(plan.links).toEqual([{a:a.id,tiles:[25,24,23,22,21].map(x=>game.map.ref(x,20))}]);
    const preview=new PlacementPreview(game.map);
    preview.begin(game.snapshot(),1,"trench","Modern");
    expect(preview.rejection("trench",tile)).toBeNull();
    const cost=buildingCost("trench","Modern",1).gold!+plan.gold;
    game.player(1)!.gold=cost-1;
    expect(game.applyCommand({type:"build",playerId:1,buildingType:"trench",tile})).not.toBeNull();
    expect(e.fortifications.barriers).toHaveLength(0);
    preview.update(game.snapshot());
    expect(preview.rejection("trench",tile)).not.toBeNull();
    game.player(1)!.gold=cost;
    preview.update(game.snapshot());
    expect(preview.rejection("trench",tile)).toBeNull();
    expect(game.applyCommand({type:"build",playerId:1,buildingType:"trench",tile})).toBeNull();
    expect(game.player(1)!.gold).toBe(0);
    const b=game.buildings.find(b=>b.tile===tile)!,run=e.fortifications.barriers[0];
    game.updateBuilding(b.id,{remainingTicks:0}); e.fortifications.updateBarrier(run.id,{remainingTicks:0});
    const own=game.squads.find(s=>s.playerId===1)!,enemy=game.squads.find(s=>s.playerId===2)!;
    for(const s of [own,enemy])game.updateSquad(s.id,{x:23.5*FIXED,y:20.5*FIXED});
    e.battle.fight([]);
    expect(e.battle.cover(own)).toBeGreaterThan(0); expect(e.battle.cover(enemy)).toBe(0);
    expect(e.fortifications.blocked(game.map.ref(23,20),2)).toBe(false);
    expect(e.fortifications.clearMovement({x:23.5*FIXED,y:19*FIXED},{x:23.5*FIXED,y:22*FIXED},2,.45*FIXED)).toBe(true);
    const walls=new WallPresentation(),trenches=new WallPresentation("trench");
    walls.update(game.snapshot()); trenches.update(game.snapshot());
    expect(walls.tiles).toHaveLength(0);
    expect(trenches.tiles.find(t=>t.tile===game.map.ref(23,20))?.mask).toBe(10);
    expect(trenches.tiles.some(t=>t.gate)).toBe(false);
    const restored=fixture().game; restored.restore(game.checkpoint());
    const decoded=new SnapshotDecoder().decode(new SnapshotEncoder().encode(restored.snapshot()));
    expect(decoded.expansion!.barriers[0].kind).toBe("trench");
    restored.removeBuilding(a.id);
    restored.expansion!.fortifications.step(restored.tick,restored.buildings);
    restored.expansion!.fortifications.step(restored.tick,restored.buildings);
    expect(restored.expansion!.fortifications.barriers).toHaveLength(0);
    restored.expansion!.battle.fight([]);
    expect(restored.expansion!.battle.cover(restored.squad(own.id)!)).toBe(0);
  });
});
describe("conquest credit", () => {
  it.each([false,true])("ignores factories, aircraft and empty hulls after the final ground kill (AI=%s)", ai => {
    const {game,e}=fixture(),victim=game.player(2)!; victim.ai=ai;
    for(const b of [...game.buildings]) if(b.playerId===2) game.removeBuilding(b.id);
    const factory=building(game,"factory",70,70,2);
    const hull=game.addShip({id:game.allocateId(),playerId:2,kind:"warship",health:1,x:0,y:0,
      destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});
    const ground=new DamageLedger(); for(const s of game.squads) if(s.playerId===2)ground.add(s.id,1,s.troops);
    game.resolveLandDamage(ground);
    const unrelated=new DamageLedger(); unrelated.add(factory.id,3,5000); unrelated.add(hull.id,3,1);
    game.recordMilitaryLosses([factory],unrelated); game.resolveNavalDamage(unrelated);
    game.step();
    expect(victim.eliminated).toBe(true);
    expect(game.owners.includes(2)).toBe(false);
    expect(e.events).toContainEqual(expect.objectContaining({kind:"conquest",actorId:1,otherId:2}));
  });
});
