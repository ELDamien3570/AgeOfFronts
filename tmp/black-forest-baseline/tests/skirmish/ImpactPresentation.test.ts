import { describe, expect, it } from "vitest";
import { ImpactPresentation } from "../../src/skirmish/client/ImpactPresentation";
import type { Projectile } from "../../src/skirmish/domain/Definitions";
function event(id = 1): Projectile {
  return {
    id,
    playerId: 1,
    sourceId: 3,
    sourceKind: "building",
    fromX: 0,
    fromY: 0,
    x: 1000,
    y: 1000,
    toX: 1000,
    toY: 1000,
    tick: 0,
    impactTick: 10,
    diameter: 128,
    blastRadius: 256,
    damage: 100,
    channel: "ranged",
    bonuses: {},
    penetration: 0,
    kind: "warhead",
    warheads: 0,
    impacted: true,
    impactAt: 10,
  };
}
describe("committed impact presentation", () => {
  it("finishes terminal effects without advancing domain state or replaying frozen events", () => {
    const view = new ImpactPresentation(),
      p = event();
    view.update([p], 10);
    expect(view.clock(10, 100, false)).toBe(10);
    expect(view.clock(10, 100, true)).toBe(10);
    const end = view.frames(10)[0].end;
    expect(view.clock(10, 100 + (end - 10) * 50, true)).toBe(end);
    expect(view.frames(end)).toHaveLength(0);
    view.update([p], 10);
    expect(view.frames(end + 1)).toHaveLength(0);
    expect(p.impactAt).toBe(10);
    expect(p.damage).toBe(100);
    view.reset();
    expect(view.clock(10, 1000, true)).toBe(10);
  });
  it("keeps one cosmetic event after the domain projectile leaves, and expires it without replay", () => {
    const view = new ImpactPresentation(),
      p = event();
    view.update([p], 10);
    expect(view.frames(10)).toHaveLength(1);
    const end = view.frames(10)[0].end;
    view.update([p], 11);
    expect(view.frames(11)).toHaveLength(1);
    view.update([], 20);
    expect(view.frames(20)).toHaveLength(1);
    expect(view.frames(end)).toHaveLength(0);
    view.update([p], end + 1);
    expect(view.frames(end + 1)).toHaveLength(0);
    expect(p.damage).toBe(100);
    expect(p.impactAt).toBe(10);
  });
  it("plays separation rather than a parent blast, excludes intercepted missiles and bounds work", () => {
    const view = new ImpactPresentation();
    view.update(
      [
        { ...event(), kind: "mirv", warheads: 4 },
        { ...event(2), damage: 0 },
        { ...event(3), kind: "icbm", definitionId: "hydrogen" },
        { ...event(4), kind: "mirv", warheads: 4, damage: 0 },
      ],
      10,
    );
    expect(view.frames(10).map((e) => e.artworkId)).toEqual([
      "mirv",
      "impact-hydrogen",
    ]);
    expect(view.frames(10).map((e) => e.clip)).toEqual([
      "separation",
      "detonate",
    ]);
    view.update(
      Array.from({ length: 256 }, (_, n) => event(n + 10)),
      10,
    );
    expect(view.frames(10)).toHaveLength(128);
    view.reset();
    expect(view.frames(10)).toHaveLength(0);
  });
});
