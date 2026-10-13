import { FlatBinaryHeap } from "../core/execution/utils/FlatBinaryHeap";
import { PathTopology } from "./PathTopology";
import type { PlanningWorkspace } from "./PlanningWorkspace";

const CLUSTER = 32;
const INFINITY = 0x3fffffff;
// Search origins repeat heavily (a trader's factory, an army's anchor), and a
// start tree is a pure function of the origin and the cluster's tile costs.
const START_TREE_CACHE = 512;
const SHARED_TREE_LIMIT = 1024;
interface Cluster {
  x: number;
  y: number;
  width: number;
  height: number;
  rowStarts: Int32Array;
  portals: number[];
}
interface LocalTree {
  cost: Int32Array;
  parent: Int16Array | Int32Array;
  start: number;
  // Cells settled while building it: the deterministic effort a cached copy
  // still reports, so budgets never depend on cache contents.
  settled: number;
  effort: number;
}
interface LocalContinuation {
  cluster: number;
  origin: number;
  progress: number;
}
interface LocalRuntime {
  tree: LocalTree;
  heap?: FlatBinaryHeap;
  closed?: Uint8Array;
}
export interface SharedPreparationCheckpoint {
  version: 1;
  clusterRevisions: Uint32Array;
  entries: {
    origin: number; cluster: number; revision: number; progress: number;
    tree: LocalTree; closed?: Uint8Array;
    heap?: { pri: number[]; tiles: number[] };
  }[];
  backbones?: { key: string; chain: number[] }[];
}
interface CorridorHeapState {
  pri: number[];
  tiles: number[];
  precise?: boolean;
}
/** Serializable heap storage is mutated in place. Reconstructing a typed heap
 * every scheduler quantum otherwise allocates its entire retained capacity. */
class CorridorHeap {
  constructor(readonly state: CorridorHeapState) {}
  size(): number {
    return this.state.tiles.length;
  }
  clear(): void {
    this.state.tiles.length = this.state.pri.length = 0;
  }
  enqueue(tile: number, priority: number): void {
    const { pri, tiles } = this.state;
    let i = tiles.length;
    tiles.push(tile);
    pri.push(0);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (priority >= pri[p]) break;
      pri[i] = pri[p];
      tiles[i] = tiles[p];
      i = p;
    }
    pri[i] = this.state.precise ? priority : Math.fround(priority);
    tiles[i] = tile;
  }
  dequeue(): number {
    const { pri, tiles } = this.state,
      top = tiles[0],
      lastPri = pri.pop()!,
      lastTile = tiles.pop()!;
    if (!tiles.length) return top;
    let i = 0;
    while (true) {
      const left = (i << 1) + 1;
      if (left >= tiles.length) break;
      const right = left + 1,
        child = right < tiles.length && pri[right] < pri[left] ? right : left;
      if (lastPri <= pri[child]) break;
      pri[i] = pri[child];
      tiles[i] = tiles[child];
      i = child;
    }
    pri[i] = lastPri;
    tiles[i] = lastTile;
    return top;
  }
}
export interface CorridorState {
  version: 1;
  start: number;
  goal: number;
  revision: number;
  phase:
    | "start"
    | "search"
    | "crossing"
    | "edges"
    | "trace"
    | "reverse"
    | "refine"
    | "segment"
    | "flush"
    | "validate"
    | "release"
    | "done"
    | "failed";
  nodes: Map<number, number>;
  heap: CorridorHeapState;
  local?: LocalContinuation;
  startTree?: LocalTree;
  tree?: LocalTree;
  current: number;
  edge: number;
  trace: number;
  reverse: number;
  chain: number[];
  path: number[];
  segment: number[];
  leg: number;
  cell: number;
  flush: number;
  validated: number;
  refining?: boolean;
}
interface Portal {
  tile: number;
  cluster: number;
  across: number;
  tree?: LocalTree;
}

