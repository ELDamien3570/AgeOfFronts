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
  coverAt(tile: number) {
    return forestOf(this.map)?.coverAt(tile) ?? 0;
  }
  colorAt(tile: number): readonly number[] {
    if (this.map.isWater(tile))
      return this.profile.shallow(tile) ? [77, 128, 143] : [48, 91, 116];
    const base = FAMILY_COLORS.get(this.familyAt(tile))!,
      cover = this.coverAt(tile);
    return base.map(
      (value, channel) => value * (1 - cover * (channel === 1 ? 0.22 : 0.3)),
    );
  }
}
