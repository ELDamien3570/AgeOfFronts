/**
 * Procedural tileable noise — pure CPU, no GL (so it is unit-testable).
 *
 * Generates the RGBA8 noise image used by the terrain/territory shaders for
 * coast wobble, ripples, large soft colour variation and land grain. Each
 * channel is an independent two-octave value noise whose lattice wraps at the
 * image edge, so the texture tiles seamlessly with REPEAT wrapping.
 */

export const NOISE_SIZE = 256;

/**
 * Base lattice cells across the image per channel (R, G, B, A). Doubled for
 * the second octave. R/G are mid frequency (wobble, ripples), B is large
 * scale (patches, macro variation), A is fine (grain).
 */
const CHANNEL_CELLS = [16, 32, 4, 64] as const;

/** mulberry32: small, fast, deterministic seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wrapping value-noise octave sampled at every texel; values in [0, 1]. */
function valueNoiseOctave(
  size: number,
  cells: number,
  rand: () => number,
): Float32Array {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  const out = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * scale;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % cells) * cells;
    const yb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * scale;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const top = lattice[ya + xa] + (lattice[ya + xb] - lattice[ya + xa]) * sx;
      const bot = lattice[yb + xa] + (lattice[yb + xb] - lattice[yb + xa]) * sx;
      out[y * size + x] = top + (bot - top) * sy;
    }
  }
  return out;
}

/**
 * Build the noise image (size×size RGBA8, row-major). Deterministic for a
 * given seed; the four channels use independent random streams.
 */
export function generateNoiseData(
  seed: number,
  size: number = NOISE_SIZE,
): Uint8Array {
  const data = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    const rand = mulberry32((seed + 0x9e3779b9 * (c + 1)) >>> 0);
    const cells = CHANNEL_CELLS[c];
    const o1 = valueNoiseOctave(size, cells, rand);
    const o2 = valueNoiseOctave(size, cells * 2, rand);
    for (let i = 0; i < size * size; i++) {
      const v = o1[i] * 0.65 + o2[i] * 0.35;
      data[i * 4 + c] = Math.round(v * 255);
    }
  }
  return data;
}
