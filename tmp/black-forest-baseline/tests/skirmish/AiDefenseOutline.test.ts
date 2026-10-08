import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AiDefenseOutline } from "../../src/skirmish/domain/AiDefenseOutline";

describe("bounded terrain-aware city outlines", () => {
  function fixture() {
    const cells = new Uint8Array(80 * 80).fill(133), map = new GameMapImpl(80, 80, cells, cells.length);
    const blocked = new Set<number>();
    for (let y = 22; y <= 27; y++) for (let x = 30; x <= 38; x++) blocked.add(map.ref(x, y));
    return { map, blocked, bounds: { left: 24, top: 28, right: 44, bottom: 44 } };
  }
  it("bends a closed outline around a blocked side while preserving tower spacing and wall limits", () => {
    const { map, blocked, bounds } = fixture(), planner = new AiDefenseOutline(map, bounds, t => !blocked.has(t));
    for (let i = 0; i < 2000 && !["complete", "failed"].includes(planner.state.phase); i++)
      expect(planner.step(7)).toBeLessThanOrEqual(7);
    const result = planner.result()!; expect(result).toBeDefined();
    expect([...result.perimeter].some(t => blocked.has(t))).toBe(false);
    expect(result.towers.some(t => map.y(t) < 24)).toBe(true);
    expect(result.towers.length).toBeLessThanOrEqual(32); expect(result.perimeter.size).toBeLessThanOrEqual(384);
    for (let i = 0; i < result.towers.length; i++) {
      const a = result.towers[i], b = result.towers[(i + 1) % result.towers.length];
      expect(map.x(a) === map.x(b) || map.y(a) === map.y(b)).toBe(true);
      expect(map.manhattanDist(a, b)).toBeGreaterThanOrEqual(3); expect(map.manhattanDist(a,b)).toBeLessThanOrEqual(12);
    }
    // Independent point-in-polygon parity check: every protected city corner is inside.
    for (const [x, y] of [[24,28], [44,28], [44,44], [24,44]]) {
      let crossings = 0;
      for (let i = 0; i < result.towers.length; i++) {
        const a = result.towers[i], b = result.towers[(i + 1) % result.towers.length];
        if ((map.y(a) > y) !== (map.y(b) > y) && map.x(a) > x) crossings++;
      }
      expect(crossings % 2).toBe(1);
    }
  });
  it("resumes mid-search and path-copy identically and rejects an unenclosable coast", () => {
    const { map, blocked, bounds } = fixture(), allowed = (t:number) => !blocked.has(t);
    const a = new AiDefenseOutline(map, bounds, allowed); a.step(37);
    const b = new AiDefenseOutline(map, bounds, allowed, a.state);
    for (let i = 0; i < 2000 && !["complete", "failed"].includes(a.state.phase); i++) { a.step(5); b.step(5); }
    expect(a.state).toEqual(b.state); expect(a.result()).toEqual(b.result());
    const coast = new AiDefenseOutline(map, bounds, t => map.y(t) >= 28);
    coast.step(100); expect(coast.state.phase).toBe("failed"); expect(coast.result()).toBeUndefined();
  });
});
