import { FlatBinaryHeap } from "../core/execution/utils/FlatBinaryHeap";
import type { GameMap } from "../core/game/GameMap";
import { HierarchicalPaths } from "./HierarchicalPaths";
import { PathTopology, type PathMedium } from "./PathTopology";
import {IncrementalPath,type IncrementalPathState} from "./IncrementalPath";
import { PlanningPath, type PlanningPathState, type PlanningWorkspace } from "./PlanningWorkspace";

// A hierarchy pays off well below the original 65,536-cell threshold: exact A*
// across a mid-size map made trade and squad routing the dominant tick cost.
const HIERARCHY_MIN_CELLS = 16_384;
// Unobstructed routes are pure functions of (start, goal, tile costs). Trade and
// AI repeat the same pairs constantly, so keep a bounded recency cache.
const ROUTE_CACHE_ENTRIES = 16_384;
const ROUTE_CACHE_TILES = 2_000_000;

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
  private readonly size: number;
  private costRevision = 0;
  private exactWork = 0;
  private replayedWork = 0;
  readonly telemetry = { searches: 0, cacheHits: 0, obstacleChecks: 0, exactExpansions: 0 };
  private readonly routes = new Map<
    number,
    { revision: number; path: Int32Array | null; work: number }
  >();
  private routeTiles = 0;
  get residency() {
    return { routes: this.routes.size, routeTiles: this.routeTiles, routeBytes: this.routeTiles * Int32Array.BYTES_PER_ELEMENT,
      hierarchy: this.hierarchy?.residency ?? { clusters: 0, portals: 0, startTrees: 0, treeBytes: 0 } };
  }

  constructor(
    protected readonly map: GameMap,
    medium: PathMedium | boolean = false,
    prepare = true,
  ) {
    const size = map.width() * map.height();
    this.size = size;
    this.topology = new PathTopology(map, medium);
    this.topology.onCostsChanged(() => this.costRevision++);
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
    if (size > HIERARCHY_MIN_CELLS) {
      this.hierarchy = new HierarchicalPaths(this.topology);
      if (prepare) this.hierarchy.prepare();
    }
  }

  prepare(): void {
    this.hierarchy?.prepare();
  }

  /** Crossing trees a full warm builds: an upper bound on warm() calls' work. */
  get hierarchyPortals(): number {
    return this.hierarchy?.residency.portals ?? 0;
  }

  /** Incremental form of `prepare()`; see HierarchicalPaths.warm. */
  warm(count: number): boolean {
    return this.hierarchy?.warm(count) ?? true;
  }

  /** Deterministic search effort so far; budgets use this, never wall time. */
  get work(): number {
    return this.exactWork + this.replayedWork + (this.hierarchy?.work ?? 0);
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
  get revision():number {return this.costRevision;}
  /** Land and water as one graph (squads of a faction with transports). */
  get amphibious(): boolean { return this.topology.medium === "amphibious"; }
  /** Cost epochs are behavioral state for unfinished jobs, unlike route caches. */
  restoreRevision(revision:number):void {
    if(!Number.isSafeInteger(revision)||revision<0)throw new Error("Invalid routing revision");
    this.costRevision=revision;this.routes.clear();this.routeTiles=0;
  }
  begin(start:number,goal:number,saved?:IncrementalPathState):IncrementalPath {
    const job=new IncrementalPath(this.topology,start,goal,this.costRevision,65_536,saved);
    if(!saved && !this.connected(start,goal))job.state.phase="unreachable";
    return job;
  }
  beginPlanning(workspace: PlanningWorkspace, start: number, goal: number, saved?: PlanningPathState): PlanningPath {
    const job = new PlanningPath(this.topology, workspace, start, goal, this.costRevision, saved);
    if (!saved && !this.connected(start, goal)) job.state.phase = "unreachable";
    return job;
  }

  /** One HPA* corridor for an incremental planner, or null when the hierarchy
   * has no route clear of `blocked`. Never falls back to an unbudgeted exact
   * search; the caller resumes its own resumable search instead. Effort is
   * reported through `work`. */
  hierarchical(start: number, goal: number, blocked?: (tile: number) => boolean): number[] | null {
    if (!this.hierarchy || !this.connected(start, goal) || blocked?.(start) || blocked?.(goal)) return null;
    const route = this.hierarchy.find(start, goal);
    if (!route || !route.length || route[route.length - 1] !== goal) return null;
    return this.routeClear([start, ...route], blocked) ? route : null;
  }

  /** Whether every cell of `path`, and both corner cells of each diagonal
   * step, is clear of `blocked`, exactly as exact search avoids them. */
  routeClear(path: readonly number[], blocked?: (tile: number) => boolean): boolean {
    if (!blocked) return true;
    return path.every((tile, i, list) => {
      this.telemetry.obstacleChecks++;
      if (blocked(tile)) return false;
      if (!i || this.map.x(tile) === this.map.x(list[i - 1]) ||
        this.map.y(tile) === this.map.y(list[i - 1])) return true;
      this.telemetry.obstacleChecks += 2;
      return !blocked(this.map.ref(this.map.x(tile), this.map.y(list[i - 1]))) &&
        !blocked(this.map.ref(this.map.x(list[i - 1]), this.map.y(tile)));
    });
  }

  find(
    start: number,
    goal: number,
    blocked?: (tile: number) => boolean,
    expansionLimit = Infinity,
  ): number[] | null {
    if (!this.connected(start, goal) || blocked?.(goal)) return null;
    if (expansionLimit !== Infinity)
      return this.search(start, goal, blocked, expansionLimit);
    if (blocked) {
      // Reuse the terrain corridor even in wall-rich worlds. Validate every
      // cell and diagonal side against the caller's current hostility mask;
      // never cache that mask or a budget-limited failure.
      const route = this.find(start, goal);
      if (route === null) return null;
      if (route && [start, ...route].every((tile, i, list) => {
        this.telemetry.obstacleChecks++;
        if (blocked(tile)) return false;
        if (!i || this.map.x(tile) === this.map.x(list[i - 1]) ||
          this.map.y(tile) === this.map.y(list[i - 1])) return true;
        this.telemetry.obstacleChecks += 2;
        return !blocked(this.map.ref(this.map.x(tile), this.map.y(list[i - 1]))) &&
          !blocked(this.map.ref(this.map.x(list[i - 1]), this.map.y(tile)));
      })) return route;
      return this.search(start, goal, blocked, expansionLimit);
    }
    const key = start * this.size + goal;
    const hit = this.routes.get(key);
    if (hit && hit.revision === this.costRevision) {
      this.telemetry.cacheHits++;
      this.routes.delete(key);
      this.routes.set(key, hit);
      // Report the effort the original search cost, keeping budgets independent
      // of what happens to be cached.
      this.replayedWork += hit.work;
      return hit.path && Array.from(hit.path);
    }
    const before = this.work;
    const route = this.search(start, goal, undefined, expansionLimit);
    this.remember(key, route, this.work - before);
    return route;
  }

  private remember(key: number, route: number[] | null, work: number): void {
    const previous = this.routes.get(key);
    if (previous) {
      this.routeTiles -= (previous.path?.length ?? 0) + 1;
      this.routes.delete(key);
    }
    const path = route && Int32Array.from(route);
    this.routes.set(key, { revision: this.costRevision, path, work });
    this.routeTiles += (path?.length ?? 0) + 1;
    while (
      this.routes.size > ROUTE_CACHE_ENTRIES ||
      this.routeTiles > ROUTE_CACHE_TILES
    ) {
      const [oldest, entry] = this.routes.entries().next().value!;
      this.routes.delete(oldest);
      this.routeTiles -= (entry.path?.length ?? 0) + 1;
    }
  }

  private search(
    start: number,
    goal: number,
    blocked: ((tile: number) => boolean) | undefined,
    expansionLimit: number,
  ): number[] | null {
    this.telemetry.searches++;
    if (
      this.hierarchy &&
      expansionLimit === Infinity &&
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
    return this.findExact(start, goal, blocked, expansionLimit);
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
      this.exactWork++;
      this.telemetry.exactExpansions++;
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
  constructor(map: GameMap, prepare = true, medium: "land" | "amphibious" = "land") {
    super(map, medium, prepare);
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

/** Squads of a faction with transport technology: land and water as one
 * graph, with an embarkation cost at every shoreline step. */
export class AmphibiousPaths extends LandPaths {
  constructor(map: GameMap, prepare = true) {
    super(map, prepare, "amphibious");
  }
}

export class WaterPaths extends TilePaths {
  constructor(map: GameMap, prepare = true) {
    super(map, true, prepare);
  }
}
