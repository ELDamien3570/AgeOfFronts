import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("complete simulation recovery", () => {
  it("restores ongoing AI, queued routing and domain timers without changing continuation", () => {
    const terrain = new Uint8Array(160 * 100).fill(133);
    const map = new GameMapImpl(160, 100, terrain, terrain.length);
    const options = { seed: 987, aiCount: 4, humanNames: ["First", "Second"], ruleset: "ages-v1" as const, tribes: false };
    const original = new Skirmish(map, options);
    const own = original.squads.filter(squad => squad.playerId === 2);
    expect(original.applyCommand({ type: "order", playerId: 2, squadIds: own.map(squad => squad.id), order: { type: "move", tile: map.ref(80, 50) } })).toBeNull();
    for (let tick = 0; tick < 77; tick++) original.step();
    const checkpoint = original.checkpoint();
    const restored = new Skirmish(map, options);
    restored.restore(checkpoint);
    expect(restored.checkpoint()).toEqual(checkpoint);
    for (let tick = 0; tick < 300; tick++) {
      original.step(); restored.step();
      if (tick % 20 === 0) expect(restored.checkpoint()).toEqual(original.checkpoint());
    }
  }, 20_000);

  it("rejects mismatched map dimensions and rules", () => {
    const terrain = new Uint8Array(64 * 40).fill(133);
    const map = new GameMapImpl(64, 40, terrain, terrain.length);
    const match = new Skirmish(map, { seed: 1, aiCount: 1 });
    const incompatible = new Skirmish(map, { seed: 2, aiCount: 1 });
    expect(() => incompatible.restore(match.checkpoint())).toThrow("match");
    const checkpoint = match.checkpoint();
    checkpoint.width++;
    expect(() => match.restore(checkpoint)).toThrow("match");
  });
});
