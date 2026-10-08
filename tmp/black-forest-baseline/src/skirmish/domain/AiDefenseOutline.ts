import type { GameMap } from "../../core/game/GameMap";

interface Bounds { left: number; top: number; right: number; bottom: number }
export interface DefenseOutlineState {
  bounds: Bounds;
  anchors: number[];
  anchorTry: number;
  side: number;
  queue: number[];
  head: number;
  edge: number;
  parent: Map<number, number>;
  path: number[];
  reverse: number[];
  trace?: number;
  turns?: number[];
  compactAt?: number;
  segment?: number;
  offset?: number;
  result?: { towers: number[]; perimeter: Set<number> };
  phase: "anchors" | "search" | "trace" | "copy" | "turns" | "outline" | "complete" | "failed";
  reason?: string;
}
/** A four-tile lattice keeps real tower spacing. Each side searches an exterior
 * band, so the result encloses the hub and can bend around unusable terrain.
 * One work unit tests at most four terrain cells, or copies one path element. */
export class AiDefenseOutline {
  readonly state: DefenseOutlineState;
  workUsed = 0;
  constructor(private readonly map: GameMap, bounds: Bounds,
    private readonly allowed: (tile: number) => boolean, saved?: DefenseOutlineState) {
    this.state = saved ? structuredClone(saved) : { bounds: { ...bounds,
      right: bounds.left + Math.ceil((bounds.right - bounds.left) / 4) * 4,
      bottom: bounds.top + Math.ceil((bounds.bottom - bounds.top) / 4) * 4 }, anchors: [], anchorTry: 0,
      side: 0, queue: [], head: 0, edge: 0, parent: new Map(), path: [], reverse: [], phase: "anchors" };
  }
  private fail(reason: string): void { this.state.phase = "failed"; this.state.reason = reason; }
  private beginSide(): void {
    const s = this.state; s.queue = [s.anchors[s.side]]; s.head = 0; s.edge = 0;
    s.parent = new Map([[s.queue[0], -1]]); s.phase = "search";
  }
  step(budget: number): number {
    if (!Number.isInteger(budget) || budget < 0) throw new Error("Invalid outline work budget");
    const s = this.state, b = s.bounds; this.workUsed = 0;
    while (this.workUsed < budget && s.phase !== "complete" && s.phase !== "failed") {
      this.workUsed++;
      if (s.phase === "turns") {
        const path = s.path, i = s.compactAt!++, tile = path[i],
          a = path[(i + path.length - 1) % path.length], c = path[(i + 1) % path.length];
        if (this.map.x(tile) - this.map.x(a) !== this.map.x(c) - this.map.x(tile) ||
            this.map.y(tile) - this.map.y(a) !== this.map.y(c) - this.map.y(tile)) s.turns!.push(tile);
        if (s.compactAt === path.length) {
          if (s.turns!.length < 4 || new Set(path).size !== path.length) this.fail("Outline is not a simple closed circuit");
          else { s.phase = "outline"; s.segment = 0; s.offset = 0; s.result = { towers: [], perimeter: new Set() }; }
        }
        continue;
      }
      if (s.phase === "outline") {
        const turns = s.turns!, from = turns[s.segment!], to = turns[(s.segment! + 1) % turns.length],
          length = this.map.manhattanDist(from, to), pieces = Math.ceil(length / 12), at = s.offset!++,
          tile = this.map.ref(this.map.x(from) + Math.sign(this.map.x(to) - this.map.x(from)) * at,
            this.map.y(from) + Math.sign(this.map.y(to) - this.map.y(from)) * at);
        s.result!.perimeter.add(tile);
        const part = Math.round(at * pieces / length);
        if (part < pieces && Math.round(part * length / pieces) === at) s.result!.towers.push(tile);
        if (s.result!.perimeter.size > 384 || s.result!.towers.length > 32) { this.fail("Outline exceeds construction budget"); continue; }
        if (s.offset === length) {
          s.offset = 0; s.segment!++;
          if (s.segment === turns.length) s.phase = "complete";
        }
        continue;
      }
      if (s.phase === "anchors") {
        const corner = s.anchors.length, offset = s.anchorTry++, dx = 4 + (offset % 3) * 4, dy = 4 + Math.floor(offset / 3) * 4;
        const x = corner === 0 || corner === 3 ? b.left - dx : b.right + dx,
          y = corner < 2 ? b.top - dy : b.bottom + dy;
        if (this.map.isValidCoord(x, y) && this.allowed(this.map.ref(x, y))) {
          s.anchors.push(this.map.ref(x, y)); s.anchorTry = 0;
          if (s.anchors.length === 4) this.beginSide();
        } else if (s.anchorTry >= 9) this.fail("No owned terrain-safe corner");
        continue;
      }
      if (s.phase === "trace") {
        const tile = s.trace!; s.reverse.push(tile); s.trace = s.parent.get(tile)!;
        if (s.trace === -1) s.phase = "copy";
        continue;
      }
      if (s.phase === "copy") {
        const tile = s.reverse.pop()!;
        if (s.path[s.path.length - 1] !== tile) s.path.push(tile);
        if (s.path.length > 97) { this.fail("Outline exceeds perimeter budget"); continue; }
        if (!s.reverse.length) {
          if (++s.side === 4) { s.path.pop(); s.phase = "turns"; s.turns = []; s.compactAt = 0; }
          else this.beginSide();
        }
        continue;
      }
      if (s.head >= s.queue.length) { this.fail("No enclosing friendly corridor"); continue; }
      const from = s.queue[s.head], goal = s.anchors[(s.side + 1) % 4];
      if (from === goal) { s.trace = from; s.reverse = []; s.phase = "trace"; continue; }
      const direction = s.edge++, dx = [4, 0, -4, 0][direction], dy = [0, 4, 0, -4][direction];
      if (s.edge === 4) { s.edge = 0; s.head++; }
      const x = this.map.x(from) + dx, y = this.map.y(from) + dy;
      if (!this.map.isValidCoord(x, y) || x < b.left - 12 || x > b.right + 12 || y < b.top - 12 || y > b.bottom + 12) continue;
      // Each side stays outside the protected rectangle. Corner bands overlap
      // only outside its diagonal, allowing a route around cliffs and deposits.
      if ((s.side === 0 && y > b.top - 4) || (s.side === 1 && x < b.right + 4) ||
          (s.side === 2 && y < b.bottom + 4) || (s.side === 3 && x > b.left - 4)) continue;
      const to = this.map.ref(x, y); if (s.parent.has(to)) continue;
      let valid = true;
      for (let n = 1; n <= 4; n++) {
        const tile = this.map.ref(this.map.x(from) + Math.sign(dx) * n, this.map.y(from) + Math.sign(dy) * n);
        if (!this.allowed(tile)) { valid = false; break; }
      }
      if (!valid) continue;
      if (s.parent.size >= 2048) { this.fail("Outline exceeds search budget"); continue; }
      s.parent.set(to, from); s.queue.push(to);
    }
    return this.workUsed;
  }
  /** Materialization and compression were already charged by step(). */
  result(): { towers: number[]; perimeter: Set<number> } | undefined {
    return this.state.phase === "complete" ? this.state.result : undefined;
  }
}
