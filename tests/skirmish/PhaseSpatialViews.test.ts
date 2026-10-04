import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(96 * 64).fill(133);
  return new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    runAi: false,
    deferredPlanning: true,
  });
}
describe("phase spatial ownership", () => {
  it("reuses geometry despite cosmetic/combat writes and invalidates position, membership and restore", () => {
    const game = fixture(),
      squad = game.squads[0],
      first = game.spatialFacts("combat");
    const original = first.ground;
    game.updateSquad(squad.id, { xp: 20, fighting: true });
    expect(game.spatialFacts("projectiles").ground).toBe(original);
    expect(game.spatialDiagnostics?.rebuilds).toBe(1);
    game.updateSquad(squad.id, { x: squad.x + FIXED });
    expect(() => first.ground).toThrow("expired");
    expect(game.spatialFacts("combat").ground).toBeDefined();
    expect(game.spatialDiagnostics?.rebuilds).toBe(2);
    game.updateSquad(squad.id, { troops: 0 });
    const all: (typeof game.squads)[number][] = [],
      alive: (typeof game.squads)[number][] = [];
    game.spatialFacts("combat").ground.query(squad.x, squad.y, FIXED, all);
    game
      .spatialFacts("trade")
      .groundAlive.query(squad.x, squad.y, FIXED, alive);
    expect(all).toContain(squad);
    expect(alive).not.toContain(squad);
    const before = game.spatialDiagnostics!.rebuilds;
    game.restore(game.checkpoint());
    expect(game.spatialFacts("combat").ground).toBeDefined();
    expect(game.spatialDiagnostics!.rebuilds).toBe(before + 1);
  });
  it("matches independent battle/trade rebuilds over combat and restored continuation", () => {
    const shared = fixture(),
      reference = fixture();
    Object.defineProperty(reference, "spatialFacts", { value: undefined });
    for (const game of [shared, reference])
      for (const squad of game.squads) {
        game.updateSquad(squad.id, {
          x: (45 + squad.playerId * 2) * FIXED,
          y: (27 + (squad.id % 3)) * FIXED,
        });
      }
    for (let tick = 0; tick < 100; tick++) {
      shared.step();
      reference.step();
      if (tick % 20 === 0)
        expect(shared.checkpoint()).toEqual(reference.checkpoint());
      if (tick === 50) {
        shared.restore(shared.checkpoint());
        reference.restore(reference.checkpoint());
      }
    }
    expect(shared.spatialDiagnostics!.hits).toBeGreaterThan(0);
  });
});
