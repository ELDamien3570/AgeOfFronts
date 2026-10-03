import { FlatBinaryHeap } from "../core/execution/utils/FlatBinaryHeap";
import type { GameMap } from "../core/game/GameMap";
import { FIXED, type Squad } from "./Protocol";
import { SpatialGrid, type WorldPoint } from "./SpatialGrid";
import {
  distanceSquared,
  squadRadius,
  squadSeparation,
  traversable,
  type FactionHostility,
} from "./SquadGeometry";

const STEP = FIXED / 8;
// Terrain routes remain coarse and shared. Only a stalled squad searches this
// bounded local lattice to fit through gaps between settled formations.
export class LocalDetours {
  constructor(
    private readonly map: GameMap,
    private readonly grid: SpatialGrid<Squad>,
    private readonly hostile?: FactionHostility,
  ) {}

  find(
    squad: Squad,
    goal: WorldPoint,
    holding: (other: Squad) => boolean,
  ): WorldPoint[] | null {
    if (distanceSquared(squad, goal) > (8 * FIXED) ** 2) return null;
    const obstacles: Squad[] = [];
    this.grid.query(
      (squad.x + goal.x) / 2,
      (squad.y + goal.y) / 2,
      10 * FIXED,
      obstacles,
    );
    const fixed = obstacles.filter(
      (other) => other.id !== squad.id && holding(other) && !!squadSeparation(squad, other, this.hostile),
    );
    const radius = squadRadius(squad.kind);
    const clear = (a: WorldPoint, b: WorldPoint) => {
      if (!traversable(this.map, a, b, radius)) return false;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      return fixed.every((other) => {
        const along = length
          ? Math.max(
              0,
              Math.min(
                1,
                ((other.x - a.x) * dx + (other.y - a.y) * dy) / length,
              ),
            )
          : 0;
        return (
          distanceSquared(other, {
            x: a.x + along * dx,
            y: a.y + along * dy,
          }) >=
          squadSeparation(squad, other, this.hostile) ** 2
        );
      });
    };
    if (clear(squad, goal)) return [goal];
    if (!clear(goal, goal)) return null;
    const left = Math.max(
      0,
      Math.floor((Math.min(squad.x, goal.x) - 2 * FIXED) / STEP),
    );
    const top = Math.max(
      0,
      Math.floor((Math.min(squad.y, goal.y) - 2 * FIXED) / STEP),
    );
    const right = Math.min(
      this.map.width() * 8,
      Math.ceil((Math.max(squad.x, goal.x) + 2 * FIXED) / STEP),
    );
    const bottom = Math.min(
      this.map.height() * 8,
      Math.ceil((Math.max(squad.y, goal.y) + 2 * FIXED) / STEP),
    );
    const width = right - left + 1,
      height = bottom - top + 1,
      size = width * height;
    const point = (id: number): WorldPoint => ({
      x: (left + (id % width)) * STEP,
      y: (top + Math.floor(id / width)) * STEP,
    });
    const costs = new Float64Array(size).fill(Infinity),
      parent = new Int32Array(size).fill(-1),
      closed = new Uint8Array(size);
    const heap = new FlatBinaryHeap();
    const ix = Math.round(squad.x / STEP) - left,
      iy = Math.round(squad.y / STEP) - top;
    for (let y = Math.max(0, iy - 1); y <= Math.min(height - 1, iy + 1); y++)
      for (let x = Math.max(0, ix - 1); x <= Math.min(width - 1, ix + 1); x++) {
        const id = y * width + x,
          p = point(id);
        if (!clear(squad, p)) continue;
        costs[id] = Math.sqrt(distanceSquared(squad, p));
        heap.enqueue(id, costs[id] + Math.sqrt(distanceSquared(p, goal)));
      }
    let expanded = 0;
    while (heap.size() && expanded < 6000) {
      const id = heap.dequeue();
      if (closed[id]) continue;
      closed[id] = 1;
      expanded++;
      const p = point(id);
      if (distanceSquared(p, goal) <= FIXED ** 2 && clear(p, goal)) {
        const result = [goal];
        for (let at = id; at >= 0; at = parent[at]) result.push(point(at));
        result.reverse();
        const smooth: WorldPoint[] = [];
        let origin: WorldPoint = squad;
        for (let i = 0; i < result.length; ) {
          let last = i;
          for (let j = i + 1; j < result.length; j++)
            if (clear(origin, result[j])) last = j;
          smooth.push(result[last]);
          origin = result[last];
          i = last + 1;
        }
        return smooth;
      }
      const x = id % width,
        y = Math.floor(id / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (
            (!dx && !dy) ||
            x + dx < 0 ||
            x + dx >= width ||
            y + dy < 0 ||
            y + dy >= height
          )
            continue;
          const next = (y + dy) * width + x + dx;
          const cost = costs[id] + STEP * (dx && dy ? Math.SQRT2 : 1);
          if (closed[next] || cost >= costs[next]) continue;
          const destination = point(next);
          if (!clear(p, destination)) continue;
          costs[next] = cost;
          parent[next] = id;
          heap.enqueue(
            next,
            cost + Math.sqrt(distanceSquared(destination, goal)),
          );
        }
    }
    return null;
  }
}
