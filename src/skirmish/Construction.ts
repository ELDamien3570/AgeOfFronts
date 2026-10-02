import type { GameMap } from "../core/game/GameMap";
import type { BuildingIndex } from "./BuildingIndex";
import type { Building, BuildingType, Player } from "./Protocol";
import { BUILDING_RULES, BUILDING_SPACING } from "./Rules";
import { coastalRanges } from "./content/CoastalTerritory";
import { coastalWaterDistances } from "./domain/CoastalReach";

// Shared domain validation also drives placement previews. A preview is advisory;
// applyCommand checks again against the current authoritative simulation state.
export function constructionRejection(
  map: GameMap,
  owners: Uint8Array,
  buildings: readonly Building[] | Pick<BuildingIndex, "nearby">,
  player: Player | undefined,
  type: BuildingType,
  tile: number,
): string | null {
  if (!player || !Object.prototype.hasOwnProperty.call(BUILDING_RULES, type))
    return "Unknown building";
  if (
    !Number.isInteger(tile) ||
    !map.isValidRef(tile) ||
    (type === "oil-rig" ? !map.isWater(tile) : !map.isLand(tile)) ||
    map.isImpassable(tile) ||
    owners[tile] !== player.id
  )
    return "Buildings need passable friendly land";
  if (type === "oil-rig" && coastalWaterDistances(map)[tile] > coastalRanges(map).oilTiles)
    return "Oil rigs need claimed coastal water within the offshore oil band";
  if (type === "port" && !map.neighbors(tile).some((n) => map.isWater(n)))
    return "Ports need a land tile directly beside water";
  const nearby =
    "nearby" in buildings
      ? buildings.nearby(tile, BUILDING_SPACING)
      : buildings;
  for (const b of nearby) {
    if (b.tile === tile) {
      if (b.type !== type)
        return "Only buildings of the same type can share a tile";
    } else if (map.euclideanDistSquared(b.tile, tile) < BUILDING_SPACING ** 2)
      return "Leave at least three tiles between separate building sites";
  }
  if (player.gold < BUILDING_RULES[type].cost)
    return "Not enough gold for this building";
  return null;
}
