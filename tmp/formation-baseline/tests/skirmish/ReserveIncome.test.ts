import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("reserve income", () => {
  it.each(["ages-v1", "sandbox-v1"] as const)(
    "%s continues producing above former reserve ceilings",
    (ruleset) => {
      let income = 0;
      for (const reserves of [0, 19_999, 20_000, 199_999, 200_000, 1_000_000]) {
        const data = new Uint8Array(96 * 64).fill(133);
        const match = new Skirmish(
          new GameMapImpl(96, 64, data, data.length),
          { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset },
        );
        const player = match.players[0];
        player.reserves = reserves;
        const recruited = player.recruited;
        for (let i = 0; i < TICKS_PER_SECOND; i++) match.step();
        if (reserves === 0) {
          income = player.reserves;
          expect(income).toBeGreaterThan(0);
        }
        expect(player.reserves).toBe(reserves + income);
        expect(player.recruited).toBe(recruited + income);
      }
    },
  );
});
