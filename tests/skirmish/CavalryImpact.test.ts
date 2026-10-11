import { describe,expect,it } from 'vitest';
import { cavalryImpactScene,cavalryBattleScene } from './fixtures/CavalryImpact';
import { chargeDisrupted,validateChargeImpact,CHARGE_IMPACT } from '../../src/skirmish/domain/ChargeImpact';
import { SnapshotDecoder,SnapshotEncoder } from '../../src/skirmish/SnapshotCodec';
import { chargeReactions } from '../../src/skirmish/client/troops/ChargeImpactPresentation';
import { formationContact,formationApproach,formationFootprint,polygonsOverlap } from '../../src/skirmish/domain/FormationContact';
import { validateCavalryMelee,waveDamage,waveTick,cavalryAttackGap,CAVALRY_RANK_MOTION as rankTiming,CAVALRY_RANK_SPEED,CAVALRY_RANK_TURN_SPEED } from '../../src/skirmish/domain/CavalryMelee';
import { validateCavalryEngagement,cavalryOverlapAllowed } from '../../src/skirmish/domain/CavalryEngagement';
import { cavalryCohort,cavalryWaves,rankMotion } from '../../src/skirmish/client/troops/CavalryMeleePresentation';
import { cavalryUsesRankWaves } from '../../src/skirmish/domain/CavalryMelee';
import { CONTACT } from '../../src/skirmish/content/TacticalRules';

