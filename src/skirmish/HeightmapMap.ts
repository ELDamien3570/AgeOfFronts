import { heightmapDimensions } from "./content/Maps";
import { ElevatedMap } from "./Elevation";
import { EnvironmentProfile } from "./Environment";
import { decodeEnvironmentData, ENVIRONMENT_ENCODING } from "./EnvironmentData";
import { heightmapGeography } from "./Geography";
import type { LoadedMap } from "./Protocol";
import { decodeClimateRegions, type ClimateRegion } from "./RegionalClimate";

export interface HeightmapManifest {
  schemaVersion: 1;
  name: string;
  minimum: number;
  maximum: number;
  seaLevel: number;
  source?: { url: string; width: number; height: number };
  variants: Record<string, { width: number; height: number }>;
  climate?: { description?: string; regions: ClimateRegion[] };
  environment?: { schemaVersion: 1; encoding: string };
}

// Explicit little-endian float encoding keeps baked assets portable. The source
// PNG is decoded offline at full 16-bit precision, never via 8-bit browser canvas.
export function decodeHeightmap(
  manifest: HeightmapManifest,
  size: number,
  terrain: Uint8Array,
  heightBytes: ArrayBuffer,
  environmentBytes?: Uint8Array,
): LoadedMap {
  const variant = manifest.variants?.[size];
  const dimensions = manifest.source
    ? heightmapDimensions(size, manifest.source.width, manifest.source.height)
    : { width: size, height: size / 2 };
  if (
    manifest.schemaVersion !== 1 ||
    !variant ||
    ![250, 500, 1000].includes(size) ||
    variant.width !== dimensions.width ||
    variant.height !== dimensions.height ||
    ![manifest.minimum, manifest.maximum, manifest.seaLevel].every(
      Number.isFinite,
    ) ||
    manifest.minimum >= manifest.maximum ||
    manifest.seaLevel < manifest.minimum ||
    manifest.seaLevel >= manifest.maximum ||
    terrain.length !== variant.width * variant.height ||
    heightBytes.byteLength !== terrain.length * 4
  )
    throw new Error("Invalid heightmap terrain assets");
  const values = new Float32Array(terrain.length),
    bytes = new DataView(heightBytes);
  for (let tile = 0; tile < values.length; tile++) {
    values[tile] = bytes.getFloat32(tile * 4, true);
    if (
      !Number.isFinite(values[tile]) ||
      values[tile] < manifest.minimum ||
      values[tile] > manifest.maximum
    )
      throw new Error("Invalid heightmap elevation samples");
  }
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
  if (
    manifest.environment &&
    (manifest.environment.schemaVersion !== 1 ||
      manifest.environment.encoding !== ENVIRONMENT_ENCODING ||
      !environmentBytes)
  )
    throw new Error("Invalid heightmap environment assets");
  const environmentData = manifest.environment
    ? decodeEnvironmentData(environmentBytes!, terrain.length)
    : undefined;
  return {
    map,
    terrain,
    elevation,
    geography,
    environmentData,
    environment: new EnvironmentProfile(
      map,
      geography,
      decodeClimateRegions(manifest.climate?.regions),
      environmentData,
    ),
    name: `${manifest.name} · ${variant.width}×${variant.height}`,
    territoryIncomeScale: (variant.width * variant.height) / (250 * 125),
    attribution: {
      label: "Elevation · Mapzen / Nextzen and others",
      url: "https://manticorp.github.io/unrealheightmap/rights.html",
    },
  };
}

export async function loadHeightmap(
  assetRoot: string,
  size: number,
): Promise<LoadedMap> {
  const root = `/maps/${assetRoot}`;
  const responses = await Promise.all([
    fetch(`${root}/manifest.json`),
    fetch(`${root}/${size}.terrain.bin`),
    fetch(`${root}/${size}.heights.f32`),
  ]);
  if (responses.some((response) => !response.ok))
    throw new Error("The heightmap assets could not be loaded");
  const [manifest, terrainBytes, heightBytes] = await Promise.all([
    responses[0].json(),
    responses[1].arrayBuffer(),
    responses[2].arrayBuffer(),
  ]);
  let environmentBytes: Uint8Array | undefined;
  if (manifest.environment) {
    const response = await fetch(`${root}/${size}.environment.bin`);
    if (!response.ok)
      throw new Error("The baked map environment could not be loaded");
    environmentBytes = new Uint8Array(await response.arrayBuffer());
  }
  return decodeHeightmap(
    manifest,
    size,
    new Uint8Array(terrainBytes),
    heightBytes,
    environmentBytes,
  );
}
