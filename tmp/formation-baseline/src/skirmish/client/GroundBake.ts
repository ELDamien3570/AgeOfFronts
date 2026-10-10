// CPU bake of the per-tile base colour texture for the WebGL2 ground layer.
// Pure TypeScript, no GL. The colour of every land tile is exactly the colour
// the Canvas2D chunks paint, so biome palettes, forest darkening, noise shade
// and relief are unchanged.
//
// Water tiles are drawn procedurally by the shader, so their texels are free.
// Water texels that touch land hold the average of those land neighbours: with
// LINEAR sampling a coast pixel that the smoothed coastline calls land never
// blends in water blue.

export interface BakeSource {
  width: number;
  height: number;
  /** Non-zero where the tile is land. */
  land: ArrayLike<number>;
  /** Painted channels (may exceed 0..255) of the tile, as `paintedRgb`. */
  rgbAt(tile: number): readonly number[];
}

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clampByte = (value: number) => Math.max(0, Math.min(255, value));

function writeTexel(
  source: BakeSource,
  x: number,
  y: number,
  out: Uint8Array,
  at: number,
): void {
  const { width, height, land } = source,
    tile = y * width + x;
  let rgb: readonly number[];
  if (land[tile]) rgb = source.rgbAt(tile);
  else {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (!land[next]) continue;
        const c = source.rgbAt(next);
        r += clampByte(c[0]);
        g += clampByte(c[1]);
        b += clampByte(c[2]);
        n++;
      }
    rgb = n ? [r / n, g / n, b / n] : source.rgbAt(tile);
  }
  out[at] = clampByte(Math.round(rgb[0]));
  out[at + 1] = clampByte(Math.round(rgb[1]));
  out[at + 2] = clampByte(Math.round(rgb[2]));
  out[at + 3] = 255;
}

/** RGBA8 colour texels for the whole map, row-major. */
export function bakeGroundColors(source: BakeSource): Uint8Array {
  const { width, height } = source,
    out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      writeTexel(source, x, y, out, (y * width + x) * 4);
  return out;
}

const BLOCK = 16;

/**
 * Re-bake the texels of `tiles` and the ring around them (water neighbours of
 * a changed land tile inherit its colour). Writes into `full` and returns one
 * tight rect with contiguous RGBA data per 16-tile block that has changes, so
 * scattered edits never upload a large bounding box.
 */
export function rebakeGroundColors(
  source: BakeSource,
  full: Uint8Array,
  tiles: readonly number[],
): (TileRect & { data: Uint8Array })[] {
  const { width, height } = source,
    blocks = new Map<number, number[]>();
  for (const tile of tiles) {
    const key =
      Math.floor(Math.floor(tile / width) / BLOCK) * Math.ceil(width / BLOCK) +
      Math.floor((tile % width) / BLOCK);
    const list = blocks.get(key);
    if (list) list.push(tile);
    else blocks.set(key, [tile]);
  }
  const rects: (TileRect & { data: Uint8Array })[] = [];
  for (const list of blocks.values()) {
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    for (const tile of list) {
      const x = tile % width,
        y = Math.floor(tile / width);
      left = Math.min(left, x - 1);
      top = Math.min(top, y - 1);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(width - 1, right);
    bottom = Math.min(height - 1, bottom);
    const w = right - left + 1,
      h = bottom - top + 1,
      data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const at = ((top + y) * width + left + x) * 4;
        writeTexel(source, left + x, top + y, full, at);
        data.set(full.subarray(at, at + 4), (y * w + x) * 4);
      }
    rects.push({ x: left, y: top, w, h, data });
  }
  return rects;
}
