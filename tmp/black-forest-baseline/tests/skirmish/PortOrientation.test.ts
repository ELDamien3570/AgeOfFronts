import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { portShoreRotation } from "../../src/skirmish/client/PortOrientation";
import { portWaterTiles } from "../../src/skirmish/PortWaterAccess";

function fixture(water: readonly [number, number][]) {
  const terrain = new Uint8Array(100).fill(133);
  for (const [x, y] of water) terrain[y * 10 + x] = 0;
  const map = new GameMapImpl(10, 10, terrain, 100 - water.length);
  return { map, tile: map.ref(4, 4) };
}

describe("cosmetic port shoreline orientation", () => {
  it.each([
    {
      water: [
        [4, 6],
        [5, 6],
      ],
      angle: 0,
    },
    {
      water: [
        [6, 4],
        [6, 5],
      ],
      angle: -Math.PI / 2,
    },
    {
      water: [
        [4, 3],
        [5, 3],
      ],
      angle: Math.PI,
    },
    {
      water: [
        [3, 4],
        [3, 5],
      ],
      angle: Math.PI / 2,
    },
  ])("faces the water edge with rotation $angle", ({ water, angle }) => {
    const { map, tile } = fixture(water as [number, number][]);
    expect(portShoreRotation(map, tile)).toBe(angle);
  });

  it("chooses the longer shoreline over a single water cell on another side", () => {
    const { map, tile } = fixture([
      [4, 6],
      [6, 4],
      [6, 5],
    ]);
    expect(portShoreRotation(map, tile)).toBe(-Math.PI / 2);
  });

  it("has a stable tie rule at corners and leaves berth priority untouched", () => {
    const { map, tile } = fixture([
      [4, 6],
      [5, 6],
      [6, 4],
      [6, 5],
    ]);
    const berths = portWaterTiles(map, tile);
    expect(portShoreRotation(map, tile)).toBe(0);
    expect(portWaterTiles(map, tile)).toEqual(berths);
  });

  it("ignores diagonal water and handles map edges without reading out of bounds", () => {
    const { map, tile } = fixture([
      [3, 3],
      [6, 6],
    ]);
    expect(portShoreRotation(map, tile)).toBe(0);
    expect(portShoreRotation(map, map.ref(0, 0))).toBe(0);
    expect(portShoreRotation(map, map.ref(8, 8))).toBe(0);
  });

  it("ignores impassable water when choosing the usable shoreline", () => {
    const { map, tile } = fixture([
      [4, 6],
      [5, 6],
      [6, 4],
    ]);
    const impassable = map.isImpassable.bind(map);
    map.isImpassable = (cell) =>
      cell === map.ref(4, 6) || cell === map.ref(5, 6) || impassable(cell);
    expect(portShoreRotation(map, tile)).toBe(-Math.PI / 2);
  });
});
