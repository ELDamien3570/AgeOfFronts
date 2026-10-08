import type { GameMap } from "../core/game/GameMap";
import {
  boundsOverlap,
  buildingGroundBounds,
  buildingReservationBounds,
} from "./BuildingFootprint";
import type { BuildingIndex } from "./BuildingIndex";
import type { Building, BuildingType, Player } from "./Protocol";
import { BUILDING_RULES } from "./Rules";
import { buildingCostMultiplier } from "./content/Buildings";
import { coastalRanges } from "./content/CoastalTerritory";
import { coastalWaterDistances } from "./domain/CoastalReach";
import { availableGold } from "./domain/Gold";

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
        reservationConflicts?(
          tile: number,
          type: BuildingType,
        ): Iterable<Building>;
        countOfType?(playerId: number, type: BuildingType): number;
      }),
  player: Player | undefined,
  type: BuildingType,
  tile: number,
  checkFunds = true,
): string | null {
  if (!player || !Object.prototype.hasOwnProperty.call(BUILDING_RULES, type))
    return "Unknown building";
  const terrain = buildingTerrainRejection(map, owners, player.id, type, tile);
  if (terrain) return terrain;
  const stack = Array.isArray(buildings)
    ? (buildings as readonly Building[]).filter((b) => b.tile === tile)
    : "at" in buildings && typeof buildings.at === "function"
      ? (buildings.at(tile) ?? [])
      : [];
  if (stack.length > 0 && stack[0].type !== type)
    return "Only buildings of the same type can share a tile";
  if (stack.length >= MAX_BUILDING_STACK)
    return `A single site can support at most ${MAX_BUILDING_STACK} stacked buildings`;
  const bounds = buildingReservationBounds(map, tile, type);
  const nearby =
    "reservationConflicts" in buildings && buildings.reservationConflicts
      ? buildings.reservationConflicts(tile, type)
      : "nearby" in buildings
        ? buildings.nearby(tile, 9)
        : buildings;
  for (const b of nearby) {
    if (b.tile === tile && b.type === type) continue;
    if (boundsOverlap(bounds, buildingReservationBounds(map, b.tile, b.type)))
      return "Leave a one-cell reserved border around each building";
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

/** Occupied cells are authoritative placement geometry; the reserved border may cross terrain and ownership. */
export function buildingTerrainRejection(
  map: GameMap,
  owners: Uint8Array,
  playerId: number,
  type: BuildingType,
  tile: number,
): string | null {
  const reason =
    type === "oil-rig"
      ? "Oil rigs need claimed coastal water"
      : "Buildings need passable friendly land";
  if (!Number.isInteger(tile) || !map.isValidRef(tile)) return reason;
  const bounds = buildingGroundBounds(map, tile, type);
  if (bounds.right > map.width() || bounds.bottom > map.height()) return reason;
  let coastal = false;
  for (let y = bounds.top; y < bounds.bottom; y++)
    for (let x = bounds.left; x < bounds.right; x++) {
      const cell = map.ref(x, y);
      if (
        map.isImpassable(cell) ||
        owners[cell] !== playerId ||
        (type === "oil-rig" ? !map.isWater(cell) : !map.isLand(cell))
      )
        return reason;
      if (
        type === "oil-rig" &&
        coastalWaterDistances(map)[cell] > coastalRanges(map).oilTiles
      )
        return "Oil rigs need claimed coastal water within the offshore oil band";
      if (type === "port" && map.neighbors(cell).some((n) => map.isWater(n)))
        coastal = true;
    }
  if (type === "port" && !coastal)
    return "Ports need occupied land directly beside water";
  return null;
}
