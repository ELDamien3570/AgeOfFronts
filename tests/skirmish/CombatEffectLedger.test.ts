import { describe, expect, it } from 'vitest';
import { cavalryDuel, duelTrace } from './fixtures/CavalryDuel';
import { GameMapImpl } from '../../src/core/game/GameMap';
import { Skirmish } from '../../src/skirmish/Simulation';
import { FIXED } from '../../src/skirmish/Protocol';
import { BOMBER_ATTACK } from '../../src/skirmish/content/ModernWeapons';

/** Warships along a water channel, 0..5 tiles from a shell impact. */
function splashScene(nearestFirst:boolean,damage:number,centreSquad=false){
  const data=new Uint8Array(100*80).fill(133);
  for(let y=0;y<80;y++)for(let x=40;x<50;x++)data[y*100+x]=0;
  const game=new Skirmish(new GameMapImpl(100,80,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
  for(const squad of [...game.squads])game.updateSquad(squad.id,{x:90.5*FIXED,y:70.5*FIXED});
  const order=nearestFirst?[0,1,2,3,4,5]:[5,4,3,2,1,0];
  // Three stacked hulls per distance so the shared budget runs out.
  const ships=new Map<number,number[]>();
  for(const d of order)for(let k=0;k<3;k++){
    const ship=game.addShip({id:game.allocateId(),kind:'warship',playerId:2,x:45.5*FIXED,y:(30.5+d)*FIXED,health:8000,
      destination:null,waypoints:[],path:[],nextPathIndex:0,fighting:false});
    ships.set(d,[...ships.get(d)??[],ship.id]);
  }
  let squad:number|undefined;
  if(centreSquad){
    // A lower-id ground body beside the channel, farther than the nearest hull.
    const victim=game.squads.find(s=>s.playerId===2)!;
    game.updateSquad(victim.id,{x:39.5*FIXED,y:30.5*FIXED,troops:12});
    squad=victim.id;
  }
  game.expansion!.battle.fire({id:999,playerId:1,x:45.5*FIXED,y:30.5*FIXED,domain:'ship'},
    {x:45.5*FIXED,y:30.5*FIXED},{...BOMBER_ATTACK,bonuses:{},projectile:{...BOMBER_ATTACK.projectile!,blastRadius:7*FIXED}},
    damage,'shell',1,0,'test-shell');
  game.tick++;
  game.expansion!.battle.advanceProjectiles();
  return {game,health:[0,1,2,3,4,5].flatMap(d=>ships.get(d)!.map(id=>game.ship(id)?.health??0)),squad};
}

/** Two identical fighters over the same patrol point, created in either owner order. */
function fighterDuel(firstOwner:1|2){
  const data=new Uint8Array(100*80).fill(133);
  const game=new Skirmish(new GameMapImpl(100,80,data,data.length),{seed:47,aiCount:1,tribes:false,runAi:false,ruleset:'ages-v1'});
  const expansion=game.expansion!;
  const field=(x:number,playerId:number)=>{
    const b=game.addBuilding({id:game.allocateId(),playerId,type:'airstrip',age:'EarlyModern',tile:20*100+x,health:5000,maxHealth:5000,remainingTicks:0});
    game.owners[b.tile]=playerId;return b;
  };
  const fields={1:field(10,1),2:field(80,2)};
  // Both builds use the same two ids (patrol orbits are phased by id); only
  // which owner's fighter comes first in the aircraft list changes.
  const ids=Array.from({length:3},()=>game.allocateId());
  const make=(playerId:1|2,id:number)=>{
    const a:(typeof expansion.aircraft)[number]={id,playerId,definitionId:'fighter',age:'EarlyModern',airfieldId:fields[playerId].id,
      x:50*FIXED,y:50*FIXED,health:1000,state:'patrolling',target:{x:50*FIXED,y:50*FIXED},reloadTick:0,fuelTicks:2000};
    expansion.aircraft.push(a);return a;
  };
  const planes=firstOwner===1?[make(1,ids[0]),make(2,ids[1])]:[make(2,ids[0]),make(1,ids[1])];
  const trace:string[]=[];
  for(let i=0;i<200&&planes.some(a=>a.health>0);i++){
    game.step();
    const byOwner=[1,2].map(owner=>planes.find(a=>a.playerId===owner)!.health);
    trace.push(`${game.tick}:${byOwner.join('/')}`);
    if(byOwner.some(h=>h<=0))break;
  }
  return {health:[1,2].map(owner=>planes.find(a=>a.playerId===owner)!.health),trace};
}

// C2: staged per-tick effects. Creation order (ids) must not decide a fight.
describe('combat effect ledger (C2)', () => {
  for(const [rider,foot] of [['bronzeage-cavalry','bronzeage-infantry'],['earlymedieval-heavycavalry','earlymedieval-infantry']] as const)
    it(`gives the same charge duel whichever combatant has the lower id: ${rider}`, () => {
      const a=duelTrace(cavalryDuel(rider,foot));
      const b=duelTrace(cavalryDuel(rider,foot,{defenderFirst:true}));
      expect(a.first).toBeGreaterThan(0);
      expect(a.footLoss.length).toBeGreaterThan(0);
      expect(a.riderLoss.length).toBeGreaterThan(0);
      expect(b.first).toBe(a.first);
      expect(b.footLoss).toEqual(a.footLoss);
      expect(b.riderLoss).toEqual(a.riderLoss);
    }, 60_000);
  it('spends a shared splash budget on the bodies nearest the impact first, whatever their ids', () => {
    const near=splashScene(true,1500),far=splashScene(false,1500);
    expect(far.health).toEqual(near.health);
    // The budget runs out: the centre hull is hit, the outermost is not.
    expect(near.health[0]).toBeLessThan(8000);
    expect(near.health[near.health.length-1]).toBe(8000);
    for(let i=1;i<near.health.length;i++)expect(near.health[i]).toBeGreaterThanOrEqual(near.health[i-1]);
  });
  it('serves nearer warships before a farther, lower-id ground body', () => {
    const scene=splashScene(false,1500,true);
    expect(scene.squad).toBeLessThan(scene.game.ships[0].id);
    expect(scene.health).toEqual(splashScene(false,1500).health);
  });
  it('resolves a mirrored fighter duel symmetrically whichever owner was created first', () => {
    const a=fighterDuel(1),b=fighterDuel(2);
    expect(a.trace.length).toBeGreaterThan(1);
    // Identical fighters trade identical hits on the same ticks.
    expect(a.health[0]).toBe(a.health[1]);
    expect(b.health[0]).toBe(b.health[1]);
    expect(b.trace).toEqual(a.trace);
  });
});
