import { describe, expect, it } from "vitest";
import { SoldierSelectionIndex } from "../../src/skirmish/client/SoldierSelectionIndex";

describe("visible soldier selection", () => {
  it("reads the completed frame while the next frame is collected", () => {
    const index = new SoldierSelectionIndex();
    index.beginFrame();
    index.add(1, 20, 30, 0.2);
    index.commit();
    index.beginFrame();
    index.add(1, 25, 30, 0.2);
    expect(index.hitTest(1, { x: 20, y: 30 }, 12)).toBe(0);
    expect(index.hitTest(1, { x: 25, y: 30 }, 12)).toBeUndefined();
    index.commit();
    expect(index.hitTest(1, { x: 20, y: 30 }, 12)).toBeUndefined();
    expect(index.hitTest(1, { x: 25, y: 30 }, 12)).toBe(0);
  });
  it("removes dead, culled, and retired members when buffers are reused", () => {
    const index = new SoldierSelectionIndex();
    index.beginFrame();
    index.add(1, 1, 1, 0.2);
    index.add(1, 10, 10, 0.2);
    index.add(2, 20, 20, 0.2);
    index.commit();
    index.beginFrame();
    index.add(1, 1, 1, 0.2);
    index.commit();
    index.beginFrame();
    index.add(1, 1, 1, 0.2);
    index.commit();
    expect(index.hitTest(1, { x: 10, y: 10 }, 12)).toBeUndefined();
    expect(index.hitTest(2, { x: 20, y: 20 }, 12)).toBeUndefined();
    index.beginFrame();
    index.commit();
    expect(index.viewRadius(1, { x: 0, y: 0 })).toBe(0);
  });
  it("picks stray soldiers and intersects their body instead of their squad root", () => {
    const index = new SoldierSelectionIndex();
    index.beginFrame();
    index.add(7, 50, 30, 0.4);
    index.commit();
    expect(index.hitTest(7, { x: 50.1, y: 30 }, 12)).toBeCloseTo(1.44);
    expect(index.hitTest(7, { x: 50.1, y: 30 }, 24)).toBeCloseTo(5.76);
    expect(
      index.intersectsBox(7, { x1: 50.3, y1: 29.9, x2: 51, y2: 30.1 }),
    ).toBe(true);
    expect(
      index.intersectsBox(7, { x1: 50.5, y1: 29.9, x2: 51, y2: 30.1 }),
    ).toBe(false);
    expect(index.viewRadius(7, { x: 0, y: 30 })).toBeCloseTo(51.2);
    index.clear();
    expect(index.hitTest(7, { x: 50, y: 30 }, 12)).toBeUndefined();
    index.beginFrame();
    index.commit();
    expect(index.intersectsBox(7, { x1: 0, y1: 0, x2: 100, y2: 100 })).toBe(
      false,
    );
  });
});
