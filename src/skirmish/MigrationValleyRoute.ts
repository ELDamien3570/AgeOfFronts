import type { MigrationLandmass, MigrationRiver } from "./MigrationLayout";
import { TerrainPriorityQueue } from "./TerrainPriorityQueue";

/** Route a sea strait across low ground within an authored mainland split corridor. */
export function migrationValleyRoute(
  size: number,
  land: Uint8Array,
  heights: Float32Array,
  mass: MigrationLandmass,
  angle: number,
  across: number,
  width: number,
): MigrationRiver | undefined {
  const stride = Math.max(1, size / 250),
    dimension = Math.ceil(size / stride),
    count = dimension * dimension,
    cos = Math.cos(angle),
    sin = Math.sin(angle),
    band = Math.min(mass.radiusX, mass.radiusY) * 0.42,
    eligible = new Uint8Array(count),
    costs = new Float64Array(count).fill(Infinity),
    parent = new Int32Array(count).fill(-1),
    open = new TerrainPriorityQueue(),
    point = (tile: number) => ({
      x: Math.min(size - 0.5, ((tile % dimension) + 0.5) * stride),
      y: Math.min(size - 0.5, (Math.floor(tile / dimension) + 0.5) * stride),
    });
  let start = -1,
    end = -1,
    minimum = Infinity,
    maximum = -Infinity;
  for (let tile = 0; tile < count; tile++) {
    const p = point(tile),
      world = Math.floor(p.y) * size + Math.floor(p.x);
    if (land[world] !== 1) continue;
    const dx = p.x - mass.x,
      dy = p.y - mass.y,
      u = dx * cos + dy * sin,
      v = -dx * sin + dy * cos;
    if (Math.abs(v - across) > band) continue;
    eligible[tile] = 1;
    const a = u + Math.abs(v - across) * 1.7,
      b = u - Math.abs(v - across) * 1.7;
    if (a < minimum) {
      minimum = a;
      start = tile;
    }
    if (b > maximum) {
      maximum = b;
      end = tile;
    }
  }
  if (start < 0 || end < 0 || start === end) return;
  const goal = point(end),
    heuristic = (tile: number) => {
      const p = point(tile);
      return Math.hypot(p.x - goal.x, p.y - goal.y);
    };
  costs[start] = 0;
  open.push(start, heuristic(start));
  while (open.length) {
    const { tile, priority } = open.pop();
    if (priority > costs[tile] + heuristic(tile) + 1e-8) continue;
    if (tile === end) break;
    const x = tile % dimension,
      y = Math.floor(tile / dimension),
      a = point(tile),
      ah = heights[Math.floor(a.y) * size + Math.floor(a.x)];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (
          (!dx && !dy) ||
          x + dx < 0 ||
          x + dx >= dimension ||
          y + dy < 0 ||
          y + dy >= dimension
        )
          continue;
        const next = tile + dy * dimension + dx;
        if (!eligible[next]) continue;
        const b = point(next),
          bh = heights[Math.floor(b.y) * size + Math.floor(b.x)],
          distance = stride * Math.hypot(dx, dy),
          cost =
            costs[tile] +
            distance * (1 + Math.pow((ah + bh) / 500, 2) * 10) +
            Math.abs(ah - bh) * 0.15;
        if (cost >= costs[next]) continue;
        costs[next] = cost;
        parent[next] = tile;
        open.push(next, cost + heuristic(next));
      }
  }
  if (parent[end] < 0) return;
  const path: number[] = [];
  for (let tile = end; tile >= 0; tile = parent[tile]) path.push(tile);
  path.reverse();
  const points = path.map((tile) => {
    const p = point(tile),
      h = heights[Math.floor(p.y) * size + Math.floor(p.x)];
    return { ...p, width: width * (0.75 + 0.5 * (1 - Math.min(1, h / 800))) };
  });
  const extend = (p: { x: number; y: number; width: number }, sign: number) => {
    let x = p.x,
      y = p.y;
    for (let step = 0; step < size; step++) {
      x += cos * sign;
      y += sin * sign;
      if (
        x < 0 ||
        y < 0 ||
        x >= size ||
        y >= size ||
        !land[Math.floor(y) * size + Math.floor(x)]
      )
        break;
    }
    return {
      x: x + cos * sign * width,
      y: y + sin * sign * width,
      width: p.width,
    };
  };
  points.unshift(extend(points[0], -1));
  points.push(extend(points[points.length - 1], 1));
  return { kind: "channel", points };
}
