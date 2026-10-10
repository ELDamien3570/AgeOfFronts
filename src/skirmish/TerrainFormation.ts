import { PseudoRandom } from "../core/PseudoRandom";
import type { Landform } from "./RegionalTopography";
import { buildTerrainDrainage } from "./TerrainDrainage";
import { terrainNoise } from "./TerrainNoise";
import { dissectTerrain, type TerrainDissectionRecipe } from "./TerrainDissection";

export interface TerrainFormationRecipe {
  resolution: number;
  erosionPasses: number;
  streamPower: number;
  spurHeight: number;
  detail?: TerrainDissectionRecipe;
  /** Inland themes may drain beyond the frame without inventing water tiles. */
  boundaryOutlets?: boolean;
}

/** Regional ridge branches followed by bounded stream-power incision. Work is
 * Regional planning is bounded by a reference grid. Optional final dissection
 * runs at selected resolution, preserving fine ridge and tributary structure.
 * The authored shoreline is immutable. This is a landscape model, not a sediment
 * transport simulator: eroded material is exported, rather than deposited.
 */
export function formTerrain(
  size: number,
  land: Uint8Array,
  heights: Float32Array,
  shore: Float32Array,
  features: readonly Landform[],
  seed: number,
  recipe: TerrainFormationRecipe,
): void {
  if (
    land.length !== size * size ||
    heights.length !== land.length ||
    shore.length !== land.length ||
    !Number.isInteger(recipe.resolution) ||
    recipe.resolution < 16 ||
    !Number.isInteger(recipe.erosionPasses) ||
    recipe.erosionPasses < 0 ||
    recipe.erosionPasses > 12 ||
    !Number.isFinite(recipe.streamPower) ||
    recipe.streamPower < 0 ||
    !Number.isFinite(recipe.spurHeight) ||
    recipe.spurHeight < 0
  )
    throw new Error("Invalid terrain formation recipe");
  const grid = Math.min(size, recipe.resolution),
    count = grid * grid,
    original = new Float32Array(count),
    surface = new Float32Array(count),
    mask = new Uint8Array(count),
    branches = new Float32Array(count),
    random = new PseudoRandom(seed ^ 0x437b951);
  const stamp = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    width: number,
    amplitude: number,
  ) => {
    const dx = bx - ax,
      dy = by - ay,
      length = dx * dx + dy * dy;
    for (
      let y = Math.max(0, Math.floor((Math.min(ay, by) - width * 2) * grid));
      y <= Math.min(grid - 1, Math.ceil((Math.max(ay, by) + width * 2) * grid));
      y++
    )
      for (
        let x = Math.max(0, Math.floor((Math.min(ax, bx) - width * 2) * grid));
        x <=
        Math.min(grid - 1, Math.ceil((Math.max(ax, bx) + width * 2) * grid));
        x++
      ) {
        const nx = (x + 0.5) / grid,
          ny = (y + 0.5) / grid,
          t = Math.max(
            0,
            Math.min(
              1,
              ((nx - ax) * dx + (ny - ay) * dy) / Math.max(1e-12, length),
            ),
          ),
          distance = Math.hypot(nx - ax - t * dx, ny - ay - t * dy) / width;
        const uplift =
          amplitude * Math.exp(-distance * distance * 2) * (1 - t * 0.8);
        branches[y * grid + x] = Math.max(branches[y * grid + x], uplift);
      }
  };
  for (const feature of features) {
    if (feature.kind !== "range" && feature.kind !== "massif") continue;
    const points = feature.points;
    for (let i = 0; i < points.length; i++) {
      const anchor = points[i],
        previous = points[Math.max(0, i - 1)],
        next = points[Math.min(points.length - 1, i + 1)],
        heading =
          feature.kind === "massif"
            ? feature.angle
            : Math.atan2(next.y - previous.y, next.x - previous.x);
      for (const side of [-1, 1]) {
        const angle = heading + side * random.nextFloat(0.8, 1.5),
          length = feature.width * random.nextFloat(2, 4),
          mx = anchor.x + Math.cos(angle) * length * 0.55,
          my = anchor.y + Math.sin(angle) * length * 0.55,
          ex = mx + Math.cos(angle + side * 0.3) * length * 0.45,
          ey = my + Math.sin(angle + side * 0.3) * length * 0.45,
          amplitude =
            feature.elevation * recipe.spurHeight * random.nextFloat(0.65, 1);
        stamp(anchor.x, anchor.y, mx, my, feature.width * 0.32, amplitude);
        stamp(mx, my, ex, ey, feature.width * 0.22, amplitude * 0.55);
        for (const fork of [-1, 1]) {
          const a = angle + fork * 0.75;
          stamp(
            mx,
            my,
            mx + Math.cos(a) * length * 0.45,
            my + Math.sin(a) * length * 0.45,
            feature.width * 0.15,
            amplitude * 0.4,
          );
        }
      }
    }
  }
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++) {
      const tile =
          Math.min(size - 1, Math.floor(((y + 0.5) * size) / grid)) * size +
          Math.min(size - 1, Math.floor(((x + 0.5) * size) / grid)),
        at = y * grid + x;
      mask[at] = Number(!!land[tile]);
      original[at] = heights[tile];
      const coastal = Math.min(1, shore[tile] / (size * 0.012)),
        hills = Math.min(1, Math.max(0, heights[tile] - 180) / 800),
        detail = terrainNoise(
          (x / grid) * 1000 + (seed % 7919),
          (y / grid) * 1000 + (seed % 104729),
          13,
        ),
        ridge = (scale: number, ox: number) =>
          1 -
          Math.abs(
            2 *
              terrainNoise(
                (x / grid) * 1000 + (seed % 7919) + ox,
                (y / grid) * 1000 + (seed % 104729) - ox,
                scale,
              ) -
              1,
          ),
        rugged =
          ridge(46, 371) * 0.55 + ridge(21, 917) * 0.3 + ridge(9, 1733) * 0.15,
        dissection =
          (rugged - 0.68) * Math.min(900, 120 + original[at] * 0.45) * hills;
      surface[at] = mask[at]
        ? original[at] +
          coastal *
            (branches[at] * hills + (detail - 0.5) * 120 * hills + dissection)
        : original[at];
    }
  for (let pass = 0; pass < recipe.erosionPasses; pass++) {
    const drainage = buildTerrainDrainage(grid, mask, surface, { boundaryOutlets: recipe.boundaryOutlets }),
      before = surface.slice();
    // Downstream cells are resolved before upstream cells: an implicit slope
    // solve is stable even where accumulated runoff is large.
    for (const tile of drainage.order) {
      const next = drainage.downstream[tile];
      if (next < 0) continue;
      const floor = mask[next] ? surface[next] : 1,
        drop = before[tile] - floor;
      if (drop <= 0) continue; // Retain low basins rather than filling them.
      const area = drainage.accumulation[tile] / (grid * grid),
        power = (recipe.streamPower * Math.sqrt(area) * grid) / 250,
        target = (before[tile] + power * floor) / (1 + power);
      surface[tile] = Math.max(original[tile] * 0.45, target, 1);
    }
  }
  // Bilinear transfer of the change retains the original high-resolution
  // shoreline and coastal detail, rather than replacing them with coarse cells.
  const change = (x: number, y: number) => {
    const tile =
      Math.max(0, Math.min(grid - 1, y)) * grid +
      Math.max(0, Math.min(grid - 1, x));
    return mask[tile] ? surface[tile] - original[tile] : 0;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      if (!land[tile]) continue;
      const gx = ((x + 0.5) * grid) / size - 0.5,
        gy = ((y + 0.5) * grid) / size - 0.5,
        ix = Math.floor(gx),
        iy = Math.floor(gy),
        u = gx - ix,
        v = gy - iy,
        delta =
          (change(ix, iy) * (1 - u) + change(ix + 1, iy) * u) * (1 - v) +
          (change(ix, iy + 1) * (1 - u) + change(ix + 1, iy + 1) * u) * v;
      heights[tile] = Math.max(
        1,
        Math.min(
          5800,
          heights[tile] + delta * Math.min(1, shore[tile] / (size * 0.006)),
        ),
      );
    }
  if (recipe.detail) dissectTerrain(size, land, heights, shore, features, seed, { ...recipe.detail, boundaryOutlets: recipe.boundaryOutlets });
}