// HPA*: sampled boundary entrances, exact weighted local crossings, and an
// abstract A* corridor refined back into contiguous tiles. The static map owns
// connectivity; soldiers are handled by local movement, never baked as walls.
// Reference: Botea, Muller, Schaeffer, Near Optimal Hierarchical Path-Finding.
export class HierarchicalPaths {
  private readonly clusters: Cluster[] = [];
  private readonly portals: Portal[] = [];
  private readonly columns: number;
  private readonly heap = new FlatBinaryHeap();
  private readonly neighbors = new Array<number>(8);
  private readonly cost: Int32Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 0;
  private readonly localHeap = new FlatBinaryHeap();
  private readonly localClosed = new Uint8Array(CLUSTER * CLUSTER);
  private readonly localRuntimes=new WeakMap<LocalContinuation,LocalRuntime>();
  private readonly sharedTrees = new Map<number, { revision: number; local: LocalContinuation; runtime: LocalRuntime }>();
  private readonly sharedBackbones = new Map<string, number[]>();
  private backboneNodes = 0;
  private sharedPins = new Set<number>();
  readonly sharedDiagnostics = { preparedUnits: 0, reused: 0, evicted: 0 };
  private readonly reclamation=new WeakMap<Map<number,number>,MapIterator<[number,number]>>();
  private readonly portalsByTile=new Map<number,number>();
  // Deterministic work counter (abstract expansions and start-tree settles). It
  // ignores cache state and lazily rebuilt crossing trees, so a restored match
  // counts exactly what an uninterrupted one does.
  work = 0;
  // Bumped when a cluster's tile costs change, retiring cached start trees.
  private clusterRevision = new Uint32Array(0);
  private readonly startTrees = new Map<
    number,
    { tree: LocalTree; revision: number }
  >();
  private crossingBytes = 0;
  get residency() {
    let treeBytes = this.crossingBytes;
    // The start cache is capped at 512; portal bytes are maintained at mutation.
    for (const { tree } of this.startTrees.values()) treeBytes += tree.cost.byteLength + tree.parent.byteLength;
    let sharedBytes = 0;
    for (const { runtime } of this.sharedTrees.values()) sharedBytes += runtime.tree.cost.byteLength + runtime.tree.parent.byteLength +
      (runtime.closed?.byteLength ?? 0) + (runtime.heap ? Math.max(1024, runtime.heap.size()) * 12 : 0);
    return { clusters: this.clusters.length, portals: this.portals.length, startTrees: this.startTrees.size, treeBytes,
      sharedTrees: this.sharedTrees.size, sharedBytes, backbones: this.sharedBackbones.size, backboneNodes: this.backboneNodes, ...this.sharedDiagnostics };
  }
  pinShared(origins: Iterable<number>): void { this.sharedPins = new Set(origins); }
  sharedCheckpoint(): SharedPreparationCheckpoint {
    return structuredClone({ version: 1 as const, clusterRevisions: this.clusterRevision,
      backbones: [...this.sharedBackbones].map(([key, chain]) => ({ key, chain })),
      entries: [...this.sharedTrees.values()].map(({ revision, local, runtime }) => {
        const heap = runtime.heap?.getState();
        return { ...local, revision, tree: { ...runtime.tree, parent: Int32Array.from(runtime.tree.parent) },
          closed: runtime.closed, heap: heap && { pri: Array.from(heap.pri), tiles: Array.from(heap.tiles) } };
      }) });
  }
  restoreShared(saved?: SharedPreparationCheckpoint): void {
    this.sharedTrees.clear(); this.sharedPins.clear(); this.sharedBackbones.clear(); this.backboneNodes = 0;
    if (!saved) return;
    if (saved.version !== 1 || !(saved.clusterRevisions instanceof Uint32Array) ||
      saved.clusterRevisions.length !== this.clusters.length || saved.entries.length > SHARED_TREE_LIMIT)
      throw Error("Invalid shared preparation checkpoint");
    this.clusterRevision.set(saved.clusterRevisions);
    for (const { key, chain } of saved.backbones ?? []) {
      const parts = key.split(":").map(Number), last = chain[chain.length - 2];
      if (parts.length !== 3 || parts.some(v => !Number.isSafeInteger(v) || v < 0) ||
        parts[0] >= this.clusters.length || parts[1] >= this.clusters.length ||
        this.sharedBackbones.has(key) || chain.length < 2 || chain.length > 4096 ||
        chain[chain.length - 1] !== this.portals.length + 1 ||
        chain.slice(0, -1).some(id => !Number.isInteger(id) || id < 0 || id >= this.portals.length) ||
        this.portals[chain[0]].cluster !== parts[0] || this.portals[last].cluster !== parts[1] ||
        chain.slice(0, -2).some((id, i) => this.portals[id].cluster !== this.portals[chain[i + 1]].cluster &&
          this.portals[id].across !== chain[i + 1]) ||
        this.sharedBackbones.size >= 128 || this.backboneNodes + chain.length > 65536)
        throw Error("Invalid shared water backbone");
      this.sharedBackbones.set(key, chain.slice()); this.backboneNodes += chain.length;
    }
    for (const entry of structuredClone(saved.entries)) {
      const { origin, cluster, revision, progress, tree, heap, closed } = entry;
      const c = this.clusters[cluster], size = c && c.width * c.height;
      if (!Number.isInteger(origin) || origin < 0 || origin >= this.topology.map.width() * this.topology.map.height() ||
        !c || this.cluster(origin) !== cluster || this.sharedTrees.has(origin) ||
        !Number.isSafeInteger(revision) || revision < 0 || revision > this.clusterRevision[cluster] ||
        !Number.isInteger(progress) || progress < 0 || progress > this.localUnits({ origin, cluster, progress }) ||
        !(tree.cost instanceof Int32Array) || tree.cost.length !== size ||
        !(tree.parent instanceof Int32Array) || tree.parent.length !== size ||
        tree.start !== this.index(c, origin) || tree.parent.some(at => at < -1 || at >= size) ||
        !Number.isInteger(tree.effort) || tree.effort < 0 || tree.effort > size * 8 + 1 ||
        !Number.isInteger(tree.settled) || tree.settled < 0 || tree.settled > size ||
        progress !== Math.ceil(tree.effort / 512) ||
        (!!heap !== !!closed) || (closed && (!(closed instanceof Uint8Array) || closed.length !== size || closed.some(v => v > 1))) ||
        (heap && (heap.pri.length !== heap.tiles.length || heap.tiles.length > size * 8 + 1 ||
          heap.pri.some(v => !Number.isFinite(v)) || heap.tiles.some(v => !Number.isInteger(v) || v < 0 || v >= size))))
        throw Error("Invalid shared preparation entry");
      const runtime: LocalRuntime = { tree, closed, heap: heap && FlatBinaryHeap.fromState({
        pri: Float32Array.from(heap.pri), tiles: Uint32Array.from(heap.tiles), capacity: Math.max(1024, heap.tiles.length) }) };
      this.sharedTrees.set(origin, { revision, local: { origin, cluster, progress }, runtime });
    }
  }
  private rememberBackbone(key: string, chain: number[]): void {
    if (chain.length < 2 || chain.length > 4096 || this.sharedBackbones.has(key)) return;
    this.sharedBackbones.set(key, chain); this.backboneNodes += chain.length;
    while (this.sharedBackbones.size > 128 || this.backboneNodes > 65536) {
      const [old, nodes] = this.sharedBackbones.entries().next().value!;
      this.sharedBackbones.delete(old); this.backboneNodes -= nodes.length;
    }
  }
  private sharedLocal(local: LocalContinuation): { runtime: LocalRuntime; local: LocalContinuation; revision: number } {
    this.sharedPins.add(local.origin);
    const revision = this.clusterRevision[local.cluster], old = this.sharedTrees.get(local.origin);
    if (old?.revision === revision) return old;
    if (old) this.sharedTrees.delete(local.origin);
    if (this.sharedTrees.size >= SHARED_TREE_LIMIT) {
      const victim = [...this.sharedTrees.keys()].find(origin => !this.sharedPins.has(origin));
      if (victim === undefined) throw Error("Shared preparation subscriber bound exceeded");
      this.sharedTrees.delete(victim); this.sharedDiagnostics.evicted++;
    }
    const owner = { ...local, progress: 0 };
    // Canonical ownership deliberately ignores physical warm caches. Only the
    // shared owner's charged progress grants readiness, including after restore.
    const c = this.clusters[local.cluster], size = c.width * c.height, start = this.index(c, local.origin);
    const tree: LocalTree = { cost: new Int32Array(size).fill(INFINITY), parent: new Int16Array(size).fill(-1), start, settled: 0, effort: 0 };
    tree.cost[start] = 0;
    const heap = new FlatBinaryHeap(); heap.enqueue(start, 0);
    const entry = { revision, local: owner, runtime: { tree, heap, closed: new Uint8Array(size) } as LocalRuntime };
    this.sharedTrees.set(local.origin, entry);
    return entry;
  }
  constructor(private readonly topology: PathTopology) {
    const map = topology.map;
    this.columns = Math.ceil(map.width() / CLUSTER);
    for (let y = 0; y < map.height(); y += CLUSTER)
      for (let x = 0; x < map.width(); x += CLUSTER)
        this.clusters.push({
          x,
          y,
          width: Math.min(CLUSTER, map.width() - x),
          height: Math.min(CLUSTER, map.height() - y),
          rowStarts: Int32Array.from({ length: Math.min(CLUSTER, map.height() - y) }, (_, row) => map.ref(x, y + row)),
          portals: [],
        });
    // A contiguous open boundary run is internally connected along the edge.
    // Short runs get their midpoint; longer runs keep ends and extra entrances.
    const boundary = (
      length: number,
      pair: (offset: number) => [number, number],
    ) => {
      let start = -1;
      const flush = (end: number) => {
        if (start < 0) return;
        const offsets =
          end - start <= 8
            ? [Math.floor((start + end - 1) / 2)]
            : [start, end - 1];
        if (end - start > 8)
          for (let at = start + 8; at < end - 1; at += 8) offsets.push(at);
        for (const offset of offsets) {
          const [a, b] = pair(offset),
            first = this.portals.length;
          this.addPortal(a, first + 1);
          this.addPortal(b, first);
        }
        start = -1;
      };
      for (let offset = 0; offset < length; offset++) {
        const [a, b] = pair(offset);
        if (topology.walkable(a) && topology.walkable(b)) {
          if (start < 0) start = offset;
        } else flush(offset);
      }
      flush(length);
    };
    for (let x = CLUSTER; x < map.width(); x += CLUSTER)
      for (let y = 0; y < map.height(); y += CLUSTER)
        boundary(Math.min(CLUSTER, map.height() - y), (offset) => [
          map.ref(x - 1, y + offset),
          map.ref(x, y + offset),
        ]);
    for (let y = CLUSTER; y < map.height(); y += CLUSTER)
      for (let x = 0; x < map.width(); x += CLUSTER)
        boundary(Math.min(CLUSTER, map.width() - x), (offset) => [
          map.ref(x + offset, y - 1),
          map.ref(x + offset, y),
        ]);
    const size = this.portals.length + 2;
    this.cost = new Int32Array(size);
    this.parent = new Int32Array(size);
    this.seen = new Uint32Array(size);
    this.closed = new Uint32Array(size);
    this.clusterRevision = new Uint32Array(this.clusters.length);
    topology.onCostsChanged((tiles) => {
      // Cover changes alter travel cost, not connectivity. Retire crossing
      // trees only in the touched clusters; boundary costs are read live.
      const changed = new Set(tiles.map((tile) => this.cluster(tile)));
      for (const cluster of changed) {
        this.clusterRevision[cluster]++;
        for (const portal of this.clusters[cluster].portals) {
          const tree = this.portals[portal].tree;
          if (tree) this.crossingBytes -= tree.cost.byteLength + tree.parent.byteLength;
          this.portals[portal].tree = undefined;
        }
      }
    });
  }
  private cluster(tile: number): number {
    const map = this.topology.map;
    return (
      Math.floor(map.x(tile) / CLUSTER) +
      Math.floor(map.y(tile) / CLUSTER) * this.columns
    );
  }
  private addPortal(tile: number, across: number) {
    const cluster = this.cluster(tile),
      id = this.portals.length;
    this.portals.push({ tile, cluster, across });
    this.portalsByTile.set(tile,id);
    this.clusters[cluster].portals.push(id);
  }
  private index(cluster: Cluster, tile: number) {
    const map = this.topology.map;
    return map.x(tile) - cluster.x + (map.y(tile) - cluster.y) * cluster.width;
  }
  private tile(cluster: Cluster, index: number) {
    return cluster.rowStarts[Math.floor(index / cluster.width)] + index % cluster.width;
  }
  private localTree(start: number, clusterId: number): LocalTree {
    const c = this.clusters[clusterId],
      size = c.width * c.height;
    const cost = new Int32Array(size).fill(INFINITY),
      parent = new Int16Array(size).fill(-1);
    // Scratch heap and closed set are reused: a tree keeps only cost and parent.
    const heap = this.localHeap,
      startIndex = this.index(c, start);
    heap.clear();
    cost[startIndex] = 0;
    heap.enqueue(startIndex, 0);
    let settled = 0, effort = 0;
    const closed = this.localClosed.subarray(0, size);
    closed.fill(0);
    const map = this.topology.map;
    while (heap.size()) {
      const index = heap.dequeue();
      effort++;
      if (closed[index]) continue;
      closed[index] = 1;
      settled++;
      const tile = this.tile(c, index),
        count = this.topology.neighbors(tile, this.neighbors);
      for (let i = 0; i < count; i++) {
        const next = this.neighbors[i],
          x = map.x(next),
          y = map.y(next);
        if (
          x < c.x ||
          y < c.y ||
          x >= c.x + c.width ||
          y >= c.y + c.height ||
          !this.topology.walkable(next)
        )
          continue;
        // Coordinates were already decoded for cluster bounds above. Reuse
        // them instead of decoding the tile again in this hot crossing loop.
        const nextIndex = x - c.x + (y - c.y) * c.width,
          candidate = cost[index] + this.topology.cost(tile, next);
        if (closed[nextIndex] || candidate >= cost[nextIndex]) continue;
        cost[nextIndex] = candidate;
        parent[nextIndex] = index;
        heap.enqueue(nextIndex, candidate);
      }
    }
    return { cost, parent, start: startIndex, settled, effort };
  }
  private startTree(start: number, clusterId: number): LocalTree {
    const revision = this.clusterRevision[clusterId];
    const hit = this.startTrees.get(start);
    if (hit && hit.revision === revision) {
      // Refresh recency so hot origins survive eviction.
      this.startTrees.delete(start);
      this.startTrees.set(start, hit);
      this.work += hit.tree.settled;
      return hit.tree;
    }
    const tree = this.localTree(start, clusterId);
    this.work += tree.settled;
    this.startTrees.set(start, { tree, revision });
    if (this.startTrees.size > START_TREE_CACHE)
      this.startTrees.delete(this.startTrees.keys().next().value!);
    return tree;
  }
  private crossing(id: number): LocalTree {
    const portal = this.portals[id];
    if (!portal.tree) {
      portal.tree = this.localTree(portal.tile, portal.cluster);
      this.crossingBytes += portal.tree.cost.byteLength + portal.tree.parent.byteLength;
    }
    return portal.tree;
  }
  // Preparation happens while a match loads, keeping cache construction out of
  // ordinary combat ticks. Local search arrays remain cluster-sized.
  prepare(): void {
    for (let id = 0; id < this.portals.length; id++) this.crossing(id);
  }
  private warmCursor = 0;
  /**
   * Builds up to `count` missing crossing trees from where the last call ended.
   * Trees are pure functions of tile costs and are rebuilt lazily when a query
   * needs one, so warming only moves cost out of ordinary ticks: it never changes
   * a route or the deterministic work counter. Returns true once every portal
   * has been visited.
   */
  warm(count: number): boolean {
    while (count > 0 && this.warmCursor < this.portals.length) {
      const portal = this.portals[this.warmCursor++];
      if (portal.tree) continue;
      this.crossing(this.warmCursor - 1);
      count--;
    }
    return this.warmCursor >= this.portals.length;
  }
  private append(
    tree: LocalTree,
    cluster: Cluster,
    goal: number,
    result: number[],
  ) {
    const segment: number[] = [];
    for (
      let at = this.index(cluster, goal);
      at !== tree.start;
      at = tree.parent[at]
    ) {
      if (at < 0) throw new Error("Invalid hierarchical route refinement");
      segment.push(this.tile(cluster, at));
    }
    for (let i = segment.length - 1; i >= 0; i--) result.push(segment[i]);
  }
  begin(
    start: number,
    goal: number,
    revision: number,
    nodes: Map<number, number>,
  ): CorridorState {
    return {
      version: 1,
      start,
      goal,
      revision,
      nodes,
      phase: "start",
      heap: {pri:[],tiles:[]},
      current: -1,
      edge: 0,
      trace: -1,
      reverse: 0,
      chain: [],
      path: [start],
      segment: [],
      leg: 0,
      cell: -1,
      flush: -1,
      validated: 0,
    };
  }
  validate(
    s: CorridorState,
    w: PlanningWorkspace,
    revision = s.revision,
    shared = false,
  ): void {
    const phases = [
      "start",
      "search",
      "crossing",
      "edges",
      "trace",
      "reverse",
      "refine",
      "segment",
      "flush",
      "validate",
      "release",
      "done",
      "failed",
    ];
    const size = this.topology.map.width() * this.topology.map.height(),
      max = this.portals.length + 1;
    if (
      s.version !== 1 ||
      !phases.includes(s.phase) ||
      !Number.isSafeInteger(s.revision) ||
      s.revision < 0 ||
      !Number.isInteger(s.start) ||
      s.start < 0 ||
      s.start >= size ||
      !Number.isInteger(s.goal) ||
      s.goal < 0 ||
      s.goal >= size ||
      !(s.nodes instanceof Map) ||
      s.nodes.size > w.capacity ||
      (s.heap.precise !== undefined && typeof s.heap.precise !== "boolean") ||
      s.heap.pri.length !== s.heap.tiles.length ||
      s.heap.tiles.length > w.capacity ||
      Array.from(s.heap.tiles).some((id) => id > max || !s.nodes.has(id)) ||
      Array.from(s.heap.pri).some((x) => !Number.isFinite(x)) ||
      [...s.nodes].some(
        ([id, slot]) =>
          !Number.isInteger(id) ||
          id < 0 ||
          id > max ||
          !Number.isInteger(slot) ||
          slot < 0 ||
          slot >= w.capacity ||
          w.tile[slot] !== id,
      ) ||
      s.chain.length > w.capacity ||
      s.path.length > size + w.capacity ||
      s.segment.length > CLUSTER * CLUSTER ||
      !Number.isInteger(s.current) ||
      s.current < -1 ||
      s.current > max ||
      !Number.isInteger(s.trace) ||
      s.trace < -1 ||
      s.trace > max ||
      !Number.isInteger(s.edge) ||
      s.edge < 0 ||
      s.edge > this.portals.length + 2 ||
      !Number.isInteger(s.reverse) ||
      s.reverse < 0 ||
      s.reverse > s.chain.length ||
      !Number.isInteger(s.leg) ||
      s.leg < 0 ||
      s.leg > s.chain.length ||
      !Number.isInteger(s.cell) ||
      s.cell < -1 ||
      s.cell >= CLUSTER * CLUSTER ||
      !Number.isInteger(s.flush) ||
      s.flush < -1 ||
      s.flush >= CLUSTER * CLUSTER ||
      !Number.isInteger(s.validated) ||
      s.validated < 0 ||
      s.validated > s.path.length ||
      (s.refining !== undefined && typeof s.refining !== "boolean") ||
      s.path.some(
        (tile) => !Number.isInteger(tile) || tile < 0 || tile >= size,
      ) ||
      s.chain.some((id) => !Number.isInteger(id) || id < 0 || id > max)
    )
      throw Error("Invalid corridor checkpoint");
    if (
      s.local &&
      (!Number.isInteger(s.local.cluster) ||
        s.local.cluster < 0 ||
        s.local.cluster >= this.clusters.length ||
        !Number.isInteger(s.local.origin) ||
        s.local.origin < 0 ||
        s.local.origin >= size ||
        this.cluster(s.local.origin) !== s.local.cluster ||
        !Number.isInteger(s.local.progress) ||
        s.local.progress < 0 ||
        s.local.progress > this.localUnits(s.local))
    )
      throw Error("Invalid corridor local checkpoint");
    for (const tree of [s.startTree, s.tree])
      if (
        tree &&
        (!(tree.cost instanceof Int32Array) ||
          !(
            tree.parent instanceof Int16Array ||
            tree.parent instanceof Int32Array
          ) ||
          tree.cost.length < 1 ||
          tree.cost.length > CLUSTER * CLUSTER ||
          tree.parent.length !== tree.cost.length ||
          !Number.isInteger(tree.start) ||
          tree.start < 0 ||
          tree.start >= tree.cost.length ||
          tree.parent.some((cell) => cell < -1 || cell >= tree.cost.length) ||
          !Number.isInteger(tree.settled) ||
          tree.settled < 1 ||
          tree.settled > tree.cost.length ||
          !Number.isInteger(tree.effort) ||
          tree.effort < tree.settled ||
          tree.effort > 8 * tree.cost.length + 1)
      )
        throw Error("Invalid corridor tree checkpoint");
    const legalStep = (from: number, to: number): boolean => {
      const count = this.topology.neighbors(from, this.neighbors);
      for (let i = 0; i < count; i++)
        if (this.neighbors[i] === to) return this.topology.walkable(to);
      return false;
    };
    for (let i = 0; i < s.path.length; i++)
      if (
        !this.topology.walkable(s.path[i]) ||
        (i === 0 ? s.path[i] !== s.start : !legalStep(s.path[i - 1], s.path[i]))
      )
        throw Error("Invalid corridor path checkpoint");
    const validateTree = (tree: LocalTree, origin: number): void => {
      const cluster = this.clusters[this.cluster(origin)];
      if (
        tree.cost.length !== cluster.width * cluster.height ||
        tree.start !== this.index(cluster, origin) ||
        tree.cost[tree.start] !== 0 ||
        tree.parent[tree.start] !== -1
      )
        throw Error("Invalid corridor tree origin");
      for (let i = 0; i < tree.cost.length; i++) {
        if (i === tree.start) continue;
        const parent = tree.parent[i];
        if (tree.cost[i] === INFINITY && parent === -1) continue;
        if (
          parent < 0 ||
          tree.cost[i] <= tree.cost[parent] ||
          !legalStep(this.tile(cluster, parent), this.tile(cluster, i)) ||
          (s.revision === revision &&
            tree.cost[i] !==
              tree.cost[parent] +
                this.topology.cost(
                  this.tile(cluster, parent),
                  this.tile(cluster, i),
                ))
        )
          throw Error("Invalid corridor tree edge");
      }
    };
    if (s.startTree) validateTree(s.startTree, s.start);
    if (s.tree) {
      const origin =
        s.current === this.portals.length
          ? s.start
          : this.portals[s.current]?.tile;
      if (origin === undefined) throw Error("Invalid corridor tree owner");
      validateTree(s.tree, origin);
    }
    if (s.local && s.revision === revision && !shared) this.localRuntime(s.local);
  }
  private prepareLocal(
    origin: number,
    cluster: number,
    cached?: LocalTree,
  ): LocalContinuation {
    const local = { origin, cluster, progress: 0 };
    if (cached) this.localRuntimes.set(local, { tree: cached });
    return local;
  }
  private localUnits(local: LocalContinuation): number {
    const c = this.clusters[local.cluster];
    return Math.ceil((8 * c.width * c.height + 1) / 512);
  }
  /** Only deterministic progress is checkpointed. Cached and cold preparation
   * have identical logical state; cold scratch can be reconstructed on restore
   * from this pure cluster origin and the restored terrain cost epoch. */
  private localRuntime(local: LocalContinuation): LocalRuntime {
    const old = this.localRuntimes.get(local);
    if (old) return old;
    const hit = this.startTrees.get(local.origin),
      portal = this.portalsByTile.get(local.origin);
    const cached =
      hit?.revision === this.clusterRevision[local.cluster]
        ? hit.tree
        : portal === undefined
          ? undefined
          : this.portals[portal].tree;
    if (cached) {
      const runtime = { tree: cached };
      this.localRuntimes.set(local, runtime);
      return runtime;
    }
    const c = this.clusters[local.cluster],
      size = c.width * c.height,
      start = this.index(c, local.origin);
    const tree = {
      cost: new Int32Array(size).fill(INFINITY),
      parent: new Int16Array(size).fill(-1),
      start,
      settled: 0,
      effort: 0,
    };
    tree.cost[start] = 0;
    const heap = new FlatBinaryHeap();
    heap.enqueue(start, 0);
    const runtime = { tree, heap, closed: new Uint8Array(size) };
    this.localRuntimes.set(local, runtime);
    this.advanceLocal(runtime, local.cluster, local.progress * 512);
    return runtime;
  }
  private advanceLocal(
    runtime: LocalRuntime,
    cluster: number,
    limit: number,
  ): void {
    if (!runtime.heap) return;
    const heap = runtime.heap,
      c = this.clusters[cluster],
      tree = runtime.tree,
      map = this.topology.map;
    let used = 0;
    while (used < limit && heap.size()) {
      const index = heap.dequeue();
      used++;
      tree.effort++;
      if (runtime.closed![index]) continue;
      runtime.closed![index] = 1;
      tree.settled++;
      const tile = this.tile(c, index),
        count = this.topology.neighbors(tile, this.neighbors);
      for (let i = 0; i < count; i++) {
        const next = this.neighbors[i],
          x = map.x(next),
          y = map.y(next);
        if (
          x < c.x ||
          y < c.y ||
          x >= c.x + c.width ||
          y >= c.y + c.height ||
          !this.topology.walkable(next)
        )
          continue;
        const at = x - c.x + (y - c.y) * c.width,
          cost = tree.cost[index] + this.topology.cost(tile, next);
        if (runtime.closed![at] || cost >= tree.cost[at]) continue;
        tree.cost[at] = cost;
        tree.parent[at] = index;
        heap.enqueue(at, cost);
      }
    }
    if (!heap.size()) {
      runtime.heap = undefined;
      runtime.closed = undefined;
    }
  }
  /** One preparation unit is at most 512 dequeues. Cache hits replay the
   * completed tree's actual effort, so cold and warm queries yield identically. */
  private stepLocal(local: LocalContinuation, budget: number): number {
    const runtime = this.localRuntime(local);
    let used = 0;
    while (
      used < budget &&
      (runtime.heap || local.progress < Math.ceil(runtime.tree.effort / 512))
    ) {
      this.advanceLocal(runtime, local.cluster, 512);
      local.progress++;
      used++;
      if (local.progress > this.localUnits(local))
        throw Error("Cluster tree exceeds preparation bound");
    }
    return used;
  }
  /** Each query owns its continuation; abstract nodes share the exact planner's
   * match-wide arena. No whole-graph arrays or unbounded query heaps are retained. */
  step(
    s: CorridorState,
    w: PlanningWorkspace,
    budget: number,
    revision: number,
    blocked?: (tile: number) => boolean,
    preparationBudget = Infinity,
    preparation: { used: number } = { used: 0 },
    shared = false,
  ): number {
    const startNode = this.portals.length,
      goalNode = startNode + 1,
      startCluster = this.cluster(s.start),
      goalCluster = this.cluster(s.goal);
    const backboneKey = `${startCluster}:${goalCluster}:${s.revision}`;
    let used = 0;
    const heap = new CorridorHeap(s.heap);
    const fail = () => {
      if (shared && this.topology.water) {
        const old = this.sharedBackbones.get(backboneKey);
        if (old) { this.sharedBackbones.delete(backboneKey); this.backboneNodes -= old.length; }
      }
      s.phase = "release";
      s.local = undefined;
      s.tree = undefined;
      s.startTree = undefined;
      s.path = [];
      s.chain = [];
      s.segment = [];
      s.current = s.trace = s.cell = s.flush = -1;
      s.edge = s.reverse = s.leg = s.validated = 0;
      s.refining = undefined;
      heap.clear();
    };
    const visit = (from: number, next: number, distance: number) => {
      if (distance === INFINITY) return;
      const parent = s.nodes.get(from)!,
        existing = s.nodes.get(next);
      if (existing !== undefined && w.position[existing] === -2) return;
      const candidate = w.cost[parent] + distance;
      if (existing !== undefined && candidate >= w.cost[existing]) return;
      const slot = existing ?? w.allocate(next, candidate, from, 0);
      if (slot === undefined || heap.size() >= w.capacity) {
        if (slot !== undefined && existing === undefined) w.release(slot);
        fail();
        return false;
      }
      if (existing === undefined) s.nodes.set(next, slot);
      w.cost[slot] = candidate;
      w.parent[slot] = from;
      heap.enqueue(
        next,
        candidate +
          this.topology.estimate(
            next === goalNode ? s.goal : this.portals[next].tile,
            s.goal,
          ) + (shared ? this.topology.estimate(next === goalNode ? s.goal : this.portals[next].tile, s.goal) /
            ((this.topology.map.width() + this.topology.map.height()) * 14 + 1) * 0.5 : 0),
      );
    };
    if (s.revision !== revision && s.phase !== "done" && s.phase !== "failed")
      fail();
    while (used < budget && s.phase !== "done" && s.phase !== "failed") {
      if (
        s.path.length >
        this.topology.map.width() * this.topology.map.height() + w.capacity
      ) {
        fail();
      }
      if (s.phase === "release") {
        let entries = this.reclamation.get(s.nodes);
        if (!entries) this.reclamation.set(s.nodes, entries = s.nodes.entries());
        while (used < budget && s.nodes.size) {
          const entry = entries.next().value!;
          w.release(entry[1]);
          s.nodes.delete(entry[0]);
          used++;
        }
        if (!s.nodes.size) this.reclamation.delete(s.nodes);
        if (!s.nodes.size && used < budget) {
          s.phase = "failed";
          used++;
        }
        continue;
      }
      if (s.phase === "start" || s.phase === "crossing") {
        if (!shared && preparation.used >= preparationBudget) break;
        if (!s.local) {
          const origin =
              s.phase === "start" ? s.start : this.portals[s.current].tile,
            cluster = this.cluster(origin);
          const hit =
            s.phase === "start" ? this.startTrees.get(origin) : undefined;
          s.local = this.prepareLocal(
            origin,
            cluster,
            s.phase === "start"
              ? hit?.revision === this.clusterRevision[cluster]
                ? hit.tree
                : undefined
              : this.portals[s.current].tree,
          );
          used++;
          continue;
        }
        const entry = shared ? this.sharedLocal(s.local) : undefined;
        const runtime = entry?.runtime ?? this.localRuntime(s.local);
        const allowance = Math.min(budget - used, preparationBudget - preparation.used);
        let localWork = 0;
        if (entry) {
          if (!runtime.heap) { this.sharedDiagnostics.reused++; used++; }
          else if (allowance <= 0) break;
          while (localWork < allowance && runtime.heap) {
            this.advanceLocal(runtime, s.local.cluster, 512);
            entry.local.progress++; localWork++; this.sharedDiagnostics.preparedUnits++;
          }
          s.local.progress = entry.local.progress;
        } else localWork = this.stepLocal(s.local, allowance);
        used += localWork;
        preparation.used += localWork;
        if (
          runtime.heap ||
          s.local.progress < Math.ceil(runtime.tree.effort / 512)
        )
          continue;
        const tree = runtime.tree;
        if (s.phase === "start") {
          s.startTree = tree;
          this.startTrees.set(s.start, {
            tree,
            revision: this.clusterRevision[startCluster],
          });
          if (this.startTrees.size > START_TREE_CACHE)
            this.startTrees.delete(this.startTrees.keys().next().value!);
          if (
            startCluster === goalCluster &&
            tree.cost[this.index(this.clusters[startCluster], s.goal)] !==
              INFINITY
          ) {
            s.chain = [goalNode];
            s.phase = "refine";
            s.current = startNode;
          } else {
            const backbone = shared && this.topology.water && this.sharedBackbones.get(backboneKey);
            if (backbone && tree.cost[this.index(this.clusters[startCluster], this.portals[backbone[0]].tile)] !== INFINITY) {
              s.chain = backbone; s.phase = "refine"; s.current = startNode; s.leg = 0;
              s.local = undefined;
              continue;
            }
            const slot = w.allocate(startNode, 0, -1, 0);
            if (slot === undefined) fail();
            else {
              s.nodes.set(startNode, slot);
              heap.enqueue(startNode, this.topology.estimate(s.start, s.goal));
              s.phase = "search";
            }
          }
        } else {
          const portal = this.portals[s.current];
          if (!portal.tree) {
            portal.tree = tree;
            this.crossingBytes += tree.cost.byteLength + tree.parent.byteLength;
          }
          s.tree = tree;
          s.phase = s.refining ? "segment" : "edges";
          s.refining = undefined;
          s.edge = 0;
        }
        s.local = undefined;
        continue;
      }
      used++;
      if (s.phase === "search") {
        if (!heap.size()) {
          fail();
          continue;
        }
        const id = heap.dequeue(),
          slot = s.nodes.get(id)!;
        if (w.position[slot] === -2) continue;
        w.position[slot] = -2;
        s.current = id;
        s.edge = 0;
        if (id === goalNode) {
          s.phase = "trace";
          s.trace = goalNode;
        } else s.phase = id === startNode ? "edges" : "crossing";
      } else if (s.phase === "edges") {
        const cluster =
            s.current === startNode
              ? startCluster
              : this.portals[s.current].cluster,
          c = this.clusters[cluster];
        if (s.current === startNode) {
          if (s.edge < c.portals.length) {
            const next = c.portals[s.edge++];
            visit(
              s.current,
              next,
              s.startTree!.cost[this.index(c, this.portals[next].tile)],
            );
          } else s.phase = "search";
        } else if (s.edge === 0) {
          s.edge++;
          const p = this.portals[s.current];
          visit(
            s.current,
            p.across,
            this.topology.cost(p.tile, this.portals[p.across].tile),
          );
        } else if (s.edge <= c.portals.length) {
          const next = c.portals[s.edge++ - 1];
          if (next !== s.current)
            visit(
              s.current,
              next,
              s.tree!.cost[this.index(c, this.portals[next].tile)],
            );
        } else {
          if (
            cluster !== goalCluster ||
            visit(s.current, goalNode, s.tree!.cost[this.index(c, s.goal)]) !==
              false
          )
            s.phase = "search";
          s.tree = undefined;
        }
      } else if (s.phase === "trace") {
        if (s.trace === startNode) {
          s.phase = "reverse";
          s.reverse = 0;
        } else {
          s.chain.push(s.trace);
          s.trace = w.parent[s.nodes.get(s.trace)!];
        }
      } else if (s.phase === "reverse") {
        if (s.reverse < Math.floor(s.chain.length / 2)) {
          const a = s.reverse++,
            b = s.chain.length - 1 - a;
          [s.chain[a], s.chain[b]] = [s.chain[b], s.chain[a]];
        } else {
          if (shared && this.topology.water) this.rememberBackbone(backboneKey, s.chain);
          s.phase = "refine";
          s.current = startNode;
        }
      } else if (s.phase === "refine") {
        if (s.leg >= s.chain.length) {
          s.phase = "validate";
          continue;
        }
        const next = s.chain[s.leg];
        if (
          s.current !== startNode &&
          next !== goalNode &&
          this.portals[s.current].cluster !== this.portals[next].cluster
        ) {
          if (this.portals[s.current].across !== next) { fail(); continue; }
          s.path.push(this.portals[next].tile);
          s.current = next;
          s.leg++;
          continue;
        }
        const cluster =
          s.current === startNode
            ? startCluster
            : this.portals[s.current].cluster;
        s.cell = this.index(
          this.clusters[cluster],
          next === goalNode ? s.goal : this.portals[next].tile,
        );
        s.segment = [];
        if (s.current === startNode) {
          s.tree = s.startTree;
          s.phase = "segment";
        } else {
          s.tree = undefined;
          s.refining = true;
          s.phase = "crossing";
        }
      } else if (s.phase === "segment") {
        if (s.tree!.cost[s.cell] === INFINITY) { fail(); continue; }
        if (s.cell === s.tree!.start) {
          s.flush = s.segment.length - 1;
          s.phase = "flush";
        } else {
          if (s.cell < 0) throw Error("Invalid hierarchical route refinement");
          const cluster =
            s.current === startNode
              ? startCluster
              : this.portals[s.current].cluster;
          s.segment.push(this.tile(this.clusters[cluster], s.cell));
          s.cell = s.tree!.parent[s.cell];
        }
      } else if (s.phase === "flush") {
        if (s.flush >= 0) s.path.push(s.segment[s.flush--]);
        else {
          s.current = s.chain[s.leg++];
          s.tree = undefined;
          s.segment = [];
          s.phase = "refine";
        }
      } else if (s.phase === "validate") {
        // Refinement already certifies immutable terrain connectivity. A v4
        // corridor without a dynamic access mask has nothing else to recheck.
        if (shared && !blocked) { s.validated = s.path.length; s.phase = "done"; used++; continue; }
        if (s.validated >= s.path.length) {
          s.phase = "done";
          continue;
        }
        const tile = s.path[s.validated],
          previous = s.path[s.validated - 1],
          map = this.topology.map;
        if (
          blocked?.(tile) ||
          (s.validated > 0 &&
            map.x(tile) !== map.x(previous) &&
            map.y(tile) !== map.y(previous) &&
            (blocked?.(map.ref(map.x(tile), map.y(previous))) ||
              blocked?.(map.ref(map.x(previous), map.y(tile)))))
        ) {
          fail();
          continue;
        }
        s.validated++;
      }
    }
    this.work += used;
    return used;
  }
  find(start: number, goal: number): number[] | null {
    const startCluster = this.cluster(start),
      goalCluster = this.cluster(goal);
    const startTree = this.startTree(start, startCluster),
      startNode = this.portals.length,
      goalNode = startNode + 1;
    if (
      startCluster === goalCluster &&
      startTree.cost[this.index(this.clusters[startCluster], goal)] !== INFINITY
    ) {
      const result: number[] = [];
      this.append(startTree, this.clusters[startCluster], goal, result);
      return result;
    }
    this.generation = (this.generation + 1) >>> 0;
    if (!this.generation) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.generation = 1;
    }
    const stamp = this.generation;
    this.heap.clear();
    this.cost[startNode] = 0;
    this.seen[startNode] = stamp;
    this.parent[startNode] = -1;
    this.heap.enqueue(startNode, this.topology.estimate(start, goal));
    const visit = (from: number, next: number, distance: number) => {
      if (distance === INFINITY || this.closed[next] === stamp) return;
      const candidate = this.cost[from] + distance;
      if (this.seen[next] === stamp && candidate >= this.cost[next]) return;
      this.seen[next] = stamp;
      this.cost[next] = candidate;
      this.parent[next] = from;
      this.heap.enqueue(
        next,
        candidate +
          this.topology.estimate(
            next === goalNode ? goal : this.portals[next].tile,
            goal,
          ),
      );
    };
    while (this.heap.size()) {
      const id = this.heap.dequeue();
      if (this.closed[id] === stamp) continue;
      this.closed[id] = stamp;
      this.work += 3;
      if (id === goalNode) {
        const nodes: number[] = [];
        for (let at = goalNode; at !== startNode; at = this.parent[at])
          nodes.push(at);
        nodes.reverse();
        const result: number[] = [];
        let previous = startNode;
        for (const next of nodes) {
          if (previous === startNode)
            this.append(
              startTree,
              this.clusters[startCluster],
              this.portals[next].tile,
              result,
            );
          else if (next === goalNode)
            this.append(
              this.crossing(previous),
              this.clusters[goalCluster],
              goal,
              result,
            );
          else if (
            this.portals[previous].cluster === this.portals[next].cluster
          )
            this.append(
              this.crossing(previous),
              this.clusters[this.portals[previous].cluster],
              this.portals[next].tile,
              result,
            );
          else result.push(this.portals[next].tile);
          previous = next;
        }
        return result;
      }
      if (id === startNode) {
        const c = this.clusters[startCluster];
        for (const portal of c.portals)
          visit(
            id,
            portal,
            startTree.cost[this.index(c, this.portals[portal].tile)],
          );
      } else {
        const portal = this.portals[id],
          c = this.clusters[portal.cluster],
          tree = this.crossing(id);
        visit(
          id,
          portal.across,
          this.topology.cost(portal.tile, this.portals[portal.across].tile),
        );
        for (const next of c.portals)
          if (next !== id)
            visit(id, next, tree.cost[this.index(c, this.portals[next].tile)]);
        if (portal.cluster === goalCluster)
          visit(id, goalNode, tree.cost[this.index(c, goal)]);
      }
    }
    return null;
  }
}
