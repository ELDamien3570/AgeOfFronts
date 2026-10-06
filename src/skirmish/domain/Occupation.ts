import type { GameMap } from "../../core/game/GameMap";
import type { BuildingIndex } from "../BuildingIndex";
import { DEFENSIVE_BUILDINGS } from "../content/Buildings";
import { CAPTURE_RADIUS, FIXED, type Squad } from "../Protocol";
import type { SpatialGrid } from "../SpatialGrid";
import type { Diplomacy } from "./Diplomacy";

// A defender whose occupation radius overlaps an assault's local footprint
// prevents accelerated capture, including units that cannot capture themselves.
// Use existing domain indexes; never scan a faction's whole frontier per unit.
export class Occupation {
  private readonly nearby: Squad[] = [];

  resisted(
    squad: Squad,
    tile: number,
    map: GameMap,
    squads: SpatialGrid<Squad>,
    buildings: BuildingIndex,
    diplomacy: Diplomacy,
  ): boolean {
    const radius = CAPTURE_RADIUS * 2;
    squads.query(squad.x, squad.y, radius * FIXED, this.nearby, squad.playerId);
    if (
      this.nearby.some(
        (s) =>
          s.troops > 0 &&
          s.embarkedOn === null &&
          !s.afloat &&
          diplomacy.hostile(squad.playerId, s.playerId),
      )
    )
      return true;
    for (const b of buildings.nearby(tile, radius))
      if (
        DEFENSIVE_BUILDINGS.includes(b.type) &&
        (b.health ?? 1) > 0 &&
        diplomacy.hostile(squad.playerId, b.playerId) &&
        map.euclideanDistSquared(tile, b.tile) <= radius ** 2
      )
        return true;
    return false;
  }
}
