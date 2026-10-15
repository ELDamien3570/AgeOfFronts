import {expect,it} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {TICKS_PER_SECOND,TICK_MS,FIXED,secondsToTicks} from '../../src/skirmish/Protocol';
import {commitWeaponShot,type WeaponState} from '../../src/skirmish/domain/WeaponTiming';
import {UNIT,VESSELS} from '../../src/skirmish/content/Units';
import {terrainSpeed} from '../../src/skirmish/Terrain';
import {BUILDING_RULES} from '../../src/skirmish/Rules';
import {REFINING} from '../../src/skirmish/content/Production';
function game(){const data=new Uint8Array(128*96).fill(133);return new Skirmish(new GameMapImpl(128,96,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1',startingAge:'Napoleonic'});}
it('advances exactly one real second in eight steps',()=>{expect(TICK_MS).toBe(125);expect(TICKS_PER_SECOND).toBe(8);const g=game();for(let i=0;i<8;i++)g.step();expect(g.snapshot().tick*TICK_MS).toBe(1000);});
it('accounts for 600 RPM without capping fire at one shot per step',()=>{const profile={...UNIT.get('modern-archer')!.rangedAttack!,shotsPerReload:1000,reloadMs:0};let state:WeaponState|undefined=commitWeaponShot(profile,undefined,0,false),count=0,max=0;for(let tick=1;tick<=secondsToTicks(10);tick++){let burst=0;for(let i=0;i<3;i++){const next=commitWeaponShot(profile,state,tick,false);if(!next)break;state=next;count++;burst++;}max=Math.max(max,burst);}expect(count).toBe(100);expect(max).toBe(2);});
it('idle time never creates a catch-up burst',()=>{const profile=UNIT.get('napoleonic-infantry')!.rangedAttack!;const initial=commitWeaponShot(profile,undefined,0,false)!;const next=commitWeaponShot(profile,initial,secondsToTicks(100),false)!;expect(next.ranged!.lastShotTick).toBe(secondsToTicks(100));expect(commitWeaponShot(profile,next,secondsToTicks(100),false)).toBeUndefined();});
it('preserves movement, naval speed, build and production rates in seconds',()=>{const g=game(),tile=g.players[0].base;expect(terrainSpeed(g.map,tile)*TICKS_PER_SECOND).toBe(1120);expect(VESSELS.find(v=>v.kind==='warship'&&v.age==='StoneAge')!.speed*TICKS_PER_SECOND).toBe(1100);expect(BUILDING_RULES.barracks.ticks/TICKS_PER_SECOND).toBe(5);expect(REFINING.find(r=>r.id==='refine-iron')!.ticks/TICKS_PER_SECOND).toBe(10);});
it('completes building work at its elapsed-time boundary',()=>{const g=game(),b=g.buildings[0];g.updateBuilding(b.id,{remainingTicks:secondsToTicks(3)});for(let i=0;i<secondsToTicks(3)-1;i++)g.step();expect(g.building(b.id)!.remainingTicks).toBe(1);g.step();expect(g.building(b.id)!.remainingTicks).toBe(0);});
