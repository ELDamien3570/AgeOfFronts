import type { PathTopology } from "./PathTopology";

interface WorkspaceValues {
  tile: Int32Array; parent: Int32Array; cost: Float64Array; score: Float64Array;
  position: Int32Array; free: Int32Array;
}
export type PlanningWorkspaceCheckpoint =
  | { empty: true; capacity?: number; free?: Int32Array }
  | (WorkspaceValues & { empty: false; capacity?: number; freeCount: number } &
    ({ sparse: true; slots: Int32Array } | { sparse?: false }));
const ACTIVE_FIELDS = ["tile", "parent", "cost", "score", "position"] as const;

/** One match-wide sparse search arena. JS lookup/heap/path containers are also
 * bounded by these slots; their runtime overhead is measured separately. */
export class PlanningWorkspace {
  readonly tile: Int32Array;
  readonly parent: Int32Array;
  readonly cost: Float64Array;
  readonly score: Float64Array;
  readonly position: Int32Array;
  readonly free: Int32Array;
  private freeCount: number;
  private pristine = true;
  constructor(readonly capacity = 65_536) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 65_536)
      throw new Error("Invalid planning workspace capacity");
    this.tile = new Int32Array(capacity);
    this.parent = new Int32Array(capacity);
    this.cost = new Float64Array(capacity);
    this.score = new Float64Array(capacity);
    this.position = new Int32Array(capacity);
    this.free = Int32Array.from(
      { length: capacity },
      (_, i) => capacity - 1 - i,
    );
    this.freeCount = capacity;
  }
  get bytes(): number {
    return this.capacity * 32;
  }
  get used(): number {
    return this.capacity - this.freeCount;
  }
  allocate(
    tile: number,
    cost: number,
    parent: number,
    score: number,
  ): number | undefined {
    if (!this.freeCount) return undefined;
    this.pristine = false;
    const slot = this.free[--this.freeCount];
    this.tile[slot] = tile;
    this.cost[slot] = cost;
    this.parent[slot] = parent;
    this.score[slot] = score;
    this.position[slot] = -1;
    return slot;
  }
  release(slot: number): void {
    this.free[this.freeCount++] = slot;
  }
  checkpoint(): PlanningWorkspaceCheckpoint {
    if (!this.used)
      return {
        empty: true as const,
        capacity: this.capacity,
        // Preserve reused allocation order, but an untouched arena is implicit.
        free: this.pristine ? undefined : this.free.slice(),
      };
    // Free order determines future slot identities. Inactive record values do
    // not: omit them, and retain active records in stable numeric slot order.
    const freeSlots = new Uint8Array(this.capacity);
    for (let at = 0; at < this.freeCount; at++) freeSlots[this.free[at]] = 1;
    const slots = new Int32Array(this.used);
    let count = 0;
    for (let slot = 0; slot < this.capacity; slot++) if (!freeSlots[slot]) slots[count++] = slot;
    const values = { tile: new Int32Array(count), parent: new Int32Array(count), cost: new Float64Array(count),
      score: new Float64Array(count), position: new Int32Array(count) };
    for (const name of ACTIVE_FIELDS)
      for (let at = 0; at < count; at++) values[name][at] = this[name][slots[at]];
    return { empty: false, sparse: true, capacity: this.capacity, slots, ...values,
      free: this.free.slice(0, this.freeCount), freeCount: this.freeCount };
  }
  restore(saved: PlanningWorkspaceCheckpoint): void {
    if (saved.capacity !== undefined && saved.capacity !== this.capacity)
      throw new Error("Planning workspace size changed");
    if (saved.empty) {
      if (saved.free && saved.free.length !== this.capacity)
        throw new Error("Planning workspace size changed");
      this.freeCount = this.capacity;
      this.pristine = !saved.free;
      if (saved.free) this.free.set(saved.free);
      else
        for (let i = 0; i < this.capacity; i++)
          this.free[i] = this.capacity - 1 - i;
      return;
    }
    if (
      !Number.isInteger(saved.freeCount) ||
      saved.freeCount < 0 ||
      saved.freeCount > this.capacity
    )
      throw new Error("Invalid planning workspace free count");
    if (saved.sparse) {
      const count = this.capacity - saved.freeCount;
      if (saved.slots.length !== count || saved.free.length !== saved.freeCount ||
        ACTIVE_FIELDS.some(name => saved[name].length !== count)) throw new Error("Planning workspace size changed");
      const partition = new Uint8Array(this.capacity);
      for (const slot of saved.free) {
        if (slot < 0 || slot >= this.capacity || partition[slot]) throw new Error("Invalid planning workspace partition");
        partition[slot] = 1;
      }
      let previous = -1;
      for (const slot of saved.slots) {
        if (slot <= previous || slot >= this.capacity || partition[slot]) throw new Error("Invalid planning workspace partition");
        previous = slot; partition[slot] = 1;
      }
      // Validate the entire partition before changing any live arena field.
      for (const name of ACTIVE_FIELDS)
        for (let at = 0; at < count; at++) this[name][saved.slots[at]] = saved[name][at];
      this.free.set(saved.free);
    } else {
      // Explicit backward-compatible reader for the original full-buffer shape.
      for (const name of [...ACTIVE_FIELDS, "free"] as const)
        if (saved[name].length !== this.capacity) throw new Error("Planning workspace size changed");
      for (const name of [...ACTIVE_FIELDS, "free"] as const) this[name].set(saved[name]);
    }
    this.pristine = false;
    this.freeCount = saved.freeCount;
  }
}

