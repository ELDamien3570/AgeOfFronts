import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { FIXED, secondsToTicks } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function launch(payload: "icbm" | "hydrogen" | "mirv", width: number, targetX = width - 0.5) {
  const terrain = new Uint8Array(width * 80).fill(133);
  const game = new Skirmish(new GameMapImpl(width, 80, terrain, terrain.length), {
    seed: 47, aiCount: 1, tribes: false, runAi: false,
    ruleset: "ages-v1", startingAge: "Modern",
  });
  const expansion = game.expansion!;
  expansion.progression.states[1].completed = TECHNOLOGIES.map(t => t.id);
  expansion.supply.inventories[1][`payload:${payload}`] = 1;
  game.player(1)!.gold = 1e6;
  const silo = game.addBuilding({
    id: game.allocateId(), playerId: 1,
    type: payload === "mirv" ? "mirv-launcher" : "missile-silo",
    tile: game.map.ref(0, 40), age: "Modern", remainingTicks: 0,
    health: 6000, maxHealth: 6000,
  });
  game.tick = 17;
  expect(game.applyCommand({
    type: "launch", playerId: 1, launcherId: silo.id, payload,
    x: targetX * FIXED, y: 40.5 * FIXED,
  })).toBeNull();
  const advance = (tick: number) => {
    game.tick = tick;
    expansion.battle.advanceProjectiles();
  };
  return { game, battle: expansion.battle, projectile: expansion.battle.projectiles[0], advance };
}

describe("distance-based strategic flight", () => {
  for (const payload of ["icbm", "hydrogen", "mirv"] as const) {
    it.each([[1000, 45], [500, 22.5], [250, 11.25]])(
      `${payload} crosses a %i-tile edge in %s seconds from launch to impact`,
      (width, seconds) => {
        const { battle, projectile, advance } = launch(payload, width);
        // Launch/target tile centers are one tile closer than the map's full edge.
        expect(projectile.impactTick - projectile.tick).toBe(secondsToTicks(seconds));
        if (payload === "mirv") {
          const separationTick = projectile.tick + Math.ceil((projectile.impactTick - projectile.tick) / 2);
          advance(separationTick - 1);
          expect(projectile.impacted).toBe(false);
          advance(separationTick);
          expect(projectile.impacted).toBe(true);
          const warheads = battle.projectiles.filter(p => p.kind === "warhead");
          expect(warheads).toHaveLength(8);
          expect(warheads.every(p => p.impactTick === projectile.impactTick)).toBe(true);
        }
        advance(projectile.impactTick - 1);
        expect(battle.projectiles.filter(p => !p.impacted)).toHaveLength(payload === "mirv" ? 8 : 1);
        advance(projectile.impactTick);
        expect(battle.projectiles.every(p => p.impacted)).toBe(true);
      },
    );
  }

  it("uses actual travel distance within a map and rounds up to a tick", () => {
    const { projectile } = launch("icbm", 1000, 100.5);
    expect(projectile.impactTick - projectile.tick).toBe(secondsToTicks(4.5));
    const nearby = launch("hydrogen", 1000, 1.5).projectile;
    expect(nearby.impactTick - nearby.tick).toBe(1);
  });

  it("preserves the MIRV impact deadline when separation rounds to the next tick", () => {
    const { battle, projectile, advance } = launch("mirv", 1000, 101.5);
    expect(projectile.impactTick - projectile.tick).toBe(37);
    advance(projectile.tick + 19);
    const warheads = battle.projectiles.filter(p => p.kind === "warhead");
    expect(warheads).toHaveLength(8);
    expect(warheads.every(p => p.impactTick === projectile.impactTick)).toBe(true);
  });

  it("still allows missile defense to intercept at the new flight speed", () => {
    const { game, battle, projectile, advance } = launch("hydrogen", 1000);
    game.addBuilding({
      id: game.allocateId(), playerId: 2, type: "missile-defence",
      tile: game.map.ref(999, 40), age: "Modern", remainingTicks: 0,
      health: 6000, maxHealth: 6000,
    });
    for (let tick = projectile.tick + 1; tick <= projectile.impactTick; tick++) advance(tick);
    expect(battle.projectiles[0].interception).toBeDefined();
    expect(projectile.impacted).toBe(true);
    expect(projectile.damage).toBe(0);
  });
});
