import { describe, expect, it } from "vitest";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { GameMapImpl, type GameMap } from "../../src/core/game/GameMap";
import { PathTopology, type PathMedium } from "../../src/skirmish/PathTopology";

// The pre-optimization neighbor enumeration, kept verbatim as the reference.
const DIAGONALS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
function reference(topology: PathTopology, map: GameMap, medium: PathMedium, tile: number, output: number[],
  blocked?: (tile: number) => boolean): number {
  let count = map.neighbors4(tile, output);
  if (medium === "water") return count;
  const x = map.x(tile), y = map.y(tile);
  for (const [dx, dy] of DIAGONALS) {
    if (!map.isValidCoord(x + dx, y + dy)) continue;
    const sideX = map.ref(x + dx, y), sideY = map.ref(x, y + dy);
    if (!topology.walkable(sideX) || !topology.walkable(sideY) || blocked?.(sideX) || blocked?.(sideY)) continue;
    if (medium === "amphibious") {
      const land = map.isLand(tile);
      if (map.isLand(sideX) !== land || map.isLand(sideY) !== land || map.isLand(map.ref(x + dx, y + dy)) !== land) continue;
    }
    output[count++] = map.ref(x + dx, y + dy);
  }
  return count;
}

describe("indexed path neighbors", () => {
  for (const medium of ["land", "water", "amphibious"] as const) {
    it(`matches the reference enumeration, order and blocked outcomes (${medium})`, () => {
      const random = new PseudoRandom(medium.length * 7919);
      const width = 37, height = 23, terrain = new Uint8Array(width * height);
      for (let i = 0; i < terrain.length; i++) terrain[i] = random.nextInt(0, 10) < 7 ? 133 : 0;
      const map = new GameMapImpl(width, height, terrain, terrain.filter(t => t).length);
      const topology = new PathTopology(map, medium);
      const fast: number[] = [], slow: number[] = [];
      let diagonals = 0, knownClearHits = 0;
      for (let trial = 0; trial < 40; trial++) {
        const mask = new Uint8Array(width * height).map(() => Number(random.nextInt(0, 6) === 0));
        const blocked = trial % 5 === 0 ? undefined : (tile: number) => mask[tile] === 1;
        for (let tile = 0; tile < width * height; tile++) {
          const calls: number[] = [], expectedCalls: number[] = [];
          const fastCount = topology.neighbors(tile, fast, blocked && (t => { calls.push(t); return blocked(t); }));
          const slowCount = reference(topology, map, medium, tile, slow, blocked && (t => { expectedCalls.push(t); return blocked(t); }));
          expect(fast.slice(0, fastCount)).toEqual(slow.slice(0, slowCount));
          diagonals += fastCount - map.neighbors4(tile, []);
          // Each side is asked at most once, and only sides the reference asks.
          expect(new Set(calls).size).toBe(calls.length);
          expect([...new Set(calls)].sort()).toEqual([...new Set(expectedCalls)].sort());
          if (blocked) {
            const sameBlocked = blocked;
            topology.neighbors(tile, fast, sameBlocked);
            for (let other = 0; other < width * height; other++)
              if (topology.knownClear(other, sameBlocked)) {
                knownClearHits++;
                expect(topology.walkable(other) && !sameBlocked(other)).toBe(true);
              }
            expect(topology.knownClear(tile, () => false)).toBe(false);
          }
        }
      }
      if (medium !== "water") { expect(diagonals).toBeGreaterThan(1000); expect(knownClearHits).toBeGreaterThan(1000); }
    });
  }
});