export interface PlanningPathState {
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
  nodes: Map<number, number>;
  heap: number[];
  path: number[];
  expanded: number;
  trace: number;
  reverse: number;
}

/** Indexed heap has one entry per discovered cell, including decrease-key.
 * A neighbor relaxation is bounded by eight cells. Cleanup is charged by the
 * owning scheduler, so a large search cannot disappear in an unbudgeted loop. */
export class PlanningPath {
  readonly state: PlanningPathState;
  private readonly neighbors = new Array<number>(8);
  constructor(
    private readonly topology: PathTopology,
    private readonly workspace: PlanningWorkspace,
    start: number,
    goal: number,
    revision: number,
    saved?: PlanningPathState,
  ) {
    this.state = saved ?? {
      start,
      goal,
      revision,
      phase: "search",
      nodes: new Map(),
      heap: [],
      path: [],
      expanded: 0,
      trace: goal,
      reverse: 0,
    };
  }
  private before(a: number, b: number): boolean {
    const w = this.workspace;
    return (
      w.score[a] < w.score[b] ||
      (w.score[a] === w.score[b] &&
        (w.cost[a] > w.cost[b] ||
          (w.cost[a] === w.cost[b] && w.tile[a] < w.tile[b])))
    );
  }
  private up(slot: number): void {
    const h = this.state.heap,
      w = this.workspace;
    let at = w.position[slot];
    if (at < 0) {
      at = h.length;
      h.push(slot);
    }
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!this.before(slot, h[parent])) break;
      h[at] = h[parent];
      w.position[h[at]] = at;
      at = parent;
    }
    h[at] = slot;
    w.position[slot] = at;
  }
  private pop(): number | undefined {
    const h = this.state.heap,
      w = this.workspace,
      first = h[0],
      last = h.pop();
    if (first === undefined) return undefined;
    w.position[first] = -1;
    if (!h.length) return first;
    let at = 0;
    while (at * 2 + 1 < h.length) {
      let child = at * 2 + 1;
      if (child + 1 < h.length && this.before(h[child + 1], h[child])) child++;
      if (!this.before(h[child], last!)) break;
      h[at] = h[child];
      w.position[h[at]] = at;
      at = child;
    }
    h[at] = last!;
    w.position[last!] = at;
    return first;
  }
  step(
    budget: number,
    revision: number,
    blocked?: (tile: number) => boolean,
  ): number {
    const s = this.state,
      w = this.workspace;
    if (s.revision !== revision) {
      s.phase = "stale";
      return 0;
    }
    let used = 0;
    while (used < budget) {
      if (s.phase === "search") {
        used++;
        if (!s.nodes.size) {
          if (s.start !== s.goal && blocked?.(s.goal)) {
            s.phase = "unreachable";
            break;
          }
          const slot = w.allocate(
            s.start,
            0,
            s.start,
            this.topology.estimate(s.start, s.goal),
          );
          if (slot === undefined) {
            s.phase = "limited";
            break;
          }
          s.nodes.set(s.start, slot);
          this.up(slot);
          continue;
        }
        const slot = this.pop();
        if (slot === undefined) {
          s.phase = "unreachable";
          break;
        }
        const tile = w.tile[slot];
        if (tile === s.goal) {
          s.phase = "trace";
          continue;
        }
        s.expanded++;
        const count = this.topology.neighbors(tile, this.neighbors, blocked);
        for (let i = 0; i < count; i++) {
          const next = this.neighbors[i];
          if (!this.topology.walkable(next) || blocked?.(next)) continue;
          const cost = w.cost[slot] + this.topology.cost(tile, next);
          let child = s.nodes.get(next);
          if (child !== undefined && cost >= w.cost[child]) continue;
          const score = cost + this.topology.estimate(next, s.goal);
          if (child === undefined) {
            child = w.allocate(next, cost, tile, score);
            if (child === undefined) {
              s.phase = "limited";
              break;
            }
            s.nodes.set(next, child);
          } else {
            w.cost[child] = cost;
            w.parent[child] = tile;
            w.score[child] = score;
          }
          this.up(child);
        }
        if (s.phase === "limited") break;
      } else if (s.phase === "trace") {
        used++;
        if (s.trace === s.start) {
          s.phase = "reverse";
          continue;
        }
        const slot = s.nodes.get(s.trace);
        if (slot === undefined) {
          s.phase = "unreachable";
          break;
        }
        s.path.push(s.trace);
        s.trace = w.parent[slot];
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
