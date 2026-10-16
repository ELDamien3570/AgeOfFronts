import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { PseudoRandom } from "../../src/core/PseudoRandom";
import { StartingPositions } from "../../src/skirmish/StartingPositions";

const NOT_ENOUGH_ROOM =
  "Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.";

function fixture(width = 90, height = 70, stride = 1) {
  const terrain = new Uint8Array(width * height).fill(133);
  const map = new GameMapImpl(width, height, terrain, terrain.length);
  const candidates: number[] = [];
  for (let y = 6; y < height - 6; y++)
    for (let x = 6; x < width - 6; x++)
      if ((x + y) % stride === 0) candidates.push(map.ref(x, y));
  return { map, candidates };
}
/** The pre-optimisation definition: every candidate's clearance over all adds. */
function bruteClearance(
  map: GameMapImpl,
  candidates: readonly number[],
  adds: readonly { tile: number; radius: number }[],
) {
  return new Map(
    candidates.map((candidate) => [
      candidate,
      adds.reduce(
        (least, { tile, radius }) =>
          Math.min(least, Math.sqrt(map.euclideanDistSquared(candidate, tile)) - radius),
        Infinity,
      ),
    ]),
  );
}

describe("windowed starting positions (R2-P5)", () => {
  it("keeps the eligible count equal to a full scan after every add", () => {
    const { map, candidates } = fixture(90, 70, 2);
    const radii = [3, 6];
    const positions = new StartingPositions(map, candidates, new PseudoRandom(5), { radii });
    const picker = new PseudoRandom(77);
    const adds: { tile: number; radius: number }[] = [];
    for (let i = 0; i < 25; i++) {
      const add = { tile: candidates[picker.nextInt(0, candidates.length)], radius: radii[i % 2] };
      adds.push(add);
      positions.add(add.tile, add.radius);
      const clearance = bruteClearance(map, candidates, adds);
      for (const radius of radii) {
        const expected = [...clearance.values()].filter((value) => value >= radius + 4).length;
        expect(positions.eligible(radius)).toBe(expected);
      }
    }
  });

  it("returns only eligible tiles, never repeats a camp, and is deterministic per seed", () => {
    const { map, candidates } = fixture();
    const run = (seed: number) => {
      const positions = new StartingPositions(map, candidates, new PseudoRandom(seed), { radii: [6, 3] });
      const adds: { tile: number; radius: number }[] = [];
      const picked: number[] = [];
      for (let i = 0; i < 12; i++) {
        const radius = i < 6 ? 6 : 3;
        const before = bruteClearance(map, candidates, adds);
        const tile = positions.next(radius);
        expect(before.get(tile)!).toBeGreaterThanOrEqual(radius + 4);
        adds.push({ tile, radius });
        picked.push(tile);
      }
      expect(new Set(picked).size).toBe(picked.length);
      return picked;
    };
    expect(run(9)).toEqual(run(9));
    expect(run(9)).not.toEqual(run(10));
  });

  it("throws the player-facing error when no tile has room, and still finds a lone eligible tile", () => {
    const { map, candidates } = fixture(40, 30);
    const full = new StartingPositions(map, candidates, new PseudoRandom(1), { radii: [6] });
    for (;;) {
      try {
        full.next(6);
      } catch (error) {
        expect((error as Error).message).toBe(NOT_ENOUGH_ROOM);
        break;
      }
    }
    expect(full.eligible(6)).toBe(0);
    // Cover the whole map except a small pocket so rejection sampling rarely hits it.
    const wide = fixture(200, 200);
    const positions = new StartingPositions(wide.map, wide.candidates, new PseudoRandom(3), { radii: [6] });
    const pocket = wide.map.ref(100, 100);
    for (let y = 6; y < 194; y += 6)
      for (let x = 6; x < 194; x += 6) {
        const tile = wide.map.ref(x, y);
        if (wide.map.euclideanDistSquared(tile, pocket) > 18 * 18) positions.add(tile, 6);
      }
    const remaining = positions.eligible(6);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(wide.candidates.length / 50);
    const tile = positions.next(6);
    expect(wide.map.euclideanDistSquared(tile, pocket)).toBeLessThanOrEqual(30 * 30);
  });

  it("resets a reused clearance buffer so attempts do not leak into each other", () => {
    const { map, candidates } = fixture();
    const clearance = new Float64Array(map.width() * map.height());
    const first = new StartingPositions(map, candidates, new PseudoRandom(2), { radii: [6], clearance });
    for (let i = 0; i < 8; i++) first.next(6);
    const second = new StartingPositions(map, candidates, new PseudoRandom(2), { radii: [6], clearance });
    expect(second.eligible(6)).toBe(candidates.length);
    const fresh = new StartingPositions(map, candidates, new PseudoRandom(2), { radii: [6] });
    for (let i = 0; i < 8; i++) expect(second.next(6)).toBe(fresh.next(6));
  });
});
