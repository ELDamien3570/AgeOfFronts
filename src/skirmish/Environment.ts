import { TerrainType } from "../core/game/Game";
import type { GameMap } from "../core/game/GameMap";
import { elevationOf, type ElevationField } from "./Elevation";
import { latitudeAt, type MapGeography } from "./Geography";
import { climateInfluence, type ClimateRegion } from "./RegionalClimate";
import { terrainNoise } from "./TerrainNoise";

export const ENVIRONMENT_FAMILIES = [
  "temperate-woodland",
  "boreal-conifer",
  "tropical-moist",
  "mediterranean-scrub",
  "grassland-steppe",
  "savanna-dry-woodland",
  "desert-xeric",
  "wetland-riparian",
  "alpine",
  "tundra",
  "coastal",
  "polar-ice",
] as const;
export type EnvironmentFamily = (typeof ENVIRONMENT_FAMILIES)[number];

export interface ApproximateClimate {
  latitude: number;
  height: number;
  moisture: number;
  coastDistance: number;
}

export function approximateFamily(
  climate: ApproximateClimate,
): EnvironmentFamily {
  const latitude = Math.abs(climate.latitude),
    cold = latitude + climate.height / 170,
    snowline = Math.max(1200, 3600 - latitude * 22);
  if (latitude >= 74 || climate.height >= snowline + 600) return "polar-ice";
  if (climate.height >= 1800) return "alpine";
  if (cold >= 65) return "tundra";
  if (climate.coastDistance <= 1) return "coastal";
  if (
    climate.coastDistance <= 2 &&
    climate.height < 600 &&
    climate.moisture > 0.65
  )
    return "wetland-riparian";
  if (cold >= 54 && climate.moisture > 0.4) return "boreal-conifer";
  if (latitude >= 18 && latitude <= 40 && climate.moisture < 0.36)
    return "desert-xeric";
  if (latitude < 25)
    return climate.moisture > 0.6 ? "tropical-moist" : "savanna-dry-woodland";
  if (latitude <= 43 && climate.moisture < 0.54 && climate.moisture >= 0.36)
    return "mediterranean-scrub";
  return climate.moisture < 0.48 ? "grassland-steppe" : "temperate-woodland";
}

// Deterministic provisional environmental inputs for forest map generation.
// No image metadata or rendering state participates in these estimates.
export class EnvironmentProfile {
  private readonly families: Uint8Array;
  private readonly moisture: Uint8Array;
  private readonly coastDistance: Uint8Array;
  private readonly latitude: Float32Array;
  private readonly woodlandBias: Uint8Array;
  private readonly heights?: ElevationField;
  constructor(
    private readonly map: GameMap,
    geography?: MapGeography,
    regions: readonly ClimateRegion[] = [],
  ) {
    const size = map.width() * map.height();
    this.families = new Uint8Array(size);
    this.moisture = new Uint8Array(size);
    this.coastDistance = new Uint8Array(size).fill(255);
    this.latitude = new Float32Array(map.height());
    this.woodlandBias = new Uint8Array(size);
    this.heights = elevationOf(map);
    // Multi-source distance transform, capped at 16 cells. Bounded linear work
    // happens once per map, never in draw() or in the simulation worker.
    const queue = new Uint32Array(size);
    let head = 0,
      tail = 0;
    for (let tile = 0; tile < size; tile++)
      if (map.isWater(tile)) {
        this.coastDistance[tile] = 0;
        queue[tail++] = tile;
      }
    while (head < tail) {
      const tile = queue[head++],
        distance = this.coastDistance[tile] + 1;
      if (distance > 16) continue;
      map.forEachNeighbor(tile, (neighbor) => {
        if (this.coastDistance[neighbor] <= distance) return;
        this.coastDistance[neighbor] = distance;
        queue[tail++] = neighbor;
      });
    }
    for (let y = 0; y < map.height(); y++) {
      // Unreferenced OpenFront/training maps use a temperate artistic baseline;
      // there is no invented geographic extent for those maps.
      this.latitude[y] = geography
        ? latitudeAt(geography, (y + 0.5) / map.height())
        : 40;
      for (let x = 0; x < map.width(); x++) {
        const tile = map.ref(x, y);
        if (!map.isLand(tile)) continue;
        const nx = (x * 500) / map.width(),
          ny = (y * 250) / map.height(),
          latitude = Math.abs(this.latitude[y]),
          subtropicalDry = latitude >= 18 && latitude <= 38 ? 0.12 : 0,
          proceduralMoisture = Math.max(
            0,
            Math.min(
              1,
              terrainNoise(nx + 113, ny - 89, 32) * 0.85 +
                0.18 -
                subtropicalDry -
                Math.min(16, this.coastDistance[tile]) * 0.004,
            ),
          );
        let moisture = proceduralMoisture,
          woodlandBias = 0;
        if (geography) {
          const longitude =
            (geography.west +
              (geography.east - geography.west) * ((x + 0.5) / map.width())) *
              360 -
            180;
          for (const region of regions) {
            const influence = climateInfluence(
              region,
              this.latitude[y],
              longitude,
            );
            // Combine overlapping regions by maximum, never accumulating them.
            moisture = Math.max(
              moisture,
              proceduralMoisture +
                Math.max(0, region.minimumMoisture - proceduralMoisture) *
                  influence,
            );
            woodlandBias = Math.max(
              woodlandBias,
              region.woodlandBias * influence,
            );
          }
        }
        this.woodlandBias[tile] = Math.round(woodlandBias * 255);
        this.moisture[tile] = Math.round(moisture * 255);
        const family = approximateFamily({
          latitude,
          height: this.heightAt(tile),
          moisture,
          coastDistance: this.coastDistance[tile],
        });
        this.families[tile] = ENVIRONMENT_FAMILIES.indexOf(family);
      }
    }
  }
  familyAt(tile: number): EnvironmentFamily {
    return ENVIRONMENT_FAMILIES[this.families[tile]];
  }
  moistureAt(tile: number): number {
    return this.moisture[tile] / 255;
  }
  woodlandBiasAt(tile: number): number {
    return this.woodlandBias[tile] / 255;
  }
  latitudeAt(tile: number): number {
    return this.latitude[this.map.y(tile)];
  }
  heightAt(tile: number): number {
    return (
      this.heights?.heightAt(tile) ??
      (this.map.terrainType(tile) === TerrainType.Mountain
        ? 2200
        : this.map.terrainType(tile) === TerrainType.Highland
          ? 900
          : 100)
    );
  }
  coastal(tile: number): boolean {
    return this.map.isLand(tile) && this.coastDistance[tile] === 1;
  }
  shallow(tile: number): boolean {
    return (
      this.map.isWater(tile) &&
      this.map.neighbors(tile).some((neighbor) => this.map.isLand(neighbor))
    );
  }
}
