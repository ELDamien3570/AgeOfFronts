import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { MatchLifecycle } from "../../src/skirmish/MatchLifecycle";
import { Skirmish } from "../../src/skirmish/Simulation";

function match() {
  const terrain = new Uint8Array(64 * 48).fill(133), map = new GameMapImpl(64, 48, terrain, terrain.length);
  return new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
}
describe("match lifecycle bus (S4)", () => {
  it("runs listeners in registration order", () => {
    const bus = new MatchLifecycle(), calls: string[] = [];
    bus.on("tileOwner", (tile, old, owner) => calls.push(`a${tile}:${old}>${owner}`));
    bus.on("tileOwner", (tile) => calls.push(`b${tile}`));
    bus.on("controller", (id, ai) => calls.push(`c${id}:${ai}`));
    bus.tileOwner(3, 1, 2);
    bus.controller(4, true);
    expect(calls).toEqual(["a3:1>2", "b3", "c4:true"]);
  });
  it("announces tile and entity owner changes, removals, handovers and eliminations", () => {
    const game = match(), events: unknown[][] = [];
    game.lifecycle.on("tileOwner", (...args) => events.push(["tile", ...args]));
    game.lifecycle.on("entityOwner", (...args) => events.push(["owner", ...args]));
    game.lifecycle.on("entityRemoved", (...args) => events.push(["removed", ...args]));
    game.lifecycle.on("controller", (...args) => events.push(["controller", ...args]));
    game.lifecycle.on("factionEliminated", (...args) => events.push(["eliminated", ...args]));
    const tile = game.map.ref(3, 3);
    (game as unknown as { changeOwner(tile: number, id: number): void }).changeOwner(tile, 2);
    expect(events).toContainEqual(["tile", tile, expect.any(Number), 2]);
    const squad = game.squads.find((s) => s.playerId === 1)!;
    expect(game.entityGeneration("squad", squad.id)).toBe(0);
    game.updateSquad(squad.id, { playerId: 2 });
    expect(events).toContainEqual(["owner", "squad", squad.id, 1, 2]);
    expect(game.entityGeneration("squad", squad.id)).toBe(1);
    game.updateSquad(squad.id, { troops: squad.troops });
    expect(game.entityGeneration("squad", squad.id)).toBe(1);
    game.removeSquad(squad.id);
    expect(events).toContainEqual(["removed", "squad", squad.id]);
    expect(game.entityGeneration("squad", squad.id)).toBe(0);
    game.setAiController(1, true);
    expect(events).toContainEqual(["controller", 1, true]);
    expect(game.aiGeneration(1)).toBe(1);
    for (const s of game.squads.filter((s) => s.playerId === 1)) game.removeSquad(s.id);
    for (const b of game.buildings.filter((b) => b.playerId === 1)) game.removeBuilding(b.id);
    game.step();
    expect(game.player(1)!.eliminated).toBe(true);
    expect(events.filter((e) => e[0] === "eliminated")).toEqual([["eliminated", 1, expect.any(Number)]]);
  });
  it("starts generations from zero after a restore, without changing the checkpoint", () => {
    const game = match(), squad = game.squads.find((s) => s.playerId === 1)!;
    game.updateSquad(squad.id, { playerId: 2 });
    expect(game.entityGeneration("squad", squad.id)).toBe(1);
    const saved = game.checkpoint();
    game.restore(saved);
    expect(game.entityGeneration("squad", squad.id)).toBe(0);
    expect(game.checkpoint()).toEqual(saved);
  });
});
