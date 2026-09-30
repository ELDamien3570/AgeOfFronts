import type { GameMap } from "../core/game/GameMap";
import type { EnvironmentProfile } from "./Environment";
import type { ForestData } from "./Forest";
import { terrainNoise } from "./TerrainNoise";

function smooth(low: number, high: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

// Generates land cover, never sprite placements. A shared field shapes whole
// stands before individual tree jitter is considered by the renderer.
export function generateForestCover(
  map: GameMap,
  environment: EnvironmentProfile,
): ForestData {
  const cover = new Uint8Array(map.width() * map.height());
  for (let y = 0; y < map.height(); y++)
    for (let x = 0; x < map.width(); x++) {
      const tile = map.ref(x, y);
      if (!map.isLand(tile) || map.isImpassable(tile)) continue;
      const family = environment.familyAt(tile),
        maximum =
          family === "temperate-woodland" ||
          family === "boreal-conifer" ||
          family === "tropical-moist"
            ? 1
            : family === "wetland-riparian"
              ? 0.8
              : family === "mediterranean-scrub"
                ? 0.45
                : family === "savanna-dry-woodland"
                  ? 0.3
                  : family === "coastal" &&
                      Math.abs(environment.latitudeAt(tile)) < 25 &&
                      environment.heightAt(tile) < 60 &&
                      environment.moistureAt(tile) > 0.6
                    ? 0.65
                    : 0;
      if (!maximum) continue;
      const nx = (x * 500) / map.width(),
        ny = (y * 250) / map.height(),
        wx = nx + (terrainNoise(nx + 71, ny - 53, 29) - 0.5) * 18,
        wy = ny + (terrainNoise(nx - 131, ny + 47, 29) - 0.5) * 18,
        stand = smooth(
          0.36,
          0.61,
          terrainNoise(wx + 211, wy - 307, 45) * 0.7 +
            terrainNoise(wx - 103, wy + 97, 17) * 0.25 +
            terrainNoise(wx + 19, wy + 53, 5) * 0.05 +
            environment.woodlandBiasAt(tile),
        ),
        clearing = smooth(0.62, 0.78, terrainNoise(wx - 421, wy + 239, 7)),
        moisture = Math.min(1, 0.65 + environment.moistureAt(tile) * 0.55);
      cover[tile] = Math.round(
        255 * maximum * stand * (1 - clearing) * moisture,
      );
    }
  return { cover };
}
