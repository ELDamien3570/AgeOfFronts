import { describe, expect, it } from 'vitest';
import { cavalryDuel } from './fixtures/CavalryDuel';
import { FIXED, TICKS_PER_SECOND, secondsToTicks } from '../../src/skirmish/Protocol';
import { remainingHealth } from '../../src/skirmish/domain/Manpower';
import { CAVALRY_WITHDRAW_GUARD_TICKS } from '../../src/skirmish/domain/CavalryAssault';

// C1 (R2-H3): an engagement lasts while its bodies are in contact, and a
// withdrawal is immune to re-acquisition only for its guard.
describe('cavalry withdrawal (C1)', () => {
  it('clears a held rider\'s engagement within 2 s once its attacker walks away alive', () => {
    const {game,riderId,footId}=cavalryDuel('earlymedieval-heavycavalry','earlymedieval-infantry',{mode:'held'});
    const rider=game.squad(riderId)!;
    for(let i=0;i<30*TICKS_PER_SECOND&&!rider.cavalryEngagement?.assault;i++)game.step();
    expect(rider.cavalryEngagement?.assault).toBeDefined();
    const foot=game.squad(footId)!;
    game.updateSquad(footId,{x:foot.x+40*FIXED,order:{type:'hold'},path:[],queuedOrders:[]});
    for(let i=0;i<secondsToTicks(2);i++)game.step();
    expect(game.squad(riderId)!.cavalryEngagement).toBeUndefined();
  });

  it('keeps a body-blocked withdrawal out of the fight for its guard, then fights back', () => {
    // Off the tile edge: traversable() misses a target exactly on a tile boundary (openIssues).
    const {game,riderId,footId}=cavalryDuel('earlymedieval-heavycavalry','earlymedieval-infantry',{mode:'assault',x:48.5});
    const rider=game.squad(riderId)!;
    for(let i=0;i<30*TICKS_PER_SECOND&&!rider.cavalryEngagement?.assault;i++)game.step();
    expect(rider.cavalryEngagement?.assault).toBeDefined();
    // Withdraw straight through the defender: it blocks the whole way.
    const foot=game.squad(footId)!;
    const tile=game.map.ref(Math.floor(foot.x/FIXED),Math.floor(foot.y/FIXED)+20);
    expect(game.applyCommand({type:'order',playerId:1,squadIds:[riderId],order:{type:'move',tile}})).toBeNull();
    expect(rider.cavalryEngagement?.phase).toBe('withdrawing');
    const start=game.tick,dealt=new Map<number,number>();
    let hp=remainingHealth(game.squad(footId)!);
    for(let i=0;i<secondsToTicks(6);i++){
      game.step();
      const now=remainingHealth(game.squad(footId)!);
      if(now<hp)dealt.set(game.tick-start,hp-now);
      hp=now;
    }
    const during=[...dealt].filter(([t])=>t<=CAVALRY_WITHDRAW_GUARD_TICKS).reduce((n,[,d])=>n+d,0);
    const after=[...dealt].filter(([t])=>t>CAVALRY_WITHDRAW_GUARD_TICKS).reduce((n,[,d])=>n+d,0);
    expect(during).toBe(0);
    expect(after).toBeGreaterThan(0);
  });

  it('keeps a charge to a point a charge when the old engagement target is far away', () => {
    const {game,riderId,footId}=cavalryDuel('earlymedieval-heavycavalry','earlymedieval-infantry',{mode:'assault'});
    const rider=game.squad(riderId)!;
    for(let i=0;i<30*TICKS_PER_SECOND&&!rider.cavalryEngagement?.assault;i++)game.step();
    const engagement=rider.cavalryEngagement!;
    expect(engagement.targetIds).toContain(footId);
    // A stale engagement: its only target is now far from the rider.
    const foot=game.squad(footId)!;
    game.updateSquad(footId,{x:foot.x+40*FIXED});
    game.updateSquad(riderId,{cavalryEngagement:{...engagement,phase:'engaged'},chargeReadyTick:0});
    const x=rider.x,y=rider.y-4*FIXED;
    expect(game.applyCommand({type:'charge',playerId:1,squadIds:[riderId],x,y})).toBeNull();
    expect(game.squad(riderId)!.order.type).toBe('move');
    expect(game.squad(riderId)!.charge).not.toBeNull();
  });
});
