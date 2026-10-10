import { expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FactionAdjacency } from "../../src/skirmish/FactionAdjacency";

it("matches independent border scans through ownership changes and rebuilds", () => {
  const width = 16, height = 12, data = new Uint8Array(width * height).fill(133);
  for (let x = 0; x < width; x++) data[5 * width + x] = 0;
  const map = new GameMapImpl(width, height, data, data.length), owners = new Uint8Array(data.length);
  const index = new FactionAdjacency(map, owners);
  const reference = (a: number, b: number) => {
    if (a === b || !a || !b) return false;
    for (let tile = 0; tile < owners.length; tile++) {
      if (owners[tile] !== a || !map.isLand(tile)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = map.x(tile) + dx, y = map.y(tile) + dy;
        if (map.isValidCoord(x, y) && map.isLand(map.ref(x, y)) && owners[map.ref(x, y)] === b) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < 240; i++) {
    const tile = (i * 37) % owners.length, previous = owners[tile];
    owners[tile] = (i * 7) % 5; index.changed(tile, previous);
    if (i % 19 === 0) index.rebuild();
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) expect(index.adjacent(a, b)).toBe(reference(a, b));
  }
  expect(index.retainedBytes).toBe(65 * 65 * 4);
});
