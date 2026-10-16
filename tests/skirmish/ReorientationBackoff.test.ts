import { describe, expect, it, vi } from "vitest";

const attempts = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/skirmish/domain/FormationGeometry", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/skirmish/domain/FormationGeometry")>();
  return {
    ...original,
    reorientedFormation: (...args: Parameters<typeof original.reorientedFormation>) => {
      attempts.count++;
      return original.reorientedFormation(...args);
    },
  };
});

import { cavalryBattleScene } from "./fixtures/CavalryImpact";
import type { Skirmish } from "../../src/skirmish/Simulation";

/** One rider ordered to face about; every reorientation fails certification,
 * as for a squad pinned against forest. */
function pinned() {
  const { game, riders, defenders } = cavalryBattleScene(), s = riders[0];
  for (const t of [...riders.slice(1), ...defenders]) game.removeSquad(t.id);
  game.updateSquad(s.id, { formation: { ...s.formation!, shape: "line", transition: undefined }, order: { type: "hold", facing: Math.PI } });
  const blocked = game as unknown as { emptyTransitionTerrain(): boolean; certifyFormationPolygon(): boolean };
  blocked.emptyTransitionTerrain = () => false;
  blocked.certifyFormationPolygon = () => false;
  return { game, id: s.id };
}
const run = (game: Skirmish, ticks: number) => {
  const before = attempts.count;
  for (let i = 0; i < ticks; i++) game.step();
  return attempts.count - before;
};

describe("failed reorientation back-off (R2-P10 b)", () => {
  it("retries a failed reorientation at most once per retry window", () => {
    const { game } = pinned();
    // ceil(80 / 8) + 1 attempts in 80 ticks, not one per tick.
    const count = run(game, 80);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(11);
  });

  it("retries at once after a heading change beyond 30 degrees", () => {
    const { game, id } = pinned();
    run(game, 3);
    game.updateSquad(id, { order: { type: "hold", facing: Math.PI / 2 } });
    expect(run(game, 1)).toBe(1);
    // A small adjustment of the failed heading keeps waiting.
    game.updateSquad(id, { order: { type: "hold", facing: Math.PI / 2 + 0.1 } });
    expect(run(game, 1)).toBe(0);
  });

  it("checkpoints the back-off and continues identically after restore", () => {
    const a = pinned(), b = pinned();
    run(a.game, 5);
    b.game.restore(a.game.checkpoint());
    const left = run(a.game, 40), right = run(b.game, 40);
    expect(right).toBe(left);
    expect(b.game.snapshot()).toEqual(a.game.snapshot());
  });
});
