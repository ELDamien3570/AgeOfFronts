import type { Landform } from "./RegionalTopography";
import { buildTerrainDrainage } from "./TerrainDrainage";
import { terrainNoise } from "./TerrainNoise";

export interface TerrainDissectionRecipe {
  strength: number;
  drainagePasses: number;
  incision: number;
  boundaryOutlets?: boolean;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** Selected-resolution landform dissection. The regional surface supplies the
 * geological envelope, but no coarse raster is used for final ridge detail or
 * drainage. Dry tributaries shape land without making every gully navigable water.
 */
export function dissectTerrain(
  size: number,
  land: Uint8Array,
  heights: Float32Array,
  shore: Float32Array,
  features: readonly Landform[],
  seed: number,
  recipe: TerrainDissectionRecipe,
): void {
  if (
    land.length !== size * size ||
    heights.length !== land.length ||
    shore.length !== land.length ||
    !Number.isFinite(recipe.strength) ||
    recipe.strength < 0 ||
    recipe.strength > 2 ||
    !Number.isInteger(recipe.drainagePasses) ||
    recipe.drainagePasses < 0 ||
    recipe.drainagePasses > 4 ||
    !Number.isFinite(recipe.incision) ||
    recipe.incision < 0 ||
    recipe.incision > 1000
  )
    throw new Error("Invalid terrain dissection recipe");
  const original = heights.slice(),
    resistance = new Float32Array(land.length),
    sx = (seed % 7919) + 321,
    sy = (seed % 104729) + 719,
    regions = features
      .filter(
        (f) => f.kind === "plain" || f.kind === "basin" || f.kind === "plateau",
      )
      .map((f) => ({ ...f, cos: Math.cos(f.angle), sin: Math.sin(f.angle) }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      if (!land[tile]) continue;
      const nx = (x + 0.5) / size,
        ny = (y + 0.5) / size,
        h = original[tile],
        coastal = clamp(shore[tile] / (size * 0.005));
      let plain = 0,
        plateau = 0;
      for (const region of regions) {
        const dx = nx - region.points[0].x,
          dy = ny - region.points[0].y,
          u = (dx * region.cos + dy * region.sin) / region.width,
          v =
            (-dx * region.sin + dy * region.cos) /
            (region.width * region.aspect),
          influence = clamp((1.1 - Math.hypot(u, v)) / 0.5);
        if (region.kind === "plateau") plateau = Math.max(plateau, influence);
        else plain = Math.max(plain, influence);
      }
      // Calm plains, dissected foothills, rugged ranges and relatively flat
      // plateau interiors share the same surface; no map-wide ruggedness switch.
      const upland = clamp((h - 180) / 1500),
        terrain =
          (0.15 + upland * 0.85) * (1 - plain * 0.88) * (1 - plateau * 0.65),
        amplitude =
          Math.min(1500, 100 + h * 0.6) * terrain * recipe.strength * coastal,
        wx =
          nx * 1000 +
          sx +
          (terrainNoise(nx * 1000 + sx, ny * 1000 + sy, 34) - 0.5) * 17,
        wy =
          ny * 1000 +
          sy +
          (terrainNoise(nx * 1000 + sx + 1191, ny * 1000 + sy - 379, 34) -
            0.5) *
            17;
      let ridge = 0,
        parent = 1;
      const scales = [22, 9, 3.5, 1.35],
        weights = [0.3, 0.27, 0.24, 0.19];
      for (let octave = 0; octave < scales.length; octave++) {
        // Ridged multifractal: finer structure is gated by its parent ridge.
        // Domain warping prevents a visible axis-aligned noise lattice.
        const signal =
          1 - Math.abs(2 * terrainNoise(wx, wy, scales[octave]) - 1);
        const value = signal * signal;
        ridge += value * weights[octave] * parent;
        parent = 0.55 + value * 0.45;
      }
      heights[tile] = Math.max(
        1,
        Math.min(5800, h + amplitude * (ridge - 0.38)),
      );
      resistance[tile] = terrain * coastal;
    }
  // Recompute drainage after detail so tributary valleys belong to the final
  // ridges, rather than painting a coarse network over unrelated fine noise.
  for (let pass = 0; pass < recipe.drainagePasses; pass++) {
    const drainage = buildTerrainDrainage(size, land, heights, {
        boundaryOutlets: recipe.boundaryOutlets,
      }),
      before = heights.slice(),
      cuts = new Float32Array(land.length);
    for (const tile of drainage.order) {
      const next = drainage.downstream[tile];
      if (next < 0 || !land[next]) continue;
      const drop = Math.max(0, before[tile] - heights[next]),
        runoff = (Math.sqrt(drainage.accumulation[tile]) * 1000) / size,
        erosion = (0.12 + resistance[tile] * 0.88) * recipe.incision,
        power = (erosion * runoff) / 1400,
        target = (before[tile] + power * heights[next]) / (1 + power),
        cut = Math.min(
          drop,
          Math.max(0, before[tile] - target),
          original[tile] * 0.32,
        );
      heights[tile] = Math.max(1, before[tile] - cut);
      cuts[tile] = cut;
    }
    // Cross-slope bank weathering widens incised tributaries. It uses a compact
    // neighbourhood instead of blurring the entire height surface.
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const tile = y * size + x;
        if (!land[tile]) continue;
        let bank = 0;
        for (const next of [tile - 1, tile + 1, tile - size, tile + size]) {
          if (!land[next] || before[next] >= before[tile]) continue;
          bank = Math.max(
            bank,
            Math.min(cuts[next] * 0.22, (before[tile] - before[next]) * 0.18),
          );
        }
        heights[tile] = Math.max(1, heights[tile] - bank);
      }
  }
}
