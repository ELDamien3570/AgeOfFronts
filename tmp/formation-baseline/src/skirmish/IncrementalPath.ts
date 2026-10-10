import type { PathTopology } from "./PathTopology";

interface Entry {
  tile: number;
  score: number;
  cost: number;
}
export interface IncrementalPathState {
  start: number;
  goal: number;
  revision: number;
  phase:
    | "search"
    | "trace"
    | "reverse"
    | "done"
    | "unreachable"
    | "limited"
    | "stale";
  heap: Entry[];
  costs: Map<number, number>;
  parents: Map<number, number>;
  trace: number;
  reverse: number;
  path: number[];
  expanded: number;
}
const before = (a: Entry, b: Entry) =>
  a.score < b.score ||
  (a.score === b.score &&
    (a.cost > b.cost || (a.cost === b.cost && a.tile < b.tile)));
/** Resumable A* over the same topology/cost/diagonal rules as ordinary routes.
 * Search, reconstruction and reversal all consume deterministic work. No
 * hierarchy or cache warmth can perform hidden work or change job scheduling.
 */
export class IncrementalPath {
  readonly state: IncrementalPathState;
  private readonly neighbors = new Array<number>(8);
  constructor(
    private readonly topology: PathTopology,
    start: number,
    goal: number,
    revision: number,
    private readonly nodeLimit = 65_536,
    saved?: IncrementalPathState,
  ) {
    this.state = saved ?? {
      start,
      goal,
      revision,
      phase: "search",
      heap: [],
      costs: new Map([[start, 0]]),
      parents: new Map(),
      trace: goal,
      reverse: 0,
      path: [],
      expanded: 0,
    };
    if (!saved)
      this.push({
        tile: start,
        cost: 0,
        score: topology.estimate(start, goal),
      });
  }
  checkpoint(): IncrementalPathState {
    return structuredClone(this.state);
  }
  private push(entry: Entry): void {
    const heap = this.state.heap;
    let at = heap.length;
    heap.push(entry);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!before(entry, heap[parent])) break;
      heap[at] = heap[parent];
      at = parent;
    }
    heap[at] = entry;
  }
  private pop(): Entry | undefined {
    const heap = this.state.heap,
      first = heap[0],
      last = heap.pop();
    if (!heap.length) return first;
    let at = 0;
    while (at * 2 + 1 < heap.length) {
      let child = at * 2 + 1;
      if (child + 1 < heap.length && before(heap[child + 1], heap[child]))
        child++;
      if (!before(heap[child], last!)) break;
      heap[at] = heap[child];
      at = child;
    }
    heap[at] = last!;
    return first;
  }
  step(
    budget: number,
    revision: number,
    blocked?: (tile: number) => boolean,
  ): number {
    const s = this.state;
    if (s.revision !== revision) {
      s.phase = "stale";
      return 0;
    }
    let used = 0;
    if (
      s.phase === "search" &&
      !s.expanded &&
      s.start !== s.goal &&
      blocked?.(s.goal)
    ) {
      if (budget > 0) {
        s.phase = "unreachable";
        return 1;
      }
      return 0;
    }
    while (used < budget) {
      if (s.phase === "search") {
        const entry = this.pop();
        used++;
        if (!entry) {
          s.phase = "unreachable";
          break;
        }
        if (entry.cost !== s.costs.get(entry.tile)) continue;
        if (entry.tile === s.goal) {
          s.phase = "trace";
          continue;
        }
        if (s.expanded >= this.nodeLimit) {
          s.phase = "limited";
          break;
        }
        s.expanded++;
        const count = this.topology.neighbors(
          entry.tile,
          this.neighbors,
          blocked,
        );
        for (let i = 0; i < count; i++) {
          const next = this.neighbors[i];
          if (!this.topology.walkable(next) || blocked?.(next)) continue;
          const cost = entry.cost + this.topology.cost(entry.tile, next);
          if (cost >= (s.costs.get(next) ?? Infinity)) continue;
          s.costs.set(next, cost);
          s.parents.set(next, entry.tile);
          this.push({
            tile: next,
            cost,
            score: cost + this.topology.estimate(next, s.goal),
          });
        }
      } else if (s.phase === "trace") {
        used++;
        if (s.trace === s.start) {
          s.phase = "reverse";
          continue;
        }
        s.path.push(s.trace);
        const parent = s.parents.get(s.trace);
        if (parent === undefined) {
          s.phase = "unreachable";
          break;
        }
        s.trace = parent;
      } else if (s.phase === "reverse") {
        used++;
        const end = s.path.length - 1 - s.reverse;
        if (s.reverse >= end) {
          s.phase = "done";
          break;
        }
        [s.path[s.reverse], s.path[end]] = [s.path[end], s.path[s.reverse]];
        s.reverse++;
      } else break;
    }
    return used;
  }
}
