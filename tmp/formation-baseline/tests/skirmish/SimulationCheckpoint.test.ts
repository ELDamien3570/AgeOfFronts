import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("complete simulation recovery", () => {
  it("rejects tile and identity failures before changing canonical state", () => {
    const terrain = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, terrain, terrain.length);
    const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false });
    const original = game.checkpoint();
    const invalidTiles = structuredClone(original);
    invalidTiles.players[0].gold++;
    invalidTiles.owners = new Uint8Array(1);
    expect(() => game.restore(invalidTiles)).toThrow("tile array");
    expect(game.checkpoint()).toEqual(original);
    const duplicate = structuredClone(original);
    duplicate.players[0].gold++;
    duplicate.squads = [...duplicate.squads, duplicate.squads[0]];
    expect(() => game.restore(duplicate)).toThrow("identity");
    expect(game.checkpoint()).toEqual(original);
    game.step(); expect(game.tick).toBe(1);
  });
  it("stops the aggregate after an unexpected deep installation failure", () => {
    const terrain = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, terrain, terrain.length);
    const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false });
    const invalid = game.checkpoint();
    invalid.players[0].gold++;
    invalid.planning.scheduling.version = 999;
    expect(() => game.restore(invalid)).toThrow("scheduling checkpoint");
    expect(game.failureReason).toBeDefined();
    expect(() => game.step()).toThrow("Simulation stopped");
    expect(() => game.applyCommand({ type: "order", playerId: 1, squadIds: [game.squads[0].id], order: { type: "hold" } })).toThrow("Simulation stopped");
    expect(() => game.checkpoint()).toThrow("Simulation stopped");
  });
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
