import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { HEIGHTMAP_MAPS } from "../../content/Maps";
import { EnvironmentProfile } from "../../Environment";
import { generateForestCover } from "../../ForestGeneration";
import { decodeHeightmap, type HeightmapManifest } from "../../HeightmapMap";
import type { LobbySettings } from "../../lobby/LobbyDirectory";
import { resourceTerrainData } from "../../ResourceTerrain";
import type { RuntimeMap } from "../application/MatchExecutor";

export async function loadServerMap(
  settings: LobbySettings,
  resources = join(process.cwd(), "resources"),
): Promise<{ map: RuntimeMap; territoryIncomeScale: number }> {
  const definition = HEIGHTMAP_MAPS.find((map) => map.id === settings.mapId);
  if (!definition) throw new Error("Unsupported multiplayer map");
  const root = join(resources, "maps", definition.assetRoot);
  const manifest = JSON.parse(
    await readFile(join(root, "manifest.json"), "utf8"),
  ) as HeightmapManifest;
  const size = settings.worldSize;
  const [terrain, heights, environment] = await Promise.all([
    readFile(join(root, `${size}.terrain.bin`)),
    readFile(join(root, `${size}.heights.f32`)),
    manifest.environment
      ? readFile(join(root, `${size}.environment.bin`))
      : undefined,
  ]);
  const loaded = decodeHeightmap(
    manifest,
    size,
    new Uint8Array(terrain),
    new Uint8Array(heights).buffer,
    environment ? new Uint8Array(environment) : undefined,
  );
  const profile =
    loaded.environment ?? new EnvironmentProfile(loaded.map, loaded.geography);
  const forest = generateForestCover(loaded.map, profile);
  return {
    map: {
      width: loaded.map.width(),
      height: loaded.map.height(),
      terrain: loaded.terrain,
      elevation: loaded.elevation,
      forest,
      resourceTerrain: resourceTerrainData(loaded.map, profile),
    },
    territoryIncomeScale: loaded.territoryIncomeScale,
  };
}
