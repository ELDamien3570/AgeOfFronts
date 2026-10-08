import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("live battle index work", () => {
  it("does not rebuild collision and cover indexes in an empty projectile phase", () => {
    const game = new Skirmish(
      new GameMapImpl(96, 64, new Uint8Array(6144).fill(133), 6144),
      { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
    );
    for (const squad of game.squads) {
      game.updateSquad(squad.id, { x: (squad.playerId === 1 ? 10 : 80) * FIXED });
      game.updateSquad(squad.id, { y: 20 * FIXED });
    }
    const battle = game.expansion!.battle,
      before = battle.telemetry.indexRebuilds;
    battle.fight([]);
    expect(battle.projectiles.length).toBe(0);
    battle.advanceProjectiles();
    expect(battle.telemetry.indexRebuilds - before).toBe(1);
  });
});
