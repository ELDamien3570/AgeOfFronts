import type { Player, Snapshot } from "../Protocol";

export interface TerritoryLabel {
  playerId: number;
  name: string;
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
}
type Layout = Omit<TerritoryLabel, "name">;
const CHUNK = 1024;
const WORK_CHUNKS = 24;
const REFRESH_MS = 1000;

export function ownsCamp(snapshot: Snapshot, player: Player): boolean {
  return !player.eliminated && snapshot.owners[player.base] === player.id;
}

// Presentation-only ownership index. Layout work is incremental and bounded;
// drawing never changes the simulation's ownership data.
export class TerritoryLabelViewModel {
  private readonly owners: Uint8Array;
  private readonly heads = new Int32Array(256).fill(-1);
  private readonly counts = new Uint32Array(256);
  private readonly next: Int32Array;
  private readonly previous: Int32Array;
  private readonly members: Uint32Array;
  private readonly memberLinks: Int32Array;
  private readonly dirty = new Set<number>();
  private readonly layouts = new Map<number, Layout>();
  private readonly refreshed = new Map<number, number>();
  private readonly membership: Uint32Array;
  private readonly component: Uint32Array;
  private readonly clearance: Uint16Array;
  private readonly queue: Uint32Array;
  private players: readonly Player[] = [];
  private initialized = false;
  private generation = 0;
  private job?: { owner: number; work: Generator<void, Layout | undefined> };

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const size = width * height;
    this.owners = new Uint8Array(size);
    this.next = new Int32Array(size).fill(-1);
    this.previous = new Int32Array(size).fill(-1);
    this.members = new Uint32Array(size);
    this.memberLinks = new Int32Array(size);
    this.membership = new Uint32Array(size);
    this.component = new Uint32Array(size);
    this.clearance = new Uint16Array(size);
    this.queue = new Uint32Array(size);
  }

  get labels(): TerritoryLabel[] {
    return this.players.flatMap((player) => {
      const layout = !player.eliminated && this.layouts.get(player.id);
      return layout &&
        this.owners[
          Math.floor(layout.y) * this.width + Math.floor(layout.x)
        ] === player.id
        ? [{ ...layout, name: player.name }]
        : [];
    });
  }

  update(snapshot: Snapshot): void {
    this.players = snapshot.players;
    const change = (tile: number) => {
      const old = this.owners[tile],
        next = snapshot.owners[tile];
      if (old === next) return;
      if (old) {
        const previous = this.previous[tile],
          next = this.next[tile];
        if (previous < 0) this.heads[old] = next;
        else this.next[previous] = next;
        if (next >= 0) this.previous[next] = previous;
        this.counts[old]--;
        this.dirty.add(old);
      }
      if (next) {
        const head = this.heads[next];
        this.previous[tile] = -1;
        this.next[tile] = head;
        if (head >= 0) this.previous[head] = tile;
        this.heads[next] = tile;
        this.counts[next]++;
        this.dirty.add(next);
      }
      this.owners[tile] = next;
    };
    if (this.initialized && snapshot.changedTiles)
      for (const tile of snapshot.changedTiles) change(tile);
    else for (let tile = 0; tile < this.owners.length; tile++) change(tile);
    this.initialized = true;
    for (const player of this.players)
      if (player.eliminated || !this.counts[player.id]) {
        this.layouts.delete(player.id);
        this.dirty.delete(player.id);
        if (this.job?.owner === player.id) this.job = undefined;
      }
  }

  // Continue while paused too. Each frame has a small time budget, with a hard
  // work ceiling so a large conquest cannot trigger an unbounded layout pass.
  advance(now = performance.now()): void {
    const deadline = performance.now() + 2;
    for (let chunk = 0; chunk < WORK_CHUNKS; chunk++) {
      if (!this.job) {
        const owner = [...this.dirty].find(
          (id) =>
            this.players.some((p) => p.id === id && !p.eliminated) &&
            (!this.refreshed.has(id) ||
              now - this.refreshed.get(id)! >= REFRESH_MS),
        );
        if (owner === undefined) break;
        this.dirty.delete(owner);
        const name = this.players.find((p) => p.id === owner)!.name;
        this.job = { owner, work: this.layout(owner, name) };
      }
      const result = this.job.work.next();
      if (result.done) {
        if (result.value) this.layouts.set(this.job.owner, result.value);
        else this.layouts.delete(this.job.owner);
        this.refreshed.set(this.job.owner, now);
        this.job = undefined;
      }
      if (performance.now() >= deadline) break;
    }
  }

  private *layout(
    owner: number,
    name: string,
  ): Generator<void, Layout | undefined> {
    if (!this.counts[owner]) return;
    // Freeze the links with a native typed-array copy, then walk them in small
    // chunks. Ownership can change between frames without corrupting this job.
    // All scratch storage is reused after a mass territorial transfer.
    this.memberLinks.set(this.next);
    if (++this.generation === 0xffffffff) {
      this.membership.fill(0);
      this.generation = 1;
    }
    const stamp = this.generation,
      size = this.owners.length;
    let work = 0,
      length = 0;
    for (
      let tile = this.heads[owner];
      tile >= 0;
      tile = this.memberLinks[tile]
    ) {
      this.members[length++] = tile;
      this.membership[tile] = stamp;
      this.component[tile] = 0;
      this.clearance[tile] = 0;
      if (++work % CHUNK === 0) yield;
    }
    const tiles = this.members.subarray(0, length);
    let id = 0,
      bestId = 0,
      bestCount = 0,
      best = {
        sx: 0,
        sy: 0,
        sxx: 0,
        syy: 0,
        sxy: 0,
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
      };
    for (const seed of tiles) {
      if (++work % CHUNK === 0) yield;
      if (this.component[seed]) continue;
      id++;
      let head = 0,
        tail = 1,
        sx = 0,
        sy = 0,
        sxx = 0,
        syy = 0,
        sxy = 0,
        minX = this.width,
        maxX = 0,
        minY = this.height,
        maxY = 0;
      this.queue[0] = seed;
      this.component[seed] = id;
      const add = (tile: number) => {
        if (this.membership[tile] === stamp && !this.component[tile]) {
          this.component[tile] = id;
          this.queue[tail++] = tile;
        }
      };
      while (head < tail) {
        const tile = this.queue[head++],
          x = tile % this.width,
          y = Math.floor(tile / this.width);
        sx += x + 0.5;
        sy += y + 0.5;
        sxx += (x + 0.5) ** 2;
        syy += (y + 0.5) ** 2;
        sxy += (x + 0.5) * (y + 0.5);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x + 1);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y + 1);
        if (x) add(tile - 1);
        if (x + 1 < this.width) add(tile + 1);
        if (y) add(tile - this.width);
        if (y + 1 < this.height) add(tile + this.width);
        if (++work % CHUNK === 0) yield;
      }
      if (tail > bestCount) {
        bestId = id;
        bestCount = tail;
        best = { sx, sy, sxx, syy, sxy, minX, maxX, minY, maxY };
      }
    }
    // Distance to the component's edge protects labels from oceans, enclaves
    // and concave bays. Coarse fitting cells require full interior clearance.
    let head = 0,
      tail = 0,
      deepest = tiles[0],
      depth = 0;
    const inside = (tile: number) =>
      tile >= 0 &&
      tile < size &&
      this.membership[tile] === stamp &&
      this.component[tile] === bestId;
    for (const tile of tiles) {
      if (++work % CHUNK === 0) yield;
      if (!inside(tile)) continue;
      const x = tile % this.width,
        y = Math.floor(tile / this.width);
      if (
        !x ||
        x + 1 === this.width ||
        !y ||
        y + 1 === this.height ||
        !inside(tile - 1) ||
        !inside(tile + 1) ||
        !inside(tile - this.width) ||
        !inside(tile + this.width)
      ) {
        this.clearance[tile] = 1;
        this.queue[tail++] = tile;
      }
    }
    const add = (tile: number, d: number) => {
      if (inside(tile) && !this.clearance[tile]) {
        this.clearance[tile] = d;
        this.queue[tail++] = tile;
      }
    };
    while (head < tail) {
      const tile = this.queue[head++],
        d = this.clearance[tile],
        x = tile % this.width,
        y = Math.floor(tile / this.width);
      if (d > depth) {
        depth = d;
        deepest = tile;
      }
      if (x) add(tile - 1, d + 1);
      if (x + 1 < this.width) add(tile + 1, d + 1);
      if (y) add(tile - this.width, d + 1);
      if (y + 1 < this.height) add(tile + this.width, d + 1);
      if (++work % CHUNK === 0) yield;
    }
    const cx = best.sx / bestCount,
      cy = best.sy / bestCount,
      xx = best.sxx / bestCount - cx * cx,
      yy = best.syy / bestCount - cy * cy,
      xy = best.sxy / bestCount - cx * cy,
      anisotropy = Math.hypot(xx - yy, 2 * xy) / Math.max(1, xx + yy),
      principal =
        anisotropy > 0.12
          ? Math.max(
              -Math.PI / 2.5,
              Math.min(Math.PI / 2.5, 0.5 * Math.atan2(2 * xy, xx - yy)),
            )
          : 0;
    const glyphCount = Math.max(4, Array.from(name).length);
    let chosen: Layout = {
      playerId: owner,
      x: (deepest % this.width) + 0.5,
      y: Math.floor(deepest / this.width) + 0.5,
      angle: 0,
      width: Math.max(1, depth - 1),
      height: Math.max(1, (depth - 1) * 0.65),
    };
    let score = 0;
    for (const angle of principal ? [principal, 0] : [0]) {
      const c = Math.cos(angle),
        s = Math.sin(angle),
        corners = [
          [best.minX, best.minY],
          [best.maxX, best.minY],
          [best.minX, best.maxY],
          [best.maxX, best.maxY],
        ],
        us = corners.map(([x, y]) => (x - cx) * c + (y - cy) * s),
        vs = corners.map(([x, y]) => -(x - cx) * s + (y - cy) * c),
        u0 = Math.min(...us),
        v0 = Math.min(...vs),
        du = Math.max(...us) - u0,
        dv = Math.max(...vs) - v0,
        step = Math.max(1, Math.ceil(Math.max(du, dv) / 96)),
        cols = Math.ceil(du / step),
        rows = Math.ceil(dv / step),
        heights = new Uint16Array(cols),
        safe = Math.ceil(step * (Math.abs(c) + Math.abs(s))) + 1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const u = u0 + (col + 0.5) * step,
            v = v0 + (row + 0.5) * step,
            x = Math.floor(cx + u * c - v * s),
            y = Math.floor(cy + u * s + v * c),
            tile = y * this.width + x;
          heights[col] =
            x >= 0 &&
            y >= 0 &&
            x < this.width &&
            y < this.height &&
            inside(tile) &&
            this.clearance[tile] >= safe
              ? heights[col] + 1
              : 0;
        }
        const stack: number[] = [];
        for (let col = 0; col <= cols; col++) {
          const h = col === cols ? 0 : heights[col];
          while (stack.length && h < heights[stack[stack.length - 1]]) {
            const height = heights[stack.pop()!],
              left = stack.length ? stack[stack.length - 1] + 1 : 0,
              width = col - left,
              font = Math.min(
                height * step * 0.45,
                (width * step) / (glyphCount * 0.7),
              ),
              value = font * width * step;
            if (value > score) {
              const u = u0 + (left + width / 2) * step,
                v = v0 + (row + 1 - height / 2) * step;
              score = value;
              chosen = {
                playerId: owner,
                x: cx + u * c - v * s,
                y: cy + u * s + v * c,
                angle,
                width: width * step,
                height: height * step,
              };
            }
          }
          stack.push(col);
        }
        // Rotated raster fitting is bounded to 96x96 samples per angle.
        if (++work % 32 === 0) yield;
      }
    }
    return chosen;
  }
}
