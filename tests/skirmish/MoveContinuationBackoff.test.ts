import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import { ADMISSION_REFUSAL_BACKOFF } from "../../src/skirmish/MovementAdmission";
import { Skirmish } from "../../src/skirmish/Simulation";

/** A speculative next-leg route (move continuation) is the least urgent
 * planner work. A refused request backs off 2, 4, 8, then 16 ticks, as
 * admissions do (P20), instead of asking again on every movement tick. */
describe("move continuation refusal back-off", () => {
  it("re-requests a refused continuation only after its back-off", () => {
    const data = new Uint8Array(160 * 100).fill(133);
    const game = new Skirmish(new GameMapImpl(160, 100, data, data.length), {
      seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true, ...FORMATION_MOVEMENT,
    });
    const squad = game.squads.find((s) => s.playerId === 1)!;
    const asks: number[] = [];
    const request = game.routePlanner.request.bind(game.routePlanner);
    game.routePlanner.request = (r) => {
      if (r.key === `continuation:${squad.id}`) { asks.push(game.tick); return false; }
      return request(r);
    };
    expect(game.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: game.map.ref(150, 50) } })).toBeNull();
    expect(game.applyCommand({ type: "order", playerId: 1, squadIds: [squad.id], order: { type: "move", tile: game.map.ref(150, 90) }, append: true })).toBeNull();
    for (let i = 0; i < 80; i++) game.step();
    expect(game.squad(squad.id)!.order.type).toBe("move");
    expect(asks.length).toBeGreaterThanOrEqual(4);
    const gaps = asks.slice(1).map((t, i) => t - asks[i]);
    expect(gaps.slice(0, 4)).toEqual([2, 4, 8, 16]);
    expect(gaps.every((g) => g <= ADMISSION_REFUSAL_BACKOFF.maximumTicks)).toBe(true);
  });
});
