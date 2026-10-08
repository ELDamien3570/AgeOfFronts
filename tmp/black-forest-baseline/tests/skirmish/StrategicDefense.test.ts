import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { missileDefenseRange } from "../../src/skirmish/content/MissileDefense";
import { defaultUnit } from "../../src/skirmish/content/Units";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fixture(stack = 0) {
  const terrain = new Uint8Array(300 * 160).fill(133),
    game = new Skirmish(new GameMapImpl(300, 160, terrain, terrain.length), {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
  const defense = Array.from({ length: stack }, () =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type: "missile-defence",
      tile: game.map.ref(150, 80),
      age: "Modern",
      remainingTicks: 0,
      health: 6000,
      maxHealth: 6000,
    }),
  );
  const fire = (kind: "icbm" | "mirv" = "icbm", x = 150.5, duration=720) =>
    game.expansion!.battle.fire(
      {
        id: 999,
        playerId: 1,
        x: 250.5 * FIXED,
        y: 80.5 * FIXED,
        domain: "building",
      },
      { x: x * FIXED, y: 80.5 * FIXED },
      {
        ...defaultUnit("infantry").attack,
        projectile: { diameter: FIXED, speed: FIXED, blastRadius: 28 * FIXED },
      },
      40000,
      kind,
      duration,
      kind === "mirv" ? 8 : 0,
      "hydrogen",
    );
  const advance = (tick: number) => {
    game.tick = tick;
    game.expansion!.battle.advanceProjectiles();
  };
  return { game, defense, fire, advance, battle: game.expansion!.battle };
}
describe("strategic defense and nuclear damage", () => {
  it("crosses the H-bomb radius at five stacks and plateaus at ten", () => {
    expect(missileDefenseRange(4)).toBeLessThan(28 * FIXED);
    expect(missileDefenseRange(5)).toBeGreaterThan(28 * FIXED);
    expect(missileDefenseRange(10)).toBe(72 * FIXED);
    expect(missileDefenseRange(15)).toBe(missileDefenseRange(10));
  });
  it("intercepts ten warheads with ten independently reloading launchers; the eleventh penetrates", () => {
    const f = fixture(10);
    for (let i = 0; i < 11; i++) f.fire("icbm",150.5,100);
    f.advance(29);
    const intercepted = f.battle.projectiles.filter((p) => p.interception);
    expect(intercepted).toHaveLength(10);
    expect(
      new Set(intercepted.map((p) => p.interception!.defenseId)).size,
    ).toBe(10);
    expect(
      f.defense.every((b) => f.game.building(b.id)!.nextAttackTick === 429),
    ).toBe(true);
    for (let tick = 30; tick <= 100; tick++) f.advance(tick);
    expect(f.defense.every((b) => f.game.building(b.id)!.health === 0)).toBe(
      true,
    );
  });
  it("preserves a launched interceptor after its launcher is destroyed",()=>{
    const f=fixture(1);f.fire();f.advance(650);
    const p=f.battle.projectiles[0];expect(p.interception).toBeDefined();
    f.game.removeBuilding(f.defense[0].id);f.advance(p.interception!.impactTick);
    expect(p.impacted).toBe(true);expect(p.damage).toBe(0);expect(f.game.wasteland.size).toBe(0);
  });
  it("does not reserve two rockets from overlapping defense sites for one warhead", () => {
    const f = fixture(2);
    f.fire();
    f.advance(600);
    expect(
      f.defense.filter(
        (b) => f.game.building(b.id)!.nextAttackTick !== undefined,
      ),
    ).toHaveLength(1);
    const p = f.battle.projectiles[0];
    f.advance(p.interception!.impactTick);
    expect(p.impacted).toBe(true);
    expect(p.damage).toBe(0);
    expect(f.defense.every((b) => f.game.building(b.id)!.health === 6000)).toBe(
      true,
    );
  });
  it("allows small-stack edge bombing, but a five-stack intercepts that same H-bomb", () => {
    const small = fixture(1);
    small.fire("icbm", 170.5);
    small.advance(1);
    expect(small.battle.projectiles[0].interception).toBeUndefined();
    small.advance(720);
    expect(small.game.building(small.defense[0].id)!.health).toBe(0);
    const large = fixture(5);
    large.fire("icbm", 170.5);
    large.advance(700);
    const p = large.battle.projectiles[0];
    expect(p.interception).toBeDefined();
    large.advance(p.interception!.impactTick);
    expect(p.damage).toBe(0);
    expect(large.game.building(large.defense[0].id)!.health).toBe(6000);
  });
  it("reserves only individual MIRV warheads and preserves in-flight claims through restore and publication", () => {
    const f = fixture(8);
    f.fire("mirv");
    f.advance(1);
    expect(f.battle.projectiles[0].interception).toBeUndefined();
    f.advance(360);
    f.advance(600);
    const heads = f.battle.projectiles.filter((p) => p.kind === "warhead");
    expect(heads).toHaveLength(8);
    expect(heads.every((p) => p.interception)).toBe(true);
    const saved = f.game.checkpoint();
    f.game.restore(saved);
    const snapshot = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(f.game.snapshot()),
    );
    expect(
      snapshot
        .expansion!.projectiles.filter((p) => p.kind === "warhead")
        .map((p) => p.interception),
    ).toEqual(heads.map((p) => p.interception));
    const impact = Math.max(...heads.map((p) => p.interception!.impactTick));
    f.advance(impact);
    expect(
      f.battle.projectiles
        .filter((p) => p.kind === "warhead")
        .every((p) => p.damage === 0),
    ).toBe(true);
  });
  it("nuclear splash cannot exhaust its damage on 64 troops and leave buildings intact", () => {
    const f = fixture(),
      template = f.game.squads.find((s) => s.playerId === 2)!;
    for (let i = 0; i < 100; i++)
      f.game.addSquad({
        ...structuredClone(template),
        id: f.game.allocateId(),
        x: 150.5 * FIXED,
        y: 80.5 * FIXED,
        troops: 1000,
      });
    const center = f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: 2,
      type: "city",
      tile: f.game.map.ref(150, 80),
      remainingTicks: 0,
      health: 100000,
      maxHealth: 100000,
    });
    const edge = f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: 2,
      type: "factory",
      tile: f.game.map.ref(178, 80),
      remainingTicks: 0,
      health: 100000,
      maxHealth: 100000,
    });
    f.fire();
    f.advance(720);
    expect(
      f.game.squads.filter((s) => s.playerId === 2 && s.x === 150.5 * FIXED),
    ).toHaveLength(0);
    expect(f.game.building(center.id)!.health).toBe(0);
    expect(f.game.building(edge.id)!.health).toBe(10000);
  });
});
