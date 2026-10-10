import { describe, expect, it } from "vitest";
import { FormationSoldierMotion } from "../../src/skirmish/client/FormationSoldierMotion";
import { FormationTravelLanes } from "../../src/skirmish/client/FormationTravelLanes";

const slots = [
  { id: 10, x: -0.25, y: -0.4, scale: 0.24, front: false },
  { id: 20, x: 0.25, y: -0.4, scale: 0.24, front: false },
  { id: 30, x: -0.25, y: 0.4, scale: 0.24, front: true },
  { id: 40, x: 0.25, y: 0.4, scale: 0.24, front: true },
];
describe("persistent soldier travel lanes", () => {
  it("preserves identities and lets rear ranks follow bends after the front", () => {
    const lanes = new FormationTravelLanes();
    lanes.sample({ x: 0, y: 0 }, slots, 0, 1);
    for (let y = 0.05; y <= 2; y += 0.05)
      lanes.sample({ x: 0, y }, slots, 0, 1);
    const turn = lanes.sample({ x: 0.1, y: 2 }, slots, 0, 1);
    expect([...turn.keys()]).toEqual([10, 20, 30, 40]);
    // Rear soldiers remain in their original left/right lanes on the incoming leg.
    expect(turn.get(10)!.x).toBeLessThan(turn.get(20)!.x);
    expect(turn.get(10)!.y).toBeLessThan(2);
    // The front travels onto the outgoing leg; no slot reassignment is performed.
    expect(turn.get(30)!.x).toBeLessThan(turn.get(40)!.x);
    expect(turn.get(30)!.y).toBeGreaterThan(2);
    const stopped = lanes.sample({ x: 0.1, y: 2 }, slots, 0, 1);
    expect(stopped).toEqual(turn);
  });
  it("retains bounded history regardless of frame count and supports casualty removal", () => {
    for (const step of [0.008, 0.025, 0.1]) {
      const lanes = new FormationTravelLanes();
      lanes.sample({ x: 0, y: 0 }, slots, 0, 1);
      for (let y = step; y < 100; y += step)
        lanes.sample({ x: Math.sin(y * 0.1), y }, slots, 0, 1);
      expect(lanes.historySize).toBeLessThanOrEqual(256);
      expect(lanes.sample({ x: 0, y: 100 }, slots.slice(1), 0, 1).has(10)).toBe(
        false,
      );
      lanes.reset();
      expect(lanes.historySize).toBe(0);
    }
  });
  it("does not create a moving idle formation before travel begins", () => {
    const lanes = new FormationTravelLanes();
    const original = lanes.sample({ x: 2, y: 3 }, slots, 0, 1);
    for (let i = 0; i < 120; i++)
      expect(lanes.sample({ x: 2, y: 3 }, slots, 0, 1)).toEqual(original);
  });
  it("keeps cosmetic followers moving through a bend without changing their identity", () => {
    const followers = new FormationSoldierMotion();
    const options = {
      footprint: 1,
      mounted: false,
      engaged: false,
      combatFootwork: true,
      looseTravel: true,
      travelLanes: true,
      reformInPlace: true,
    };
    followers.sample(0, { x: 0, y: 0 }, 0, slots, options);
    let previous = followers.sample(0, { x: 0, y: 0 }, 0, slots, options);
    for (let frame = 1; frame <= 240; frame++) {
      const t = frame / 60;
      const anchor = t < 2 ? { x: 0, y: t } : { x: t - 2, y: 2 };
      const current = followers.sample(
        (frame * 1000) / 60,
        anchor,
        0,
        slots,
        options,
      );
      expect(current.map((s) => s.id)).toEqual([10, 20, 30, 40]);
      current.forEach((s, i) =>
        expect(
          Math.hypot(s.x - previous[i].x, s.y - previous[i].y),
        ).toBeLessThan(0.055),
      );
      previous = current;
    }
  });
});
