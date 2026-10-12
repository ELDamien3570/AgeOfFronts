import { describe, expect, it } from "vitest";
import { Renderer } from "../../src/skirmish/client/Renderer";
import {
  effectiveRange,
  maxEffectiveRange,
  rangedElevation,
} from "../../src/skirmish/domain/ElevationAdvantage";
import { FiringPositions } from "../../src/skirmish/FiringPositions";
import { FIXED } from "../../src/skirmish/Protocol";
import { tilePoint } from "../../src/skirmish/SquadGeometry";
import { firingPosition } from "../../src/skirmish/TacticalRoutes";
import { hillDefenceScene } from "./fixtures/HillDefence";
describe("one effective range", () => {
  it("shares the exact target-dependent range with the selection ring for fifty seeded positions", () => {
    const { game, defenders, riders } = hillDefenceScene(true),
      s = defenders[0],
      t = riders[0],
      p = game.expansion!.unit(s).attack;
    let seed = 5;
    for (let i = 0; i < 50; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      game.updateSquad(s.id, {
        x: (25 + (seed % 14)) * FIXED,
        y: (22 + ((seed >>> 8) % 12)) * FIXED,
        order: { type: "attack", targetId: t.id },
      });
      game.updateSquad(t.id, {
        x: (25 + ((seed >>> 12) % 14)) * FIXED,
        y: (34 + ((seed >>> 16) % 12)) * FIXED,
      });
      const expected = effectiveRange(game, s, p, t),
        ui = Renderer.prototype.highGround.call(
          { map: game.map } as never,
          s,
          game.snapshot(),
        );
      expect(ui.range).toBe(expected);
      expect(ui.rangeBp).toBe(rangedElevation(game, s, p, t).rangeBp);
      expect(expected).toBeLessThanOrEqual(maxEffectiveRange(p));
    }
  });
  it("evaluates candidate height in both bounded and immediate firing-position planners", () => {
    const { game, defenders, riders } = hillDefenceScene(true),
      s = defenders[0],
      t = riders[0],
      p = game.expansion!.unit(s).attack;
    const rangeAt = (point: { x: number; y: number }) =>
        effectiveRange(game, point, p, t),
      score = (point: { x: number; y: number }) =>
        (rangedElevation(game, point, p, t).rangeBp - 10000) / 50;
    const bounded = new FiringPositions(
      game.map,
      game.paths,
      game.tileOf(s),
      s.kind,
      t,
      maxEffectiveRange(p),
    );
    while (!bounded.state.done)
      expect(
        bounded.step(32, 0, undefined, undefined, undefined, rangeAt, score)
          .work,
      ).toBeLessThanOrEqual(32);
    expect(bounded.state.candidates.length).toBeGreaterThan(0);
    for (const c of bounded.state.candidates) {
      const point = tilePoint(game.map, c.tile);
      expect((point.x - t.x) ** 2 + (point.y - t.y) ** 2).toBeLessThanOrEqual(
        rangeAt(point) ** 2,
      );
    }
    expect(
      firingPosition(
        game.map,
        game.paths,
        s,
        t,
        maxEffectiveRange(p),
        undefined,
        undefined,
        rangeAt,
        score,
      ),
    ).toBe(bounded.state.candidates[0].tile);
  });
});
