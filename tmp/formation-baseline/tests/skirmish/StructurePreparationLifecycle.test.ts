import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(ai = false) {
  const terrain = new Uint8Array(96 * 64).fill(133),
    map = new GameMapImpl(96, 64, terrain, terrain.length);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    deferredPlanning: true,
  });
  const playerId = ai ? 2 : 1,
    squads = game.squads.filter((s) => s.playerId === playerId);
  squads.forEach((s, i) =>
    game.updateSquad(s.id, { x: (8 + i) * FIXED, y: 8 * FIXED }),
  );
  const tower = game.addBuilding({
    id: game.allocateId(),
    playerId: ai ? 1 : 2,
    type: "tower",
    tile: map.ref(48, 32),
    remainingTicks: 10000,
    age: "StoneAge",
    health: 10000,
    maxHealth: 10000,
  });
  const command = {
    type: "attack-structure" as const,
    playerId,
    squadIds: squads.map((s) => s.id),
    buildingId: tower.id,
  };
  return { game, squads, tower, command };
}
describe("structure preparation lifecycle and intent", () => {
  it("keeps one deferred receipt through preparation, route handoff and checkpoint continuation", () => {
    const { game, squads, command } = fixture(),
      before = squads.map((s) => structuredClone(s.order));
    expect(game.commandApplications.apply("attack", command).status).toBe(
      "deferred",
    );
    expect(squads.map((s) => s.order)).toEqual(before);
    game.movementAdmission.step(game.tick, 7);
    const saved = game.checkpoint(),
      restored = new Skirmish(game.map, game.options);
    restored.restore(saved);
    for (let tick = 0; tick < 120; tick++) {
      game.step();
      restored.step();
    }
    expect(restored.checkpoint()).toEqual(game.checkpoint());
    expect(game.commandApplications.apply("attack", command).status).toBe(
      "executed",
    );
    expect(game.commandApplications.diagnostics.pending).toBe(0);
    expect(game.movementAdmission.preparationCount).toBe(0);
  });
  it.each([
    "Hold",
    "target removal",
    "alliance",
    "controller transfer",
  ] as const)("releases preparation after %s", (reason) => {
    const { game, squads, command, tower } = fixture();
    game.commandApplications.apply("attack", command);
    game.movementAdmission.step(game.tick, 3);
    if (reason === "Hold")
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: command.squadIds,
        order: { type: "hold" },
      });
    else if (reason === "target removal") game.removeBuilding(tower.id);
    else if (reason === "alliance") {
      game.expansion!.diplomacy.state.alliances.push({
        id: 1,
        a: 1,
        b: 2,
        expiresTick: 10000,
        renewal: [],
      });
      game.expansion!.diplomacy.revision++;
    } else game.setAiController(1, true);
    for (let i = 0; i < 5; i++) game.step();
    expect(game.movementAdmission.preparationCount).toBe(0);
    expect(game.commandApplications.diagnostics.pending).toBe(0);
    expect(squads.every((s) => !s.structureTarget)).toBe(true);
    expect(game.commandApplications.apply("attack", command).status).toBe(
      reason === "Hold" || reason === "controller transfer"
        ? "superseded"
        : "rejected",
    );
  });
  it("retains equivalent AI progress but keeps human replacements distinct", () => {
    for (const ai of [true, false]) {
      const { game, command } = fixture(ai);
      game.applyCommand(command);
      game.movementAdmission.step(game.tick, 7);
      const before = game.movementAdmission.checkpoint().pending[0][1];
      game.applyCommand(command);
      const after = game.movementAdmission.checkpoint().pending[0][1];
      if (ai) {
        expect(after.id).toBe(before.id);
        expect(after.preparation!.consumed).toBe(before.preparation!.consumed);
      } else {
        expect(after.id).not.toBe(before.id);
        expect(after.preparation!.consumed).toBe(0);
      }
    }
  });
});
