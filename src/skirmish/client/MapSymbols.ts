import { buildingFootprint } from "../BuildingFootprint";
import { CAPTURE_RADIUS, type BuildingType, type ShipType } from "../Protocol";
import type { FormationType } from "./FormationArtwork";
import {
  MAX_MELEE_LUNGE_RATIO,
  SPRITE_FOOTPRINT,
  squadSpriteSize,
} from "./UnitAnimation";
export { buildingFootprintCells } from "../BuildingFootprint";

// Presentation budgets are independent of terrain collision and weapon range.
const SQUAD_ART_MIN_PIXELS = 28;
const BUILDING_ART_MIN_PIXELS = 28;

export function squadSymbol(
  scale: number,
  troops: number,
  hasArtwork: boolean,
  formation: FormationType = "infantry",
) {
  const size = squadSpriteSize(scale, troops);
  const artwork = hasArtwork && size >= SQUAD_ART_MIN_PIXELS;
  const width = artwork ? size : Math.max(6, Math.min(28, size));
  const height = artwork
    ? size
    : formation === "siege"
      ? width
      : (width * 240) / 448;
  // Hug the standing troop formation; weapon swings extend beyond the pad.
  // Keep selection and viewport bounds independent of this cosmetic circle.
  const underlayRadius = artwork ? size * 0.35 + 1 : 0;
  return {
    artwork,
    width,
    height,
    underlayRadius,
    hitRadius: artwork
      ? size * Math.SQRT1_2 + 1.5
      : Math.hypot(
          width / 2,
          height * (formation === "siege" ? 0.5 : 128 / 240),
        ),
    viewRadius: artwork
      ? (size / SPRITE_FOOTPRINT) * Math.SQRT1_2 + size * MAX_MELEE_LUNGE_RATIO
      : Math.hypot(
          width / 2,
          height * (formation === "siege" ? 0.5 : 128 / 240),
        ),
  };
}

/** Conservative pre-artwork bound, including fallback formations and the
 * selected capture indicator. Uses the same LOD contract as final symbols. */
export function squadViewRadius(
  scale: number,
  troops: number,
  selected = false,
): number {
  const size = squadSpriteSize(scale, troops);
  return Math.max(
    (size / SPRITE_FOOTPRINT) * Math.SQRT1_2 + size * MAX_MELEE_LUNGE_RATIO,
    Math.max(6, Math.min(28, size)) * Math.SQRT1_2,
    selected ? CAPTURE_RADIUS * scale : 0,
  );
}

export function shipSpriteSize(
  scale: number,
  kind: ShipType = "warship",
): number {
  const cap = kind === "warship" ? 125 : 87.5;
  return Math.min(cap, scale * 2.4);
}

export function shipViewRadius(scale: number, kind: ShipType): number {
  return Math.max(60, ((shipSpriteSize(scale, kind) * 4) / 3) * 0.5 + 12);
}

export function shipSymbol(
  scale: number,
  hasFormationArtwork: boolean,
  kind: ShipType = "warship",
  hasShipArt = false,
) {
  const formation =
    !hasShipArt && hasFormationArtwork && scale * 2 < SQUAD_ART_MIN_PIXELS;
  if (hasShipArt) {
    const size = (shipSpriteSize(scale, kind) * 4) / 3;
    const hitRadius = size * 0.38;
    const viewRadius = size * 0.5 + 12;
    return {
      formation: false,
      width: size,
      height: size,
      hitRadius,
      viewRadius,
    };
  }
  const height = formation ? Math.max(8, Math.min(28, scale * 3)) : 22;
  const width = formation ? (height * 224) / 464 : 16;
  // Include the authored pivot's slight offset from the graphic's midpoint.
  const radius = formation ? Math.hypot(width / 2, (height * 240) / 464) : 15;
  return { formation, width, height, hitRadius: radius, viewRadius: radius };
}

export function buildingSymbol(
  scale: number,
  hasArtwork: boolean,
  type: BuildingType,
  selected = false,
) {
  const shape = buildingFootprint(type);
  const width = shape.width * scale,
    height = shape.height * scale;
  const artwork =
    hasArtwork && Math.min(width, height) >= BUILDING_ART_MIN_PIXELS;
  const backdropAlpha = artwork ? (selected ? 0.2 : 0) : 0.9;
  // Artwork, hit bounds and the occupied pad share placement dimensions.
  const inset = type === "city" ? 0 : scale * 0.075;
  return {
    artwork,
    size: artwork ? Math.max(width, height) : 18,
    footprintSize: Math.max(width, height),
    footprintWidth: width,
    footprintHeight: height,
    inset,
    backdropAlpha,
  };
}

export function traderSymbol(
  scale: number,
  hasArtwork: boolean,
  naval = false,
) {
  // Traders retain their own budget when soldier readability is adjusted.
  const cap = naval ? 77 : 44;
  const size = Math.min(cap, scale * 2);
  const artwork = hasArtwork && size >= SQUAD_ART_MIN_PIXELS;
  return {
    artwork,
    size: artwork ? size : Math.max(6, Math.min(naval ? 18 : 12, size)),
    viewRadius: artwork
      ? (size / SPRITE_FOOTPRINT) * Math.SQRT1_2
      : Math.max(6, Math.min(naval ? 18 : 12, size)) * Math.SQRT1_2,
  };
}
