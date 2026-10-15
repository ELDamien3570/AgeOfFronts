import {secondsToTicks} from '../../src/skirmish/Protocol';
import {describe,expect,it} from "vitest";
import {GameMapImpl} from "../../src/core/game/GameMap";
import {Skirmish} from "../../src/skirmish/Simulation";
import {FIXED} from "../../src/skirmish/Protocol";
import {TECHNOLOGIES} from "../../src/skirmish/content/Technology";
import {createManpower} from "../../src/skirmish/domain/Manpower";
import {UNIT} from "../../src/skirmish/content/Units";
import {commitWeaponShot} from "../../src/skirmish/domain/WeaponTiming";
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
  it("fires the authored 30-round rifle magazine and retains phase across snapshot/recovery",()=>{
    const unit=UNIT.get("modern-infantry")!, weapon=unit.rangedAttack!;
    const a=commitWeaponShot(weapon,undefined,secondsToTicks(5),false)!;
    const b=commitWeaponShot(weapon,a,secondsToTicks(5.1),false)!;
    expect(a.ranged).toMatchObject({shots:1,nextTick:secondsToTicks(5.1)});
    let cycle=b;
    for(let shot=2;shot<30;shot++)cycle=commitWeaponShot(weapon,cycle,secondsToTicks((5+(shot*0.1))),false)!;
    expect(cycle.ranged).toMatchObject({shots:0,reloadStartedTick:secondsToTicks(7.9),nextTick:secondsToTicks(10.9)});
    const game=fixture(),squad=game.squads[0];game.updateSquad(squad.id,{definitionId:unit.id,troops:unit.formationRecipe!.capacity,manpower:createManpower(unit),weaponState:b});
    const packed=packSnapshotDetails(game.snapshot().squads,[],[],[]);
    expect(unpackSnapshotDetails(packed).squadDetails?.find(s=>s.id===squad.id)?.weaponState).toEqual(b);
    const restored=fixture();restored.restore(game.checkpoint());expect(restored.squad(squad.id)?.weaponState).toEqual(b);
  });
  it("upgrades into available intermediate kits without converting spear units into regular infantry",()=>{
    const game=fixture(),p=game.players[0],squad=game.squads[0],planner=new AiModernization();p.gold=1_000_000;
    planner.reserve(p,[squad],TECHNOLOGIES.filter(t=>!t.optional).map(t=>t.id),{"equipment:bronzeage":1},0);
    expect(planner.leases.get(squad.id)?.targetId).toBe("bronzeage-infantry");
    const spear=Object.assign({},squad,{definitionId:"bronzeage-anticavalry"});planner.leases.clear();
    planner.reserve(p,[spear],TECHNOLOGIES.filter(t=>!t.optional).map(t=>t.id),{"equipment:classicalage":1},0);
    const target=UNIT.get(planner.leases.get(squad.id)!.targetId)!;expect(target.troopClass).toBe("antiCavalry");
  });
  it("keeps casualty/contact identities in the packed stream and salvages old equipment only on explicit orders",()=>{
    const fact={id:40,tick:secondsToTicks(5),squadId:2,playerId:1,fromX:0,fromY:0,toX:FIXED,toY:FIXED,targetId:5,damage:30,melee:true};
    expect(unpackSnapshotDetails(packSnapshotDetails([],[],[],[fact])).volleys[0]).toEqual(fact);
    const salvage=PRODUCTION_RECIPES.filter(r=>r.id.startsWith("recycle-"));expect(salvage).toHaveLength(8);
    expect(salvage.every(r=>r.manualOnly&&r.building==="blacksmith"&&r.technologyId==="rus-earlymodern-factories-mines")).toBe(true);
    expect(ATOMIC_ATTACK.projectile!.blastRadius).toBe(12*FIXED);
  });
  it("publishes fighter damage as visible contacts without adding a second damaging projectile",()=>{
    const game=fixture(),e=game.expansion!,p=game.players[0],point=e.battle.position(game.buildings[0]);
    const base=game.addBuilding({id:game.allocateId(),type:"airstrip",tile:p.base,playerId:p.id,remainingTicks:0,age:"EarlyModern"});
    e.aircraft.push({id:game.allocateId(),playerId:p.id,definitionId:"fighter",airfieldId:base.id,x:point.x,y:point.y,health:1000,state:"patrolling",target:point,reloadTick:0,fuelTicks:secondsToTicks(180)});
    const bomber={id:game.allocateId(),playerId:game.players[1].id,definitionId:"bomber" as const,airfieldId:base.id,x:point.x+FIXED,y:point.y,health:1000,state:"outbound" as const,target:point,reloadTick:0,fuelTicks:secondsToTicks(120)};e.aircraft.push(bomber);
    (e as any).advanceAircraft();
    expect(game.volleys.find(v=>v.sourceKind==="aircraft")).toMatchObject({targetId:bomber.id,damage:200});
    expect(e.battle.projectiles).toHaveLength(0);
  });
});
