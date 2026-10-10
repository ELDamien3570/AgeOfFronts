import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { buildingClearedBounds } from "../../src/skirmish/BuildingFootprint";
import { heightmapGeography, latitudeAt } from "../../src/skirmish/Geography";
import { EARTH_ACCENTS } from "../../src/skirmish/client/EarthTerrainCatalog";
import {
  buildingTerrainFootprint,
  overlaps,
  TerrainDecorations,
} from "../../src/skirmish/client/TerrainDecorations";
import {
  approximateFamily,
  TerrainEnvironment,
} from "../../src/skirmish/client/TerrainEnvironment";

const bounds = { left: 0, top: 0, right: 192, bottom: 128 };
function fixture() {
  const bytes = new Uint8Array(192 * 128).fill(128),
    map = new GameMapImpl(192, 128, bytes, bytes.length),
    environment = new TerrainEnvironment(map);
  return { bytes, map, field: new TerrainDecorations(map, environment) };
}

describe("Earth terrain presentation", () => {
  it("uses the export's Mercator footprint and preserves latitude across resolutions", () => {
    const geography = heightmapGeography({
      url: "https://manticorp.github.io/unrealheightmap/#latitude/41.508545159505786/longitude/30.58607442197581/zoom/4/outputzoom/7/width/8192/height/4096/outputformat/png16",
      width: 8192,
      height: 4096,
    })!;
    expect(latitudeAt(geography, 0.5)).toBeCloseTo(41.508545159505786, 8);
    expect(geography.east - geography.west).toBeCloseTo(0.25);
    expect(geography.south - geography.north).toBeCloseTo(0.125);
    expect(latitudeAt(geography, 0)).toBeGreaterThan(latitudeAt(geography, 1));
    expect(latitudeAt(geography, 0.25)).not.toBeCloseTo(
      latitudeAt(geography, 0) * 0.75 + latitudeAt(geography, 1) * 0.25,
      2,
    );
    expect(heightmapGeography()).toBeUndefined();
    expect(
      heightmapGeography({
        url: "https://example.com/",
        width: 100,
        height: 100,
      }),
    ).toBeUndefined();
  });

  it("keeps coast, wet lowlands, alpine ground and cold regions distinct from forest guesses", () => {
    const family = (
      latitude: number,
      height: number,
      moisture: number,
      coastDistance: number,
    ) => approximateFamily({ latitude, height, moisture, coastDistance });
    expect(family(40, 100, 0.7, 8)).toBe("temperate-woodland");
    expect(family(58, 100, 0.7, 8)).toBe("boreal-conifer");
    expect(family(10, 100, 0.8, 8)).toBe("tropical-moist");
    expect(family(35, 100, 0.5, 8)).toBe("mediterranean-scrub");
    expect(family(48, 100, 0.4, 8)).toBe("grassland-steppe");
    expect(family(10, 100, 0.4, 8)).toBe("savanna-dry-woodland");
    expect(family(30, 100, 0.2, 8)).toBe("desert-xeric");
    expect(family(40, 100, 0.8, 2)).toBe("wetland-riparian");
    expect(family(40, 2100, 0.8, 8)).toBe("alpine");
    expect(family(67, 100, 0.8, 8)).toBe("tundra");
    expect(family(40, 100, 0.8, 1)).toBe("coastal");
    expect(family(78, 100, 0.8, 1)).toBe("polar-ice");
  });

  it("places the same approved, small accents every time without changing domain terrain", () => {
    const a = fixture(),
      b = fixture(),
      before = a.bytes.slice(),
      placed = Array.from(a.field.visible(bounds));
    expect(placed.length).toBeGreaterThan(300);
    expect(placed).toEqual(Array.from(b.field.visible(bounds)));
    expect(EARTH_ACCENTS).toHaveLength(48);
    for (const placement of placed) {
      const width = placement.bounds.right - placement.bounds.left,
        height = placement.bounds.bottom - placement.bounds.top;
      expect(Math.max(width, height)).toBeCloseTo(
        placement.accent.visibleFootprintCells,
      );
      expect(Math.max(width, height)).toBeLessThanOrEqual(2.1000001);
    }
    expect(a.bytes).toEqual(before);
  });

  it("never decorates water or crosses the land mask", () => {
    const bytes = new Uint8Array(64 * 64).fill(128);
    for (let y = 0; y < 64; y++)
      for (let x = 28; x < 36; x++) bytes[y * 64 + x] = 0;
    const map = new GameMapImpl(64, 64, bytes, 0),
      field = new TerrainDecorations(map, new TerrainEnvironment(map));
    for (const placed of field.visible(bounds))
      for (
        let y = Math.floor(placed.bounds.top);
        y < Math.ceil(placed.bounds.bottom);
        y++
      )
        for (
          let x = Math.floor(placed.bounds.left);
          x < Math.ceil(placed.bounds.right);
          x++
        ) {
          expect(map.isValidCoord(x, y)).toBe(true);
          expect(map.isLand(map.ref(x, y))).toBe(true);
        }
  });

  it("clears intersecting silhouettes, including accents centered on neighbouring tiles", () => {
    const { field, map } = fixture(),
      all = Array.from(field.visible(bounds)),
      placed = all[0],
      tile = map.ref(Math.floor(placed.x) + 1, Math.floor(placed.y)),
      footprint = buildingTerrainFootprint(map, tile, "city"),
      expected = all.filter(
        (accent) =>
          !overlaps(accent.bounds, buildingClearedBounds(map, tile, "city")),
      );
    expect(overlaps(placed.bounds, footprint)).toBe(true);
    expect(map.ref(Math.floor(placed.x), Math.floor(placed.y))).not.toBe(tile);
    const dirty = field.updateBuildings([{ tile, type: "city" }]);
    expect(dirty.length).toBeGreaterThan(0);
    expect(Array.from(field.visible(bounds))).toEqual(expected);
    expect(field.updateBuildings([{ tile, type: "city" }])).toEqual([]);
  });

  it("deduplicates stacks and keeps accents cleared until all intersecting sites are gone", () => {
    const { field, map } = fixture(),
      placed = Array.from(field.visible(bounds))[0],
      tile = map.ref(Math.floor(placed.x), Math.floor(placed.y)),
      a = { tile, type: "city" as const },
      b = { tile: tile + 1, type: "city" as const };
    field.updateBuildings([a, b]);
    expect(field.updateBuildings([a, a, a, b])).toEqual([]);
    field.updateBuildings([b]);
    expect(
      Array.from(field.visible(bounds)).some(
        (accent) => accent.id === placed.id,
      ),
    ).toBe(false);
    field.updateBuildings([]);
    expect(
      Array.from(field.visible(bounds)).some(
        (accent) => accent.id === placed.id,
      ),
    ).toBe(true);
  });

  it("clears accents whose core sits on a road and restores them when the road goes", () => {
    const { field, map } = fixture(),
      all = Array.from(field.visible(bounds)),
      placed = all[0],
      road = map.ref(Math.floor(placed.x), Math.floor(placed.y)),
      tiles = new Set([road]);
    const dirty = field.updateRoads(tiles);
    expect(dirty).toContainEqual(placed.imageBounds);
    const visible = Array.from(field.visible(bounds));
    expect(visible.some((accent) => accent.id === placed.id)).toBe(false);
    // A one-cell road removes only nearby accents, not the surrounding ground.
    expect(all.length - visible.length).toBeLessThanOrEqual(2);
    expect(field.updateRoads(new Set(tiles))).toEqual([]);
    // Shared clearing with a building keeps the accent hidden until both go.
    field.updateBuildings([{ tile: road, type: "city" }]);
    field.updateRoads(new Set());
    expect(
      Array.from(field.visible(bounds)).some((a) => a.id === placed.id),
    ).toBe(false);
    field.updateBuildings([]);
    expect(Array.from(field.visible(bounds))).toEqual(all);
  });

  it("reads road cells as cleared cover in the view only", () => {
    const { map } = fixture(),
      environment = new TerrainEnvironment(map),
      tile = map.ref(10, 10);
    environment.setRoads(new Set([tile]));
    expect(environment.coverAt(tile)).toBe(0);
  });
});
