import { FlatBinaryHeap } from "../core/execution/utils/FlatBinaryHeap";
import { PathTopology } from "./PathTopology";

const CLUSTER = 32;
const INFINITY = 0x3fffffff;
// Search origins repeat heavily (a trader's factory, an army's anchor), and a
// start tree is a pure function of the origin and the cluster's tile costs.
const START_TREE_CACHE = 512;
interface Cluster {
  x: number;
  y: number;
  width: number;
  height: number;
  portals: number[];
}
interface LocalTree {
  cost: Int32Array;
  parent: Int16Array;
  start: number;
  // Cells settled while building it: the deterministic effort a cached copy
  // still reports, so budgets never depend on cache contents.
  settled: number;
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
    return { clusters: this.clusters.length, portals: this.portals.length, startTrees: this.startTrees.size, treeBytes };
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
    this.clusters[cluster].portals.push(id);
  }
  private index(cluster: Cluster, tile: number) {
    const map = this.topology.map;
    return map.x(tile) - cluster.x + (map.y(tile) - cluster.y) * cluster.width;
  }
  private tile(cluster: Cluster, index: number) {
    return this.topology.map.ref(
      cluster.x + (index % cluster.width),
      cluster.y + Math.floor(index / cluster.width),
    );
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
    let settled = 0;
    const closed = this.localClosed.subarray(0, size);
    closed.fill(0);
    const map = this.topology.map;
    while (heap.size()) {
      const index = heap.dequeue();
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
        const nextIndex = this.index(c, next),
          candidate = cost[index] + this.topology.cost(tile, next);
        if (closed[nextIndex] || candidate >= cost[nextIndex]) continue;
        cost[nextIndex] = candidate;
        parent[nextIndex] = index;
        heap.enqueue(nextIndex, candidate);
      }
    }
    return { cost, parent, start: startIndex, settled };
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
