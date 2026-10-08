import { retainSquads } from "./UnitFixtures";
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const data = new Uint8Array(100 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(100, 64, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: true,
    ruleset: "ages-v1",
  });
  const player = game.players[1];
  player.gold = 0;
  player.reserves = 0;
  const unit = game.squads.find((s) => s.playerId === player.id)!;
  game.updateSquad(unit.id, { definitionId: "modern-siege" });
  game.updateSquad(unit.id, { kind: "archer" });
  game.updateSquad(unit.id, { x: 20.5 * FIXED });
  game.updateSquad(unit.id, { y: 30.5 * FIXED });
  game.updateSquad(unit.id, { order: { type: "hold" } });
  game.updateSquad(unit.id, { path: [] });
  game.updateSquad(unit.id, { queuedOrders: [] });
  retainSquads(game, [unit]);
  const state = game.expansion!.progression.states[player.id];
  state.age = "Modern";
  state.completed = TECHNOLOGIES.map((t) => t.id);
  for (const building of game.buildings) game.removeBuilding(building.id);
  const target: Building = game.addBuilding({
    id: game.allocateId(),
    type: "barracks",
    playerId: 1,
    tile: game.map.ref(70, 30),
    age: "Modern",
    remainingTicks: 0,
    health: 10000,
    maxHealth: 10000,
  });
  const think = () => {
    game.tick = game.tick ? game.tick + 60 : (player.id % 20) * 3;
    game.expansion!.beforeStep();
  };
  return { game, player, unit, target, think };
}

describe("AI siege target commitment", () => {
  it("does not reset a valid approach or search again for the same structure", () => {
    const { game, unit, target, think } = fixture();
    const find = vi.spyOn(game.paths, "find");
    think();
    expect(unit.structureTarget?.buildingId).toBe(target.id);
    expect(find).toHaveBeenCalled();
    const path = unit.path;
    game.updateSquad(unit.id, { nextPathIndex: 1 });
    find.mockClear();
    think();
    expect(find).not.toHaveBeenCalled();
    expect(unit.path).toBe(path);
    expect(unit.nextPathIndex).toBe(1);
  });

  it("keeps a deployed gun firing without restarting its approach", () => {
    const { game, unit, target, think } = fixture();
    game.updateSquad(unit.id, { x: 65.5 * FIXED });
    game.updateSquad(unit.id, { y: 30.5 * FIXED });
    game.updateSquad(unit.id, { structureTarget: { buildingId: target.id } });
    game.updateSquad(unit.id, { order: { type: "hold" } });
    const find = vi.spyOn(game.paths, "find");
    think();
    expect(find).not.toHaveBeenCalled();
    expect(unit.order).toEqual({ type: "hold" });
    game.expansion!.battle.fight([]);
    expect(game.expansion!.battle.projectiles).toHaveLength(1);
    expect(unit.lastAttackTick).toBe(game.tick);
  });

  it.each(["destroyed", "captured", "removed"] as const)(
    "reacquires a hostile target when the previous structure is %s",
    (reason) => {
      const { game, player, unit, target, think } = fixture();
      think();
      const replacement = game.addBuilding({
        ...target,
        id: game.allocateId(),
        tile: game.map.ref(80, 30),
      });

      if (reason === "destroyed") game.updateBuilding((target).id, { health: 0 });
      else if (reason === "captured") game.updateBuilding((target).id, { playerId: player.id });
      else game.removeBuilding(target.id);
      const find = vi.spyOn(game.paths, "find");
      think();
      expect(find).toHaveBeenCalled();
      expect(unit.structureTarget?.buildingId).toBe(replacement.id);
      expect(unit.nextPathIndex).toBe(0);
    },
  );

  it("preserves the existing policy of choosing a newly closer structure", () => {
    const { game, unit, target, think } = fixture();
    think();
    const closer = game.addBuilding({
      ...target,
      id: game.allocateId(),
      tile: game.map.ref(45, 30),
    });

    think();
    expect(unit.structureTarget?.buildingId).toBe(closer.id);
  });
});
