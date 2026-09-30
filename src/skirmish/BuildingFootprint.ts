import type { GameMap } from "../core/game/GameMap";
import type { BuildingType } from "./Protocol";

export interface GroundBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function buildingFootprintCells(type: BuildingType): number {
  return type === "city" ? 2.3 : 2;
}
export function buildingGroundBounds(
  map: GameMap,
  tile: number,
  type: BuildingType,
): GroundBounds {
  const radius = buildingFootprintCells(type) / 2,
    x = map.x(tile) + 0.5,
    y = map.y(tile) + 0.5;
  return {
    left: x - radius,
    right: x + radius,
    top: y - radius,
    bottom: y + radius,
  };
}

export function buildingClearedBounds(
  map: GameMap,
  tile: number,
  type: BuildingType,
): GroundBounds {
  const bounds = buildingGroundBounds(map, tile, type);
  return {
    left: Math.max(0, Math.floor(bounds.left)),
    top: Math.max(0, Math.floor(bounds.top)),
    right: Math.min(map.width(), Math.ceil(bounds.right)),
    bottom: Math.min(map.height(), Math.ceil(bounds.bottom)),
  };
}
