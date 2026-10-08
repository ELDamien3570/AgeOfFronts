import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";

describe("simulation radial enumeration", () => {
  it("visits exactly the walkable disk in stable tile order, including clipped edges and uncommon radii", () => {
    const terrain = Uint8Array.from({ length: 64 * 40 }, (_, i) => i % 17 ? 133 : 0);
    const map = new GameMapImpl(64, 40, terrain, terrain.length);
    const game = new Skirmish(map, { seed: 42, aiCount: 1, runAi: false });
    const visitor = game as unknown as {
      eachInRadius(center: number, radius: number, fn: (tile: number) => void): void;
    };
    for (const center of [0, 63, 2496, 2559, map.ref(1, 1), map.ref(32, 20)])
      for (let radius = 0; radius <= 9; radius++) {
        const expected: number[] = [], actual: number[] = [];
        for (let tile = 0; tile < terrain.length; tile++)
          if (map.euclideanDistSquared(center, tile) <= radius ** 2 && game.paths.walkable(tile)) expected.push(tile);
        visitor.eachInRadius(center, radius, tile => actual.push(tile));
        expect(actual).toEqual(expected);
      }
  });
});
