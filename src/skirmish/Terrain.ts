import { resourceTerrainData } from "./ResourceTerrain";
import { TerrainType } from "../core/game/Game";
import type { GameMap } from "../core/game/GameMap";
import { GameMapImpl } from "../core/game/GameMap";
import { HEIGHTMAP_MAPS } from "./content/Maps";
import { createSkirmishMap } from "./Elevation";
import { EnvironmentProfile } from "./Environment";
import { forestOf } from "./Forest";
import { generateForestCover } from "./ForestGeneration";
import { loadHeightmap } from "./HeightmapMap";
import type { LoadedMap } from "./Protocol";

export const MAPS = [
  ...HEIGHTMAP_MAPS.map(({ id, name }) => ({ id, name })),
  { id: "thebox", name: "Training Square" },
] as const;

export function terrainSpeed(map: GameMap, tile: number): number {
  return Math.round(
    baseTerrainSpeed(map, tile) *
      (1 - 0.4 * (forestOf(map)?.coverAt(tile) ?? 0)),
  );
}

export function baseTerrainSpeed(map: GameMap, tile: number): number {
  switch (map.terrainType(tile)) {
    case TerrainType.Plains:
      return 56;
    case TerrainType.Highland:
      return 35;
    case TerrainType.Mountain:
      return 20;
    default:
      return 0;
  }
}

export async function loadMap(id: string, worldSize = 500): Promise<LoadedMap> {
  const loaded = await loadBareMap(id, worldSize);
  const environment =
    loaded.environment ?? new EnvironmentProfile(loaded.map, loaded.geography);
  const forest = generateForestCover(loaded.map, environment);
  const resourceTerrain = resourceTerrainData(loaded.map, environment);
  return {
    ...loaded,
    map: createSkirmishMap(
      loaded.map.width(),
      loaded.map.height(),
      loaded.terrain,
      loaded.elevation,
      forest,
      resourceTerrain,
    ),
    forest,
    environment,
    resourceTerrain,
  };
}

async function loadBareMap(id: string, worldSize: number): Promise<LoadedMap> {
  if (!MAPS.some((m) => m.id === id)) throw new Error("Unknown map");
  if (![250, 500, 1000].includes(worldSize))
    throw new Error("Unknown world size");
  const heightmap = HEIGHTMAP_MAPS.find((map) => map.id === id);
  if (heightmap) return loadHeightmap(heightmap.assetRoot, worldSize);
  const variant = "map16x";
  const [manifestResponse, binaryResponse] = await Promise.all([
    fetch(`/maps/${id}/manifest.json`),
    fetch(`/maps/${id}/${variant}.bin`),
  ]);
  if (!manifestResponse.ok || !binaryResponse.ok)
    throw new Error("The map could not be loaded. Please try again.");
  const manifest = await manifestResponse.json();
  const source = new Uint8Array(await binaryResponse.arrayBuffer());
  const metadata = manifest[variant] as { width: number; height: number };
  if (source.length !== metadata.width * metadata.height)
    throw new Error("Invalid OpenFront terrain data");
  // Use OpenFront's original terrain bytes at a readable skirmish resolution.
  const stride = Math.max(
    1,
    Math.ceil(Math.max(metadata.width, metadata.height) / 256),
  );
  const width = Math.ceil(metadata.width / stride);
  const height = Math.ceil(metadata.height / stride);
  const terrain = new Uint8Array(width * height);
  let land = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(
        metadata.width - 1,
        x * stride + Math.floor(stride / 2),
      );
      const sy = Math.min(
        metadata.height - 1,
        y * stride + Math.floor(stride / 2),
      );
      const value = source[sy * metadata.width + sx];
      terrain[y * width + x] = value;
      if ((value & 128) !== 0 && (value & 31) < 31) land++;
    }
  }
  return {
    map: new GameMapImpl(width, height, terrain, land),
    terrain,
    name: `${manifest.name} · ${width}×${height}`,
    territoryIncomeScale: 1,
  };
}
