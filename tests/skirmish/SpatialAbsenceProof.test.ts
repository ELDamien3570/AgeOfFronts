import { describe, expect, it } from "vitest";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";
import { FIXED } from "../../src/skirmish/Protocol";
import { formationLoad } from "./fixtures/FormationLoad";
import { CombatActivity } from "../../src/skirmish/domain/CombatActivity";
import { CombatGeometry } from "../../src/skirmish/domain/CombatGeometry";
import { transitionFootprint, formationFootprints } from "../../src/skirmish/domain/FormationContact";
import { reorientedFormation, formationSlots } from "../../src/skirmish/domain/FormationGeometry";

describe("spatial absence proofs", () => {
  it("proves column terrain and reforms conservatively without bypassing row movement legality",()=>{
    const {game}=formationLoad("distributed",15),source=game.squads[0];
    const owner=game as unknown as {emptyFormationTerrain:(s:typeof source,t:number)=>boolean;
      emptyTransitionTerrain:(s:typeof source,a:number,b:number)=>boolean;
      certifyFormationPolygon:(s:typeof source,p:ReturnType<typeof transitionFootprint>,purpose:"deploy"|"hold")=>boolean};
    let proofs=0;
    for(const troops of [1,40,144])for(const facing of [0,8192,16384]) {
      const s={...source,troops,x:100*FIXED,y:100*FIXED,formation:{...source.formation!,shape:"column" as const,facing,transition:undefined,
        trail:[{x:-12*FIXED,y:-6*FIXED},{x:0,y:-6*FIXED},{x:0,y:0}]}};
      if(owner.emptyFormationTerrain(s,0)) { proofs++;expect(formationFootprints(s,0).every(p=>owner.certifyFormationPolygon(s,p,"hold"))).toBe(true); }
      const candidate={...s,formation:{...s.formation,shape:"line" as const,transition:{from:"column" as const,fromFacing:facing,fromSlots:formationSlots(s,0),startTick:0,duration:20}}};
      if(owner.emptyTransitionTerrain(candidate,0,20)) { proofs++;expect(owner.certifyFormationPolygon(candidate,transitionFootprint(candidate,0,20),"deploy")).toBe(true); }
      const beforeMountain=owner.emptyFormationTerrain(s,0);
      game.map.setMagnitude(game.map.ref(100,100),31);
      expect(owner.emptyFormationTerrain(s,0)).toBe(beforeMountain);game.map.setMagnitude(game.map.ref(100,100),5);
    }
    expect(proofs).toBeGreaterThan(0);
  });
  it("certifies complete reform sweeps only when their exact padded hull is legal", () => {
    const {game}=formationLoad("distributed",15),source=game.squads[0];
    const owner=game as unknown as {emptyTransitionTerrain:(s:typeof source,start:number,end:number)=>boolean;certifyFormationPolygon:(s:typeof source,p:ReturnType<typeof transitionFootprint>,purpose:"deploy")=>boolean};
    let certified=0;
    for(const troops of [1,40,144])for(const facing of [4096,16384,32768,49152]) {
      game.updateSquad(source.id,{x:20*FIXED,y:20*FIXED,troops,formation:{...source.formation!,shape:"mass",facing:0,transition:undefined}});
      const candidate={...source,formation:reorientedFormation(source,0,facing)},end=candidate.formation.transition!.duration;
      if(owner.emptyTransitionTerrain(candidate,0,end)) {
        certified++;expect(owner.certifyFormationPolygon(candidate,transitionFootprint(candidate,0,end),"deploy")).toBe(true);
      }
      const beforeMountain=owner.emptyTransitionTerrain(candidate,0,end);
      game.map.setMagnitude(game.map.ref(20,20),31);
      expect(owner.emptyTransitionTerrain(candidate,0,end)).toBe(beforeMountain);
      game.map.setMagnitude(game.map.ref(20,20),5);
    }
    expect(certified).toBeGreaterThan(0);
  });
  it("excludes only own-faction activity while retaining independent self and other-owner epochs", () => {
    const {game}=formationLoad("distributed",15),a=game.squads[0],friend=game.squads[1],enemy=game.squads[2];
    game.updateSquad(friend.id,{playerId:a.playerId,x:a.x+FIXED,y:a.y});
    game.updateSquad(enemy.id,{x:a.x+2*FIXED,y:a.y});
    const activity=new CombatActivity(500,250),geometry=new CombatGeometry();
    const update=()=>activity.update(game.squads,game.squadFacts(),geometry,game.tick);
    update();const initial=activity.region(a,4*FIXED,a.playerId),self=activity.pose(a.id);
    game.updateSquad(friend.id,{x:friend.x+10});update();
    expect(activity.region(a,4*FIXED,a.playerId)).toBe(initial);
    expect(activity.pose(a.id)).toBe(self);
    game.updateSquad(a.id,{troops:a.troops-1});update();
    expect(activity.pose(a.id)).toBeGreaterThan(self!);
    expect(activity.region(a,4*FIXED,a.playerId)).toBe(initial);
    game.updateSquad(enemy.id,{x:enemy.x+10});update();
    const changed=activity.region(a,4*FIXED,a.playerId);expect(changed).toBeGreaterThan(initial);
    game.updateSquad(friend.id,{x:friend.x+10});update();
    expect(activity.region(a,4*FIXED,a.playerId)).toBe(changed);
    game.removeSquad(enemy.id);update();
    expect(activity.region(a,4*FIXED,a.playerId)).toBeGreaterThan(changed);
  });
  it("matches the previous two-stage query in order, including live extent changes", () => {
    const rows = Array.from({length:120},(_,id)=>({id,x:(id*317)%5000,y:(id*191)%3000,owner:id%4,radius:id%11*45}));
    const grid=new SpatialGrid<(typeof rows)[number]>(5000,3000,128,r=>r.owner,r=>r.radius);
    grid.rebuild(rows);
    rows[31].radius += 100; // Query callbacks still see live borrowed facts.
    for(let i=0;i<100;i++)for(const owner of [undefined,0,2]) {
      const x=i*157%5000,y=i*239%3000,radius=i%7*80;
      const reference:typeof rows=[],actual:typeof rows=[];
      const originalQuery = rows.filter(r => (owner === undefined || r.owner !== owner) &&
        (r.x-x)**2+(r.y-y)**2 <= (radius+450)**2)
        .sort((a,b) => Math.floor(a.y/128)*40+Math.floor(a.x/128)-Math.floor(b.y/128)*40-Math.floor(b.x/128));
      grid.query(x,y,radius+450,reference,owner);
      expect(reference).toEqual(originalQuery);
      const expected=reference.filter(r=>(r.x-x)**2+(r.y-y)**2<=(radius+r.radius)**2);
      grid.queryOverlaps(x,y,radius,actual,owner);
      expect(actual).toEqual(expected);
      expect(grid.mayOverlap(x,y,radius,r=>r.id%3===0,owner)).toBe(expected.some(r=>r.id%3===0));
    }
    grid.remove(rows[31]); grid.rebuild([]);
    expect(grid.mayOverlap(0,0,5000,()=>true)).toBe(false);
    grid.insert(rows[31]);
    expect(grid.mayOverlap(rows[31].x,rows[31].y,0,()=>true)).toBe(true);
    grid.remove(rows[31]);
    expect(grid.mayOverlap(rows[31].x,rows[31].y,0,()=>true)).toBe(false);
    expect(grid.mayContain(-1000,-1000,1)).toBe(false);
  });

  it("shadow-checks transport terrain certificates with live terrain changes", () => {
    const {game}=formationLoad("distributed",15),source=game.squads[0];
    const owner=game as unknown as {emptyTerrainBounds:(...bounds:number[])=>boolean;transportStepClear:(s:typeof source,end:{x:number;y:number})=>boolean};
    const proof=owner.emptyTerrainBounds;
    game.updateSquad(source.id,{x:20*FIXED,y:20*FIXED,afloat:{hull:100,maxHull:100,vesselId:"test"}});
    for(const magnitude of [5,31,5]) {
      game.map.setMagnitude(game.map.ref(20,20),magnitude);
      for(const delta of [{x:10,y:20},{x:-20,y:30},{x:500,y:-200},{x:-source.x,y:0}]) {
        const end={x:source.x+delta.x,y:source.y+delta.y};
        const actual=owner.transportStepClear(source,end);
        owner.emptyTerrainBounds=()=>false;
        try { expect(actual).toBe(owner.transportStepClear(source,end)); }
        finally { owner.emptyTerrainBounds=proof; }
      }
    }
  });

  it("shadow-checks certified sweeps against exact geometry through terrain edits and reform completion", () => {
    const {game}=formationLoad("distributed",15),source=game.squads[0];
    type Owner={emptyMovementSweep: (s:typeof source,p:{x:number;y:number})=>boolean;formationMoveClear:(s:typeof source,p:{x:number;y:number})=>boolean;movementLand:()=>void};
    const owner=game as unknown as Owner,proof=owner.emptyMovementSweep;
    let proven=0;
    for(const troops of [1,40,144])for(const tick of [0,8,19,20])for(const transition of [false,true]) {
      game.tick=tick;
      game.updateSquad(source.id,{troops,x:20*FIXED,y:20*FIXED,formation:{...source.formation!,shape:"mass",facing:8192,
        transition:transition?{from:"line",fromFacing:0,startTick:0,duration:20}:undefined}});
      owner.movementLand();
      for(const delta of [{x:17,y:21},{x:-30,y:40},{x:1200,y:-1500}]) {
        const end={x:source.x+delta.x,y:source.y+delta.y};
        const certified=proof.call(owner,source,end),actual=owner.formationMoveClear(source,end);
        owner.emptyMovementSweep=()=>false;
        const exact=owner.formationMoveClear(source,end);
        owner.emptyMovementSweep=proof;
        expect(actual).toBe(exact);
        // Clearance is only consumed after the formation's motion eligibility
        // guard; an immobile reform still rejects an otherwise empty sweep.
        if(certified && actual){proven++;expect(exact).toBe(true);}
      }
    }
    expect(proven).toBeGreaterThan(0);
    const tile=game.map.ref(20,20);
    const beforeMountain=proof.call(owner,source,{x:source.x+17,y:source.y});
    game.map.setMagnitude(tile,31);
    expect(proof.call(owner,source,{x:source.x+17,y:source.y})).toBe(beforeMountain);
    game.map.setMagnitude(tile,5);
    expect(proof.call(owner,{...source,x:0},{x:17,y:source.y})).toBe(false);
  });

  it("retains exact hostile arrival and long thin body clearance with tighter sweep bounds", () => {
    const {game}=formationLoad("distributed",15),source=game.squads[0],enemy=game.squads[1];
    const owner=game as unknown as {emptyMovementSweep:(s:typeof source,p:{x:number;y:number})=>boolean;formationMoveClear:(s:typeof source,p:{x:number;y:number})=>boolean;movementLand:()=>void};
    const proof=owner.emptyMovementSweep;
    for(const facing of [0,8192,16384])for(let offset=-8;offset<=8;offset++) {
      game.updateSquad(source.id,{x:40*FIXED,y:40*FIXED,formation:{...source.formation!,shape:"line",facing,transition:undefined}});
      game.updateSquad(enemy.id,{x:source.x+offset*FIXED,y:source.y+Math.abs(offset%3)*FIXED,
        formation:{...enemy.formation!,shape:"line",facing:16384-facing,transition:undefined}});
      owner.movementLand();
      for(const delta of [{x:20,y:0},{x:0,y:40},{x:-40,y:40}]) {
        const end={x:source.x+delta.x,y:source.y+delta.y},actual=owner.formationMoveClear(source,end);
        owner.emptyMovementSweep=()=>false;
        try { expect(actual).toBe(owner.formationMoveClear(source,end)); }
        finally { owner.emptyMovementSweep=proof; }
      }
    }
  });
});
