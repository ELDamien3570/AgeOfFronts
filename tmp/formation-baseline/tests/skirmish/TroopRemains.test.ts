import { describe, expect, it } from "vitest";
import {
  REMAINS,
  TroopRemains,
  type FallenTroop,
} from "./browser/TroopRemains";

const death: FallenTroop = {
  key: "8:3",
  artwork: "Clubman",
  x: 12,
  y: 9,
  angle: 1,
  size: 0.6,
  started: 1000,
  fallDuration: 750,
  seed: 29,
};

describe("world-space troop remains", () => {
  it("shrinks during the fall and retains a full body until the exact removal deadline", () => {
    const remains = new TroopRemains();
    remains.add(death);
    expect(remains.sample(1000)[0].bodyScale).toBe(1);
    expect(remains.sample(1375)[0].bodyScale).toBeCloseTo(0.975);
    expect(remains.sample(1750)[0].bodyScale).toBe(REMAINS.fallenScale);
    expect(remains.sample(20_999)[0].bodyVisible).toBe(true);
    expect(remains.sample(21_000)[0].bodyVisible).toBe(false);
  });
  it("leaves blood after body removal and expires it independently", () => {
    const remains = new TroopRemains();
    remains.add(death);
    const stain = remains.sample(21_000)[0];
    expect(stain.bloodGrowth).toBe(1);
    expect(stain.bodyVisible).toBe(false);
    expect(remains.sample(45_999)).toHaveLength(1);
    expect(remains.sample(46_000)).toHaveLength(0);
  });
  it("fades blood gradually without changing its grown footprint or body deadline", () => {
    const remains = new TroopRemains();
    remains.add(death);
    const early = remains.sample(death.started + 5000)[0];
    const middle = remains.sample(death.started + 25000)[0];
    const late = remains.sample(death.started + 44000)[0];
    expect(early.bloodOpacity).toBe(1);
    expect(middle.bloodOpacity).toBeCloseTo(0.5);
    expect(late.bloodOpacity).toBeLessThan(0.01);
    expect(
      [early, middle, late].every(
        (r) => r.bloodGrowth === 1 && r.size === death.size,
      ),
    ).toBe(true);
    expect(early.bodyVisible).toBe(true);
    expect(middle.bodyVisible).toBe(false);
    expect(remains.sample(death.started + REMAINS.bloodLifetime)).toHaveLength(
      0,
    );
  });
  it("freezes world poses, ignores repeated death records and clears on reset", () => {
    const remains = new TroopRemains();
    const source = { ...death };
    remains.add(source);
    source.x = 90;
    source.y = 70;
    remains.add({ ...source, started: 4000 });
    expect(remains.sample(5000)[0]).toMatchObject({
      x: 12,
      y: 9,
      angle: 1,
      started: 1000,
    });
    expect(remains.sample(5000)).toHaveLength(1);
    remains.clear();
    expect(remains.sample(5000)).toHaveLength(0);
  });
});