describe('bounded cavalry impact prototype',()=>{
  it('does not pay a committed wave whose stored paths no longer intersect the target',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,cavalryAttackGap(rider,defender),-Math.PI/2));
    game.expansion!.battle.fight([]);
    const c=rider.cavalryMelee!.current;
    game.updateSquad(rider.id,{cavalryMelee:{current:{...c,contacts:c.contacts.map(p=>({...p,targetBody:p.targetBody!.map(v=>({x:v.x+4096,y:v.y}))}))}}});
    game.tick=waveTick(c,0);game.expansion!.battle.fight([]);
    expect(game.volleys.some(v=>v.squadId===rider.id&&v.tick===game.tick)).toBe(false);
    expect(defender.chargeImpact).toBeUndefined();
  });
  it('keeps a last-rank attack physically within ordinary melee reach',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,troops:1,y:26*256,manpower:{...rider.manpower!,hp:1000000},formation:{...rider.formation!,transition:undefined}});
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'attack',targetId:defender.id}})).toBeNull();
    for(let i=0;i<100;i++)game.step();
    expect(rider.troops).toBe(1);expect(rider.cavalryMelee).toBeUndefined();
    expect(formationContact(rider,defender,game.tick).gap).toBeLessThanOrEqual(CONTACT.release);
    expect(rider.meleeStrike).toBeDefined();
  });
  it('closes the stand-off gap and cancels rank waves when only one rank remains',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,cavalryAttackGap(rider,defender),-Math.PI/2));
    game.expansion!.battle.fight([]);expect(rider.cavalryMelee).toBeDefined();
    game.updateSquad(rider.id,{troops:1});
    expect(cavalryUsesRankWaves(rider)).toBe(false);
    expect(cavalryAttackGap(rider,defender)).toBe(CONTACT.enter);
    game.expansion!.battle.fight([]);expect(rider.cavalryMelee).toBeUndefined();
  });
  it('hands approach momentum to the first rank immediately and launches the next during withdrawal',()=>{
    const c={tick:10,interval:324,completed:0,troops:3,definitionId:'bronzeage-cavalry',approachSpeed:6,orderRevision:0,
      contacts:[{targetId:10,budget:1000,lunge:512,strikeDepth:64,laneWidth:16,bearing:Math.PI/2,fromX:0,fromY:0,toX:0,toY:128}]};
    const members=[0,-.3,-.6].map((y,id)=>({id,x:0,y,scale:.2})),cohort=cavalryCohort(c,members),cache=new Map([[c.tick,cohort]]);
    const clip={id:'attack',file:'attack.png',frames:[],frameCount:8,fps:10};
    const atStart=cavalryWaves({current:c},c.tick,clip,members,cache);
    expect(atStart.get(0)?.moving).toBe(true);expect(atStart.has(1)).toBe(false);
    expect(cavalryWaves({current:c},c.tick+1,clip,members,cache).get(0)!.y).toBeGreaterThan(0);
    const nextStart=waveTick(c,1)-rankTiming.advance;
    expect(Math.abs(nextStart-waveTick(c,0)-rankTiming.brake-rankTiming.turn)).toBeLessThan(1);
    const handoff=cavalryWaves({current:c},nextStart+1,clip,members,cache);
    expect(handoff.get(0)?.moving).toBe(true);expect(handoff.get(1)?.moving).toBe(true);
  });
  it('prevents infantry hitting a parked cavalry body across the gap and wakes retaliation only for exposed ranks',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,cavalryAttackGap(rider,defender),-Math.PI/2));
    game.expansion!.battle.fight([]);const c=structuredClone(rider.cavalryMelee!.current);
    const before=Math.ceil(waveTick(c,0)-rankTiming.brake);
    for(let tick=1;tick<before;tick++){game.tick=tick;game.expansion!.battle.fight([]);}
    expect(game.volleys.filter(v=>v.squadId===defender.id)).toHaveLength(0);
    for(let tick=before;tick<=waveTick(c,0);tick++){game.tick=tick;game.expansion!.battle.fight([]);}
    expect(game.volleys.some(v=>v.squadId===defender.id&&v.melee)).toBe(true);
    const local=defender.meleeStrike!.contacts[0];
    expect(local.bearing).toBeCloseTo(Math.atan2(local.toY-local.fromY,local.toX-local.fromX),10);
    expect(defender.chargeImpact?.tick).toBe(waveTick(c,0));
    expect(defender.chargeImpact?.disruptedUntilTick).toBe(game.tick);
    expect(chargeDisrupted(defender,game.tick)).toBe(false);
    // Cached acquisition must close again when the rank leaves the contact
    // window, even though neither squad body moved.
    game.tick=Math.ceil(waveTick(c,0)+rankTiming.brake+rankTiming.turn+rankTiming.return/2);game.updateSquad(defender.id,{weaponState:undefined,nextAttackTick:0});
    game.expansion!.battle.fight([]);
    expect(game.volleys.some(v=>v.squadId===defender.id&&v.tick===game.tick)).toBe(false);
  });
  it('keeps an ordinary cavalry attack at its infantry-sized gap and still pays all three waves',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,y:26*256,formation:{...rider.formation!,transition:undefined}});
    const gap=cavalryAttackGap(rider,defender);
    expect(gap).toBeGreaterThan(32);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'attack',targetId:defender.id}})).toBeNull();
    const strikes=new Set<number>();
    for(let i=0;i<150;i++){game.step();for(const v of game.volleys)if(v.squadId===rider.id&&v.melee)strikes.add(v.id);}
    expect(formationContact(rider,defender,game.tick).gap).toBeGreaterThan(gap-10);
    expect(formationContact(rider,defender,game.tick).gap).toBeLessThanOrEqual(gap+2);
    expect(rider.cavalryEngagement).toBeUndefined();expect(rider.cavalryMelee).toBeDefined();
    expect(rider.cavalryMelee!.current.approachSpeed).toBeGreaterThan(0);
    for(let i=0;i<200;i++){game.step();for(const v of game.volleys)if(v.squadId===rider.id&&v.melee)strikes.add(v.id);}
    expect(strikes.size).toBeGreaterThanOrEqual(3);
    game.updateSquad(rider.id,{charge:{phase:'committed',x:defender.x,y:defender.y,startTick:game.tick,committedTick:game.tick,targetId:defender.id}});
    expect(cavalryAttackGap(rider,defender)).toBe(4);
  });
  it('physically enters after impact, stays in contact, and withdraws on a human order',()=>{
    const {game,rider,defender}=cavalryImpactScene();game.step();const start={x:rider.x,y:rider.y},impact=rider.chargeImpact!.tick;
    expect(rider.cavalryEngagement?.phase).toBe('penetrating');
    for(let i=0;i<50;i++)game.step();
    expect(Math.hypot(rider.x-start.x,rider.y-start.y)).toBeGreaterThan(30);
    expect(rider.cavalryEngagement?.phase).toBe('engaged');
    expect(formationContact(rider,defender,game.tick).gap).toBeLessThanOrEqual(4);
    expect(rider.chargeImpact!.tick).toBe(impact);
    const entered={x:rider.x,y:rider.y},tile=game.map.ref(32,24);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'move',tile}})).toBeNull();
    expect(rider.order.type).toBe('move');expect(rider.cavalryEngagement?.phase).toBe('withdrawing');
    for(let i=0;i<240;i++)game.step();
    expect(rider.y).toBeLessThan(entered.y-256);expect(rider.cavalryEngagement).toBeUndefined();
  });
  it('bounds overlap permission to the contacted enemy and forward corridor; rejects malformed entry',()=>{
    const {game,rider,defender}=cavalryImpactScene();game.step();const e=rider.cavalryEngagement!;
    expect(cavalryOverlapAllowed(rider,defender,{x:e.goalX,y:e.goalY},game.tick,false)).toBe(true);
    expect(cavalryOverlapAllowed(rider,{...defender,id:999},{x:e.goalX,y:e.goalY},game.tick,false)).toBe(false);
    expect(cavalryOverlapAllowed(rider,defender,{x:e.goalX+512,y:e.goalY},game.tick,false)).toBe(false);
    expect(()=>validateCavalryEngagement({...e,goalY:e.originY+1000},game.tick)).toThrow();
    const spears=cavalryImpactScene(false,true);spears.game.step();expect(spears.rider.cavalryEngagement?.phase).toBe('engaged');
    expect(spears.rider.cavalryEngagement!.goalY).toBe(spears.rider.y);
  });
  it('keeps walls and newly encountered formations authoritative during entry',()=>{
    const blocked=cavalryImpactScene();blocked.game.step();const e=blocked.rider.cavalryEngagement!;
    blocked.game.expansion!.fortifications.addBarrier({id:900,playerId:2,age:'BronzeAge',a:800,b:801,
      tiles:Array.from({length:10},(_,i)=>blocked.game.map.ref(27+i,32)),health:2000,maxHealth:2000,remainingTicks:0});
    for(let i=0;i<45;i++)blocked.game.step();
    expect(blocked.rider.y).toBeLessThan(e.goalY);
    const crowded=cavalryImpactScene();crowded.game.step();
    const blocker=crowded.game.addSquad({...structuredClone(crowded.defender),id:crowded.game.allocateId(),chargeImpact:undefined});
    for(let i=0;i<10;i++)crowded.game.step();
    expect(crowded.rider.y).toBeLessThan(crowded.rider.cavalryEngagement!.goalY);
    expect(crowded.rider.cavalryEngagement!.targetIds).not.toContain(blocker.id);
    expect(polygonsOverlap(formationFootprint(crowded.rider,crowded.game.tick),formationFootprint(blocker,crowded.game.tick))).toBe(false);
  });
  it('continues physical entry identically after checkpoint restoration',()=>{
    const f=cavalryImpactScene();f.game.step();const saved=f.game.checkpoint(),restored=cavalryImpactScene().game;
    restored.restore(saved);
    expect(restored.squad(f.rider.id)!.cavalryEngagement).toEqual(f.rider.cavalryEngagement);
    for(let i=0;i<35;i++){f.game.step();restored.step();}
    expect(restored.checkpoint()).toEqual(f.game.checkpoint());
  });
  it('pays exactly one attack budget across three timed waves and restores the pending commitment',()=>{
    const {game,rider,defender}=cavalryImpactScene();
    game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,0,-Math.PI/2));
    game.updateSquad(defender.id,{weaponState:{sharedReadyTick:10000}});
    game.expansion!.battle.fight([]);const c=structuredClone(rider.cavalryMelee!.current);
    expect(c.completed).toBe(0);expect(game.volleys.filter(v=>v.squadId===rider.id)).toHaveLength(0);
    const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
    expect(decoder.decode(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts())).squads.find(s=>s.id===rider.id)!.cavalryMelee).toEqual(rider.cavalryMelee);
    const saved=game.checkpoint();game.restore(saved);
    for(let tick=1;tick<c.tick+c.interval;tick++){game.tick=tick;game.expansion!.battle.fight([]);}
    const shots=game.volleys.filter(v=>v.squadId===rider.id);
    expect(shots.map(v=>v.tick)).toEqual([0,1,2].map(rank=>waveTick(c,rank)));
    expect(Math.round(shots.reduce((n,v)=>n+(v.damage??0),0)*1000)).toBe(c.contacts.reduce((n,p)=>n+p.budget,0));
    expect(()=>validateCavalryMelee({current:{...c,completed:4}},game.tick)).toThrow();
    expect([0,1,2].reduce((n,rank)=>n+waveDamage(c,1001,rank,c.troops),0)).toBeCloseTo(1.001,12);
    expect(waveDamage(c,1001,2,c.troops/2)).toBeLessThanOrEqual(waveDamage(c,1001,2,c.troops)/2);
  });
  it('cancels unpaid waves immediately on a new player order',()=>{
    const {game,rider,defender}=cavalryImpactScene();game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,0,-Math.PI/2));game.expansion!.battle.fight([]);
    const c=rider.cavalryMelee!.current;
    game.updateSquad(rider.id,{meleeStrike:{tick:game.tick,contacts:c.contacts}});
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'move',tile:game.map.ref(32,20)}})).toBeNull();
    expect(rider.cavalryMelee).toBeUndefined();
    expect(rider.meleeStrike).toBeUndefined();
    game.updateSquad(rider.id,{x:10*256,y:10*256});game.tick=c.tick+c.interval;game.expansion!.battle.fight([]);
    expect(game.volleys.filter(v=>v.squadId===rider.id)).toHaveLength(0);
  });
  it('does not recreate the old attack while approaching an explicitly retargeted enemy',()=>{
    const {game,rider,defender}=cavalryImpactScene();game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,cavalryAttackGap(rider,defender),-Math.PI/2));
    game.expansion!.battle.fight([]);expect(rider.cavalryMelee).toBeDefined();
    const next=game.addSquad({...structuredClone(defender),id:game.allocateId(),y:defender.y+3*256,chargeImpact:undefined});
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[rider.id],order:{type:'attack',targetId:next.id}})).toBeNull();
    game.expansion!.battle.fight([]);
    expect(rider.cavalryMelee).toBeUndefined();expect(rider.combatTargetId).toBeNull();
    game.tick=100; // The original weapon commitment still has its cooldown.
    game.updateSquad(rider.id,formationApproach(rider,next,game.tick,cavalryAttackGap(rider,next),-Math.PI/2));
    game.expansion!.battle.fight([]);
    expect(rider.cavalryMelee!.current.contacts[0].targetId).toBe(next.id);
  });
  it('keeps wave ranks stable across casualties and overlaps retreat with the following rank',()=>{
    const {game,rider,defender}=cavalryImpactScene();game.updateSquad(rider.id,{charge:null,formation:{...rider.formation!,transition:undefined}});
    game.updateSquad(rider.id,formationApproach(rider,defender,0,0,-Math.PI/2));game.expansion!.battle.fight([]);
    // Synthetic origin-centered riders exercise timing/identity independently
    // of the real scene's target hull in world coordinates.
    const raw=rider.cavalryMelee!.current,c={...raw,contacts:raw.contacts.map(p=>({...p,targetBody:undefined}))},members=Array.from({length:9},(_,id)=>({id,x:id%3,y:-Math.floor(id/3)*.3,scale:.2}));
    const cohort=cavalryCohort(c,members),cohorts=new Map([[c.tick,cohort]]),clip={id:"attack",file:"attack.png",frames:[],frameCount:8,fps:10,releaseFrame:2};
    const sampleTick=waveTick(c,1)-rankTiming.advance+1;
    const waves=cavalryWaves({current:c},sampleTick,clip,members,cohorts);
    expect(new Set([...waves.keys()].map(id=>cohort.get(id)!.rank)).size).toBe(2);
    const survivors=members.filter(m=>m.id!==0);
    expect(cavalryWaves({current:c},sampleTick,clip,survivors,cohorts).has(0)).toBe(false);
    const next={...c,tick:c.tick+c.interval},both=new Map([[c.tick,cohort],[next.tick,cavalryCohort(next,members)]]);
    const handoff=cavalryWaves({current:next,previous:{...c,completed:3}},next.tick+2,clip,members,both);
    const activeRanks=new Set([...handoff.keys()].map(id=>cohort.get(id)!.rank));
    expect(activeRanks.has(0)).toBe(true);expect(activeRanks.has(2)).toBe(true);
  });
  it('builds momentum and caches tightly bounded lanes through preceding-rank gaps',()=>{
    expect(rankMotion(2.4,-9,10,20,19)!.forward).toBeCloseTo(rankMotion(1.6,-9,10,20,19)!.forward,12);
    expect(rankMotion(.8,-8,10,20,19)!.forward).toBeCloseTo(4*rankMotion(.8,-9,10,20,19)!.forward,12);
    expect(rankMotion(.8,-10,10,20,19)!.forward).toBe(0);expect(rankMotion(.8,39,10,20,19)).toBeUndefined();
    const members=[{id:0,x:0,y:0,scale:.2},{id:1,x:.4,y:0,scale:.2},{id:2,x:0,y:-.3,scale:.2}];
    const c={tick:0,interval:324,completed:0,troops:3,definitionId:'bronzeage-cavalry',orderRevision:0,
      contacts:[{targetId:10,budget:1000,lunge:256,laneWidth:64,bearing:Math.PI/2,fromX:0,fromY:0,toX:0,toY:0}]};
    const cohort=cavalryCohort(c,members);
    expect(cohort.get(2)!.lane).toBeCloseTo(-.0625,12);expect(cohort.get(0)!.lane).toBe(0);
    const clip={id:'attack',file:'attack.png',frames:[],frameCount:8,fps:10},cache=new Map([[0,cohort]]);
    const startTick=waveTick(c,1)-rankTiming.advance;
    const start=cavalryWaves({current:c},startTick,clip,members,cache).get(2)!;
    expect(start.x).toBe(0);expect(start.y).toBe(-.3);
    const passing=cavalryWaves({current:c},startTick+5,clip,members,cache).get(2)!;
    expect(passing.x).toBeGreaterThan(0);expect(passing.x).toBeLessThanOrEqual(.25);
    expect(cavalryWaves({current:c},startTick+5,clip,[...members].reverse(),cache)).toEqual(cavalryWaves({current:c},startTick+5,clip,members,cache));
    expect(cavalryCohort({...c,contacts:[{...c.contacts[0],laneWidth:0}]},members).get(2)!.lane).toBe(0);
  });
  it('takes each rank from its actual inset position into the target at the strike, then rides home',()=>{
    const members=[-.1,-.3,-.5].map((y,id)=>({id,x:0,y,scale:.2}));
    const c={tick:0,interval:240,completed:3,troops:3,definitionId:'bronzeage-cavalry',orderRevision:0,
      contacts:[{targetId:10,budget:1000,lunge:512,strikeDepth:64,laneWidth:16,bearing:Math.PI/2,fromX:0,fromY:0,toX:0,toY:192}]};
    const cohort=cavalryCohort(c,members),cache=new Map([[0,cohort]]),clip={id:'attack',file:'attack.png',frames:[],frameCount:8,fps:10};
    for(const member of members){
      const hit=waveTick(c,cohort.get(member.id)!.rank);
      const strike=cavalryWaves({current:c},hit,clip,members,cache).get(member.id)!;
      expect(strike.y).toBeCloseTo(1,10);expect(strike.attacking).toBe(true);
      const returning=cavalryWaves({current:c},hit+rankTiming.brake+rankTiming.turn+rankTiming.return/2,clip,members,cache).get(member.id)!;
      expect(Math.abs(returning.angle)).toBeCloseTo(Math.PI,10);
      const home=cavalryWaves({current:c},hit+rankTiming.brake+rankTiming.turn+rankTiming.return+1,clip,members,cache).get(member.id)!;
      expect(home.y).toBeCloseTo(member.y,10);
    }
    expect(()=>validateCavalryMelee({current:{...c,contacts:[{...c.contacts[0],strikeDepth:129}]}})).toThrow();
    const blocked={...c,contacts:[{...c.contacts[0],lunge:0}]};
    expect([...cavalryCohort(blocked,members).values()].every(p=>p.travel===0)).toBe(true);
  });
  it('peaks at the strike, recovers without spinning, and returns without position or velocity jumps',()=>{
    const sample=(t:number)=>rankMotion(.8,t,12,20,27)!;
    expect(sample(-.01).speed).toBeLessThan(sample(0).speed);expect(sample(.01).speed).toBeLessThan(sample(0).speed);
    expect(sample(10).speed).toBe(0);expect(sample(19).returning).toBe(false);
    expect(sample(20).returning).toBe(true);expect(sample(20).speed).toBe(0);expect(sample(20).rotation).toBe(0);
    for(const boundary of [0,8,20,24.05,36.2,40.25]){
      const left=sample(boundary-.000001),right=sample(boundary+.000001);
      expect(Math.abs(left.forward-right.forward)).toBeLessThan(.00001);
      expect(Math.abs(left.speed-right.speed)).toBeLessThan(.00001);
      expect(Math.abs(left.rotation-right.rotation)).toBeLessThan(.00001);
    }
    for(let t=20;t<47;t+=.1)expect(sample(t).speed).toBeLessThanOrEqual(sample(0).speed);
    // A broad, lower cruise speed replaces the old sharp quintic peak.
    expect(sample(30).speed).toBeCloseTo(sample(35).speed,12);
    expect(sample(30).speed).toBeLessThan(.8*1.875/(27-6.75)*.7);
    expect(sample(46.9999).forward).toBeLessThan(.000001);expect(sample(46.9999).speed).toBeLessThan(.000001);
    expect(sample(46.9999).rotation).toBeLessThan(.000001);
  });
  it('lets a returning survivor finish before its promotion to a new front rank',()=>{
    const members=[{id:8,x:0,y:0,scale:.2}],clip={id:'attack',file:'attack.png',frames:[],frameCount:8,fps:10};
    const previous={tick:0,interval:72,completed:3,troops:8,definitionId:'bronzeage-cavalry',orderRevision:0,
      contacts:[{targetId:10,budget:1000,lunge:256,laneWidth:64,bearing:Math.PI/2,fromX:0,fromY:0,toX:0,toY:0}]};
    const current={...previous,tick:72,completed:0},old=cavalryCohort(previous,members),next=cavalryCohort(current,members);
    old.get(8)!.rank=2;next.get(8)!.rank=0;
    const cohorts=new Map([[0,old],[72,next]]);
    expect(cavalryWaves({current,previous},80,clip,members,cohorts).get(8)).toEqual(cavalryWaves({current:previous},80,clip,members,cohorts).get(8));
    expect(cavalryWaves({current,previous},240,clip,members,cohorts).has(8)).toBe(false);
  });
  it('never spins idle or short-lunge riders, and bounds turning during curved returns',()=>{
    const clip={id:'attack',file:'attack.png',frames:[],frameCount:8,fps:10},members=[{id:0,x:0,y:0,scale:.2}];
    const c={tick:0,interval:240,completed:3,troops:1,definitionId:'bronzeage-cavalry',orderRevision:0,
      contacts:[{targetId:10,budget:1000,lunge:256,laneWidth:64,bearing:Math.PI/2,fromX:0,fromY:0,toX:0,toY:256}]};
    const sample=(travel:number,tick:number)=>{
      const cohort=cavalryCohort(c,members);cohort.get(0)!.travel=travel;
      return cavalryWaves({current:c},tick,clip,members,new Map([[0,cohort]])).get(0)!;
    };
    const hit=waveTick(c,0),departure=hit+rankTiming.brake+rankTiming.turn,arrival=departure+rankTiming.return,end=arrival+rankTiming.turn;
    for(let tick=0;tick<end;tick++){
      const idle=sample(0,tick);expect(idle.angle).toBe(0);expect(idle.x).toBe(0);expect(idle.y).toBe(0);
      expect(sample(.04,tick).angle).toBe(0);
    }
    expect(sample(1,hit+rankTiming.brake-.1).angle).toBe(0); // Brake before turning.
    expect(sample(1,departure).angle).toBeCloseTo(Math.PI,12);
    expect(sample(1,departure+rankTiming.return/2).angle).toBeCloseTo(Math.PI,12); // Ride home facing home.
    for(let tick=hit+rankTiming.brake;tick<end-.1;tick+=.1){
      const before=sample(1,tick),after=sample(1,tick+.1);
      expect(Math.abs(after.angle-before.angle)/.1).toBeLessThanOrEqual(Math.PI/40*CAVALRY_RANK_SPEED*CAVALRY_RANK_TURN_SPEED+.000001);
    }
    expect(sample(1,end-.0001).angle).toBeCloseTo(0,8);
    const settled=sample(1,arrival+1);expect(settled.x).toBeCloseTo(0,12);expect(settled.y).toBeCloseTo(0,12);
  });
  it('runs three real moving charge orders through run-up and impact against six infantry formations',()=>{
    const scene=cavalryBattleScene(),starts=scene.riders.map(r=>r.y),phases=new Set<string>();
    for(let i=0;i<200;i++){scene.launch();scene.game.step();for(const rider of scene.riders)if(rider.charge)phases.add(rider.charge.phase);}
    expect(phases.has('preparing')).toBe(false);expect(phases.has('approach')).toBe(true);expect(phases.has('committed')).toBe(true);
    expect(scene.riders.every(r=>r.chargeImpact?.role==='rider')).toBe(true);
    // Larger original-scale bodies contact sooner, but each charge must have a real run-up.
    expect(scene.riders.every((r,i)=>r.y-starts[i]>256)).toBe(true);
    expect(scene.defenders.filter(d=>d.chargeImpact).length).toBeGreaterThanOrEqual(3);
  });
  it('publishes one impact, keeps roots fixed, briefly disrupts and recovers without repeating damage',()=>{
    const {game,rider,defender}=cavalryImpactScene(),root={x:defender.x,y:defender.y};
    game.step();expect(rider.chargeImpact?.role).toBe('rider');expect(defender.chargeImpact?.role).toBe('defender');
    expect(chargeDisrupted(defender,game.tick)).toBe(true);expect(game.ordinarySpeed(defender)).toBe(0);
    expect({x:defender.x,y:defender.y}).toEqual(root);const impact=structuredClone(defender.chargeImpact);
    const until=defender.chargeImpact!.disruptedUntilTick;
    for(let i=game.tick;i<=until;i++)game.step();
    expect(defender.chargeImpact).toEqual(impact);expect(chargeDisrupted(defender,game.tick)).toBe(false);
    expect(game.ordinarySpeed(defender)).toBeGreaterThan(0);
    expect(defender.lastAttackTick??-1).toBeGreaterThanOrEqual(until);
  });
  it('makes flank disruption stronger and braced spears resistant',()=>{
    const front=cavalryImpactScene(),flank=cavalryImpactScene(true),spears=cavalryImpactScene(false,true);
    for(const scene of [front,flank,spears])scene.game.step();
    const duration=(s:typeof front)=>s.defender.chargeImpact!.disruptedUntilTick-s.defender.chargeImpact!.tick;
    expect(duration(flank)).toBeGreaterThan(duration(front));expect(duration(spears)).toBeLessThan(duration(front));
  });
  it('preserves impacts through packed/delta snapshots and checkpoints; rejects malformed facts',()=>{
    const {game,defender}=cavalryImpactScene();const encoder=new SnapshotEncoder(),decoder=new SnapshotDecoder();
    decoder.decode(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
    game.step();const decoded=decoder.decode(encoder.encode(game.replicationSource(),game.tileChanges,game.replicationFacts()));
    expect(decoded.squads.find(s=>s.id===defender.id)!.chargeImpact).toEqual(defender.chargeImpact);
    const saved=game.checkpoint();game.restore(saved);expect(game.squad(defender.id)!.chargeImpact).toEqual(defender.chargeImpact);
    expect(()=>validateChargeImpact({...defender.chargeImpact!,dx:CHARGE_IMPACT.maxOffset*2},game.tick)).toThrow();
    expect(()=>validateChargeImpact({...defender.chargeImpact!,tick:game.tick+1},game.tick)).toThrow();
  });
  it('keeps reactions bounded and deterministic, and does not replay expired impacts',()=>{
    const {game,defender}=cavalryImpactScene();game.step();const fact=defender.chargeImpact!;
    const members=Array.from({length:72},(_,id)=>({id,x:fact.x/256+id*.01,y:fact.y/256,angle:0,scale:.12}));
    const first=chargeReactions(fact,fact.tick+6,members);
    expect(first.size).toBeLessThanOrEqual(CHARGE_IMPACT.maxMembers);
    expect(chargeReactions(fact,fact.tick+6,[...members].reverse())).toEqual(first);
    expect(new Set([...first.values()].map(r=>r.time)).size).toBeGreaterThan(1);
    expect(new Set([...first.values()].map(r=>r.angle)).size).toBeGreaterThan(1);
    const selected=new Set(first.keys()),survivors=members.filter(member=>member.id!==[...selected][0]);
    expect(chargeReactions(fact,fact.tick+7,survivors,selected).size).toBe(selected.size-1);
    expect(chargeReactions(fact,fact.tick+CHARGE_IMPACT.duration,members).size).toBe(0);
    expect(chargeReactions(fact,fact.tick-1,members).size).toBe(0);
  });
  it('suppresses cosmetic translation when the terrain/wall certificate fails',()=>{
    const {game,rider,defender}=cavalryImpactScene();game.chargePresentationClear=()=>false;game.step();
    expect(rider.chargeImpact?.dx).toBe(0);expect(rider.chargeImpact?.dy).toBe(0);
    expect(defender.chargeImpact?.dx).toBe(0);expect(defender.chargeImpact?.dy).toBe(0);
    expect(chargeDisrupted(defender,game.tick)).toBe(true);
  });
  it('accepts a human move order during disruption without dropping or queueing the order behind AI',()=>{
    const {game,defender}=cavalryImpactScene();game.setAiController(2,false);game.step();
    const root={x:defender.x,y:defender.y},tile=game.map.ref(36,32);
    expect(game.applyCommand({type:'order',playerId:2,squadIds:[defender.id],order:{type:'move',tile}})).toBeNull();
    expect(defender.order).toEqual({type:'move',tile});game.step();
    expect({x:defender.x,y:defender.y}).toEqual(root);
    expect(defender.order).toEqual({type:'move',tile});
  });
});
