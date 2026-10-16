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
  it("rejects tile owners and claimants outside the roster before installation (L19)", () => {
    const terrain = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, terrain, terrain.length);
    const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false });
    const original = game.checkpoint();
    for (const field of ["owners", "claims"] as const) for (const value of [200, 255]) {
      const invalid = structuredClone(original);
      invalid.players[0].gold++;
      invalid[field][7] = value;
      expect(() => game.restore(invalid)).toThrow("Invalid checkpoint tile owner");
      expect(game.failureReason).toBeUndefined();
      expect(game.checkpoint()).toEqual(original);
    }
    const valid = structuredClone(original);
    valid.owners[7] = game.players[1].id;
    expect(() => new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false }).restore(valid)).not.toThrow();
    game.step(); expect(game.tick).toBe(1);
  });
  it("rejects a transferring aircraft without its reservation before installation (R2-L3)", () => {
    const terrain = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, terrain, terrain.length);
    const options = { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" as const };
    const game = new Skirmish(map, options);
    const original = game.checkpoint();
    const plane = {
      id: 90_000, playerId: 1, definitionId: "bomber" as const, airfieldId: 77, x: 10_000, y: 10_000, health: 100,
      target: null, state: "transferring" as const, reloadTick: 0, fuelTicks: 400,
    };
    const missing = structuredClone(original);
    missing.expansion!.aircraft.push(plane);
    expect(() => game.restore(missing)).toThrow("Invalid checkpoint aircraft");
    expect(game.failureReason).toBeUndefined();
    expect(game.checkpoint()).toEqual(original);
    for (const bad of [
      { ...plane, state: "transferring" as const, transfer: { destinationId: -1 } },
      { ...plane, state: "ready" as const, playerId: 99 },
      { ...plane, state: "ready" as const, definitionId: "zeppelin" as never },
      { ...plane, state: "ready" as const, fuelTicks: Number.NaN },
    ]) {
      const invalid = structuredClone(original);
      invalid.expansion!.aircraft.push(bad);
      expect(() => game.restore(invalid)).toThrow("Invalid checkpoint aircraft");
    }
    const duplicate = structuredClone(original);
    duplicate.expansion!.aircraft.push({ ...plane, state: "ready" }, { ...plane, state: "ready" });
    expect(() => game.restore(duplicate)).toThrow("Invalid checkpoint aircraft");
    // Control: the same plane with its reservation, from an airfield that does not exist.
    const control = structuredClone(original);
    control.expansion!.aircraft.push({ ...plane, transfer: { destinationId: 78 } });
    const fresh = new Skirmish(map, options);
    fresh.restore(control);
    expect(fresh.checkpoint()).toEqual(control);
  });
  it("omits unused crowd recovery and derived AI building state, and still reads them (L15)", () => {
    const terrain = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, terrain, terrain.length);
    const options = { seed: 47, aiCount: 1, tribes: false, runAi: true, ruleset: "ages-v1" as const };
    const game = new Skirmish(map, options);
    for (let tick = 0; tick < 20; tick++) game.step();
    const saved = game.checkpoint();
    expect(saved.avoidance).not.toHaveProperty("recovery");
    expect(saved.expansion!.economy.recovery).not.toHaveProperty("known");
    // A checkpoint written before the removal carries both; restore ignores them.
    const legacy = structuredClone(saved) as typeof saved & { avoidance: { recovery: unknown }; expansion: { economy: { recovery: { known: unknown } } } };
    legacy.avoidance.recovery = { waiting: new Map([[1, { x: 0, y: 0, since: 0, granted: 0 }]]), leases: [] };
    legacy.expansion.economy.recovery.known = [[999, { owner: 1, tile: 0, type: "city" }]];
    const fresh = new Skirmish(map, options);
    fresh.restore(legacy);
    expect(fresh.checkpoint()).toEqual(saved);
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
  });

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
