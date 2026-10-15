import {expect,it,vi} from 'vitest';
import {GameMapImpl} from '../../src/core/game/GameMap';
import {Skirmish} from '../../src/skirmish/Simulation';
import {FIXED} from '../../src/skirmish/Protocol';
import {LocalDetours} from '../../src/skirmish/LocalDetours';
import {SpatialGrid} from '../../src/skirmish/SpatialGrid';
import {SnapshotEncoder,SnapshotDecoder} from '../../src/skirmish/SnapshotCodec';
import {controllerOf} from '../../src/skirmish/domain/CommandPrecedence';
function fixture(){const cells=new Uint8Array(96*64).fill(133);const g=new Skirmish(new GameMapImpl(96,64,cells,cells.length),{seed:47,aiCount:2,tribes:false,runAi:false,deferredPlanning:true,ruleset:'ages-v1',aiWarPolicy:true,diplomacyRules:'raids-v1'});return g;}
function point(x:number,y=20){return{x:(x+.5)*FIXED,y:(y+.5)*FIXED};}
it('shortcuts cannot cross neutral land to reach a permitted endpoint, but war opens the same leg',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,point(20));
 for(let y=0;y<64;y++)for(let x=20;x<=30;x++)g.owners[g.map.ref(x,y)]=x===25?3:2;
 expect((g as any).movementPolicyClear(s,point(30))).toBe(false);expect((g as any).clearCorridor(s,point(30))).toBe(false);
 g.expansion!.diplomacy.establishWar(2,3,g.tick);expect((g as any).movementPolicyClear(s,point(30))).toBe(true);
});
it('local lattice and smoothing use the supplied segment certificate',()=>{
 const g=fixture(),s=g.squads[0];g.updateSquad(s.id,point(20));const detours=new LocalDetours(g.map,new SpatialGrid(96*FIXED,64*FIXED,4*FIXED));
 const path=detours.find(s,point(24),()=>true,(from,to)=>!(from.x<22*FIXED&&to.x>=22*FIXED));expect(path).toBeNull();
});
it('humans can intentionally invade but cannot shortcut protected land',()=>{
 const g=fixture(),s=g.squads[0];g.updateSquad(s.id,point(20));for(let x=20;x<=30;x++)g.owners[g.map.ref(x,20)]=x===25?2:1;
 expect((g as any).movementPolicyClear(s,point(30))).toBe(true);
 g.expansion!.diplomacy.state.peaceProtection!.push({a:1,b:2,untilTick:100});expect((g as any).movementPolicyClear(s,point(30))).toBe(false);
 g.expansion!.diplomacy.step(100,g.players);expect((g as any).movementPolicyClear(s,point(30))).toBe(true);
});
it('a blocked route waits for queue capacity or permission changes instead of repairing every tick',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,{...point(20),order:{type:'move',tile:g.map.ref(25,20)},path:[g.map.ref(25,20)],nextPathIndex:0});
 g.owners[g.map.ref(20,20)]=2;g.owners[g.map.ref(25,20)]=3;
 const request=vi.spyOn(g as any,'requestNavigationRoute').mockReturnValue(false),repair=vi.spyOn(g as any,'recoverNavigation');
 for(let i=0;i<50;i++){g.tick++;expect((g as any).navigation(s)).toBeNull();}
 expect(request).toHaveBeenCalledTimes(1);expect(repair).not.toHaveBeenCalled();
 g.expansion!.diplomacy.establishWar(2,3,g.tick);(g as any).navigation(s);expect(repair).toHaveBeenCalled();
});
it('AI withdrawal has one 600-tick deadline, owns movement, persists and does not declare war',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,point(20));g.owners[g.map.ref(20,20)]=1;
 g.tick=10;(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toMatchObject({owner:1,since:10,deadline:610,phase:'withdrawing'});
 expect(controllerOf({armyOf:()=>undefined},s)).toBe('domain');expect(g.applyCommand({type:'order',playerId:2,squadIds:[s.id],order:{type:'hold'}})).toContain('withdrawing');
 const c=g.checkpoint(),restored=fixture();restored.restore(c);expect(restored.squad(s.id)!.aiWithdrawal).toEqual(s.aiWithdrawal);
 const decoded=new SnapshotDecoder().decodeLatest(new SnapshotEncoder().encode(g.snapshot()));expect(decoded.squads.find(u=>u.id===s.id)!.aiWithdrawal).toEqual(s.aiWithdrawal);
 g.tick=609;(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal?.phase).toBe('withdrawing');
 g.tick=610;(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal?.phase).toBe('recovery');expect(s.order.type).toBe('hold');expect(g.expansion!.diplomacy.state.wars).toEqual([]);
 g.owners[g.map.ref(20,20)]=2;(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toBeUndefined();expect(g.expansion!.economy.assets.held(`squad:${s.id}`)).toBe(false);
});
it('grace permits retreat within its original country but not entry into a different neutral country',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,point(20));for(let x=20;x<=25;x++)g.owners[g.map.ref(x,20)]=x===25?3:1;
 g.tick=10;(g as any).advanceDiplomaticWithdrawal();expect((g as any).movementPolicyClear(s,point(23))).toBe(true);expect((g as any).movementPolicyClear(s,point(25))).toBe(false);
});
it('foreign human squads receive no withdrawal timer or automatic order replacement',()=>{
 const g=fixture(),s=g.squads[0];g.updateSquad(s.id,point(20));g.owners[g.map.ref(20,20)]=2;const before=structuredClone(s.order);
 (g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toBeUndefined();expect(s.order).toEqual(before);
});
it('rejects corrupt withdrawal deadlines during checkpoint restoration',()=>{
 const g=fixture(),c=g.checkpoint();(c.squads[0] as any).aiWithdrawal={owner:2,since:0,deadline:599,phase:'withdrawing'};expect(()=>g.restore(c)).toThrow('Invalid diplomatic withdrawal');
});
it('human takeover immediately releases AI-only control without changing the order',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,point(20));g.owners[g.map.ref(20,20)]=1;
 (g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toBeDefined();const order=structuredClone(s.order);
 g.setAiController(2,false);expect(s.aiWithdrawal).toBeUndefined();expect(s.order).toEqual(order);
 expect(g.applyCommand({type:'order',playerId:2,squadIds:[s.id],order:{type:'hold'}})).toBeNull();
});
it('a grace leg cannot leave its host and then re-enter it in the same shortcut',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,point(20));
 for(let x=20;x<=25;x++)g.owners[g.map.ref(x,20)]=x===22?2:1;
 g.tick=10;(g as any).advanceDiplomaticWithdrawal();expect((g as any).movementPolicyClear(s,point(25))).toBe(false);
});
it('persisted diplomatic waits do not manufacture a new request after restore',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!;g.updateSquad(s.id,{...point(20),order:{type:'move',tile:g.map.ref(25,20)},path:[g.map.ref(25,20)],nextPathIndex:0});
 g.owners[g.map.ref(20,20)]=2;g.owners[g.map.ref(25,20)]=3;
 vi.spyOn(g as any,'requestNavigationRoute').mockReturnValue(false);(g as any).navigation(s);
 const restored=fixture();restored.restore(g.checkpoint());const request=vi.spyOn(restored as any,'requestNavigationRoute').mockReturnValue(false);
 (restored as any).navigation(restored.squad(s.id)!);expect(request).not.toHaveBeenCalled();
});
it('raid expiry starts withdrawal, and another border change cannot reset its deadline',()=>{
 const g=fixture(),s=g.squads.find(s=>s.playerId===2)!,d=g.expansion!.diplomacy;g.updateSquad(s.id,point(20));g.owners[g.map.ref(20,20)]=1;
 expect(d.beginAiRaid(g.players[1],g.players[0],0)).toBeNull();(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toBeUndefined();
 g.tick=1200;d.step(g.tick,g.players);(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toMatchObject({since:1200,deadline:1800,owner:1});
 g.owners[g.map.ref(20,20)]=3;g.tick++;(g as any).advanceDiplomaticWithdrawal();expect(s.aiWithdrawal).toMatchObject({since:1200,deadline:1800,owner:3});expect(d.state.wars).toEqual([]);
});
