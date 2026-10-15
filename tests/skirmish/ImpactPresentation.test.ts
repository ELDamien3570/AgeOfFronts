import {TICKS_PER_SECOND} from '../../src/skirmish/Protocol';
const presentationTicks=(seconds:number)=>seconds*TICKS_PER_SECOND;
import {secondsToTicks} from '../../src/skirmish/Protocol';
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
    impactTick: presentationTicks(0.5),
    diameter: 128,
    blastRadius: 256,
    damage: 100,
    channel: "ranged",
    bonuses: {},
    penetration: 0,
    kind: "warhead",
    warheads: 0,
    impacted: true,
    impactAt: presentationTicks(.5),
  };
}
describe("committed impact presentation", () => {
  it("finishes terminal effects without advancing domain state or replaying frozen events", () => {
    const view = new ImpactPresentation(),
      p = event();
    view.update([p], presentationTicks(0.5));
    expect(view.clock(presentationTicks(0.5), 100, false)).toBe(4);
    expect(view.clock(presentationTicks(0.5), 100, true)).toBe(4);
    const end = view.frames(presentationTicks(0.5))[0].end;
    expect(view.clock(presentationTicks(0.5), 100 + (end - presentationTicks(.5)) * (1000/TICKS_PER_SECOND), true)).toBe(end);
    expect(view.frames(end)).toHaveLength(0);
    view.update([p], presentationTicks(0.5));
    expect(view.frames(end+1)).toHaveLength(0);
    expect(p.impactAt).toBe(4);
    expect(p.damage).toBe(100);
    view.reset();
    expect(view.clock(presentationTicks(0.5), 1000, true)).toBe(4);
  });
  it("keeps one cosmetic event after the domain projectile leaves, and expires it without replay", () => {
    const view = new ImpactPresentation(),
      p = event();
    view.update([p], presentationTicks(0.5));
    expect(view.frames(presentationTicks(0.5))).toHaveLength(1);
    const end = view.frames(presentationTicks(0.5))[0].end;
    view.update([p], presentationTicks(0.55));
    expect(view.frames(presentationTicks(0.55))).toHaveLength(1);
    view.update([], presentationTicks(1));
    expect(view.frames(presentationTicks(1))).toHaveLength(1);
    expect(view.frames(end)).toHaveLength(0);
    view.update([p], end+1);
    expect(view.frames(end+1)).toHaveLength(0);
    expect(p.damage).toBe(100);
    expect(p.impactAt).toBe(4);
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
      presentationTicks(0.5),
    );
    expect(view.frames(presentationTicks(0.5)).map((e) => e.artworkId)).toEqual([
      "mirv",
      "impact-hydrogen",
    ]);
    expect(view.frames(presentationTicks(0.5)).map((e) => e.clip)).toEqual([
      "separation",
      "detonate",
    ]);
    view.update(
      Array.from({ length: 256 }, (_, n) => event(n + 10)),
      presentationTicks(0.5),
    );
    expect(view.frames(presentationTicks(0.5))).toHaveLength(128);
    view.reset();
    expect(view.frames(presentationTicks(0.5))).toHaveLength(0);
  });
});
