import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEIGHTMAP_MAPS,
  heightmapDimensions,
} from "../../src/skirmish/content/Maps";
import { SpawnSelection } from "../../src/skirmish/domain/SpawnSelection";
import { latitudeAt } from "../../src/skirmish/Geography";
import {
  decodeHeightmap,
  type HeightmapManifest,
} from "../../src/skirmish/HeightmapMap";
import {
  defaultLobbySettings,
  validateLobbySettings,
} from "../../src/skirmish/lobby/LobbyDirectory";
import { LOBBY_MAP_IDS } from "../../src/skirmish/lobby/LobbyRules";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { decodeClimateRegions } from "../../src/skirmish/RegionalClimate";
import { Skirmish } from "../../src/skirmish/Simulation";
import { MAPS } from "../../src/skirmish/Terrain";

function heightmap(assetRoot: string, size = 250) {
  const root = `resources/maps/${assetRoot}`;
  const manifest: HeightmapManifest = JSON.parse(
    fs.readFileSync(`${root}/manifest.json`, "utf8"),
  );
  const heights = fs.readFileSync(`${root}/${size}.heights.f32`);
  return decodeHeightmap(
    manifest,
    size,
    new Uint8Array(fs.readFileSync(`${root}/${size}.terrain.bin`)),
    heights.buffer.slice(
      heights.byteOffset,
      heights.byteOffset + heights.length,
    ),
    manifest.environment
      ? new Uint8Array(fs.readFileSync(`${root}/${size}.environment.bin`))
      : undefined,
  );
}
const africa = (size = 250) => heightmap("africa", size);

