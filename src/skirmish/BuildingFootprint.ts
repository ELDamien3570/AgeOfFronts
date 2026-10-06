import type { GameMap } from "../core/game/GameMap";
import type { BuildingType } from "./Protocol";

export interface GroundBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export function buildingFootprintCells(type: BuildingType): number {
  const shape = buildingFootprint(type);
  return Math.max(shape.width, shape.height);
}
export const BUILDING_BORDER = 1;
const SMALL = Object.freeze({ width: 1, height: 1 });
const MILITARY = Object.freeze({ width: 2, height: 2 });
const FOOTPRINTS: Record<
  BuildingType,
  Readonly<{ width: number; height: number }>
> = {
  city: { width: 3, height: 3 },
  barracks: MILITARY,
  archery: MILITARY,
  stables: MILITARY,
  "siege-workshop": MILITARY,
  "arms-factory": MILITARY,
  airstrip: { width: 2, height: 3 },
  factory: MILITARY,
  port: MILITARY,
  mine: SMALL,
  blacksmith: MILITARY,
  armory: MILITARY,
  depot: MILITARY,
  tower: SMALL,
  "oil-well": SMALL,
  "oil-rig": SMALL,
  "gun-nest": SMALL,
  trench: SMALL,
  "missile-silo": MILITARY,
  "mirv-launcher": MILITARY,
  "missile-defence": SMALL,
};
export const MAX_BUILDING_EXTENT = Math.max(...Object.values(FOOTPRINTS).flatMap(shape => [shape.width, shape.height]));
export function buildingFootprint(type: BuildingType) {
  return FOOTPRINTS[type];
}
/** Tile is the north-west occupied cell; bounds have exclusive right/bottom edges. */
export function buildingGroundBounds(
  map: GameMap,
  tile: number,
  type: BuildingType,
): GroundBounds {
  const shape = buildingFootprint(type),
    x = map.x(tile),
    y = map.y(tile);
  return {
    left: x,
    right: x + shape.width,
    top: y,
    bottom: y + shape.height,
  };
}
export function buildingReservationBounds(
  map: GameMap,
  tile: number,
  type: BuildingType,
): GroundBounds {
  const bounds = buildingGroundBounds(map, tile, type);
  return {
    left: bounds.left - BUILDING_BORDER,
    top: bounds.top - BUILDING_BORDER,
    right: bounds.right + BUILDING_BORDER,
    bottom: bounds.bottom + BUILDING_BORDER,
  };
}
export function boundsOverlap(a: GroundBounds, b: GroundBounds): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}
/** Keep the established forest/path-cost overlay independent of presentation sizing. */
export function buildingNavigationClearedBounds(
  map: GameMap,
  tile: number,
  type: BuildingType,
): GroundBounds {
  const radius = (type === "city" ? 2.3 : 2) / 2;
  const x = map.x(tile) + 0.5,
    y = map.y(tile) + 0.5;
  return {
    left: Math.max(0, Math.floor(x - radius)),
    top: Math.max(0, Math.floor(y - radius)),
    right: Math.min(map.width(), Math.ceil(x + radius)),
    bottom: Math.min(map.height(), Math.ceil(y + radius)),
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
