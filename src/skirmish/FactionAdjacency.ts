import type { GameMap } from "../core/game/GameMap";
import { MAX_PLAYER_ID } from "./FactionRules";

/** Symmetric counts of actual cardinal land-border edges. One ownership
 * mutation examines four neighbours; the fixed roster bounds storage. */
export class FactionAdjacency {
  private readonly side = MAX_PLAYER_ID + 1;
  private readonly edges = new Uint32Array((MAX_PLAYER_ID + 1) ** 2);
  constructor(private readonly map: GameMap, private readonly owners: Uint8Array,
    private readonly passable: (tile: number) => boolean = tile => map.isLand(tile)) {}
  adjacent(a: number, b: number): boolean {
    return a > 0 && b > 0 && a !== b && a <= MAX_PLAYER_ID && b <= MAX_PLAYER_ID && this.edges[a * this.side + b] > 0;
  }
  private adjust(a: number, b: number, amount: number): boolean {
    if (!a || !b || a === b || a > MAX_PLAYER_ID || b > MAX_PLAYER_ID) return true;
    const index = a * this.side + b;
    if (amount < 0 && !this.edges[index]) return false;
    this.edges[index] += amount; this.edges[b * this.side + a] += amount; return true;
  }
  changed(tile: number, previousOwner: number): void {
    if (!this.passable(tile)) return;
    const x = this.map.x(tile), y = this.map.y(tile), owner = this.owners[tile];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!this.map.isValidCoord(x + dx, y + dy)) continue;
      const next = this.map.ref(x + dx, y + dy); if (!this.passable(next)) continue;
      if (!this.adjust(previousOwner, this.owners[next], -1)) {
        // Recovery/import callers may replace ownership arrays wholesale.
        this.rebuild(); return;
      }
      this.adjust(owner, this.owners[next], 1);
    }
  }
  rebuild(): void {
    this.edges.fill(0);
    for (let tile = 0; tile < this.owners.length; tile++) {
      if (!this.passable(tile)) continue;
      const x = this.map.x(tile), y = this.map.y(tile);
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (!this.map.isValidCoord(x + dx, y + dy)) continue;
        const next = this.map.ref(x + dx, y + dy);
        if (this.passable(next)) this.adjust(this.owners[tile], this.owners[next], 1);
      }
    }
  }
  get retainedBytes(): number { return this.edges.byteLength; }
}
