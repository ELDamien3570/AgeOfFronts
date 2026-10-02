import type { GameMap } from "../../core/game/GameMap";
import type { BuildingType } from "../Protocol";
import { BUILDING_SPACING } from "../Rules";
import type { Deposit } from "./Definitions";

/** Spatial facts shared by construction previews and authoritative validation. */
export class ResourceSiteIndex {
  private readonly nodes = new Map<number, Deposit>();
  private readonly exclusion = new Set<number>();
  private signature = "";
  constructor(private readonly map: GameMap) {}
  update(deposits: readonly Deposit[]): boolean {
    // Ownership and yield do not change placement exclusions.
    const signature = deposits
      .map((d) => `${d.id}:${d.tile}:${d.resource}`)
      .join("|");
    if (signature === this.signature) return false;
    this.signature = signature;
    this.nodes.clear();
    this.exclusion.clear();
    for (const node of deposits) {
      this.nodes.set(node.tile, node);
      if (node.resource === "horses" || !this.map.isLand(node.tile)) continue;
      const x = this.map.x(node.tile),
        y = this.map.y(node.tile);
      for (let dy = -BUILDING_SPACING + 1; dy < BUILDING_SPACING; dy++)
        for (let dx = -BUILDING_SPACING + 1; dx < BUILDING_SPACING; dx++) {
          if (
            dx * dx + dy * dy < BUILDING_SPACING ** 2 &&
            this.map.isValidCoord(x + dx, y + dy)
          )
            this.exclusion.add(this.map.ref(x + dx, y + dy));
        }
    }
    return true;
  }
  at(tile: number): Deposit | undefined {
    return this.nodes.get(tile);
  }
  rejection(type: BuildingType, tile: number): string | null {
    return !["mine", "oil-well", "oil-rig"].includes(type) &&
      this.exclusion.has(tile)
      ? "Leave room for resource extraction sites"
      : null;
  }
}
