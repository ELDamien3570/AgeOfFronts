import test1Climate from "../../resources/maps/heightmap-test1/climate.json";
import { ElevatedMap } from "./Elevation";
import { EnvironmentProfile } from "./Environment";
import { heightmapGeography } from "./Geography";
import type { LoadedMap } from "./Protocol";

export interface HeightmapManifest {
  schemaVersion: 1;
  name: string;
  minimum: number;
  maximum: number;
  seaLevel: number;
  source?: { url: string; width: number; height: number };
  variants: Record<string, { width: number; height: number }>;
}

// Explicit little-endian float encoding keeps baked assets portable. The source
// PNG is decoded offline at full 16-bit precision, never via 8-bit browser canvas.
export function decodeHeightmap(
  manifest: HeightmapManifest,
  size: number,
  terrain: Uint8Array,
  heightBytes: ArrayBuffer,
): LoadedMap {
  const variant = manifest.variants?.[size];
  if (
    manifest.schemaVersion !== 1 ||
    !variant ||
    ![250, 500, 1000].includes(size) ||
    variant.width !== size ||
    variant.height !== size / 2 ||
    terrain.length !== variant.width * variant.height ||
    heightBytes.byteLength !== terrain.length * 4
  )
    throw new Error("Invalid heightmap terrain assets");
  const values = new Float32Array(terrain.length),
    bytes = new DataView(heightBytes);
  for (let tile = 0; tile < values.length; tile++)
    values[tile] = bytes.getFloat32(tile * 4, true);
  const elevation = {
    values,
    minimum: manifest.minimum,
    maximum: manifest.maximum,
    seaLevel: manifest.seaLevel,
  };
  const map = new ElevatedMap(
      variant.width,
      variant.height,
      terrain,
      elevation,
    ),
    geography = heightmapGeography(manifest.source);
  return {
    map,
    terrain,
    elevation,
    geography,
    environment: new EnvironmentProfile(map, geography, test1Climate.regions),
    name: `${manifest.name} · ${variant.width}×${variant.height}`,
    territoryIncomeScale: (variant.width * variant.height) / (250 * 125),
    attribution: {
      label: "Elevation · Mapzen / Nextzen and others",
      url: "https://manticorp.github.io/unrealheightmap/rights.html",
    },
  };
}

export async function loadHeightmap(size: number): Promise<LoadedMap> {
  const root = "/maps/heightmap-test1";
  const responses = await Promise.all([
    fetch(`${root}/manifest.json`),
    fetch(`${root}/${size}.terrain.bin`),
    fetch(`${root}/${size}.heights.f32`),
  ]);
  if (responses.some((response) => !response.ok))
    throw new Error("The heightmap test assets could not be loaded");
  const [manifest, terrainBytes, heightBytes] = await Promise.all([
    responses[0].json(),
    responses[1].arrayBuffer(),
    responses[2].arrayBuffer(),
  ]);
  return decodeHeightmap(
    manifest,
    size,
    new Uint8Array(terrainBytes),
    heightBytes,
  );
}
