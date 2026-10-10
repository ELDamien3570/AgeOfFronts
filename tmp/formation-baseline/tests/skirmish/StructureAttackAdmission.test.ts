import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("bounded structure attack approaches", () => {
  it("spreads attackers over exposed sides without synchronous route searches", () => {
    const terrain = new Uint8Array(100 * 70).fill(133),
      map = new GameMapImpl(100, 70, terrain, terrain.length),
      game = new Skirmish(map, {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
        deferredPlanning: true,
      });
    const own = game.squads.filter((s) => s.playerId === 1);
    own.forEach((s, i) =>
      game.updateSquad(s.id, { x: (10.5 + i) * FIXED, y: 15.5 * FIXED }),
    );
    game.squads
      .filter((s) => s.playerId === 2)
      .forEach((s, i) =>
        game.updateSquad(s.id, { x: 90.5 * FIXED, y: (10.5 + i) * FIXED }),
      );
    const tower = game.addBuilding({
      id: game.allocateId(),
      type: "tower",
      playerId: 2,
      tile: map.ref(50, 35),
      age: "StoneAge",
      remainingTicks: 100000,
      health: 100000,
      maxHealth: 100000,
    });
    const synchronous = vi.spyOn(game.paths, "find");
    expect(
      game.applyCommand({
        type: "attack-structure",
        playerId: 1,
        squadIds: own.map((s) => s.id),
        buildingId: tower.id,
      }),
    ).toBeNull();
    expect(synchronous).not.toHaveBeenCalled();
    expect(game.movementAdmission.checkpoint().pending[0][1].phase).toBe("preparation");
    expect(game.movementAdmission.checkpoint().pending[0][1].preparation!.consumed).toBe(0);
    for (let i = 0; i < 1000 && game.movementAdmission.preparationCount; i++)
      game.movementAdmission.step(game.tick, 128);
    expect(game.movementAdmission.preparationCount).toBe(0);
    const points =
      game.movementAdmission.checkpoint().pending[0][1].formation.preferred!;
    const sides = new Set(
      [...points.values()].map((p) =>
        Math.floor(
          ((Math.atan2(p.y - 35.5 * FIXED, p.x - 50.5 * FIXED) + Math.PI) * 2) /
            Math.PI,
        ),
      ),
    );
    expect(sides.size).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 500; i++) game.step();
    expect(
      game.movementAdmission.events.some((e) => e.status === "rejected"),
    ).toBe(false);
    expect(tower.health).toBeLessThan(100000);
    expect(own.every((s) => s.structureTarget?.buildingId === tower.id)).toBe(
      true,
    );
    expect(synchronous).not.toHaveBeenCalled();
    synchronous.mockRestore();
  });
});
