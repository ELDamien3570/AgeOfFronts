/**
 * Terrain "fields" bake — pure CPU, no GL.
 *
 * Produces a 2-channel (RG8) per-tile texture used for sub-tile terrain
 * rendering:
 *
 *   R  signed distance to the coastline in tiles, clamp(d, -8, 8) mapped to
 *      0..255 (decode: byte * 16 / 255 - 8). Negative = land, positive = water.
 *      Distance is measured from tile *edges*: a land tile adjacent to water
 *      is -0.5, the water tile on the other side +0.5, so the zero isoline
 *      sits between tiles. Impassable land counts as land.
 *   G  elevation: land magnitude / 30 (clamped to 1, impassable = 1), water 0.
 *
 * The signed distance uses a two-pass 3x3 chamfer transform (weights 1 and
 * sqrt(2)) run separately from land and from water, so the bake is O(n).
 * Distances are kept in 16-bit fixed point (1/FIXED tiles) and saturate just
 * past the clamp range, which also makes a windowed recompute exact for any
 * pixel at least FIELD_PAD tiles inside the window.
 */

/** Distance clamp range, in tiles. */
export const FIELD_RANGE = 8;
/**
 * Padding (tiles) added around a changed rect when recomputing incrementally.
 * Must exceed FIELD_RANGE so every texel whose value can change is covered and
 * the window edge cannot influence texels inside it.
 */
export const FIELD_PAD = 9;

const FIXED = 64;
const ORTHO = FIXED; // cost of an orthogonal step
const DIAG = Math.round(Math.SQRT2 * FIXED); // cost of a diagonal step
const CAP = (FIELD_RANGE + 2) * FIXED; // saturation value ("far")
const HALF = FIXED / 2; // 0.5 tile edge offset

export interface FieldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Terrain byte helpers (layout: bit7 land, bits0-4 magnitude). */
const isLandByte = (tb: number): boolean => (tb & 0x80) !== 0;

/**
 * Two-pass chamfer distance transform over a w×h window. `dist` is
 * initialised by the caller: 0 for source pixels, CAP elsewhere.
 */
function chamfer(dist: Uint16Array, w: number, h: number): void {
  // Forward pass: top-left to bottom-right.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x > 0) {
        const a = dist[i - 1] + ORTHO;
        if (a < v) v = a;
      }
      if (y > 0) {
        const up = i - w;
        const b = dist[up] + ORTHO;
        if (b < v) v = b;
        if (x > 0) {
          const c = dist[up - 1] + DIAG;
          if (c < v) v = c;
        }
        if (x < w - 1) {
          const d = dist[up + 1] + DIAG;
          if (d < v) v = d;
        }
      }
      dist[i] = v < CAP ? v : CAP;
    }
  }
  // Backward pass: bottom-right to top-left.
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x < w - 1) {
        const a = dist[i + 1] + ORTHO;
        if (a < v) v = a;
      }
      if (y < h - 1) {
        const dn = i + w;
        const b = dist[dn] + ORTHO;
        if (b < v) v = b;
        if (x < w - 1) {
          const c = dist[dn + 1] + DIAG;
          if (c < v) v = c;
        }
        if (x > 0) {
          const d = dist[dn - 1] + DIAG;
          if (d < v) v = d;
        }
      }
      dist[i] = v < CAP ? v : CAP;
    }
  }
}

/** Quantise a signed distance (tiles) to the R byte. */
export function encodeCoastDistance(d: number): number {
  const c = d < -FIELD_RANGE ? -FIELD_RANGE : d > FIELD_RANGE ? FIELD_RANGE : d;
  return Math.round(((c + FIELD_RANGE) * 255) / (2 * FIELD_RANGE));
}

/** Inverse of encodeCoastDistance. */
export function decodeCoastDistance(byte: number): number {
  return (byte * 2 * FIELD_RANGE) / 255 - FIELD_RANGE;
}

/** Elevation byte (G) for a terrain byte. */
export function encodeElevation(tb: number): number {
  if (!isLandByte(tb)) return 0;
  const e = (tb & 0x1f) / 30;
  return Math.round((e > 1 ? 1 : e) * 255);
}

/**
 * Bake fields for the window `rect` of a map-sized terrain array. Returns
 * rect.w * rect.h * 2 bytes (RG interleaved, row-major). Cost is O(rect area).
 */
export function bakeTerrainFieldsWindow(
  terrain: Uint8Array,
  mapW: number,
  rect: FieldRect,
): Uint8Array {
  const { x: x0, y: y0, w, h } = rect;
  const n = w * h;
  const out = new Uint8Array(n * 2);
  const toLand = new Uint16Array(n);
  const toWater = new Uint16Array(n);
  for (let y = 0; y < h; y++) {
    const src = (y0 + y) * mapW + x0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (isLandByte(terrain[src + x])) {
        toLand[row + x] = 0;
        toWater[row + x] = CAP;
      } else {
        toLand[row + x] = CAP;
        toWater[row + x] = 0;
      }
    }
  }
  chamfer(toLand, w, h);
  chamfer(toWater, w, h);
  for (let y = 0; y < h; y++) {
    const src = (y0 + y) * mapW + x0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const tb = terrain[src + x];
      // Water: nearest-land centre distance minus half a tile; land: negated
      // nearest-water distance plus half a tile.
      const d = isLandByte(tb)
        ? -(toWater[i] - HALF) / FIXED
        : (toLand[i] - HALF) / FIXED;
      out[i * 2] = encodeCoastDistance(d);
      out[i * 2 + 1] = encodeElevation(tb);
    }
  }
  return out;
}

/** Bake fields for the whole map: mapW * mapH * 2 bytes. */
export function bakeTerrainFields(
  terrain: Uint8Array,
  mapW: number,
  mapH: number,
): Uint8Array {
  return bakeTerrainFieldsWindow(terrain, mapW, {
    x: 0,
    y: 0,
    w: mapW,
    h: mapH,
  });
}

/** Expand `r` by `pad` tiles on every side, clamped to the map. */
export function padRect(
  r: FieldRect,
  mapW: number,
  mapH: number,
  pad: number = FIELD_PAD,
): FieldRect {
  const x0 = Math.max(0, r.x - pad);
  const y0 = Math.max(0, r.y - pad);
  const x1 = Math.min(mapW, r.x + r.w + pad);
  const y1 = Math.min(mapH, r.y + r.h + pad);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Incremental update: recompute the fields for `r` expanded by FIELD_PAD,
 * reading current terrain from the map-sized `terrain` array. Returns the
 * padded rect and its RG data, ready for texSubImage2D.
 *
 * The chamfer runs over a window a further FIELD_PAD larger and the result is
 * cropped, so texels at the edge of the uploaded rect still see land/water
 * sources just outside it and match a full bake exactly. Cost stays O(rect
 * area + perimeter * FIELD_PAD).
 */
export function bakeTerrainFieldsRect(
  terrain: Uint8Array,
  mapW: number,
  mapH: number,
  r: FieldRect,
): FieldRect & { data: Uint8Array } {
  const padded = padRect(r, mapW, mapH);
  const win = padRect(padded, mapW, mapH);
  const full = bakeTerrainFieldsWindow(terrain, mapW, win);
  const data = new Uint8Array(padded.w * padded.h * 2);
  const ox = padded.x - win.x;
  const oy = padded.y - win.y;
  for (let y = 0; y < padded.h; y++) {
    const src = ((oy + y) * win.w + ox) * 2;
    data.set(full.subarray(src, src + padded.w * 2), y * padded.w * 2);
  }
  return { ...padded, data };
}
