import { describe, expect, it } from 'vitest';
import { GameMapImpl } from '../../src/core/game/GameMap';
import { UNIT, UNITS } from '../../src/skirmish/content/Units';
import { damageAmount, defenceOf } from '../../src/skirmish/domain/Combat';
import { formationApproach } from '../../src/skirmish/domain/FormationContact';
import { createFormation, TURN } from '../../src/skirmish/domain/FormationGeometry';
import { createManpower, remainingHealth } from '../../src/skirmish/domain/Manpower';
import { weaponAccuracy } from '../../src/skirmish/domain/WeaponAccuracy';
import { FIXED, TICKS_PER_SECOND } from '../../src/skirmish/Protocol';
import { Skirmish } from '../../src/skirmish/Simulation';
import { SnapshotDecoder, SnapshotEncoder } from '../../src/skirmish/SnapshotCodec';

/** Controlled frontal combat: no charge, cover, promotion or approach time.
 * Keep contact as bodies shrink, using the real battle/strike/projectile paths. */
function engagement(aId: string, bId: string, count: number) {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
    seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: 'ages-v1',
  });
  const ids = [game.squads.find(s => s.playerId === 1)!.id, game.squads.find(s => s.playerId === 2)!.id];
  for (const s of [...game.squads]) if (!ids.includes(s.id)) game.removeSquad(s.id);
  for (let i = 0; i < 2; i++) {
    const id = [aId, bId][i], unit = UNIT.get(id)!;
    game.updateSquad(ids[i], {
      definitionId: id, kind: unit.line, troops: count,
      manpower: { ...createManpower(unit), capacity: count },
      formation: { ...createFormation(id), shape: 'mass', facing: i ? TURN / 2 : 0, layoutTroops: count },
      x: 24 * FIXED, y: (i ? 28 : 24) * FIXED, order: { type: 'hold' }, moved: false, xp: 0,
    });
  }
  const victim = structuredClone(game.squad(ids[1])!);
  function run() {
    const started = game.tick;
    for (; game.tick - started < 180 * TICKS_PER_SECOND && ids.every(id => !!game.squad(id)); game.tick++) {
      const a = game.squad(ids[0])!, b = game.squad(ids[1])!;
      game.updateSquad(a.id, formationApproach(a, b, game.tick, count === 1 ? 0 : FIXED / 2));
      game.updateSquad(a.id, { xp: 0 }); game.updateSquad(b.id, { xp: 0 });
      game.expansion!.battle.fight([]);
      game.expansion!.battle.advanceProjectiles();
    }
    return {
      seconds: (game.tick - started) / TICKS_PER_SECOND,
      survivors: ids.map(id => game.squad(id)?.troops ?? 0),
      hp: ids.map(id => game.squad(id) ? remainingHealth(game.squad(id)!) / 1000 : 0),
    };
  }
  return { game, ids, run, nextVictim() { game.addSquad({ ...structuredClone(victim), id: ids[1] }); } };
}

