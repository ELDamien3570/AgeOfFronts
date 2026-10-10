import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { defaultUnit } from "../../src/skirmish/content/Units";
import type { AttackProfile } from "../../src/skirmish/domain/Definitions";
import {
  boxSweepEntry,
  circleSweepEntry,
} from "../../src/skirmish/domain/ProjectileCollision";

function match() {
  const data = new Uint8Array(64 * 32).fill(133);
  const m = new Skirmish(new GameMapImpl(64, 32, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  for (const s of m.squads) {
    m.updateSquad(s.id, { x: 55 * FIXED });
    m.updateSquad(s.id, { y: (s.playerId === 1 ? 2 : 28) * FIXED });
    m.updateSquad(s.id, { order: { type: "hold" } });
  }
  const source = m.squads.find((s) => s.playerId === 1)!;
  m.updateSquad(source.id, { x: 5 * FIXED });
  m.updateSquad(source.id, { y: 15 * FIXED });
  return {
    m,
    source,
    enemies: m.squads.filter((s) => s.playerId === 2),
    battle: m.expansion!.battle,
  };
}
const profile: AttackProfile = {
  ...defaultUnit("archer").attack,
  damage: 100,
  bonuses: {},
  projectile: { diameter: FIXED / 4, speed: FIXED * 30, blastRadius: 0 },
};

describe("swept projectile contacts", () => {
  it("finds entry rather than the nearest centre, including overlaps and tangencies", () => {
    expect(
      boxSweepEntry({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 }, 1, 1),
    ).toBeCloseTo((5 - Math.SQRT1_2) / 10);
    expect(
      boxSweepEntry(
        { x: 4.1, y: 4.1 },
        { x: 4.1, y: 4.1 },
        { x: 5, y: 5 },
        1,
        1,
      ),
    ).toBeNull();
    expect(
      circleSweepEntry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 7, y: 0 }, 2),
    ).toBe(0.5);
    expect(
      circleSweepEntry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 2 }, 2),
    ).toBe(0.5);
    expect(
      circleSweepEntry({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 2),
    ).toBe(0);
    expect(
      circleSweepEntry({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, 2),
    ).toBeNull();
    expect(
      circleSweepEntry({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 7, y: 0 }, 2),
    ).toBeNull();
    expect(
      boxSweepEntry(
        { x: 0, y: 0.9 },
        { x: 10, y: 0.9 },
        { x: 5, y: 1 },
        1,
        0.2,
      ),
    ).toBeCloseTo(0.48);
    expect(
      boxSweepEntry({ x: 0, y: 0.9 }, { x: 10, y: 0.9 }, { x: 5, y: 1 }, 1),
    ).toBeNull();
  });
  it("hits only the first eligible formation, once, without an artificial blast", () => {
    const { m, source, enemies, battle } = match();
    m.updateSquad(enemies[0].id, { x: 10 * FIXED });
    m.updateSquad(enemies[0].id, { y: source.y });
    m.updateSquad(enemies[1].id, { x: 10.8 * FIXED });
    m.updateSquad(enemies[1].id, { y: source.y });
    battle.fire(source, { x: 30 * FIXED, y: source.y }, profile, 100);
    m.tick++;
    battle.advanceProjectiles();
    expect(enemies[0].troops).toBeLessThan(1000);
    expect(enemies[1].troops).toBe(1000);
    expect(source.xp).toBe(1000 - enemies[0].troops);
    const health = enemies[0].troops,
      xp = source.xp;
    m.tick++;
    battle.advanceProjectiles();
    expect(enemies[0].troops).toBe(health);
    expect(source.xp).toBe(xp);
  });
  it("does not intercept a shot with an ineligible type or grant XP for a miss", () => {
    const { m, source, enemies, battle } = match();
    m.updateSquad(enemies[0].id, { kind: "infantry" });
    m.updateSquad(enemies[0].id, { definitionId: defaultUnit("infantry").id });
    m.updateSquad(enemies[0].id, { x: 10 * FIXED });
    m.updateSquad(enemies[0].id, { y: source.y });
    m.updateSquad(enemies[1].id, { kind: "archer" });
    m.updateSquad(enemies[1].id, { definitionId: defaultUnit("archer").id });
    m.updateSquad(enemies[1].id, { x: 15 * FIXED });
    m.updateSquad(enemies[1].id, { y: source.y });
    battle.fire(
      source,
      { x: 30 * FIXED, y: source.y },
      { ...profile, targets: ["ranged"] },
      100,
    );
    m.tick++;
    battle.advanceProjectiles();
    expect(enemies[0].troops).toBe(1000);
    expect(enemies[1].troops).toBeLessThan(1000);
    const xp = source.xp;
    battle.fire(source, { x: 30 * FIXED, y: 20 * FIXED }, profile, 100);
    m.tick++;
    battle.advanceProjectiles();
    expect(source.xp).toBe(xp);
  });
  it("preserves building source identity through a MIRV split and awards no squad XP", () => {
    const { m, source, enemies, battle } = match();
    // Isolate the ground target from automatically selected starting cities.
    for (const b of m.buildings.slice()) m.removeBuilding(b.id);
    m.updateSquad(enemies[0].id, { x: 20 * FIXED });
    m.updateSquad(enemies[0].id, { y: 15 * FIXED });
    battle.fire(
      { ...source, domain: "building" },
      { x: 20 * FIXED, y: 15 * FIXED },
      {
        ...profile,
        projectile: { ...profile.projectile!, blastRadius: 4 * FIXED },
      },
      100,
      "mirv",
      2,
      4,
    );
    m.tick++;
    battle.advanceProjectiles();
    const children = battle.projectiles.filter((p) => p.kind === "warhead");
    expect(children).toHaveLength(4);
    expect(children.every((p) => p.sourceKind === "building")).toBe(true);
    expect(children.reduce((n, p) => n + p.damage, 0)).toBe(100);
    m.tick++;
    battle.advanceProjectiles();
    expect(enemies[0].troops).toBeLessThan(1000);
    expect(source.xp ?? 0).toBe(0);
  });
  it("blocks a grazing projectile on a neighbouring wall tile", () => {
    const { m, source, enemies, battle } = match();
    const forts = m.expansion!.fortifications;
    const tile = m.map.ref(10, 15);
    forts.addBarrier({
      id: 900,
      playerId: 2,
      age: "StoneAge",
      a: 800,
      b: 801,
      tiles: [tile],
      health: 2000,
      maxHealth: 2000,
      remainingTicks: 0,
    });
    // Completed live towers keep the linked barrier active during indexing.
    for (const [id, x] of [
      [800, 10],
      [801, 12],
    ])
      m.addBuilding({
        id,
        type: "tower",
        tile: m.map.ref(x, 18),
        playerId: 2,
        age: "StoneAge",
        remainingTicks: 0,
        health: 2000,
        maxHealth: 2000,
      });
    forts.step(1, m.buildings);
    m.updateSquad(source.id, { y: 14.9 * FIXED });
    m.updateSquad(enemies[0].id, { x: 20 * FIXED });
    m.updateSquad(enemies[0].id, { y: source.y });
    battle.fire(source, { x: 30 * FIXED, y: source.y }, profile, 100);
    m.tick++;
    battle.advanceProjectiles();
    expect(enemies[0].troops).toBe(1000);
    expect(battle.projectiles[0].impacted).toBe(true);
    expect(battle.projectiles[0].x).toBeLessThan(10 * FIXED);
    const wall = forts.barriers[0],
      firstLoss = 2000 - wall.health;
    expect(firstLoss).toBeGreaterThan(0);
    m.expansion!.diplomacy.state.betrayal[2] = 600;
    const before = wall.health;
    battle.fire(source, { x: 30 * FIXED, y: source.y }, profile, 100);
    m.tick++;
    battle.advanceProjectiles();
    expect(before - wall.health).toBe(firstLoss * 2);
  });
  it("damages an eligible structure at contact without granting building-shot XP to a squad", () => {
    const { m, source, battle } = match();
    const b = m.addBuilding({
      id: m.allocateId(),
      type: "city" as const,
      tile: m.map.ref(15, 15),
      playerId: 2,
      remainingTicks: 0,
      health: 2000,
      maxHealth: 2000,
    });

    m.updateSquad(source.id, { y: 15.5 * FIXED });
    battle.fire(
      { ...source, domain: "building" },
      { x: 30 * FIXED, y: source.y },
      { ...profile, targets: ["structure"] },
      100,
    );
    m.tick++;
    battle.advanceProjectiles();
    expect(b.health).toBeLessThan(2000);
    expect(source.xp ?? 0).toBe(0);
    const health = b.health;
    m.tick++;
    battle.advanceProjectiles();
    expect(b.health).toBe(health);
  });
});