function geographicTile(
  loaded: ReturnType<typeof heightmap>,
  lon: number,
  lat: number,
) {
  const geo = loaded.geography!;
  if (geo.projection !== "web-mercator")
    throw new Error("Expected Earth geography");
  const x = Math.floor(
    (((lon + 180) / 360 - geo.west) / (geo.east - geo.west)) *
      loaded.map.width(),
  );
  const y = Math.floor(
    (((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2 -
      geo.north) /
      (geo.south - geo.north)) *
      loaded.map.height(),
  );
  return loaded.map.ref(x, y);
}

describe("reviewed heightmap content contract", () => {
  it("loads Old World at all sizes with calibrated heights and viable faction starts", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = heightmap("old-world", size);
      const height = Math.round((size * 3) / 4);
      expect(loaded.map.width()).toBe(size);
      expect(loaded.map.height()).toBe(height);
      expect(loaded.terrain.length).toBe(size * height);
      expect(loaded.name).toBe(`Old World · ${size}×${height}`);
      expect(loaded.geography?.projection).toBe("web-mercator");
      const landPaths = new LandPaths(loaded.map, false);
      const waterPaths = new WaterPaths(loaded.map);
      let valid = true,
        water = 0,
        inlandWater = 0;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const elevation = loaded.elevation!.values[tile];
        valid &&=
          Number.isFinite(elevation) && elevation >= -450 && elevation <= 5353;
        valid &&= !loaded.map.isLand(tile) || elevation > 0;
        water += Number(loaded.map.isWater(tile));
        if (loaded.map.isWater(tile) && elevation > 0) {
          inlandWater++;
          valid &&= waterPaths.walkable(tile) && !landPaths.walkable(tile);
        }
      }
      expect(valid).toBe(true);
      expect(water).toBeGreaterThan(loaded.terrain.length * 0.2);
      expect(water).toBeLessThan(loaded.terrain.length * 0.8);
      expect(inlandWater).toBeGreaterThan(1000);
    }
    const loaded = heightmap("old-world");
    const match = new Skirmish(loaded.map, {
      ruleset: "ages-v1",
      aiCount: 14,
      humanNames: Array.from({ length: 6 }, (_, i) => `Human ${i + 1}`),
      tribes: false,
      runAi: false,
      seed: 42,
    });
    expect(match.players).toHaveLength(20);
    for (const player of match.players) {
      expect(loaded.map.isLand(player.base)).toBe(true);
      // Current spawn selection permits separate viable landmasses.
      const component = match.paths.component[player.base];
      expect(component).toBeGreaterThan(0);
      expect(
        match.paths.component.reduce(
          (count, value) => count + Number(value === component),
          0,
        ),
      ).toBeGreaterThanOrEqual(80);
    }
    match.step();
    expect(match.tick).toBe(1);
  });
  it("connects Old World's Congo and Ganges-Brahmaputra channels to the ocean at every size", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = heightmap("old-world", size);
      const paths = new WaterPaths(loaded.map);
      for (const [lon, lat, oceanLon, oceanLat] of [
        [15.274913, -4.300226, 11, -6],
        [85.142833, 25.641872, 90, 20],
        [94.440684, 27.016669, 90, 20],
      ]) {
        const inland = geographicTile(loaded, lon, lat);
        const ocean = geographicTile(loaded, oceanLon, oceanLat);
        expect(loaded.map.isWater(inland)).toBe(true);
        expect(loaded.map.isWater(ocean)).toBe(true);
        expect(paths.connected(inland, ocean)).toBe(true);
        expect(paths.find(inland, ocean)).not.toBeNull();
      }
    }
  });
  it("keeps Old World's Sahara drier than the Congo with authored climate regions", () => {
    const loaded = heightmap("old-world", 500);
    function meanMoisture(lon: number, lat: number) {
      const center = geographicTile(loaded, lon, lat);
      const x = loaded.map.x(center),
        y = loaded.map.y(center);
      let moisture = 0,
        count = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const tile = loaded.map.ref(x + dx, y + dy);
          if (!loaded.map.isLand(tile)) continue;
          moisture += loaded.environment!.moistureAt(tile);
          count++;
        }
      }
      expect(count).toBeGreaterThan(20);
      return moisture / count;
    }
    const sahara = meanMoisture(12, 25),
      congo = meanMoisture(23, -1);
    expect(sahara).toBeLessThan(0.3);
    expect(congo).toBeGreaterThan(0.75);
    expect(congo - sahara).toBeGreaterThan(0.4);
  });
  it("loads Amazon River in wide proportions with clear water and viable faction starts", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = heightmap("amazon-river", size);
      expect(loaded.map.width()).toBe(size);
      expect(loaded.map.height()).toBe(Math.round(size / 4));
      let valid = true,
        inlandWater = 0;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const h = loaded.elevation!.values[tile];
        valid &&= Number.isFinite(h) && (!loaded.map.isLand(tile) || h > 0);
        if (loaded.map.isWater(tile)) {
          valid &&= loaded.environmentData!.vegetation[tile] === 0;
          if (h > 0) inlandWater++;
        }
      }
      expect(valid).toBe(true);
      expect(inlandWater).toBeGreaterThan(100);
      for (const [lon, lat] of [
        [-52.711781, -1.583836],
        [-73.488637, -4.444838],
      ]) {
        const tile = geographicTile(loaded, lon, lat);
        expect(loaded.map.isWater(tile)).toBe(true);
        expect(loaded.terrain[tile] & 32).toBe(32); // Ocean-connected flood-fill class.
      }
    }
    const loaded = heightmap("amazon-river", 250);
    const match = new Skirmish(loaded.map, {
      ruleset: "ages-v1",
      // Twenty regular factions: six humans and the 14-AI cap.
      humanNames: ["H1", "H2", "H3", "H4", "H5", "H6"],
      aiCount: 14,
      tribes: false,
      runAi: false,
      seed: 41,
    });
    expect(match.players).toHaveLength(20);
    expect(
      match.players.every((player) => loaded.map.isLand(player.base)),
    ).toBe(true);
    match.step();
    expect(match.tick).toBe(1);
  });
  it("connects the Congo's downstream channel to the Atlantic at every map size", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = africa(size),
        paths = new WaterPaths(loaded.map);
      const inland = geographicTile(loaded, 13.184337, -5.856296);
      const ocean = geographicTile(loaded, 12.1, -6.1);
      expect(loaded.map.isWater(inland)).toBe(true);
      expect(loaded.map.isWater(ocean)).toBe(true);
      expect(paths.connected(inland, ocean)).toBe(true);
      expect(paths.find(inland, ocean)).not.toBeNull();
    }
  });
  it("gives Mediterranean inland rivers navigable water with no land walking or vegetation", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = heightmap("heightmap-test1", size),
        water = new WaterPaths(loaded.map),
        land = new LandPaths(loaded.map, false);
      let channels = 0;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        if (!loaded.map.isWater(tile) || loaded.elevation!.values[tile] <= 0)
          continue;
        channels++;
        expect(water.walkable(tile)).toBe(true);
        expect(land.walkable(tile)).toBe(false);
        expect(loaded.environmentData!.vegetation[tile]).toBe(0);
      }
      expect(channels).toBeGreaterThan(300);
    }
    const loaded = heightmap("heightmap-test1");
    const match = new Skirmish(loaded.map, {
      seed: 42,
      // Twenty regular factions: six humans and the 14-AI cap.
      humanNames: ["H1", "H2", "H3", "H4", "H5", "H6"],
      aiCount: 14,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    expect(match.players).toHaveLength(20);
    expect(
      match.players.every((player) => loaded.map.isLand(player.base)),
    ).toBe(true);
    match.step();
    expect(match.tick).toBe(1);
  });
  it("shares map identities between gameplay and lobbies, retains Mediterranean links, and retires base maps", () => {
    expect(LOBBY_MAP_IDS).toEqual(HEIGHTMAP_MAPS.map((map) => map.id));
    expect(MAPS.map((map) => map.id)).toEqual([
      "heightmap-test1",
      "africa",
      "amazon-river",
      "old-world",
      "new-world",
      "valles-kairulia",
      "thebox",
    ]);
    expect(MAPS[0].name).toBe("Mediterranean");
    for (const map of HEIGHTMAP_MAPS) {
      const manifest = JSON.parse(
        fs.readFileSync(
          `resources/maps/${map.assetRoot}/manifest.json`,
          "utf8",
        ),
      );
      expect(manifest.name).toBe(map.name);
      expect(manifest.source.width).toBe(map.sourceWidth);
      expect(manifest.source.height).toBe(map.sourceHeight);
    }
  });

  it("uses the longest edge without stretching square, wide or portrait sources", () => {
    expect(heightmapDimensions(500, 4096, 4096)).toEqual({
      width: 500,
      height: 500,
    });
    expect(heightmapDimensions(500, 8192, 2048)).toEqual({
      width: 500,
      height: 125,
    });
    expect(heightmapDimensions(1000, 6144, 8192)).toEqual({
      width: 750,
      height: 1000,
    });
    expect(heightmapDimensions(250, 300, 400)).toEqual({
      width: 188,
      height: 250,
    });
  });

  it("loads all three Africa variants with finite calibrated heights and coherent land/water", () => {
    for (const size of [250, 500, 1000]) {
      const loaded = africa(size);
      expect(loaded.map.width()).toBe(size);
      expect(loaded.map.height()).toBe(size);
      expect(loaded.terrain.length).toBe(size * size);
      expect(loaded.environmentData!.moisture.length).toBe(size * size);
      expect(loaded.environmentData!.vegetation.length).toBe(size * size);
      expect(loaded.environmentData!.aridity.length).toBe(size * size);
      let valid = true,
        water = 0;
      for (let tile = 0; tile < loaded.terrain.length; tile++) {
        const height = loaded.elevation!.values[tile];
        valid &&= Number.isFinite(height) && height >= -450 && height <= 2577;
        valid &&= !loaded.map.isLand(tile) || height > 0;
        if (loaded.map.isWater(tile))
          valid &&= loaded.environmentData!.vegetation[tile] === 0;
        water += Number(loaded.map.isWater(tile));
      }
      expect(valid).toBe(true);
      expect(water).toBeGreaterThan(size * size * 0.3);
      expect(
        loaded.elevation!.values.some(
          (height, tile) => height > 0 && loaded.map.isWater(tile),
        ),
      ).toBe(true);
      expect(loaded.name).toBe(`Africa · ${size}×${size}`);
    }
  });

  it("uses Africa's satellite gradients to separate dry interiors from humid woodland", () => {
    const loaded = africa(500),
      geo = loaded.geography!,
      profile = loaded.environment!;
    if (geo.projection !== "web-mercator")
      throw new Error("Expected Earth geography");
    let dryMoisture = 0,
      dryCount = 0,
      humidMoisture = 0,
      humidCount = 0;
    for (let tile = 0; tile < loaded.terrain.length; tile++) {
      if (!loaded.map.isLand(tile)) continue;
      const latitude = latitudeAt(geo, (loaded.map.y(tile) + 0.5) / 500);
      const longitude =
        (geo.west +
          (geo.east - geo.west) * ((loaded.map.x(tile) + 0.5) / 500)) *
          360 -
        180;
      if (
        latitude > -26 &&
        latitude < -22 &&
        longitude > 21 &&
        longitude < 25
      ) {
        dryMoisture += profile.moistureAt(tile);
        dryCount++;
      }
      if (latitude > -6 && latitude < -2 && longitude > 19 && longitude < 23) {
        humidMoisture += profile.moistureAt(tile);
        humidCount++;
      }
    }
    expect(dryCount).toBeGreaterThan(100);
    expect(humidCount).toBeGreaterThan(100);
    expect(dryMoisture / dryCount).toBeLessThan(0.35);
    expect(humidMoisture / humidCount).toBeGreaterThan(0.75);
    expect(() => decodeClimateRegions([{ latitude: 0 }])).toThrow("climate");
    expect(() =>
      decodeClimateRegions([
        {
          latitude: 0,
          longitude: 0,
          latitudeRadius: 1,
          longitudeRadius: 1,
          minimumMoisture: 0.8,
          maximumMoisture: 0.2,
          woodlandBias: 0,
        },
      ]),
    ).toThrow("climate");
  });

  it("starts twenty factions on viable Africa land and advances the simulation", () => {
    const loaded = africa();
    const match = new Skirmish(loaded.map, {
      seed: 42,
      // Twenty regular factions: six humans and the 14-AI cap.
      humanNames: ["H1", "H2", "H3", "H4", "H5", "H6"],
      aiCount: 14,
      runAi: false,
    });
    expect(match.players).toHaveLength(20);
    for (const player of match.players) {
      expect(match.map.isLand(player.base)).toBe(true);
      expect(match.paths.walkable(player.base)).toBe(true);
    }
    match.step();
    expect(match.tick).toBe(1);
  });
});

