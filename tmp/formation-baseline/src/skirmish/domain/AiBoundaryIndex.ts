import type { GameMap } from "../../core/game/GameMap";

export interface BoundaryChunk {
  id: string;
  playerId: number;
  x: number;
  y: number;
  tiles: Set<number>;
  /** East, west, south, north foreign land edges. Treaty filtering is live. */
  directions: number[];
  revision: number;
  changedTick: number;
}
/** Shared raw ownership facts, not a defended-section or per-faction influence
 * map. Every ownership event inspects at most five cells / twenty edges.
 * The byte mask is match-wide; consumers resume local chunk geometry work. */
export class AiBoundaryIndex {
  private readonly masks: Uint8Array;
  private readonly owners = new Map<number, Map<string, BoundaryChunk>>();
  private revision = 0;
  private readonly links = new Map<
    string,
    { chunk: BoundaryChunk; previous?: string; next?: string }
  >();
  private readonly first = new Map<number, string>();
  private readonly last = new Map<number, string>();
  private link(chunk: BoundaryChunk): void {
    const previous = this.last.get(chunk.playerId);
    this.links.set(chunk.id, { chunk, previous });
    if (previous) this.links.get(previous)!.next = chunk.id;
    else this.first.set(chunk.playerId, chunk.id);
    this.last.set(chunk.playerId, chunk.id);
  }
  private unlink(chunk: BoundaryChunk): void {
    const entry = this.links.get(chunk.id)!;
    if (entry.previous) this.links.get(entry.previous)!.next = entry.next;
    else if (entry.next) this.first.set(chunk.playerId, entry.next);
    else this.first.delete(chunk.playerId);
    if (entry.next) this.links.get(entry.next)!.previous = entry.previous;
    else if (entry.previous) this.last.set(chunk.playerId, entry.previous);
    else this.last.delete(chunk.playerId);
    this.links.delete(chunk.id);
  }
  /** Constant-time cursor reads; deleting the cursor restarts at a live head. */
  readChunk(
    playerId: number,
    cursor?: string,
  ): { value?: BoundaryChunk; next: string | null } {
    const entry =
      (cursor ? this.links.get(cursor) : undefined) ??
      this.links.get(this.first.get(playerId) ?? "");
    return entry?.chunk.playerId === playerId
      ? { value: entry.chunk, next: entry.next ?? null }
      : { next: null };
  }
  chunk(id: string): BoundaryChunk | undefined {
    return this.links.get(id)?.chunk;
  }
  private rebuildCursor = 0;
  ready = true;
  readonly diagnostics = { cells: 0, edges: 0, chunks: 0, bytes: 0 };
  constructor(
    private readonly map: GameMap,
    private readonly ownership: Uint8Array,
    private readonly passable: (tile: number) => boolean,
  ) {
    this.masks = new Uint8Array(ownership.length);
    this.diagnostics.bytes = this.masks.byteLength;
  }
  private neighbor(tile: number, direction: number): number | undefined {
    const x = this.map.x(tile) + [1, -1, 0, 0][direction],
      y = this.map.y(tile) + [0, 0, 1, -1][direction];
    return this.map.isValidCoord(x, y) ? this.map.ref(x, y) : undefined;
  }
  private mask(tile: number): number {
    if (!this.ownership[tile] || !this.passable(tile)) return 0;
    let mask = 0;
    for (let direction = 0; direction < 4; direction++) {
      this.diagnostics.edges++;
      const next = this.neighbor(tile, direction);
      if (
        next !== undefined &&
        this.passable(next) &&
        this.ownership[next] &&
        this.ownership[next] !== this.ownership[tile]
      )
        mask |= 1 << direction;
    }
    return mask;
  }
  private key(tile: number): string {
    return `${Math.floor(this.map.x(tile) / 16)}:${Math.floor(this.map.y(tile) / 16)}`;
  }
  private subtract(
    tile: number,
    owner: number,
    mask: number,
    tick: number,
  ): void {
    if (!mask) return;
    const groups = this.owners.get(owner),
      key = this.key(tile),
      chunk = groups?.get(key);
    if (!chunk) throw new Error("Boundary event missing its previous owner");
    chunk.tiles.delete(tile);
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) chunk.directions[d]--;
    chunk.revision = ++this.revision;
    chunk.changedTick = tick;
    if (!chunk.tiles.size) {
      groups!.delete(key);
      this.unlink(chunk);
      this.diagnostics.chunks--;
      if (!groups!.size) this.owners.delete(owner);
    }
  }
  private add(tile: number, owner: number, mask: number, tick: number): void {
    if (!mask) return;
    let groups = this.owners.get(owner);
    if (!groups) this.owners.set(owner, (groups = new Map()));
    const key = this.key(tile);
    let chunk = groups.get(key);
    if (!chunk) {
      chunk = {
        id: `${owner}:${key}`,
        playerId: owner,
        x: Math.floor(this.map.x(tile) / 16),
        y: Math.floor(this.map.y(tile) / 16),
        tiles: new Set(),
        directions: [0, 0, 0, 0],
        revision: 0,
        changedTick: tick,
      };
      groups.set(key, chunk);
      this.link(chunk);
      this.diagnostics.chunks++;
    }
    chunk.tiles.add(tile);
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) chunk.directions[d]++;
    chunk.revision = ++this.revision;
    chunk.changedTick = tick;
  }
  private update(tile: number, previousOwner: number, tick: number): void {
    this.diagnostics.cells++;
    const previous = this.masks[tile],
      next = this.mask(tile),
      owner = this.ownership[tile];
    if (previous === next && previousOwner === owner) return;
    this.subtract(tile, previousOwner, previous, tick);
    this.masks[tile] = next;
    this.add(tile, owner, next, tick);
  }
  /** Called AFTER authoritative ownership changes, with that cell's old owner.
   * Fresh matches start empty. Recovery restores facts from a checkpoint. */
  changed(tile: number, previousOwner: number, tick: number): void {
    this.diagnostics.cells = this.diagnostics.edges = 0;
    this.update(tile, previousOwner, tick);
    for (let d = 0; d < 4; d++) {
      const next = this.neighbor(tile, d);
      if (next !== undefined) this.update(next, this.ownership[next], tick);
    }
  }
  chunks(playerId: number): Iterable<BoundaryChunk> {
    return this.owners.get(playerId)?.values() ?? [];
  }
  /** Treaty changes do not require copying ownership edges or rescanning the
   * map. Candidate geometry reads exact current hostility per local edge. */
  *hostileEdges(
    tile: number,
    hostile: (a: number, b: number) => boolean,
  ): Iterable<{ tile: number; neighbor: number; direction: number }> {
    const mask = this.masks[tile],
      owner = this.ownership[tile];
    for (let d = 0; d < 4; d++)
      if (mask & (1 << d)) {
        const next = this.neighbor(tile, d)!;
        if (hostile(owner, this.ownership[next]))
          yield { tile, neighbor: next, direction: d };
      }
  }
  checkpoint() {
    return structuredClone({
      owners: [...this.owners],
      revision: this.revision,
      rebuildCursor: this.rebuildCursor,
      ready: this.ready,
    });
  }
  resetForRebuild(): void {
    this.owners.clear();
    this.links.clear();
    this.first.clear();
    this.last.clear();
    this.masks.fill(0);
    this.diagnostics.chunks = 0;
    this.rebuildCursor = 0;
    this.ready = false;
  }
  step(tick: number, budget: number): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid boundary fact budget");
    if (this.ready) return 0;
    let used = 0;
    while (used < budget && this.rebuildCursor < this.ownership.length) {
      const tile = this.rebuildCursor++;
      this.update(tile, this.ownership[tile], tick);
      used++;
    }
    if (this.rebuildCursor === this.ownership.length) this.ready = true;
    return used;
  }
  restore(saved: ReturnType<AiBoundaryIndex["checkpoint"]>): void {
    this.owners.clear();
    this.links.clear();
    this.first.clear();
    this.last.clear();
    this.masks.fill(0);
    this.diagnostics.chunks = 0;
    this.revision = saved.revision;
    this.rebuildCursor = saved.rebuildCursor;
    this.ready = saved.ready;
    for (const [owner, chunks] of structuredClone(saved.owners)) {
      this.owners.set(owner, chunks);
      this.diagnostics.chunks += chunks.size;
      for (const chunk of chunks.values()) {
        this.link(chunk);
        const directions = [0, 0, 0, 0];
        for (const tile of chunk.tiles) {
          const mask = this.mask(tile);
          if (this.ownership[tile] !== owner || !mask) {
            this.resetForRebuild();
            return;
          }
          this.masks[tile] = mask;
          for (let d = 0; d < 4; d++) if (mask & (1 << d)) directions[d]++;
        }
        if (directions.some((count, d) => count !== chunk.directions[d])) {
          this.resetForRebuild();
          return;
        }
      }
    }
    this.diagnostics.cells = this.diagnostics.edges = 0;
  }
}
