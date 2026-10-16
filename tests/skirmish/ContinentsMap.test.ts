import { SLOW_MAP_TIMEOUT } from "./fixtures/TestTimeouts";
import {TICKS_PER_SECOND} from '../../src/skirmish/Protocol';
import { describe, expect, it } from "vitest";
import { CONTINENTS_THEME } from "../../src/skirmish/content/Continents";
import { generateContinents } from "../../src/skirmish/ContinentsMap";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { mapIdentity } from "../../src/skirmish/multiplayer/application/MapIdentity";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { loadMap, terrainSpeed } from "../../src/skirmish/Terrain";

/** Count 4-connected water components. */
function waterComponents(size: number, regions: Uint8Array) {
  const seen = new Uint8Array(regions.length);
  let components = 0;
  for (let start = 0; start < regions.length; start++) {
    if (regions[start] || seen[start]) continue;
    components++;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const tile = stack.pop()!,
        x = tile % size;
      for (const next of [x > 0 ? tile - 1 : -1, x < size - 1 ? tile + 1 : -1, tile - size, tile + size])
        if (next >= 0 && next < regions.length && !regions[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
    }
  }
  return components;
}

describe("Continents layout", () => {
  for (const size of [250, 500, 1000] as const)
    it(`${size}: deterministic solo/server map, seed-dependent`, async () => {
      const a = await loadMap("continents", size, 5),
        b = await loadServerMap(defaultLobbySettings("continents", size), undefined, 5),
        c = await loadServerMap(defaultLobbySettings("continents", size), undefined, 6);
      const identity = (m: typeof a) =>
        mapIdentity({
          width: size,
          height: size,
          terrain: m.terrain,
          elevation: m.elevation,
          forest: m.forest,
          resourceTerrain: m.resourceTerrain,
        });
      expect(await identity(a)).toBe(await mapIdentity(b.map));
      expect(await mapIdentity(c.map)).not.toBe(await mapIdentity(b.map));
    }, SLOW_MAP_TIMEOUT);

  it("scales the continent count with map size", () => {
    for (const [size, [low, high]] of [
      [250, CONTINENTS_THEME.continentCounts[250]],
      [500, CONTINENTS_THEME.continentCounts[500]],
      [1000, CONTINENTS_THEME.continentCounts[1000]],
    ] as const) {
      const { layout } = generateContinents(size, 11);
      expect(layout.continentCount).toBeGreaterThanOrEqual(low);
      expect(layout.continentCount).toBeLessThanOrEqual(high);
      expect(layout.mainlands).toHaveLength(layout.continentCount);
      expect(layout.profiles).toHaveLength(layout.continentCount);
    }
    const counts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => generateContinents(1000, seed).layout.continentCount),
    );
    expect(counts).toEqual(new Set([4, 5]));
  }, SLOW_MAP_TIMEOUT);

  it("keeps all water connected to the ocean, with rivers and lakes present", () => {
    for (const [size, seed] of [[500, 3], [500, 21], [1000, 7]] as const) {
      const { layout } = generateContinents(size, seed);
      expect(waterComponents(size, layout.regions)).toBe(1);
      expect(layout.rivers.length).toBeGreaterThan(0);
      for (const lake of layout.lakes)
        expect(layout.regions[Math.floor(lake.y) * size + Math.floor(lake.x)]).toBe(0);
    }
  }, SLOW_MAP_TIMEOUT);

  it("gives continents distinct climates, relief and forest, with impassable ridges only where rugged", () => {
    const climates = new Set<string>();
    let rugged = 0,
      calm = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const m = generateContinents(500, seed),
        impassable = new Map<number, number>();
      for (let tile = 0; tile < m.terrain.length; tile++)
        if (m.map.isImpassable(tile)) {
          expect(terrainSpeed(m.map, tile)).toBe(400/TICKS_PER_SECOND);
          const id = m.layout.regions[tile];
          impassable.set(id, (impassable.get(id) ?? 0) + 1);
        }
      for (const profile of m.layout.profiles) {
        climates.add(profile.climate);
        if (profile.ruggedness < 0.25) {
          calm++;
          let area = 0;
          for (const id of m.layout.regions) area += Number(id === profile.id);
          expect((impassable.get(profile.id) ?? 0) / area).toBeLessThan(0.005);
        }
        if (profile.ruggedness > 0.75) rugged++;
      }
      for (const id of impassable.keys()) expect(id).toBeLessThanOrEqual(m.layout.continentCount);
    }
    expect(climates.size).toBeGreaterThanOrEqual(5);
    expect(rugged).toBeGreaterThan(0);
    expect(calm).toBeGreaterThan(0);
  }, SLOW_MAP_TIMEOUT);

  it("rejects invalid input", () => {
    expect(() => generateContinents(300, 1)).toThrow();
    expect(() => generateContinents(500, -1)).toThrow();
  });
});
