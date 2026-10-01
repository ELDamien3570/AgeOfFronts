/**
 * Terrain "fields" bake for the WebGL2 ground layer. Pure CPU, no GL.
 *
 * Produces a map-sized RGBA8 texture that is sampled with LINEAR filtering:
 *
 *   R  signed distance to the coastline in tiles, clamp(d, -8, 8) mapped to
 *      0..255 (decode: byte * 16 / 255 - 8). Negative = land, positive =
 *      water. Distance is measured from tile edges: a land tile next to water
 *      is -0.5 and the water tile across is +0.5, so the zero isoline lies
 *      between tiles. Impassable land counts as land.
 *   G  smoothed hillshade, 128 = flat, from a blurred copy of the continuous
 *      elevation field (never from quantized terrain bytes, whose gradient
 *      draws a line at every step). 128 everywhere when the map has no
 *      elevation.
 *   B  water depth, sqrt(clamp((seaLevel - height) / DEPTH_REFERENCE)) mapped
 *      to 0..255, blurred. 0 on land, and everywhere without elevation (the
 *      shader then falls back to coast distance).
 *   A  255.
 *
 * The signed distance uses a two-pass 3x3 chamfer transform (weights 1 and
 * sqrt(2)) run separately from land and from water, so the bake is O(n).
 */

/** Distance clamp range, in tiles. */
export const FIELD_RANGE = 8;
/** Water depth (metres) at which the depth channel saturates. */
export const DEPTH_REFERENCE = 400;
/** Hillshade is clamped to this many 8-bit colour steps, as `terrainRelief`. */
export const SHADE_LIMIT = 26;

const FIXED = 64;
const ORTHO = FIXED; // cost of an orthogonal step
const DIAG = Math.round(Math.SQRT2 * FIXED); // cost of a diagonal step
const CAP = (FIELD_RANGE + 2) * FIXED; // saturation value ("far")
const HALF = FIXED / 2; // 0.5 tile edge offset

/**
 * Two-pass chamfer distance transform over a w x h grid. `dist` is
 * initialised by the caller: 0 for source pixels, CAP elsewhere.
 */
function chamfer(dist: Uint16Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[i - 1] + ORTHO);
      if (y > 0) {
        const up = i - w;
        v = Math.min(v, dist[up] + ORTHO);
        if (x > 0) v = Math.min(v, dist[up - 1] + DIAG);
        if (x < w - 1) v = Math.min(v, dist[up + 1] + DIAG);
      }
      dist[i] = Math.min(v, CAP);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, dist[i + 1] + ORTHO);
      if (y < h - 1) {
        const dn = i + w;
        v = Math.min(v, dist[dn] + ORTHO);
        if (x < w - 1) v = Math.min(v, dist[dn + 1] + DIAG);
        if (x > 0) v = Math.min(v, dist[dn - 1] + DIAG);
      }
      dist[i] = Math.min(v, CAP);
    }
  }
}

/** Quantise a signed distance (tiles) to the R byte. */
export function encodeCoastDistance(d: number): number {
  const c = Math.max(-FIELD_RANGE, Math.min(FIELD_RANGE, d));
  return Math.round(((c + FIELD_RANGE) * 255) / (2 * FIELD_RANGE));
}

/** Inverse of encodeCoastDistance. */
export function decodeCoastDistance(byte: number): number {
  return (byte * 2 * FIELD_RANGE) / 255 - FIELD_RANGE;
}

/**
 * Signed coast distance in tiles for every tile of a land mask (non-zero =
 * land), clamped to +-FIELD_RANGE.
 */
export function bakeCoastDistance(
  land: ArrayLike<number>,
  w: number,
  h: number,
): Float32Array {
  const toLand = new Uint16Array(w * h),
    toWater = new Uint16Array(w * h);
  for (let i = 0; i < w * h; i++)
    if (land[i]) toWater[i] = CAP;
    else toLand[i] = CAP;
  chamfer(toLand, w, h);
  chamfer(toWater, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // Water: nearest-land centre distance minus half a tile; land: negated
    // nearest-water distance plus half a tile.
    const d = land[i]
      ? -(toWater[i] - HALF) / FIXED
      : (toLand[i] - HALF) / FIXED;
    out[i] = Math.max(-FIELD_RANGE, Math.min(FIELD_RANGE, d));
  }
  return out;
}

/** Separable box blur (edge-clamped), `passes` times, radius in tiles. */
export function blurField(
  source: Float32Array,
  w: number,
  h: number,
  radius: number,
  passes = 2,
): Float32Array {
  const a = Float32Array.from(source),
    b = new Float32Array(source.length);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let k = -radius; k <= radius; k++)
        sum += a[row + Math.max(0, Math.min(w - 1, k))];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / span;
        sum +=
          a[row + Math.min(w - 1, x + radius + 1)] -
          a[row + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++)
        sum += b[Math.max(0, Math.min(h - 1, k)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / span;
        sum +=
          b[Math.min(h - 1, y + radius + 1) * w + x] -
          b[Math.max(0, y - radius) * w + x];
      }
    }
  }
  return a;
}

export interface FieldInputs {
  width: number;
  height: number;
  /** Non-zero where the tile is land (impassable land included). */
  land: ArrayLike<number>;
  /** Continuous elevation per tile and sea level, when the map has them. */
  elevation?: { heights: Float32Array; seaLevel: number };
}

/** Smoothing radius (tiles) applied to elevation before shading and depth. */
const SMOOTH_RADIUS = 2;

/** Bake the RGBA8 fields texture for the whole map. */
export function bakeTerrainFields(input: FieldInputs): Uint8Array {
  const { width: w, height: h, land, elevation } = input;
  const out = new Uint8Array(w * h * 4);
  const coast = bakeCoastDistance(land, w, h);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = encodeCoastDistance(coast[i]);
    out[i * 4 + 1] = 128;
    out[i * 4 + 3] = 255;
  }
  if (elevation) {
    const { heights, seaLevel } = elevation;
    // Water reads as sea level for shading so coasts do not cast cliffs.
    const surface = new Float32Array(w * h),
      depth = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      surface[i] = land[i] ? heights[i] : seaLevel;
      depth[i] = land[i] ? 0 : Math.max(0, seaLevel - heights[i]);
    }
    const smooth = blurField(surface, w, h, SMOOTH_RADIUS),
      deep = blurField(depth, w, h, SMOOTH_RADIUS);
    const at = (x: number, y: number) =>
      smooth[
        Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))
      ];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (land[i]) {
          // Same fixed upper-left light and scale as `terrainRelief`.
          const gradient =
            at(x + 1, y) - at(x - 1, y) + at(x, y + 1) - at(x, y - 1);
          const shade = Math.max(
            -SHADE_LIMIT,
            Math.min(SHADE_LIMIT, gradient / 40),
          );
          out[i * 4 + 1] = Math.round(128 + (shade / SHADE_LIMIT) * 127);
        } else
          out[i * 4 + 2] = Math.round(
            Math.sqrt(Math.min(1, deep[i] / DEPTH_REFERENCE)) * 255,
          );
      }
  }
  return out;
}
