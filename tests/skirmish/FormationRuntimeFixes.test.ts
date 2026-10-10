import {describe,expect,it} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {Skirmish} from "../../src/skirmish/Simulation";
import {FIXED} from "../../src/skirmish/Protocol";
import {TECHNOLOGIES} from "../../src/skirmish/content/Technology";
import {UNIT} from "../../src/skirmish/content/Units";
import {afterWeaponShot} from "../../src/skirmish/content/WeaponCycles";
import {AiModernization} from "../../src/skirmish/domain/AiMilitaryDevelopment";
import {FormationSoldierMotion} from "../../src/skirmish/client/FormationSoldierMotion";
import {packSnapshotDetails,unpackSnapshotDetails} from "../../src/skirmish/SnapshotDetails";
import {tintMaskedPixels} from "../../src/skirmish/client/troops/FactionMaskTint";
import {PRODUCTION_RECIPES} from "../../src/skirmish/content/Production";
import {ATOMIC_ATTACK} from "../../src/skirmish/content/ModernWeapons";

function fixture(){const terrain=new Uint8Array(80*64).fill(133);return new Skirmish(new GameMapImpl(80,64,terrain,terrain.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:"ages-v1"});}
describe("formation review runtime contracts",()=>{
  it("carries the root once through reversals without losing member identity or shifting the centroid",()=>{
    const slots=Array.from({length:12},(_,i)=>({id:i,x:(i%4-1.5)*.2,y:(Math.floor(i/4)-1)*.2,scale:.24,front:i<4}));
    for(const fps of [30,60,120]){
      const motion=new FormationSoldierMotion(2);
      for(let frame=0;frame<fps*4;frame++){
        const t=frame/fps,root={x:t<2?t*2:8-t*2,y:0};
        const members=motion.sample(t*1000,root,t<2?0:Math.PI,slots,{footprint:2/0.75,mounted:false,engaged:false,combatFootwork:true,carrierRelative:true});
        const x=members.reduce((n,s)=>n+s.x,0)/members.length,y=members.reduce((n,s)=>n+s.y,0)/members.length;
        expect(Math.hypot(x-root.x,y-root.y)).toBeLessThan(.15);
        expect(members.map(s=>s.id)).toEqual(slots.map(s=>s.id));
      }
    }
  });
  it("preserves unmasked pixels, source alpha, shading and partial coverage",()=>{
    const source=new Uint8ClampedArray([200,0,0,255,100,0,0,123,50,40,30,200]);
    const mask=new Uint8ClampedArray([255,255,255,255,255,255,255,128,0,0,0,0]);
    const result=tintMaskedPixels(source,mask,"#0000ff");
    expect([...result.slice(0,4)]).toEqual([0,0,200,255]);
    expect(result[7]).toBe(123);expect(result[4]).toBeCloseTo(50,0);expect(result[6]).toBeCloseTo(50,0);
    expect([...result.slice(8)]).toEqual([...source.slice(8)]);
  });
  it("fires three rifle volleys before reload and retains magazine state across snapshot/recovery",()=>{
    const unit=UNIT.get("modern-infantry")!;
    const a=afterWeaponShot(unit,0,100,20),b=afterWeaponShot(unit,a.magazineShots,120,20),c=afterWeaponShot(unit,b.magazineShots,140,20);
    expect(a).toMatchObject({magazineShots:1,nextAttackTick:120});expect(b.magazineShots).toBe(2);
    expect(c).toMatchObject({magazineShots:0,reloadStartedTick:140,nextAttackTick:200});
    const game=fixture(),squad=game.squads[0];game.updateSquad(squad.id,{definitionId:unit.id,...b});
    const packed=packSnapshotDetails(game.snapshot().squads,[],[],[]);
    expect(unpackSnapshotDetails(packed).squadDetails?.find(s=>s.id===squad.id)?.magazineShots).toBe(2);
    const restored=fixture();restored.restore(game.checkpoint());expect(restored.squad(squad.id)?.magazineShots).toBe(2);
  });
  it("upgrades into available intermediate kits without converting spear units into regular infantry",()=>{
    const game=fixture(),p=game.players[0],squad=game.squads[0],planner=new AiModernization();p.gold=1_000_000;
    planner.reserve(p,[squad],TECHNOLOGIES.map(t=>t.id),{"equipment:bronzeage":1},0);
    expect(planner.leases.get(squad.id)?.targetId).toBe("bronzeage-infantry");
    const spear=Object.assign({},squad,{definitionId:"bronzeage-anticavalry"});planner.leases.clear();
    planner.reserve(p,[spear],TECHNOLOGIES.map(t=>t.id),{"equipment:classicalage":1},0);
    const target=UNIT.get(planner.leases.get(squad.id)!.targetId)!;expect(target.troopClass).toBe("antiCavalry");
  });
  it("keeps casualty/contact identities in the packed stream and salvages old equipment only on explicit orders",()=>{
    const fact={id:40,tick:100,squadId:2,playerId:1,fromX:0,fromY:0,toX:FIXED,toY:FIXED,targetId:5,damage:30,melee:true};
    expect(unpackSnapshotDetails(packSnapshotDetails([],[],[],[fact])).volleys[0]).toEqual(fact);
    const salvage=PRODUCTION_RECIPES.filter(r=>r.id.startsWith("recycle-"));expect(salvage).toHaveLength(8);
    expect(salvage.every(r=>r.manualOnly&&r.building==="blacksmith"&&r.technologyId==="rus-earlymodern-factories-mines")).toBe(true);
    expect(ATOMIC_ATTACK.projectile!.blastRadius).toBe(12*FIXED);
  });
  it("publishes fighter damage as visible contacts without adding a second damaging projectile",()=>{
    const game=fixture(),e=game.expansion!,p=game.players[0],point=e.battle.position(game.buildings[0]);
    const base=game.addBuilding({id:game.allocateId(),type:"airstrip",tile:p.base,playerId:p.id,remainingTicks:0,age:"EarlyModern"});
    e.aircraft.push({id:game.allocateId(),playerId:p.id,definitionId:"fighter",airfieldId:base.id,x:point.x,y:point.y,health:1000,state:"patrolling",target:point,reloadTick:0,fuelTicks:3600});
    const bomber={id:game.allocateId(),playerId:game.players[1].id,definitionId:"bomber" as const,airfieldId:base.id,x:point.x+FIXED,y:point.y,health:1000,state:"outbound" as const,target:point,reloadTick:0,fuelTicks:2400};e.aircraft.push(bomber);
    (e as any).advanceAircraft();
    expect(game.volleys.find(v=>v.sourceKind==="aircraft")).toMatchObject({targetId:bomber.id,damage:200});
    expect(e.battle.projectiles).toHaveLength(0);
  });
});
