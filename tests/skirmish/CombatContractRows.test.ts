import { describe, expect, it } from 'vitest';
import { combatRow, firstLoss } from './fixtures/CombatRows';
import { UNIT } from '../../src/skirmish/content/Units';
import { FIXED, TICKS_PER_SECOND } from '../../src/skirmish/Protocol';
import { BOMBER_ATTACK } from '../../src/skirmish/content/ModernWeapons';
import { directHitBodies, soldierHitCap } from '../../src/skirmish/domain/SoldierHitCap';
import { createManpower } from '../../src/skirmish/domain/Manpower';

// C3 contract rows (review-notes/05 issues 1 and 7, recommendations 1 and 7),
// measured through real Skirmish.step() with catalog units on hold.
describe('Napoleonic volley contract (C3)', () => {
  const line={id:'napoleonic-infantry',shape:'line' as const};
  it('kills 15-20 percent of an equal 48-soldier line with a full-range volley', () => {
    const {game,target}=combatRow(line,line,10);
    const volley=firstLoss(game,target);
    expect(volley.fraction).toBeGreaterThanOrEqual(.15);
    expect(volley.fraction).toBeLessThanOrEqual(.20);
  });
  it('kills about 45 percent at close range, and never a whole line in one volley', () => {
    for(const d of [2,3]){
      const {game,target}=combatRow(line,line,d);
      const volley=firstLoss(game,target);
      expect(volley.fraction).toBeGreaterThanOrEqual(.35);
      expect(volley.fraction).toBeLessThanOrEqual(.5);
    }
  });
});

describe('Modern lethality contract (C3)', () => {
  it('lets one machine-gun burst kill at most 4 riflemen', () => {
    const {game,target}=combatRow({id:'modern-field-support'},{id:'modern-infantry'},6);
    const before=game.squad(target)!.troops;
    const burst=firstLoss(game,target);
    expect(burst.fraction).toBeGreaterThan(0);
    expect(before-burst.troops).toBeGreaterThan(0);
    expect(before-burst.troops).toBeLessThanOrEqual(4);
  });
  it('lets two ATGM teams kill a T-14 within 40 s', () => {
    const {game,target}=combatRow({id:'present-day-anticavalry',count:2},{id:'present-day-heavycavalry'},14);
    let t=0;
    for(;t<40*TICKS_PER_SECOND&&game.squad(target);t++)game.step();
    expect(game.squad(target)).toBeUndefined();
  });
});

describe('non-per-soldier hit cap (C3, OD3)', () => {
  it('limits a direct hit to one frontage of soldier bodies and leaves hulls uncapped', () => {
    const rifles=UNIT.get('modern-infantry')!,line=UNIT.get('napoleonic-infantry')!,tank=UNIT.get('present-day-heavycavalry')!;
    const squad=(u:typeof rifles)=>({troops:u.formationRecipe!.capacity,manpower:createManpower(u),afloat:undefined});
    expect(directHitBodies(squad(rifles))).toBe(3);
    expect(soldierHitCap(squad(rifles),directHitBodies(squad(rifles)))).toBe(300);
    expect(directHitBodies(squad(line))).toBe(7);
    expect(soldierHitCap(squad(tank),1)).toBe(Infinity);
  });
  it('lets an overwhelming shell kill only the soldiers inside its blast', () => {
    const {game,shooters,target}=combatRow({id:'modern-siege'},{id:'napoleonic-infantry',shape:'line'},12);
    const source=game.squad(shooters[0])!,line=game.squad(target)!,before=line.troops;
    // Far more damage than the whole line holds, in a 0.6-tile blast.
    game.expansion!.battle.fire({id:source.id,playerId:1,x:source.x,y:source.y},{x:line.x,y:line.y},
      {...BOMBER_ATTACK,bonuses:{},projectile:{...BOMBER_ATTACK.projectile!,blastRadius:.6*FIXED}},100000,'shell',1,0,'test-shell');
    game.tick++;
    game.expansion!.battle.advanceProjectiles();
    const after=game.squad(target)?.troops??0;
    expect(after).toBeLessThan(before);
    expect(before-after).toBeLessThanOrEqual(8);
  });
});
