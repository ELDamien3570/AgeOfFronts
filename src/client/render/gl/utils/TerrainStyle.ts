/**
 * Uniform-only terrain style, derived from `settings.terrain`. Everything here
 * can change live without re-baking the terrain textures (except `stylized`,
 * which also selects the colour-texture encoding and so goes through
 * rebuildTerrain).
 */

import type { RenderSettings } from "../RenderSettings";
import { hexToRgb } from "./ColorUtils";

export type Rgb01 = readonly [number, number, number];

export interface TerrainStyle {
  stylized: boolean;
  animate: boolean;
  shallow: Rgb01;
  deep: Rgb01;
  foam: Rgb01;
  wetSand: Rgb01;
  dirt: Rgb01;
  sand: Rgb01;
  plains: Rgb01;
  highland: Rgb01;
  mountain: Rgb01;
  rippleStrength: number;
  foamStrength: number;
  hillshadeStrength: number;
  grainStrength: number;
  macroVariation: number;
  zoomFadeStart: number;
  zoomFadeEnd: number;
}

const to01 = (hex: string, fallback: Rgb01): Rgb01 => {
  const c = hexToRgb(hex);
  return c ? [c[0] / 255, c[1] / 255, c[2] / 255] : fallback;
};

export function terrainStyleFromSettings(
  t: RenderSettings["terrain"],
): TerrainStyle {
  return {
    stylized: t.stylized,
    animate: t.waterAnimation,
    shallow: to01(t.shallowColor, [0.36, 0.78, 0.88]),
    deep: to01(t.deepColor || t.oceanColor, [0.18, 0.62, 0.82]),
    foam: to01(t.foamColor, [0.96, 0.98, 1]),
    wetSand: to01(t.wetSandColor, [0.64, 0.62, 0.45]),
    dirt: to01(t.dirtColor, [0.66, 0.56, 0.36]),
    sand: to01(t.sandColor, [0.8, 0.8, 0.62]),
    plains: to01(t.plainsColor, [0.75, 0.86, 0.54]),
    highland: to01(t.highlandColor, [0.86, 0.8, 0.62]),
    mountain: to01(t.mountainColor, [0.9, 0.9, 0.9]),
    rippleStrength: t.rippleStrength,
    foamStrength: t.foamStrength,
    hillshadeStrength: t.hillshadeStrength,
    grainStrength: t.grainStrength,
    macroVariation: t.macroVariation,
    zoomFadeStart: t.zoomFadeStart,
    zoomFadeEnd: t.zoomFadeEnd,
  };
}

/** Style with `stylized` off: reproduces the legacy flat look. */
export const LEGACY_TERRAIN_STYLE: TerrainStyle = {
  stylized: false,
  animate: false,
  shallow: [0.36, 0.78, 0.88],
  deep: [0.18, 0.62, 0.82],
  foam: [0.96, 0.98, 1],
  wetSand: [0.64, 0.62, 0.45],
  dirt: [0.66, 0.56, 0.36],
  sand: [0.8, 0.8, 0.62],
  plains: [0.75, 0.86, 0.54],
  highland: [0.86, 0.8, 0.62],
  mountain: [0.9, 0.9, 0.9],
  rippleStrength: 0,
  foamStrength: 0,
  hillshadeStrength: 0,
  grainStrength: 0,
  macroVariation: 0,
  zoomFadeStart: 2,
  zoomFadeEnd: 6,
};
