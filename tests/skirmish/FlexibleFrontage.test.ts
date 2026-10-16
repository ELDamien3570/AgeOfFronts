import { describe, it, expect } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { createManpower, HEALTH_SCALE } from "../../src/skirmish/domain/Manpower";
import { createFormation, formationDoctrine, formationEnvelope, formationSlots, validateFormation } from "../../src/skirmish/domain/FormationGeometry";
import { formationProfile, frontageCandidates, frontageLayout, frontageSummary } from "../../src/skirmish/domain/FormationProfiles";
import { layoutBattleLine } from "../../src/skirmish/domain/BattleLineLayout";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { contactParticipants } from "../../src/skirmish/domain/FormationContact";
import authored from "../../skirmish/plans/formation-doctrines.json";
import recipes from "../../skirmish/plans/formation-recipes.json";
import { FRONTAGE } from "../../src/skirmish/content/TacticalRules";
import { validateFormationDoctrineData } from "../../scripts/FormationDoctrineSchema";

function fixture(count=72) {
  const terrain=new Uint8Array(160*160).fill(133),map=new GameMapImpl(160,160,terrain,terrain.length);
  const options={seed:42,aiCount:1,runAi:false,tribes:false,ruleset:"ages-v1" as const};
  const game=new Skirmish(map,options),unit=UNIT.get("napoleonic-infantry")!,s=game.squads.find(s=>s.playerId===1)!;
  for(const other of [...game.squads])if(other.id!==s.id)game.removeSquad(other.id);
  game.updateSquad(s.id,{definitionId:unit.id,kind:unit.line,troops:count,manpower:createManpower(unit,count>unit.formationRecipe!.capacity?"enlarged":"base"),x:60*FIXED,y:60*FIXED,formation:{...createFormation(unit.id),shape:"line",layoutTroops:count},order:{type:"hold"}});
  return {game,s:game.squad(s.id)!,map,options};
}
describe("bounded flexible frontage",()=>{
  it("replicates and restores a casualty during an interpolated 238-unit reform",()=>{
    const {game,s,map,options}=fixture(12),unit=UNIT.get("stoneage-infantry")!;
    game.updateSquad(s.id,{definitionId:unit.id,kind:unit.line,manpower:createManpower(unit),formation:{...createFormation(unit.id),layoutTroops:12}});
    const slots=formationSlots(s,0),halfWidth=Math.max(...slots.map(p=>Math.abs(p.x)));
    const fromSlots=slots.map(p=>({...p,x:Math.round(p.x*87/halfWidth)}));
    game.updateSquad(s.id,{formation:{...s.formation!,transition:{from:"mass",fromFacing:0,fromSlots,startTick:17,duration:20}}});
    game.tick=17;
    expect(formationEnvelope(s,game.tick).width).toBe(238);
    const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
    decoder.decodeLatest(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
    const hits=new DamageLedger();hits.add(s.id,2,s.manpower!.hp/HEALTH_SCALE);
    game.resolveLandDamage(hits);
    expect(s.troops).toBe(11);
    expect(s.formation!.frontage).toBeLessThanOrEqual(238);
    expect(()=>decoder.decodeLatest(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()))).not.toThrow();
    const saved=game.checkpoint(),restored=new Skirmish(map,options);
    expect(()=>restored.restore(saved)).not.toThrow();
    expect(restored.squad(s.id)!.formation).toEqual(s.formation);
  });
  it("keeps casualty ceilings consistent with unbounded decoding and restore",()=>{
    const d=formationDoctrine("stoneage-infantry");
    const next=frontageLayout(11,d,"mass",238,238)!;
    expect(next.width).toBeLessThanOrEqual(238);
    expect(frontageLayout(11,d,"mass",next.width)!.width).toBe(next.width);
    expect(()=>validateFormation({...createFormation("stoneage-infantry"),layoutTroops:11,frontage:next.width},"stoneage-infantry",11)).not.toThrow();
  });
  it("round trips every casualty-ceiling result across authored soldier profiles",()=>{
    for(const u of UNITS){if(u.formationRecipe?.model!=="soldiers")continue;
      const d=formationDoctrine(u.id);
      for(const shape of d.shapes)for(let n=1;n<=144;n++)for(const ceiling of [238,255,383,511,767,1023]){
        const layout=frontageLayout(n,d,shape,ceiling,ceiling);if(!layout)continue;
        expect(layout.width).toBeLessThanOrEqual(ceiling);
        expect(frontageLayout(n,d,shape,layout.width)?.width,`${u.id} ${shape} ${n} ${ceiling}`).toBe(layout.width);
      }
    }
  });
  it("projects casualty width downward across a gap between legal profile bands",()=>{
    // A fixed geometry fixture keeps this interval-gap regression independent
    // of authored soldier-size changes.
    const d={...formationDoctrine("bronzeage-infantry"),spacing:128,bodyWidth:128,bodyDepth:128},width=frontageLayout(24,d,"shield-wall",880)!.width;
    const next=frontageLayout(20,d,"shield-wall",width,width)!;
    expect(next.width).toBeLessThanOrEqual(width);
    expect(next.width).toBe(768);
    expect(next.ranks).toBe(3);
  });
  it("rejects malformed profile data and mounted width exploits in the compiler",()=>{
    const compile=(input:unknown)=>validateFormationDoctrineData(input,recipes.recipes);
    const checks=compile(authored).mountedChecks as {ratio:number}[];
    expect(checks).toHaveLength(24);
    // The gate admits the authored mounted lines with a narrow margin only.
    const widest=Math.max(...checks.map(c=>c.ratio));
    expect(widest).toBeLessThanOrEqual(FRONTAGE.mountedWidthRatioMax);
    expect(FRONTAGE.mountedWidthRatioMax-widest).toBeLessThan(0.05);
    for(const edit of [
      (d:any)=>d.shapeProfiles.line.minRanks=1.5,
      (d:any)=>d.shapeProfiles.line.aspectBp.min=50000,
      (d:any)=>delete d.shapeProfiles.line.aspectBp.max,
      (d:any)=>d.shapeProfiles.square=d.shapeProfiles.mass,
      (d:any)=>d.doctrines["latemedieval-cavalry"].spacing=1024,
    ]){const data=structuredClone(authored);edit(data);expect(()=>compile(data)).toThrow();}
  });
  it("keeps every authored soldier profile inside its real footprint band at counts 1–144",()=>{
    for(const u of UNITS){if(u.formationRecipe?.model!=="soldiers")continue;
      const d=formationDoctrine(u.id);
      for(const shape of d.shapes){const p=formationProfile(d,shape);if(!p)continue;
        for(let n=1;n<=144;n++){
          let previous=0;
          for(const request of [0,256,512,1024,2048,32768]){
            const layout=frontageLayout(n,d,shape,request);if(!layout)continue;
            const s={id:1,definitionId:u.id,troops:n,kind:u.line,manpower:{capacity:144},formation:{...createFormation(u.id),shape,frontage:layout.width}} as Squad;
            const e=formationEnvelope(s,0),label=`${u.id} ${shape} ${n} ${request}`;
            expect(e.width/e.depth,label).toBeLessThanOrEqual(p.aspectBp.max/10000);
            expect(e.width/e.depth,label).toBeGreaterThanOrEqual(p.aspectBp.min/10000-.01);
            expect(layout.ranks,label).toBeGreaterThanOrEqual(p.minRanks);
            expect(layout.width,label).toBeGreaterThanOrEqual(previous);previous=layout.width;
            expect(frontageCandidates(n,d,shape).some(r=>layout.width>=r.minWidth&&layout.width<=r.maxWidth),label).toBe(true);
            expect(formationSlots(s,0)).toEqual(formationSlots({...s,formation:{...s.formation!}},0));
            const slots=formationSlots(s,0);
            const actualWidth=Math.max(...slots.map(p=>p.x))-Math.min(...slots.map(p=>p.x))+d.bodyWidth;
            const actualDepth=Math.max(...slots.map(p=>p.y))-Math.min(...slots.map(p=>p.y))+d.bodyDepth;
            expect(Math.abs(actualWidth-e.width),label).toBeLessThanOrEqual(2);
            expect(Math.abs(actualDepth-e.depth),label).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  },30000);
  it("clamps requests and rejects malformed commands, restored bands and packed bands",()=>{
    const {game,s}=fixture(72),d=formationDoctrine(s.definitionId),wide=frontageLayout(72,d,"line",32768)!.width;
    expect(game.applyCommand({type:"formation",playerId:1,squadIds:[s.id],shape:"line",frontage:32768})).toBeNull();
    expect(s.formation?.frontage).toBe(wide);expect(s.formation?.shapeLock).toBe(true);
    for(const width of [-1,0,1.5,32769])expect(commandSchema.safeParse({type:"formation",playerId:1,squadIds:[s.id],shape:"line",frontage:width}).success).toBe(false);
    expect(()=>validateFormation({...s.formation!,frontage:wide+100},s.definitionId,144)).toThrow("band");
    const checkpoint=game.checkpoint();expect(()=>game.restore({...checkpoint,squads:checkpoint.squads.map(q=>({...q,formation:{...q.formation!,frontage:wide+100}}))})).toThrow("band");
    const packet=new SnapshotEncoder().encode(game.snapshot());
    const index=packet.details!.squads![29],payload=JSON.parse(packet.details!.strings[index]);payload.formation.frontage=wide+100;packet.details!.strings[index]=JSON.stringify(payload);
    expect(()=>new SnapshotDecoder().decode(packet)).toThrow("band");
  });
  it("keeps contributor files capped when the contact width is stretched",()=>{
    const {s}=fixture(144),d=formationDoctrine(s.definitionId),wide=frontageLayout(144,d,"line",32768)!;
    const formed={...s,formation:{...s.formation!,frontage:wide.width}};
    expect(contactParticipants(formed,formed,0,2,{gap:0,normal:{x:0,y:1},facing:1,frontage:100000} as any)).toBe(wide.files*2);
  });
  it("reduces depth before width and falls back when casualties make a shape unavailable",()=>{
    const {game,s}=fixture(48),d=formationDoctrine(s.definitionId),width=frontageLayout(48,d,"line",1600)!.width;
    game.updateSquad(s.id,{formation:{...s.formation!,frontage:width,preferredFrontage:width}});
    game.updateSquad(s.id,{troops:40});game.step();
    expect(s.formation?.frontage).toBe(frontageLayout(40,d,"line",width)!.width);
    game.updateSquad(s.id,{troops:1});game.step();
    expect(s.formation?.shape).not.toBe("line");expect(()=>validateFormation(s.formation,s.definitionId,1)).not.toThrow();
  });
  it("keeps marching through repeated casualties without tactical reform",()=>{
    const {game,s,map}=fixture(72);
    expect(game.applyCommand({type:"order",playerId:1,squadIds:[s.id],order:{type:"move",tile:map.ref(76,60)}})).toBeNull();
    const initial=s.x;
    let width=formationEnvelope(s,game.tick).width;
    for(let i=0;i<35;i++){
      if(i%3===0)game.updateSquad(s.id,{troops:s.troops-1});
      game.step();
      expect(s.formation?.transition).toBeUndefined();
      expect(formationEnvelope(s,game.tick).width).toBeLessThanOrEqual(width+2);
      width=formationEnvelope(s,game.tick).width;
    }
    expect(s.x-initial).toBeGreaterThan(FIXED);
  });
  it("does not extend a deliberate reform when casualties arrive",()=>{
    const {game,s}=fixture(72);
    expect(game.applyCommand({type:"formation",playerId:1,squadIds:[s.id],shape:"line",frontage:2500})).toBeNull();
    const end=s.formation!.transition!.startTick+s.formation!.transition!.duration;
    for(let i=0;i<8;i++){
      game.updateSquad(s.id,{troops:s.troops-1});game.step();
      if(s.formation!.transition)expect(s.formation!.transition.startTick+s.formation!.transition.duration).toBe(end);
    }
  });
  it("caps a long drag, uses footprint widths and wraps ranged troops behind melee",()=>{
    const {s}=fixture(144),gesture={start:{x:0,y:0},end:{x:80*FIXED,y:0}};
    const one=layoutBattleLine([{id:s.id,origin:s,squad:s}],gesture)!;
    const plan=one.layouts.get(s.id)!,d=formationDoctrine(s.definitionId);
    expect(plan.frontage).toBe(frontageLayout(144,d,plan.shape,32768)!.width);
    expect(one.end.x-one.start.x).toBeLessThan(14*FIXED);expect(one.warnings).toContain("At maximum width");
    const members=Array.from({length:5},(_,i)=>({id:i+1,origin:{x:i*FIXED,y:0},squad:{...s,id:i+1,troops:48,kind:i===0?"archer" as const:"infantry" as const}}));
    const short={start:{x:0,y:0},end:{x:5*FIXED,y:0}},line=layoutBattleLine(members,short)!;
    expect(line.rows).toBeGreaterThan(1);expect(line.slots.get(1)!.y).toBeGreaterThan(line.slots.get(2)!.y);
    expect([...line.layouts]).toEqual([...layoutBattleLine([...members].reverse(),short)!.layouts]);
  });
  it("preserves a locked square while an unlocked group can choose a line",()=>{
    const {s}=fixture(48),locked={...s,definitionId:"latemedieval-anticavalry",formation:{...s.formation!,shape:"square" as const,shapeLock:true}};
    const line=layoutBattleLine([{id:s.id,origin:s,squad:locked}],{start:{x:0,y:0},end:{x:20*FIXED,y:0}})!;
    expect(line.layouts.get(s.id)?.shape).toBe("square");
  });
  it("keeps queued line intent dormant until its leg activates and replicates it",()=>{
    const {game,s,map,options}=fixture(72);
    expect(game.applyCommand({type:"order",playerId:1,squadIds:[s.id],order:{type:"move",tile:map.ref(65,60)}})).toBeNull();
    const before=structuredClone(s.formation);
    expect(game.applyCommand({type:"order",playerId:1,squadIds:[s.id],append:true,order:{type:"move",tile:map.ref(75,70)},deploymentLine:{start:{x:72*FIXED,y:70*FIXED},end:{x:80*FIXED,y:70*FIXED}}})).toBeNull();
    expect(s.formation).toEqual(before);expect(s.queuedOrders[0].type).toBe("move");
    const snapshot=new SnapshotDecoder().decode(new SnapshotEncoder().encode(game.snapshot()));
    expect(snapshot.squads[0].queuedOrders).toEqual(s.queuedOrders);
    const restored=new Skirmish(map,options);restored.restore(game.checkpoint());
    for(let i=0;i<700;i++){game.step();restored.step();}
    expect(restored.checkpoint()).toEqual(game.checkpoint());
    expect(s.order.type).toBe("hold");expect(s.formation?.transition).toBeUndefined();
    const expected=layoutBattleLine([{id:s.id,origin:{x:65.5*FIXED,y:60.5*FIXED},squad:{...s,formation:before}}],{start:{x:72*FIXED,y:70*FIXED},end:{x:80*FIXED,y:70*FIXED}})!.layouts.get(s.id)!;
    expect(s.formation?.shape).toBe(expected.shape);expect(s.formation?.frontage).toBe(expected.frontage);
  },30000);
});
