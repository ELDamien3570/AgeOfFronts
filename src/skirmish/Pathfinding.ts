import { FlatBinaryHeap } from "../core/execution/utils/FlatBinaryHeap";
import type { GameMap } from "../core/game/GameMap";
import { HierarchicalPaths } from "./HierarchicalPaths";
import { PathTopology } from "./PathTopology";

class TilePaths {
  private readonly cost: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private readonly heap = new FlatBinaryHeap();
  private generation = 0;
  private readonly neighbors = new Array<number>(8);
  private readonly topology: PathTopology;
  private readonly hierarchy?: HierarchicalPaths;
  readonly component: Int32Array;
  readonly largestComponent: number[];

  constructor(
    protected readonly map: GameMap,
    private readonly water = false,
    prepare = true,
  ) {
    const size = map.width() * map.height();
    this.topology = new PathTopology(map, water);
    this.cost = new Int32Array(size);
    this.parent = new Int32Array(size);
    this.seen = new Uint32Array(size);
    this.closed = new Uint32Array(size);
    this.component = new Int32Array(size);
    const queue = new Int32Array(size);
    let largest: number[] = [];
    let id = 0;
    for (let tile = 0; tile < size; tile++) {
      if (!this.walkable(tile) || this.component[tile] !== 0) continue;
      id++;
      let head = 0,
        tail = 1;
      queue[0] = tile;
      this.component[tile] = id;
      while (head < tail) {
        const current = queue[head++];
        const n = map.neighbors4(current, this.neighbors);
        for (let i = 0; i < n; i++) {
          const next = this.neighbors[i];
          if (this.component[next] !== 0 || !this.walkable(next)) continue;
          this.component[next] = id;
          queue[tail++] = next;
        }
      }
      if (tail > largest.length) largest = Array.from(queue.subarray(0, tail));
    }
    this.largestComponent = largest.sort((a, b) => a - b);
    if (size > 65_536) {
      this.hierarchy = new HierarchicalPaths(this.topology);
      if (prepare) this.hierarchy.prepare();
    }
  }

  prepare(): void {
    this.hierarchy?.prepare();
  }

  walkable(tile: number): boolean {
    return this.topology.walkable(tile);
  }

  connected(a: number, b: number): boolean {
    return (
      this.walkable(a) &&
      this.walkable(b) &&
      this.component[a] === this.component[b]
    );
  }

  find(
    start: number,
    goal: number,
    blocked?: (tile: number) => boolean,
  ): number[] | null {
    if (!this.connected(start, goal) || blocked?.(goal)) return null;
    if (
      this.hierarchy &&
      Math.abs(this.map.x(start) - this.map.x(goal)) +
        Math.abs(this.map.y(start) - this.map.y(goal)) >
        48
    ) {
      const route = this.hierarchy.find(start, goal);
      if (
        !blocked ||
        (route &&
          [start, ...route].every(
            (t, i, list) =>
              !blocked(t) &&
              (!i ||
                this.map.x(t) === this.map.x(list[i - 1]) ||
                this.map.y(t) === this.map.y(list[i - 1]) ||
                (!blocked(
                  this.map.ref(this.map.x(t), this.map.y(list[i - 1])),
                ) &&
                  !blocked(
                    this.map.ref(this.map.x(list[i - 1]), this.map.y(t)),
                  ))),
          ))
      )
        return route;
    }
    return this.findExact(start, goal, blocked);
  }

  // Exact refinement and dynamic obstacle repair share the authoritative costs.
  findExact(
    start: number,
    goal: number,
    blocked?: (tile: number) => boolean,
    expansionLimit = Infinity,
  ): number[] | null {
    if (!this.connected(start, goal)) return null;
    if (blocked?.(goal)) return null;
    if (start === goal) return [];
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.generation = 1;
    }
    const stamp = this.generation;
    this.heap.clear();
    this.seen[start] = stamp;
    this.cost[start] = 0;
    this.parent[start] = -1;
    this.heap.enqueue(start, this.estimate(start, goal));
    let expanded = 0;
    while (this.heap.size() > 0) {
      const tile = this.heap.dequeue();
      if (this.closed[tile] === stamp) continue;
      if (expanded++ >= expansionLimit) return null;
      this.closed[tile] = stamp;
      if (tile === goal) {
        const result: number[] = [];
        for (let at = goal; at !== start; at = this.parent[at]) result.push(at);
        return result.reverse();
      }
      const count = this.topology.neighbors(tile, this.neighbors, blocked);
      for (let i = 0; i < count; i++) {
        const next = this.neighbors[i];
        if (
          !this.walkable(next) ||
          this.closed[next] === stamp ||
          blocked?.(next)
        )
          continue;
        const candidate = this.cost[tile] + this.topology.cost(tile, next);
        if (this.seen[next] === stamp && candidate >= this.cost[next]) continue;
        this.seen[next] = stamp;
        this.cost[next] = candidate;
        this.parent[next] = tile;
        this.heap.enqueue(next, candidate + this.estimate(next, goal));
      }
    }
    return null;
  }

  private estimate(a: number, b: number): number {
    return this.topology.estimate(a, b);
  }
}

export class LandPaths extends TilePaths {
  constructor(map: GameMap, prepare = true) {
    super(map, false, prepare);
  }
  get largestLand(): number[] {
    return this.largestComponent;
  }

  // One long corridor per group; each member only plans local connectors.
  findGroup(
    starts: number[],
    goals: number[],
    center: number,
    blocked?: (tile: number) => boolean,
  ): (number[] | null)[] {
    if (starts.length === 1) return [this.find(starts[0], goals[0], blocked)];
    const cx =
      starts.reduce((sum, tile) => sum + this.map.x(tile), 0) / starts.length;
    const cy =
      starts.reduce((sum, tile) => sum + this.map.y(tile), 0) / starts.length;
    const anchor = [...starts].sort(
      (a, b) =>
        (this.map.x(a) - cx) ** 2 +
          (this.map.y(a) - cy) ** 2 -
          ((this.map.x(b) - cx) ** 2 + (this.map.y(b) - cy) ** 2) || a - b,
    )[0];
    const path = this.find(anchor, center, blocked);
    if (!path) return starts.map(() => null);
    const spine = [anchor, ...path];
    const closest = (tile: number) => {
      let best = 0;
      for (let i = 1; i < spine.length; i++)
        if (
          this.map.euclideanDistSquared(tile, spine[i]) <
          this.map.euclideanDistSquared(tile, spine[best])
        )
          best = i;
      return best;
    };
    return starts.map((start, i) => {
      const join = closest(start),
        leave = closest(goals[i]);
      if (leave <= join) return this.find(start, goals[i], blocked);
      const head = this.find(start, spine[join], blocked),
        tail = this.find(spine[leave], goals[i], blocked);
      if (!head || !tail) return null;
      return [...head, ...spine.slice(join + 1, leave + 1), ...tail];
    });
  }
}

export class WaterPaths extends TilePaths {
  constructor(map: GameMap) {
    super(map, true);
  }
}
