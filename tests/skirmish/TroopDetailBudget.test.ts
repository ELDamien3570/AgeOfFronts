import { describe, expect, it } from "vitest";
import { SOLDIER_DETAIL_BUDGET, selectDetailedSquads, type DetailCandidate } from "../../src/skirmish/client/troops/TroopDetailBudget";

function mulberry(seed: number) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const crowd = (count: number, seed = 3): DetailCandidate[] => {
  const random = mulberry(seed);
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, soldiers: 20 + Math.floor(random() * 100),
    selected: random() < 0.05, distance: Math.floor(random() * 1_000_000) }));
};
const soldiers = (candidates: readonly DetailCandidate[], chosen: Set<number>) =>
  candidates.filter(c => chosen.has(c.id)).reduce((sum, c) => sum + c.soldiers, 0);

describe("U5 detailed-soldier budget", () => {
  it("defaults to the owner's 2,500 soldiers and never exceeds the budget", () => {
    expect(SOLDIER_DETAIL_BUDGET).toBe(2500);
    for (const seed of [1, 2, 3, 4]) {
      const candidates = crowd(200, seed), chosen = selectDetailedSquads(candidates);
      expect(soldiers(candidates, chosen)).toBeLessThanOrEqual(SOLDIER_DETAIL_BUDGET);
      expect(chosen.size).toBeGreaterThan(0);
      expect(chosen.size).toBeLessThan(200);
    }
  });

  it("serves selected squads first, then the nearest to the screen centre", () => {
    const candidates: DetailCandidate[] = [
      { id: 1, soldiers: 60, selected: false, distance: 1 },
      { id: 2, soldiers: 60, selected: true, distance: 900 },
      { id: 3, soldiers: 60, selected: false, distance: 4 },
      { id: 4, soldiers: 60, selected: false, distance: 9 },
    ];
    expect([...selectDetailedSquads(candidates, 120)].sort()).toEqual([1, 2]);
    expect([...selectDetailedSquads(candidates, 180)].sort()).toEqual([1, 2, 3]);
    // A squad that does not fit is skipped; a smaller one further out still fits.
    expect([...selectDetailedSquads([...candidates, { id: 5, soldiers: 10, selected: false, distance: 99 }], 130)].sort()).toEqual([1, 2, 5]);
  });

  it("chooses the same set for the same inputs in any order (no draw-order dependence)", () => {
    const candidates = crowd(300, 9), chosen = selectDetailedSquads(candidates);
    const shuffled = [...candidates].reverse();
    expect(selectDetailedSquads(shuffled)).toEqual(chosen);
    const ties = candidates.map(c => ({ ...c, distance: 5, selected: false }));
    expect(selectDetailedSquads(ties)).toEqual(selectDetailedSquads([...ties].reverse()));
  });

  it("puts every squad in the budget when the screen is light", () => {
    const candidates = crowd(10);
    expect(selectDetailedSquads(candidates).size).toBe(10);
  });
});
