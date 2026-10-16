import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, secondsToTicks, type Ship, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import type { SpatialGrid } from "../../src/skirmish/SpatialGrid";

/** An AI ready to raid an enemy whose only squads are embarked, with no
 * conquest buildings left: every raider's last-squad search misses. */
function fixture() {
  const width = 200, height = 120, terrain = new Uint8Array(width * height).fill(133);
  for (let y = 110; y < height; y++) terrain.fill(0, y * width, (y + 1) * width);
  const game = new Skirmish(new GameMapImpl(width, height, terrain, terrain.filter(v => v & 128).length), {
    seed: 42, aiCount: 1, tribes: false, runAi: true,
  });
  const ai = game.players.find(p => p.ai)!, enemy = game.players.find(p => !p.ai)!;
  for (const b of game.buildings.filter(b => b.playerId === enemy.id)) game.removeBuilding(b.id);
  const ship: Ship = game.addShip({ id: game.allocateId(), playerId: enemy.id, kind: "warship", x: 100 * FIXED, y: 115 * FIXED,
    health: 1000, destination: null, waypoints: [], path: [], nextPathIndex: 0, fighting: false });
  for (const s of game.squads.filter(s => s.playerId === enemy.id)) game.updateSquad(s.id, { embarkedOn: ship.id });
  // Let the AI settle its home land first; raids wait for it.
  for (let i = 0; i < secondsToTicks(100); i++) game.step();
  const template = game.squads.find(s => s.playerId === ai.id)!;
  const bx = game.map.x(ai.base), by = game.map.y(ai.base);
  for (let i = 0; i < 40; i++)
    game.addSquad({ ...template, id: game.allocateId(), x: (bx - 6 + (i % 8) * 1.5) * FIXED, y: (by - 4 + Math.floor(i / 8) * 1.5) * FIXED,
      order: { type: "hold" } as Squad["order"], path: [], queuedOrders: [] });
  return { game, ai, enemy };
}

describe("raid last-squad negative cache (P6)", () => {
  it("scans the whole grid at most once per enemy per think when the enemy has only embarked squads", () => {
    const { game, enemy } = fixture();
    const spatial = (game as unknown as { spatial: SpatialGrid<Squad> }).spatial, nearest = spatial.nearest.bind(spatial);
    const misses = new Map<number, number>();
    let raidSearches = 0;
    // Identify the raid's last-squad search by behaviour, not by its source
    // text: it accepts a landed enemy squad with troops and rejects the same
    // squad with none. The other nearest-enemy search (captured camps) does
    // not test troops, and no other search accepts this enemy's squads.
    const base = game.player(enemy.id)!.base, embarked = game.squads.find(s => s.playerId === enemy.id)!;
    const probe: Squad = { ...embarked, embarkedOn: null, troops: Math.max(1, embarked.troops),
      x: (game.map.x(base) + 0.5) * FIXED, y: (game.map.y(base) + 0.5) * FIXED };
    const isRaidSearch = (accept: (candidate: Squad) => boolean) => {
      try { return accept(probe) && !accept({ ...probe, troops: 0 }); } catch { return false; }
    };
    spatial.nearest = (x, y, accept) => {
      const found = nearest(x, y, accept);
      if (isRaidSearch(accept)) {
        raidSearches++;
        if (!found) misses.set(game.tick, (misses.get(game.tick) ?? 0) + 1);
      }
      return found;
    };
    for (let i = 0; i < 60; i++) game.step();
    expect(game.player(enemy.id)!.eliminated).toBe(false);
    expect(raidSearches).toBeGreaterThan(0);
    // One AI, one enemy: a single scan per think, not one per raider.
    expect(Math.max(...misses.values())).toBe(1);
  });
});
