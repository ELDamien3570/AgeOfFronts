import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  CoastSearch,
  coastSearch,
} from "../../src/skirmish/domain/CoastSearch";
describe("bounded nearest coast search", () => {
  it("emits the same exact candidate order as a full sort and resumes its frontier", () => {
    const data = new Uint8Array(90 * 60).fill(133),
      map = new GameMapImpl(90, 60, data, data.length);
    const edges = Array.from({ length: 150 }, (_, i) => ({
      landTile: map.ref((i * 17) % 85, (i * 13) % 57),
      waterTile: map.ref(((i * 17) % 85) + 1, (i * 13) % 57),
    }));
    for (const origin of [undefined, map.ref(4, 7), map.ref(79, 55)]) {
      const destination = map.ref(40, 25),
        index = new CoastSearch(map, edges),
        expected = edges
          .map((edge, ordinal) => ({
            edge,
            ordinal,
            key:
              origin === undefined
                ? map.manhattanDist(edge.landTile, destination)
                : map.manhattanDist(origin, edge.landTile) +
                  map.manhattanDist(edge.waterTile, destination),
          }))
          .sort(
            (a, b) =>
              a.key - b.key ||
              a.edge.landTile - b.edge.landTile ||
              a.ordinal - b.ordinal,
          );
      let state = coastSearch();
      const actual = [];
      for (let work = 0; !state.done && work < 10000; work++) {
        const row = index.step(state, destination, origin);
        if (row) actual.push(row);
        if (work === 40) state = structuredClone(state);
      }
      expect(state.done).toBe(true);
      expect(actual).toEqual(expected);
    }
  });
});