describe("small Amazon River lobbies", () => {
  it("starts with a territory income scale of at least 1", () => {
    const loaded = heightmap("amazon-river", 250);
    expect(loaded.territoryIncomeScale).toBe(1);
    const match = new Skirmish(loaded.map, {
      seed: 3,
      ...defaultLobbySettings("amazon-river", 250),
      humanNames: ["A", "B"],
      tribes: true,
      ruleset: "ages-v1",
      territoryIncomeScale: loaded.territoryIncomeScale,
    });
    expect(match.players).toHaveLength(2 + 6 + 20);
  });

  it("only accepts lobbies whose full roster fits on the map", () => {
    const loaded = heightmap("amazon-river", 250);
    const base = defaultLobbySettings("amazon-river", 250);
    expect(validateLobbySettings(base)).toBeTruthy();
    for (const aiCount of [0, 7, 14]) {
      // Largest tribe count the rule accepts with all 20 human seats filled.
      let tribeCount = 30;
      const settings = () => ({ ...base, aiCount, tribeCount });
      while (tribeCount > 0) {
        try {
          validateLobbySettings(settings());
          break;
        } catch {
          tribeCount--;
        }
      }
      if (tribeCount < 30)
        expect(() =>
          validateLobbySettings({ ...settings(), tribeCount: tribeCount + 1 }),
        ).toThrow("too small");
      for (let seed = 1; seed <= 6; seed++)
        expect(() =>
          new SpawnSelection(loaded.map, {
            seed,
            aiCount,
            tribes: true,
            tribeCount,
            humanNames: Array.from({ length: 20 }, (_, i) => `H${i}`),
          }).resolve(),
        ).not.toThrow();
    }
    // Larger map sizes are not limited.
    expect(
      validateLobbySettings({
        ...defaultLobbySettings("amazon-river", 500),
        aiCount: 14,
        tribeCount: 30,
      }),
    ).toBeTruthy();
  }, 60_000);
});
