import { TerrainPriorityQueue } from "./TerrainPriorityQueue";

export interface TerrainDrainage {
  /** Depression-resolved drainage surface, in metres. */
  surface: Float32Array;
  /** Next downstream cell; -1 for ocean cells. */
  downstream: Int32Array;
  /** Contributing land area, in cells. */
  accumulation: Float32Array;
  /** Land cells ordered from their outlets towards their headwaters. */
  order: Int32Array;
}

/**
 * Priority-Flood drainage, seeded from coastal land cells. Depressions receive
 * a minimal ascending grade so every land cell has an acyclic route to the sea.
 * Barnes, Lehman & Mulla (2014): https://doi.org/10.1016/j.cageo.2013.04.024
 * The routing surface is construction data, not an arbitrary flattening of rivers.
 */
export function buildTerrainDrainage(
  size: number,
  land: ArrayLike<number>,
  heights: Float32Array,
): TerrainDrainage {
  const count = size * size;
  if (land.length !== count || heights.length !== count)
    throw new Error("Invalid drainage grid");
  const surface = heights.slice(),
    downstream = new Int32Array(count).fill(-1),
    accumulation = new Float32Array(count),
    visited = new Uint8Array(count),
    costs = new Float64Array(count).fill(Infinity),
    ordered = new Int32Array(count),
    open = new TerrainPriorityQueue();
  const neighbours = (tile: number, visit: (next: number) => void) => {
    const x = tile % size,
      y = Math.floor(tile / size);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (
          (!dx && !dy) ||
          x + dx < 0 ||
          x + dx >= size ||
          y + dy < 0 ||
          y + dy >= size
        )
          continue;
        visit(tile + dy * size + dx);
      }
  };
  for (let tile = 0; tile < count; tile++)
    if (land[tile]) surface[tile] = Infinity;
  for (let tile = 0; tile < count; tile++) {
    if (!land[tile]) continue;
    let outlet = -1;
    neighbours(tile, (next) => {
      if (!land[next] && (outlet < 0 || next < outlet)) outlet = next;
    });
    if (outlet < 0) continue;
    surface[tile] = heights[tile];
    costs[tile] = 0;
    downstream[tile] = outlet;
    accumulation[tile] = 1;
    open.push(tile, surface[tile]);
  }
  let length = 0;
  while (open.length) {
    const { tile, priority, secondary } = open.pop();
    if (
      visited[tile] ||
      priority !== surface[tile] ||
      secondary !== costs[tile]
    )
      continue;
    visited[tile] = 1;
    ordered[length++] = tile;
    neighbours(tile, (next) => {
      if (!land[next] || visited[next]) return;
      const level = Math.max(heights[next], surface[tile]),
        distance = Math.hypot(
          (next % size) - (tile % size),
          Math.floor(next / size) - Math.floor(tile / size),
        ),
        // Within a filled depression, prefer its original low terrain. Routing
        // on epsilon distance alone makes artificial straight runs across flats.
        cost =
          costs[tile] +
          distance * (1 + Math.pow(Math.max(0, heights[next]) / 80, 2));
      if (
        level > surface[next] ||
        (level === surface[next] && cost >= costs[next])
      )
        return;
      downstream[next] = tile;
      accumulation[next] = 1;
      surface[next] = level;
      costs[next] = cost;
      open.push(next, level, cost);
    });
  }
  for (let tile = 0; tile < count; tile++)
    if (land[tile] && !visited[tile])
      throw new Error("Land has no coastal drainage outlet");
  for (let i = 0; i < length; i++) {
    const tile = ordered[i],
      next = downstream[tile];
    if (next >= 0 && land[next])
      surface[tile] = Math.max(surface[tile], surface[next] + 0.002);
  }
  for (let i = length - 1; i >= 0; i--) {
    const tile = ordered[i],
      next = downstream[tile];
    if (next >= 0 && land[next]) accumulation[next] += accumulation[tile];
  }
  return { surface, downstream, accumulation, order: ordered.slice(0, length) };
}