describe('agreed pre-modern balance contract', () => {
  it('retains the pikeman pace and uses the approved faster Boyar battles', () => {
    const pikes = engagement('earlymodern-anticavalry', 'earlymodern-anticavalry', 81).run();
    expect(pikes.seconds).toBeGreaterThanOrEqual(55);
    expect(pikes.seconds).toBeLessThanOrEqual(65);
    const guards = engagement('latemedieval-infantry', 'latemedieval-infantry', 40).run();
    expect(guards.seconds).toBeGreaterThanOrEqual(14);
    expect(guards.seconds).toBeLessThanOrEqual(18);
  });
  it('lets melee infantry survive three consecutive spearmen without healing', () => {
    const f = engagement('bronzeage-infantry', 'bronzeage-anticavalry', 1);
    for (let i = 0; i < 3; i++) {
      const result = f.run();
      expect(result.survivors).toEqual([1, 0]);
      if (i < 2) f.nextVictim();
    }
    expect(remainingHealth(f.game.squad(f.ids[0])!)).toBeGreaterThan(0);
  });
  it('calibrates the Bronze Age fights starting in melee range', () => {
    const axes = engagement('bronzeage-infantry', 'bronzeage-archer', 60).run();
    expect(axes.survivors[1]).toBe(0);
    expect(axes.survivors[0]).toBeGreaterThanOrEqual(27);
    expect(axes.survivors[0]).toBeLessThanOrEqual(33);
    const spears = engagement('bronzeage-anticavalry', 'bronzeage-archer', 60).run();
    expect(spears.survivors[1]).toBe(0);
    expect(spears.survivors[0]).toBeGreaterThanOrEqual(15);
    expect(spears.survivors[0]).toBeLessThanOrEqual(22);
  });
  it.each([
    ['bronzeage-anticavalry', 'bronzeage-cavalry'],
    ['classicalage-anticavalry', 'classicalage-cavalry'],
    ['earlymedieval-anticavalry', 'earlymedieval-cavalry'],
    ['latemedieval-anticavalry', 'latemedieval-cavalry'],
    ['earlymodern-anticavalry', 'napoleonic-cavalry'],
  ])('lets %s beat contemporary light cavalry with about 30 percent HP', (spear, cavalry) => {
    const r = engagement(spear, cavalry, 1).run();
    expect(r.survivors).toEqual([1, 0]);
    expect(r.hp[0]).toBeGreaterThanOrEqual(20);
    expect(r.hp[0]).toBeLessThanOrEqual(40);
  });
  it.each([
    ['earlymedieval-anticavalry', 'earlymedieval-heavycavalry'],
    ['latemedieval-anticavalry', 'latemedieval-heavycavalry'],
    ['earlymodern-anticavalry', 'earlymodern-heavycavalry'],
  ])('lets contemporary heavy cavalry defeat %s with about half HP', (spear, cavalry) => {
    const r = engagement(spear, cavalry, 1).run(), hp = UNIT.get(cavalry)!.formationRecipe!.soldierHp;
    expect(r.survivors).toEqual([0, 1]);
    expect(r.hp[1] / hp).toBeGreaterThanOrEqual(.4);
    expect(r.hp[1] / hp).toBeLessThanOrEqual(.6);
  });
  it('gives caught ranged-only troops no melee or singleton contact fire', () => {
    for (const id of ['bronzeage-archer', 'classicalage-rangedcavalry', 'napoleonic-archer']) {
      expect(UNIT.get(id)!.meleeAttack).toBeUndefined();
      const f = engagement('bronzeage-infantry', id, 1);
      f.run();
      expect(f.game.squad(f.ids[0])!.manpower!.wounds).toBe(0);
    }
    expect(UNIT.get('napoleonic-infantry')!.meleeAttack).toBeDefined();
  });
  it('uses authored ranges, movement relationships and ATGM counts', () => {
    for (const [age, range] of [['bronzeage', 6], ['classicalage', 7], ['earlymedieval', 8], ['latemedieval', 9]] as const) {
      const bow = UNIT.get(`${age}-archer`)!, spear = UNIT.get(`${age}-anticavalry`)!;
      expect(bow.rangedAttack!.range).toBe(range * FIXED);
      expect(bow.speedPercent).toBeGreaterThan(spear.speedPercent!);
    }
    expect(UNIT.get('napoleonic-infantry')!.rangedAttack!.range).toBe(10 * FIXED);
    expect(UNIT.get('napoleonic-archer')!.rangedAttack!.range).toBe(11 * FIXED);
    expect(UNIT.get('present-day-anticavalry')!.formationRecipe).toMatchObject({ capacity: 1, enlargedCapacity: 2 });
  });
  it('makes artillery vulnerable in melee and rams/towers unable to damage soldiers', () => {
    for (const unit of UNITS.filter(u => !['EarlyModern', 'Modern'].includes(u.age) && u.formationRecipe!.model === 'hull')) {
      if (unit.attack.channel === 'melee') {
        expect(damageAmount(unit.attack, defenceOf(UNIT.get('bronzeage-infantry')!))).toBe(0);
        expect(unit.attack.targets).toEqual(['structure', 'wall']);
      } else expect(unit.meleeArmour).toBeLessThanOrEqual(3);
    }
    const cannon = UNIT.get('napoleonic-field-support')!, howitzer = UNIT.get('napoleonic-siege')!;
    expect(cannon.attack.range).toBeGreaterThan(howitzer.attack.range);
    expect(cannon.attack.damage).toBeLessThan(howitzer.attack.damage);
  });
  it('increases Napoleonic firearm accuracy toward contact, without changing other weapons', () => {
    const musket = UNIT.get('napoleonic-archer')!.rangedAttack!;
    expect(weaponAccuracy(musket, 0)).toBe(.9);
    expect(weaponAccuracy(musket, musket.range)).toBe(.35);
    expect(weaponAccuracy(musket, musket.range / 2)).toBe(.625);
    expect(weaponAccuracy(UNIT.get('modern-infantry')!.rangedAttack!, 100 * FIXED)).toBe(1);
  });
  it('commits accuracy into projectile strength and retains it in packed snapshots', () => {
    const f = engagement('napoleonic-archer', 'bronzeage-infantry', 12);
    const source = f.game.squad(f.ids[0])!, target = f.game.squad(f.ids[1])!;
    const profile = { ...UNIT.get('napoleonic-archer')!.rangedAttack!, projectile: { diameter: 10, speed: 10, blastRadius: 0 } };
    f.game.expansion!.battle.fire({ ...source, attackScale: 12 }, target, profile, profile.damage);
    const projectile = f.game.expansion!.battle.projectiles[0];
    const distance = Math.hypot(projectile.toX - projectile.fromX, projectile.toY - projectile.fromY);
    expect(projectile.attackScale).toBeCloseTo(12 * weaponAccuracy(profile, distance));
    const decoded = new SnapshotDecoder().decode(new SnapshotEncoder().encode(f.game.snapshot()));
    expect(decoded.expansion!.projectiles[0].attackScale).toBeCloseTo(projectile.attackScale!);
  });
  it('applies the distance curve to live direct musket damage', () => {
    const losses = [4, 10].map(distance => {
      const f = engagement('napoleonic-archer', 'bronzeage-anticavalry', 12);
      const source = f.game.squad(f.ids[0])!, target = f.game.squad(f.ids[1])!;
      f.game.updateSquad(target.id, { y: source.y + distance * FIXED });
      const before = remainingHealth(target);
      f.game.expansion!.battle.fight([]);
      return before - remainingHealth(f.game.squad(target.id)!);
    });
    expect(losses[0]).toBeGreaterThan(losses[1]);
    expect(losses[1]).toBeGreaterThan(0);
  });
});
