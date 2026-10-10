import type { GameMap } from "../../core/game/GameMap";
import { EnvironmentProfile } from "../Environment";
import { forestOf } from "../Forest";
import type { MapGeography } from "../Geography";
import { FAMILY_COLORS } from "./EarthTerrainCatalog";
export { approximateFamily } from "../Environment";

// View model for the authoritative environment and effective forest cover.
// Palettes and dark woodland ground are disposable presentation only.
export class TerrainEnvironment {
  readonly profile: EnvironmentProfile;
  constructor(
    private readonly map: GameMap,
    geography?: MapGeography,
    profile?: EnvironmentProfile,
  ) {
    this.profile = profile ?? new EnvironmentProfile(map, geography);
  }
  familyAt(tile: number) {
    return this.profile.familyAt(tile);
  }
  moistureAt(tile: number) {
    return this.profile.moistureAt(tile);
  }
  latitudeAt(tile: number) {
    return this.profile.latitudeAt(tile);
  }
  heightAt(tile: number) {
    return this.profile.heightAt(tile);
  }
  // Road tiles read as cleared ground in the view only. Trade roads are
  // cosmetic, so authoritative cover (movement, tooltips) stays unchanged.
  private roads: ReadonlySet<number> = new Set();
  setRoads(tiles: ReadonlySet<number>): void {
    this.roads = tiles;
  }
  coverAt(tile: number) {
    if (this.roads.has(tile)) return 0;
    return forestOf(this.map)?.coverAt(tile) ?? 0;
  }
  colorAt(tile: number): readonly number[] {
    if (this.map.isWater(tile))
      return this.profile.shallow(tile) ? [77, 128, 143] : [48, 91, 116];
    const family = this.familyAt(tile);
    let base: readonly number[] = FAMILY_COLORS.get(family)!;
    const aridity = this.profile.aridityAt(tile),
      vegetation = this.profile.vegetationAt(tile);
    if (
      aridity !== undefined &&
      vegetation !== undefined &&
      !["alpine", "polar-ice", "tundra", "coastal"].includes(family)
    ) {
      const grass = FAMILY_COLORS.get("grassland-steppe")!,
        desert = FAMILY_COLORS.get("desert-xeric")!,
        forest = FAMILY_COLORS.get(
          Math.abs(this.latitudeAt(tile)) < 25
            ? "tropical-moist"
            : family === "boreal-conifer"
              ? "boreal-conifer"
              : "temperate-woodland",
        )!;
      // Continuous evidence gives gentle ground-color transitions. Semantic
      // families still select objects; raw albedo imagery is never drawn here.
      const dry = grass.map(
        (value, channel) => value * (1 - aridity) + desert[channel] * aridity,
      );
      const green = Math.min(1, vegetation * (1 - aridity));
      base = dry.map(
        (value, channel) => value * (1 - green) + forest[channel] * green,
      );
    }
    const cover = this.coverAt(tile);
    return base.map(
      (value, channel) => value * (1 - cover * (channel === 1 ? 0.22 : 0.3)),
    );
  }
}
