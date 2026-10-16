import {describe,it,expect} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {FIXED,type Command} from '../../src/skirmish/Protocol';
import {TECHNOLOGIES} from '../../src/skirmish/content/Technology';
import {DRONE_SWARM,aircraftSlots} from '../../src/skirmish/content/DroneSwarms';
import {maximumHealth,remainingHealth,HEALTH_SCALE} from '../../src/skirmish/domain/Manpower';
import {airfieldAircraftCount} from '../../src/skirmish/domain/AirfieldCapacity';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';
import {sortieCommand} from '../../src/skirmish/client/Controls';
import {EmpireViewModel} from '../../src/skirmish/client/EmpireViewModel';
import {commandSchema} from '../../src/skirmish/multiplayer/CommandSchema';
import {CarrierAircraftPresentation} from '../../src/skirmish/client/CarrierAircraftPresentation';
import type {Aircraft} from '../../src/skirmish/domain/Definitions';

function fixture(){
  const pixels=new Uint8Array(100*80).fill(133);
  const game=new Skirmish(new GameMapImpl(100,80,pixels,pixels.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
  const e=game.expansion!;
  for(const p of game.players){e.progression.states[p.id].completed=TECHNOLOGIES.map(t=>t.id);e.progression.states[p.id].age='Modern';p.gold=1000000;}
  e.diplomacy.action(game.players[0],game.players[1],'declare',game.tick);
  const field=(kind:'airstrip'|'drone-facility'='airstrip',x=15,owner=1)=>{
    const b=game.addBuilding({id:game.allocateId(),playerId:owner,type:kind,tile:20*100+x,age:'Modern',health:10000,maxHealth:10000,remainingTicks:0});
    game.owners[b.tile]=owner;return b;
  };
  const carrier=()=>game.addShip({id:game.allocateId(),playerId:1,kind:'carrier',definitionId:'earlymodern-carrier',x:30*FIXED,y:20*FIXED,health:6500,destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});
  const plane=(base:{id:number;playerId:number},kind:Aircraft['definitionId']='bomber')=>{
    const b=game.building(base.id),ship=game.ship(base.id),point=b?e.battle.position(b):ship!;
    const a:Aircraft={id:game.allocateId(),playerId:base.playerId,definitionId:kind,airfieldId:base.id,age:'Modern',x:point.x,y:point.y,health:1000,state:'ready',target:null,reloadTick:0,fuelTicks:10000};
    e.aircraft.push(a);return a;
  };
  const tick=(n=1)=>{for(let i=0;i<n;i++){game.tick++;e.afterMovement();}};
  const launch=(a:Aircraft,target:{x:number;y:number},extra:Partial<Extract<Command,{type:'sortie'}>>={})=>game.applyCommand({type:'sortie',mission:'drone',playerId:1,aircraftIds:[a.id],x:target.x,y:target.y,...extra});
  return {game,e,field,carrier,plane,tick,launch};
}

describe('FPV swarm authority',()=>{
  it('launches twenty spread members while preserving one capacity slot and approximately one-third building damage',()=>{
    const f=fixture(),base=f.field('drone-facility'),a=f.plane(base,'drone'),target=f.field('airstrip',30,2);
    expect(f.launch(a,f.e.battle.position(target),{targetBuildingId:target.id})).toBeNull();
    expect(f.e.aircraft).toHaveLength(20);expect(aircraftSlots(f.e.aircraft,1)).toBe(1);expect(airfieldAircraftCount(f.e.aircraft,base.id)).toBe(1);
    expect(new Set(f.e.aircraft.map(a=>a.drone?.index)).size).toBe(20);
    f.tick(100);
    expect(f.game.building(target.id)?.health).toBeCloseTo(10000*2/3,0);
    expect(f.e.aircraft).toHaveLength(0);
    expect(f.e.battle.projectiles.every(p=>p.definitionId==='fpv-drone')).toBe(true);
  });
  it('removes intercepted members and their damage shares without replacing them',()=>{
    const f=fixture(),a=f.plane(f.field('drone-facility'),'drone'),target=f.field('airstrip',30,2);
    expect(f.launch(a,f.e.battle.position(target),{targetBuildingId:target.id})).toBeNull();
    for(const member of f.e.aircraft.slice(0,10))member.health=0;
    f.tick(100);
    expect(f.game.building(target.id)!.health!).toBeGreaterThan(8200);
    expect(f.game.building(target.id)!.health!).toBeLessThan(8400);
  });
  it('preserves integral troop counts for a legacy formation without fixed-point manpower',()=>{
    const f=fixture(),a=f.plane(f.field('drone-facility'),'drone'),target=f.game.squads.find(s=>s.playerId===2&&s.troops>0)!;
    f.game.updateSquad(target.id,{manpower:undefined,formation:undefined,troops:1000,x:35*FIXED,y:20*FIXED});
    expect(f.launch(a,{x:35*FIXED,y:20*FIXED},{targetUnitId:target.id})).toBeNull();f.tick(120);
    expect(f.game.squad(target.id)?.troops).toBe(667);
  });
  it('tracks a moving formation and wounds it rather than destroying a healthy formation',()=>{
    const f=fixture(),a=f.plane(f.field('drone-facility'),'drone'),target=f.game.squads.find(s=>s.playerId===2&&s.troops>0)!;
    f.game.updateSquad(target.id,{x:35*FIXED,y:20*FIXED});
    const before=remainingHealth(target),maximum=maximumHealth(target);
    expect(f.launch(a,target,{targetUnitId:target.id})).toBeNull();f.tick(5);
    f.game.updateSquad(target.id,{x:40*FIXED,y:22*FIXED});f.tick(120);
    const after=f.game.squad(target.id)!;
    expect(after).toBeDefined();expect(after.troops).toBeGreaterThan(0);
    const expected=target.manpower?Math.floor(maximum/3):Math.floor(1000/3);
    expect(before-remainingHealth(after)).toBeCloseTo(expected,0);
  });
  it('allows finishing wounded buildings, rejects friendly and malformed target locks',()=>{
    const f=fixture(),base=f.field('drone-facility'),a=f.plane(base,'drone'),target=f.field('airstrip',30,2);
    expect(f.game.applyCommand({type:'recruit-aircraft',playerId:1,buildingId:base.id,definitionId:'invalid' as never})).toMatch(/Unknown/);
    expect(f.game.applyCommand({type:'sortie',playerId:1,mission:'invalid' as never,aircraftIds:[a.id],x:a.x,y:a.y})).toMatch(/Invalid/);
    expect(f.launch(a,a,{targetBuildingId:base.id})).not.toBeNull();
    expect(a.state).toBe('ready');
    expect(commandSchema.safeParse({type:'sortie',playerId:1,mission:'drone',aircraftIds:[a.id],x:a.x,y:a.y,targetUnitId:-1}).success).toBe(false);
    f.game.updateBuilding(target.id,{health:1000});
    expect(f.launch(a,f.e.battle.position(target),{targetBuildingId:target.id})).toBeNull();f.tick(100);
    expect(f.game.building(target.id)).toBeUndefined();
  });
  it('persists swarm membership, target and damage through snapshots and checkpoint continuation',()=>{
    const f=fixture(),a=f.plane(f.field('drone-facility'),'drone'),target=f.field('airstrip',30,2);
    f.launch(a,f.e.battle.position(target),{targetBuildingId:target.id});f.tick(3);
    const decoded=new SnapshotDecoder().decode(new SnapshotEncoder().encode(f.game.snapshot()));
    expect(decoded.expansion!.aircraft.map(a=>a.drone)).toEqual(f.e.aircraft.map(a=>a.drone));
    for(let i=0;i<100&&!f.e.battle.projectiles.some(p=>p.droneImpact&&!p.impacted);i++)f.tick();
    expect(f.e.battle.projectiles.some(p=>p.droneImpact&&!p.impacted)).toBe(true);
    const pending=new SnapshotDecoder().decode(new SnapshotEncoder().encode(f.game.snapshot()));
    expect(pending.expansion!.projectiles.map(p=>p.droneImpact)).toEqual(f.e.battle.projectiles.map(p=>p.droneImpact));
    const saved=f.game.checkpoint(),restored=fixture();restored.game.restore(saved);
    f.tick(80);restored.tick(80);
    expect(restored.game.building(target.id)?.health).toBe(f.game.building(target.id)?.health);
    expect(restored.e.aircraft).toEqual(f.e.aircraft);
  });
  it('advances 240 drones without ground pathfinding and counts twelve swarm slots',()=>{
    const f=fixture(),target=f.field('airstrip',65,2),bases=Array.from({length:4},(_,i)=>f.field('drone-facility',15+i*2));
    for(let i=0;i<12;i++)expect(f.launch(f.plane(bases[Math.floor(i/3)],'drone'),f.e.battle.position(target),{targetBuildingId:target.id})).toBeNull();
    const before=f.game.paths.work;f.tick(40);
    expect(f.game.paths.work).toBe(before);expect(f.e.aircraft).toHaveLength(240);expect(aircraftSlots(f.e.aircraft,1)).toBe(12);
  });
});

describe('mobile carrier bases',()=>{
  it('shows six separate moving deck berths without changing authoritative aircraft',()=>{
    const f=fixture(),carrier=f.carrier(),planes=Array.from({length:6},()=>f.plane(carrier)),presentation=new CarrierAircraftPresentation();
    const before=structuredClone(f.e.aircraft);presentation.update(f.game.snapshot());
    const poses=planes.map(a=>presentation.pose(a.id,{x:a.x,y:a.y,angle:0,size:28,radius:22},48,1,()=>({x:carrier.x+FIXED,y:carrier.y,angle:Math.PI/2,moving:true}))!);
    expect(new Set(poses.map(p=>`${p.x}:${p.y}`)).size).toBe(6);expect(poses.every(p=>p.elevation===0&&p.angle===Math.PI/2)).toBe(true);
    expect(f.e.aircraft).toEqual(before);
  });
  it('recruits aboard and reserves its six berths against recruitment and transfers',()=>{
    const f=fixture(),carrier=f.carrier(),base=f.field();
    for(let i=0;i<5;i++)f.plane(carrier);
    expect(f.game.applyCommand({type:'recruit-aircraft',playerId:1,buildingId:carrier.id,definitionId:'fighter'})).toBeNull();
    const a=f.plane(base);
    expect(f.game.applyCommand({type:'transfer-aircraft',playerId:1,buildingId:carrier.id,aircraftIds:[a.id]})).toMatch(/parking/);
    const job=f.game.recruitment.byProducer(carrier.id)[0];
    f.game.recruitment.updateJob(job.id,{remainingTicks:1});f.game.step();
    expect(f.e.aircraft.filter(a=>a.airfieldId===carrier.id)).toHaveLength(6);
    expect(f.game.recruitment.byProducer(carrier.id)).toHaveLength(0);
  });
  it('follows a moving carrier during transfer and return, and scopes mission quotes to selected carriers',()=>{
    const f=fixture(),carrier=f.carrier(),a=f.plane(f.field()),b=f.plane(f.field('airstrip',40));
    expect(f.game.applyCommand({type:'transfer-aircraft',playerId:1,buildingId:carrier.id,aircraftIds:[a.id]})).toBeNull();
    f.game.updateShip(carrier.id,{x:33*FIXED});f.tick(30);
    expect(a.state).toBe('ready');expect(a.x).toBe(33*FIXED);expect(a.airfieldId).toBe(carrier.id);
    const snapshot=f.game.snapshot();
    expect(sortieCommand(snapshot,1,34*FIXED,20*FIXED,false,new Set(),'bombing',new Set([carrier.id]))?.aircraftIds).toEqual([a.id]);
    expect(f.game.applyCommand({type:'sortie',playerId:1,mission:'bombing',aircraftIds:[a.id],x:34*FIXED,y:20*FIXED})).toBeNull();
    f.game.updateShip(carrier.id,{x:32*FIXED});f.tick(30);
    expect(a.state).toBe('ready');expect(a.x).toBe(32*FIXED);expect(b.state).toBe('ready');
    const vm=new EmpireViewModel(snapshot,{selected:new Set(),selectedShips:new Set([carrier.id]),selectedBuilding:null,selectedAircraft:new Set()});
    expect(vm.aircraft('fighter').building?.id).toBe(carrier.id);
  });
  it('launches atomic and fighter missions aboard carriers using the normal payload and mission rules',()=>{
    const f=fixture(),carrier=f.carrier(),bomber=f.plane(carrier),fighter=f.plane(carrier,'fighter');
    const order={type:'sortie',playerId:1,x:40*FIXED,y:20*FIXED} as const;
    expect(f.game.applyCommand({...order,mission:'atomic',aircraftIds:[bomber.id]})).toMatch(/atomic/);
    f.e.supply.inventories[1]['payload:atomic']=1;
    expect(f.game.applyCommand({...order,mission:'atomic',aircraftIds:[bomber.id]})).toBeNull();
    expect(f.e.supply.inventories[1]['payload:atomic']).toBe(0);
    expect(f.game.applyCommand({...order,mission:'patrol',aircraftIds:[fighter.id]})).toBeNull();
  });
  it('loses deck aircraft on sinking while airborne planes reserve and divert to a surviving base',()=>{
    const f=fixture(),carrier=f.carrier(),field=f.field(),parked=f.plane(carrier),airborne=f.plane(carrier,'fighter');
    f.game.applyCommand({type:'sortie',playerId:1,mission:'patrol',aircraftIds:[airborne.id],x:40*FIXED,y:20*FIXED});
    f.game.updateShip(carrier.id,{health:0});f.tick();
    expect(parked.health).toBe(0);expect(airborne.transfer?.destinationId).toBe(field.id);
    f.tick(60);expect(airborne.state).toBe('ready');expect(airborne.airfieldId).toBe(field.id);
  });
  it('serializes the carrier class and recruitment reservation through full and delta snapshots',()=>{
    const f=fixture(),carrier=f.carrier(),encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
    const first=decoder.decode(encoder.encode(f.game.snapshot()));
    expect(first.ships.find(s=>s.id===carrier.id)?.kind).toBe('carrier');
    f.game.applyCommand({type:'recruit-aircraft',playerId:1,buildingId:carrier.id,definitionId:'bomber'});
    const next=decoder.decode(encoder.encode(f.game.snapshot()));
    expect(next.expansion!.recruitment!.find(j=>j.buildingId===carrier.id)).toBeDefined();
  });
});
