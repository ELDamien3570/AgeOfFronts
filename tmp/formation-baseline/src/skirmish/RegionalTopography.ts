import { PseudoRandom } from "../core/PseudoRandom";
import { terrainNoise } from "./TerrainNoise";

export type LandformKind = "range" | "massif" | "plateau" | "basin" | "plain";
export interface Landform {
  id: number;
  kind: LandformKind;
  /** Normalized world coordinates, independent of raster resolution. */
  points: readonly { x: number; y: number }[];
  width: number;
  aspect: number;
  angle: number;
  elevation: number;
  phase: number;
}
export interface RegionalTopographyRecipe {
  counts: Readonly<Record<LandformKind, readonly [number, number]>>;
  heights: Readonly<Record<LandformKind, readonly [number, number]>>;
  widths: Readonly<Record<LandformKind, readonly [number, number]>>;
  rangeLength: readonly [number, number];
  rangeBend: number;
  maximumHeight: number;
  coastalBlend: readonly [number, number];
  /** Continental focus and world-wide regions coexist in the same recipe. */
  focusBounds: readonly [number, number, number, number];
  focusFraction: number;
}
const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Regional uplift and lowlands from landform primitives, detailed with spatial noise. */
export function createRegionalTopography(
  size: number,
  seed: number,
  recipe: RegionalTopographyRecipe,
) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0x7fffffff ||
    !Number.isFinite(recipe.maximumHeight) ||
    recipe.maximumHeight <= 0 ||
    recipe.coastalBlend.some(
      (value) => !Number.isFinite(value) || value <= 0,
    ) ||
    recipe.coastalBlend[1] < recipe.coastalBlend[0] ||
    !Number.isFinite(recipe.focusFraction) ||
    recipe.focusFraction < 0 ||
    recipe.focusFraction > 1 ||
    recipe.focusBounds.some(
      (value) => !Number.isFinite(value) || value < 0 || value > 1,
    ) ||
    recipe.focusBounds[2] <= recipe.focusBounds[0] ||
    recipe.focusBounds[3] <= recipe.focusBounds[1] ||
    recipe.rangeLength.some((value) => !Number.isFinite(value) || value <= 0) ||
    recipe.rangeLength[1] < recipe.rangeLength[0] ||
    !Number.isFinite(recipe.rangeBend) ||
    recipe.rangeBend < 0
  )
    throw new Error("Invalid regional topography recipe");
  for (const kind of [
    "range",
    "massif",
    "plateau",
    "basin",
    "plain",
  ] as const) {
    const counts = recipe.counts[kind],
      heights = recipe.heights[kind],
      widths = recipe.widths[kind];
    if (
      counts.some((value) => !Number.isInteger(value) || value < 0) ||
      counts[1] < counts[0] ||
      heights.some((value) => !Number.isFinite(value) || value < 0) ||
      heights[1] < heights[0] ||
      widths.some((value) => !Number.isFinite(value) || value <= 0) ||
      widths[1] < widths[0]
    )
      throw new Error("Invalid regional landform recipe");
  }
  const random = new PseudoRandom(seed ^ 0x658fc731),
    nx = random.nextInt(-10000, 10000),
    ny = random.nextInt(-10000, 10000),
    features: Landform[] = [];
  for (const kind of [
    "range",
    "massif",
    "plateau",
    "basin",
    "plain",
  ] as const) {
    const [minimum, maximum] = recipe.counts[kind],
      count = random.nextInt(minimum, maximum + 1);
    for (let i = 0; i < count; i++) {
      const bounds =
        i < count * recipe.focusFraction
          ? recipe.focusBounds
          : [0.08, 0.08, 0.92, 0.92];
      const angle = random.nextFloat(0, Math.PI * 2),
        cx = random.nextFloat(bounds[0], bounds[2]),
        cy = random.nextFloat(bounds[1], bounds[3]),
        length = random.nextFloat(...recipe.rangeLength),
        points: { x: number; y: number }[] = [];
      if (kind === "range") {
        let heading = angle,
          x = cx - Math.cos(angle) * length * 0.5,
          y = cy - Math.sin(angle) * length * 0.5;
        for (let step = 0; step < 8; step++) {
          points.push({ x, y });
          heading += random.nextFloat(-recipe.rangeBend, recipe.rangeBend);
          x += (Math.cos(heading) * length) / 7;
          y += (Math.sin(heading) * length) / 7;
        }
      } else points.push({ x: cx, y: cy });
      features.push({
        id: features.length,
        kind,
        points,
        width: random.nextFloat(...recipe.widths[kind]),
        aspect: random.nextFloat(0.6, 1.6),
        angle,
        elevation: random.nextFloat(...recipe.heights[kind]),
        phase: random.nextFloat(0, Math.PI * 2),
      });
    }
  }
  const raw = new Float32Array(size * size).fill(NaN),
    coast = new Float32Array(size * size);
  const sample = (x: number, y: number, shore: number) => {
    const tx = Math.max(0, Math.min(size - 1, Math.floor(x))),
      ty = Math.max(0, Math.min(size - 1, Math.floor(y))),
      tile = ty * size + tx;
    if (Number.isNaN(raw[tile])) {
      const px = (tx + 0.5) / size,
        py = (ty + 0.5) / size,
        wx =
          px +
          (terrainNoise(px * 1000 + nx, py * 1000 + ny, 125) - 0.5) * 0.035,
        wy =
          py +
          (terrainNoise(px * 1000 + nx + 791, py * 1000 + ny - 341, 125) -
            0.5) *
            0.035;
      let uplift = 0,
        plateau = 0,
        basin = 0,
        plain = 0;
      for (const f of features) {
        let distance = Infinity,
          along = 0;
        if (f.kind === "range") {
          for (let i = 1; i < f.points.length; i++) {
            const a = f.points[i - 1],
              b = f.points[i],
              dx = b.x - a.x,
              dy = b.y - a.y,
              t = Math.max(
                0,
                Math.min(
                  1,
                  ((wx - a.x) * dx + (wy - a.y) * dy) / (dx * dx + dy * dy),
                ),
              ),
              d = Math.hypot(wx - a.x - dx * t, wy - a.y - dy * t);
            if (d < distance) {
              distance = d;
              along = (i - 1 + t) / (f.points.length - 1);
            }
          }
          const d = distance / f.width,
            peaks =
              0.72 +
              0.22 * Math.sin(along * Math.PI * 7 + f.phase) +
              0.12 * terrainNoise(wx * 1000 + nx, wy * 1000 + ny, 19);
          uplift +=
            f.elevation *
            (Math.exp(-d * d * 1.5) * peaks + 0.16 * Math.exp(-d * d * 0.12));
        } else {
          const dx = wx - f.points[0].x,
            dy = wy - f.points[0].y,
            cos = Math.cos(f.angle),
            sin = Math.sin(f.angle),
            u = (dx * cos + dy * sin) / f.width,
            v = (-dx * sin + dy * cos) / (f.width * f.aspect),
            r = Math.hypot(u, v),
            mask = 1 - smooth((r - 0.45) / 0.85);
          if (f.kind === "massif")
            uplift +=
              f.elevation *
              Math.exp(-r * r * 2) *
              (0.8 + 0.2 * terrainNoise(wx * 1000 + nx, wy * 1000 + ny, 23));
          if (f.kind === "plateau")
            plateau = Math.max(
              plateau,
              f.elevation * (1 - smooth((r - 0.7) / 0.35)),
            );
          if (f.kind === "basin") basin = Math.max(basin, mask);
          if (f.kind === "plain") plain = Math.max(plain, mask);
        }
      }
      const broad = terrainNoise(wx * 1000 + nx, wy * 1000 + ny, 175),
        detail = terrainNoise(wx * 1000 + nx, wy * 1000 + ny, 12) - 0.5,
        foothills = terrainNoise(wx * 1000 + nx, wy * 1000 + ny, 42) - 0.5,
        base = 45 + broad * 210,
        elevated = Math.max(uplift, plateau) + Math.min(uplift, plateau) * 0.15;
      raw[tile] = Math.max(
        3,
        recipe.maximumHeight *
          Math.tanh(
            (base +
              elevated * (1 - basin * 0.88) * (1 - plain * 0.75) +
              foothills * (55 + elevated * 0.06) * (1 - plain) +
              detail * (12 + elevated * 0.025)) /
              recipe.maximumHeight,
          ),
      );
      // Plains form wide coastal lowlands; ranges may reach a steep coast.
      coast[tile] =
        (recipe.coastalBlend[0] +
          (recipe.coastalBlend[1] - recipe.coastalBlend[0]) *
            Math.max(
              plain,
              basin * 0.75,
              terrainNoise(px * 1000 + nx + 1971, py * 1000 + ny, 180) * 0.45,
            )) *
        size;
    }
    const fade = smooth(shore / Math.max(1, coast[tile]));
    return 1 + (raw[tile] - 1) * fade;
  };
  return { features: features as readonly Landform[], heightAt: sample };
}
