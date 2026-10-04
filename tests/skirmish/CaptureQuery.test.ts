import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("batched capture eligibility", () => {
  it("falls back to live rays if an obstacle appears or the origin moves", () => {
    const terrain = new Uint8Array(48 * 32).fill(133),
      map = new GameMapImpl(48, 32, terrain, terrain.length);
    const game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      runAi: false,
      tribes: false,
      ruleset: "ages-v1",
    });
    const expansion = game.expansion!,
      squad = game.squads.find((s) => s.playerId === 1)!;
    game.updateSquad(squad.id, { x: 10.5 * FIXED, y: 10.5 * FIXED });
    const query = expansion.captureQuery(squad, 3),
      target = map.ref(12, 10);
    expect(query(target)).toBe(true);
    game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type: "tower",
      tile: map.ref(11, 10),
      remainingTicks: 0,
      health: 2000,
    });
    expansion.fortifications.step(game.tick, game.buildings);
    expect(query(target)).toBe(false);
    game.updateSquad(squad.id, { x: 13.5 * FIXED, y: 10.5 * FIXED });
    expect(query(target)).toBe(expansion.canCaptureTile(squad, target));
  });
  it("agrees with exact per-tile queries at edges, block boundaries and enemy walls", () => {
    const terrain = new Uint8Array(48 * 32).fill(133),
      map = new GameMapImpl(48, 32, terrain, terrain.length);
    const game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      runAi: false,
      tribes: false,
      ruleset: "ages-v1",
    });
    const expansion = game.expansion!,
      forts = expansion.fortifications;
    const tower = game.addBuilding({
      id: game.allocateId(),
      playerId: 2,
      type: "tower",
      tile: map.ref(16, 12),
      remainingTicks: 0,
      health: 2000,
      maxHealth: 2000,
    });
    forts.addBarrier({
      id: 1,
      playerId: 2,
      age: "StoneAge",
      a: tower.id,
      b: tower.id,
      tiles: [map.ref(15, 12), map.ref(16, 12), map.ref(17, 12)],
      health: 100,
      maxHealth: 100,
      remainingTicks: 0,
    });
    let squad = game.squads.find((s) => s.playerId === 1)!;
    const compare = () => {
      forts.step(game.tick, game.buildings);
      for (const [x, y] of [
        [0, 0],
        [7, 7],
        [8, 8],
        [13, 12],
        [15, 11],
        [16, 12],
        [17, 13],
        [47, 31],
      ]) {
        game.updateSquad(squad.id, {
          x: (x + 0.25) * FIXED,
          y: (y + 0.75) * FIXED,
        });
        const query = expansion.captureQuery(squad, 3);
        for (let yy = Math.max(0, y - 3); yy <= Math.min(31, y + 3); yy++)
          for (let xx = Math.max(0, x - 3); xx <= Math.min(47, x + 3); xx++)
            if ((xx - x) ** 2 + (yy - y) ** 2 <= 9) {
              const tile = map.ref(xx, yy);
              expect(query(tile)).toBe(expansion.canCaptureTile(squad, tile));
            }
      }
    };
    compare();
    expansion.diplomacy.state.alliances.push({
      id: 1,
      a: 1,
      b: 2,
      expiresTick: 1000,
      renewal: [],
    });
    expansion.diplomacy.revision++;
    compare();
    expansion.diplomacy.state.alliances = [];
    expansion.diplomacy.revision++;
    game.updateBuilding(tower.id, { playerId: 1 });
    forts.updateBarrier(forts.barriers[0].id, { health: 0 });
    compare();
    game.removeBuilding(tower.id);
    compare();
    const saved = game.checkpoint();
    game.restore(saved);
    squad = game.squad(squad.id)!;
    compare();
  });
});
