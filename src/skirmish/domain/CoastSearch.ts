import type { GameMap } from "../../core/game/GameMap";
import type { Coast } from "../CoastIndex";
export interface RankedCoast {
  edge: Coast;
  key: number;
  ordinal: number;
}
interface Node {
  children?: [number, number];
  edges?: number[];
  land: number[];
  water: number[];
  first: number;
  ordinal: number;
}
interface Entry {
  node?: number;
  edge?: number;
  key: number;
  land: number;
  ordinal: number;
}
export interface CoastSearchState {
  heap: Entry[];
  started: boolean;
  done: boolean;
}
export const coastSearch = (): CoastSearchState => ({
  heap: [],
  started: false,
  done: false,
});
/** Immutable coast bounds built with the map. Each query yields after one tree
 * expansion (at most four heap inserts), emits exact nearest-first candidates,
 * and checkpoints only its frontier. No whole-coast ranking precedes a voyage. */
export class CoastSearch {
  private readonly nodes: Node[] = [];
  private readonly root?: number;
  constructor(
    private readonly map: GameMap,
    private readonly edges: readonly Coast[],
  ) {
    if (edges.length)
      this.root = this.build(
        edges.map((_, i) => i),
        0,
      );
  }
  private build(ids: number[], depth: number): number {
    const xs = ids.map((i) => this.map.x(this.edges[i].landTile)),
      ys = ids.map((i) => this.map.y(this.edges[i].landTile));
    const wx = ids.map((i) => this.map.x(this.edges[i].waterTile)),
      wy = ids.map((i) => this.map.y(this.edges[i].waterTile));
    const bounds = (x: number[], y: number[]) => [
      Math.min(...x),
      Math.max(...x),
      Math.min(...y),
      Math.max(...y),
    ];
    const id = this.nodes.length,
      node: Node = {
        land: bounds(xs, ys),
        water: bounds(wx, wy),
        first: Math.min(...ids.map((i) => this.edges[i].landTile)),
        ordinal: Math.min(...ids),
      };
    this.nodes.push(node);
    if (ids.length <= 4) node.edges = ids;
    else {
      const axis = depth % 2;
      ids.sort(
        (a, b) =>
          (axis
            ? this.map.y(this.edges[a].landTile) -
              this.map.y(this.edges[b].landTile)
            : this.map.x(this.edges[a].landTile) -
              this.map.x(this.edges[b].landTile)) || a - b,
      );
      const half = Math.floor(ids.length / 2);
      node.children = [
        this.build(ids.slice(0, half), depth + 1),
        this.build(ids.slice(half), depth + 1),
      ];
    }
    return id;
  }
  private compare(a: Entry, b: Entry): number {
    return a.key - b.key || a.land - b.land || a.ordinal - b.ordinal;
  }
  private push(s: CoastSearchState, entry: Entry): void {
    let i = s.heap.length;
    s.heap.push(entry);
    while (i) {
      const p = (i - 1) >> 1;
      if (this.compare(s.heap[p], entry) <= 0) break;
      s.heap[i] = s.heap[p];
      i = p;
    }
    s.heap[i] = entry;
  }
  private pop(s: CoastSearchState): Entry {
    const first = s.heap[0],
      last = s.heap.pop()!;
    if (!s.heap.length) return first;
    let i = 0;
    while (i * 2 + 1 < s.heap.length) {
      let c = i * 2 + 1;
      if (c + 1 < s.heap.length && this.compare(s.heap[c + 1], s.heap[c]) < 0)
        c++;
      if (this.compare(last, s.heap[c]) <= 0) break;
      s.heap[i] = s.heap[c];
      i = c;
    }
    s.heap[i] = last;
    return first;
  }
  private distance(tile: number, box: number[]): number {
    const x = this.map.x(tile),
      y = this.map.y(tile);
    return (
      Math.max(box[0] - x, 0, x - box[1]) + Math.max(box[2] - y, 0, y - box[3])
    );
  }
  step(
    s: CoastSearchState,
    destination: number,
    origin?: number,
  ): RankedCoast | undefined {
    const insert = (id: number) => {
      const n = this.nodes[id];
      this.push(s, {
        node: id,
        key:
          origin === undefined
            ? this.distance(destination, n.land)
            : this.distance(origin, n.land) +
              this.distance(destination, n.water),
        land: n.first,
        ordinal: n.ordinal,
      });
    };
    if (!s.started) {
      s.started = true;
      if (this.root !== undefined) insert(this.root);
    }
    if (!s.heap.length) {
      s.done = true;
      return;
    }
    const row = this.pop(s);
    if (row.edge !== undefined)
      return { edge: this.edges[row.edge], key: row.key, ordinal: row.edge };
    const node = this.nodes[row.node!];
    if (node.children) {
      for (const child of node.children) insert(child);
    } else
      for (const index of node.edges!) {
        const edge = this.edges[index];
        this.push(s, {
          edge: index,
          key:
            origin === undefined
              ? this.map.manhattanDist(edge.landTile, destination)
              : this.map.manhattanDist(origin, edge.landTile) +
                this.map.manhattanDist(edge.waterTile, destination),
          land: edge.landTile,
          ordinal: index,
        });
      }
  }
}
