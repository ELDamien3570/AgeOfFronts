import { TerrainType } from "../../core/game/Game";
import type { GameMap } from "../../core/game/GameMap";
import { elevationOf } from "../Elevation";
import { forestOf } from "../Forest";
import { terrainSpeed } from "../Terrain";

const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export class TerrainViewModel {
  constructor(private readonly map: GameMap) {}
  describe(tile: number): string {
    const type = this.map.terrainType(tile);
    const terrain =
      type === TerrainType.Plains
        ? "Plains"
        : type === TerrainType.Highland
          ? "Highlands"
          : type === TerrainType.Mountain
            ? "Mountains"
            : "Water";
    const cover = forestOf(this.map)?.coverAt(tile) ?? 0;
    const movement = this.map.isWater(tile)
      ? "Water · no land movement"
      : `${terrain} · ${Math.round((terrainSpeed(this.map, tile) / 56) * 100)}% speed${cover > 0 ? ` · Forest ${Math.round(cover * 100)}% cover (−${Math.round(cover * 40)}%)` : ""}`;
    const elevation = elevationOf(this.map);
    return elevation
      ? `${movement} · ${format.format(elevation.heightAt(tile))} m elevation`
      : movement;
  }
}
