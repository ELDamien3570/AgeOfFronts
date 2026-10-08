import { MIGRATION_THEME } from "./content/Migration";
import type { MigrationRiver } from "./MigrationLayout";
import { buildTerrainDrainage } from "./TerrainDrainage";

/** Generate tributaries from contributing area, then incise their beds and banks. */
export function carveMigrationDrainage(
  size: number,
  regions: Uint8Array,
  heights: Float32Array,
  mainlandCount: number,
): MigrationRiver[] {
  const land = regions.slice(),
    drainage = buildTerrainDrainage(size, land, heights),
    { downstream, accumulation, order } = drainage,
    threshold = Math.max(45, size * size * MIGRATION_THEME.riverCatchmentRatio),
    upstream = new Float32Array(land.length),
    streams = new Uint8Array(land.length),
    beds = new Float32Array(land.length).fill(Infinity),
    rivers: MigrationRiver[] = [];
  const original = heights.slice(),
    centreBeds = new Float32Array(land.length).fill(Infinity);
  for (const tile of order) {
    const next = downstream[tile];
    if (next >= 0 && land[next])
      upstream[next] = Math.max(upstream[next], accumulation[tile]);
  }
  const sources = Array.from(order).filter(
    (tile) =>
      land[tile] <= mainlandCount &&
      accumulation[tile] >= threshold &&
      upstream[tile] < threshold,
  );
  sources.sort((a, b) => accumulation[b] - accumulation[a] || a - b);
  for (const source of sources) {
    const path: number[] = [];
    for (let tile = source; tile >= 0 && land[tile]; tile = downstream[tile])
      path.push(tile);
    if (path.length < size * MIGRATION_THEME.riverMinimumLengthRatio) continue;
    const points = path.map((tile) => ({
      x: (tile % size) + 0.5,
      y: Math.floor(tile / size) + 0.5,
      width:
        Math.max(
          1.15,
          Math.min(4.5, Math.sqrt(accumulation[tile] / threshold) * 0.85),
        ) * Math.sqrt(size / 500),
    }));
    // Include the actual outlet, so diagonal drainage also opens a navigable mouth.
    const outlet = downstream[path[path.length - 1]];
    points.push({
      x: (outlet % size) + 0.5,
      y: Math.floor(outlet / size) + 0.5,
      width: points[points.length - 1].width,
    });
    rivers.push({ kind: "river", points });
    for (const tile of path) {
      streams[tile] = 1;
      centreBeds[tile] = Math.max(
        0.1,
        original[tile] -
          Math.min(
            MIGRATION_THEME.riverIncision *
              Math.sqrt(accumulation[tile] / threshold),
            original[tile] * 0.22,
          ),
      );
    }
  }
  // Breach spill points along the selected drainage network. Keep low basins
  // low instead of replacing the entire landscape with a filled routing surface.
  for (let i = order.length - 1; i >= 0; i--) {
    const tile = order[i],
      next = downstream[tile];
    if (streams[tile] && next >= 0 && streams[next])
      centreBeds[next] = Math.min(
        centreBeds[next],
        Math.max(0.1, centreBeds[tile] - 0.002),
      );
  }
  for (const river of rivers) {
    for (let i = 0; i < river.points.length - 1; i++) {
      const tile =
          Math.floor(river.points[i].y) * size + Math.floor(river.points[i].x),
        p = river.points[i],
        radius = Math.max(1.15, p.width),
        bed = centreBeds[tile],
        bankRadius = radius * MIGRATION_THEME.valleyBankWidth;
      streams[tile] = 1;
      for (
        let y = Math.max(0, Math.floor(p.y - bankRadius));
        y < Math.min(size, Math.ceil(p.y + bankRadius));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(p.x - bankRadius));
          x < Math.min(size, Math.ceil(p.x + bankRadius));
          x++
        ) {
          const t = y * size + x,
            distance = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
          if (!land[t] || distance > bankRadius) continue;
          if (distance <= radius) {
            regions[t] = 0;
            beds[t] = Math.min(beds[t], bed, original[t]);
          } else {
            const blend = (distance - radius) / (bankRadius - radius),
              smooth = blend * blend * (3 - 2 * blend);
            heights[t] = Math.min(
              heights[t],
              bed + 2 + (original[t] - bed) * smooth,
            );
          }
        }
    }
  }
  for (let tile = 0; tile < land.length; tile++)
    if (Number.isFinite(beds[tile])) heights[tile] = beds[tile];
  // Raster footprints can overlap; restore the proven descending centre beds.
  for (const tile of order) if (streams[tile]) heights[tile] = centreBeds[tile];
  return rivers;
}
