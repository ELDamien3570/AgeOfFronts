// Screen-space styling: camera scale is CSS pixels per map tile, independent
// of devicePixelRatio. Zoom changes only compositing, never cached tile images.
import { TERRITORY_ALPHA } from "./TerritoryBorders";
export { TERRITORY_ALPHA } from "./TerritoryBorders";
export const TERRITORY_DETAIL_ALPHA = 0.05;
export const TERRITORY_BORDER_INK = "#172825";
export const TERRITORY_BORDER_LIGHT = "#f3e7c8";

function transition(value: number, from: number, to: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

export function territoryStyle(scale: number) {
  const detail = transition(scale, 2, 14);
  return {
    fillAlpha:
      TERRITORY_ALPHA + (TERRITORY_DETAIL_ALPHA - TERRITORY_ALPHA) * detail,
    accentAlpha: 0.85 * transition(scale, 2, 6),
    accentWidth: Math.min(3, scale * 0.28),
    accentInset: Math.min(2.2, scale * 0.22),
    casingWidth: 2.3 + detail * 0.3,
    lineWidth: 0.8,
  };
}
