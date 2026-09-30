import { TerrainType } from "../core/game/Game";
import type { GameMap } from "../core/game/GameMap";
import { GameMapImpl } from "../core/game/GameMap";
import type { LoadedMap } from "./Protocol";

export const MAPS = [
  { id: "world", name: "World · land skirmish" },
  { id: "fourislands", name: "Four Islands · one island" },
  { id: "thebox", name: "Training Square" },
] as const;

export function terrainSpeed(map: GameMap, tile: number): number {
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
  if (!MAPS.some((m) => m.id === id)) throw new Error("Unknown map");
  if (![250, 500, 1000].includes(worldSize))
    throw new Error("Unknown world size");
  const variant = id === "world" && worldSize === 1000 ? "map4x" : "map16x";
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
    Math.ceil(
      Math.max(metadata.width, metadata.height) /
        (id === "world" ? worldSize : 256),
    ),
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
    territoryIncomeScale: id === "world" ? (width * height) / (250 * 125) : 1,
  };
}
