// Presentation-only topology: each shared tile edge is stored once. Ownership
// changes update four local edges; rendering reuses a cached path between changes.
export interface BorderEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const TERRITORY_ALPHA = 0.35;
export const TERRITORY_BORDER_COLOR = "#152321";

export class TerritoryBorders {
  private readonly edges = new Map<number, BorderEdge>();

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  get segments(): Iterable<BorderEdge> {
    return this.edges.values();
  }

  updateTile(owners: Uint8Array, tile: number): boolean {
    const x = tile % this.width,
      y = Math.floor(tile / this.width);
    const owner = owners[tile];
    const at = (tx: number, ty: number) =>
      tx < 0 || ty < 0 || tx >= this.width || ty >= this.height
        ? 0
        : owners[ty * this.width + tx];
    let changed = this.edge(x, y, true, owner, at(x, y - 1));
    changed = this.edge(x, y + 1, true, owner, at(x, y + 1)) || changed;
    changed = this.edge(x, y, false, owner, at(x - 1, y)) || changed;
    changed = this.edge(x + 1, y, false, owner, at(x + 1, y)) || changed;
    return changed;
  }

  private edge(
    x: number,
    y: number,
    horizontal: boolean,
    a: number,
    b: number,
  ): boolean {
    const key = (y * (this.width + 1) + x) * 2 + Number(horizontal);
    if (a === b) return this.edges.delete(key);
    if (this.edges.has(key)) return false;
    this.edges.set(key, {
      x1: x,
      y1: y,
      x2: x + Number(horizontal),
      y2: y + Number(!horizontal),
    });
    return true;
  }
}
