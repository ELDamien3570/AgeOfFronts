import type { BuildingType, ShipType } from "../Protocol";
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

export function shipSpriteSize(
  scale: number,
  kind: ShipType = "warship",
): number {
  const cap = kind === "warship" ? 125 : 87.5;
  return Math.min(cap, scale * 2.4);
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
  const artwork = hasArtwork && scale >= BUILDING_ART_MIN_PIXELS;
  const backdropAlpha = artwork ? (selected ? 0.2 : 0) : 0.9;
  // One visual terrain cell, independent of domain clearing/placement rules.
  const inset = type === "city" ? 0 : scale * 0.075;
  return {
    artwork,
    size: artwork ? scale : 18,
    footprintSize: scale,
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
