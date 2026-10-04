import { availableGold } from "./domain/Gold";
import type { GameMap } from "../core/game/GameMap";
import type { BuildingIndex } from "./BuildingIndex";
import type { Building, BuildingType, Player } from "./Protocol";
import { BUILDING_RULES, BUILDING_SPACING } from "./Rules";
import { coastalRanges } from "./content/CoastalTerritory";
import { buildingCostMultiplier } from "./content/Buildings";
import { coastalWaterDistances } from "./domain/CoastalReach";

// Shared domain validation also drives placement previews. A preview is advisory;
// applyCommand checks again against the current authoritative simulation state.
export const MAX_BUILDING_STACK = 15;
export function constructionRejection(
  map: GameMap,
  owners: Uint8Array,
  buildings:
    | readonly Building[]
    | (Pick<BuildingIndex, "nearby"> & {
        at?(tile: number): readonly Building[];
        countOfType?(playerId: number, type: BuildingType): number;
      }),
  player: Player | undefined,
  type: BuildingType,
  tile: number,
  checkFunds = true,
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
    return type === "oil-rig"
      ? "Oil rigs need claimed coastal water"
      : "Buildings need passable friendly land";
  if (
    type === "oil-rig" &&
    coastalWaterDistances(map)[tile] > coastalRanges(map).oilTiles
  )
    return "Oil rigs need claimed coastal water within the offshore oil band";
  if (type === "port" && !map.neighbors(tile).some((n) => map.isWater(n)))
    return "Ports need a land tile directly beside water";
  const stack = Array.isArray(buildings)
    ? (buildings as readonly Building[]).filter((b) => b.tile === tile)
    : "at" in buildings && typeof buildings.at === "function"
      ? (buildings.at(tile) ?? [])
      : [];
  if (stack.length > 0 && stack[0].type !== type)
    return "Only buildings of the same type can share a tile";
  if (stack.length >= MAX_BUILDING_STACK)
    return `A single site can support at most ${MAX_BUILDING_STACK} stacked buildings`;
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
  const existingCount = Array.isArray(buildings)
    ? (buildings as readonly Building[]).filter(
        (b) => b.playerId === player.id && b.type === type,
      ).length
    : "countOfType" in buildings && typeof buildings.countOfType === "function"
      ? buildings.countOfType(player.id, type)
      : 0;
  const cost = Math.round(
    BUILDING_RULES[type].cost * buildingCostMultiplier(existingCount),
  );
  if (checkFunds && availableGold(player) < cost)
    return "Not enough gold for this building";
  return null;
}
