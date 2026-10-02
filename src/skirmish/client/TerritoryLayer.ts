import type { Snapshot } from "../Protocol";
import { CAPTURE_TICKS } from "../Protocol";
import {
  TERRITORY_ALPHA,
  TERRITORY_BORDER_INK,
  TERRITORY_BORDER_LIGHT,
  territoryStyle,
} from "./TerritoryStyle";

const CHUNK = 64;
// Inward normals: north, east, south, west. Each canonical edge contributes
// to its two owners, but never to neutral land or water.
const NORMALS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
interface Accent {
  path: Path2D;
  color: string;
  normal: (typeof NORMALS)[number];
}
interface Chunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  x: number;
  y: number;
  width: number;
  height: number;
  path: Path2D;
  accents: Accent[];
  borderDirty: boolean;
}

// Dynamic ownership is independent of painted ground. Only changed chunks
// upload their small overlay image; border geometry is rebuilt locally.
export class TerritoryLayer {
  private readonly chunks = new Map<number, Chunk>();
  private readonly columns: number;
  private readonly owners: Uint8Array;
  private readonly claims: Uint8Array;
  private readonly progress: Uint8Array;
  private readonly borderColors: string[];
  private initialized = false;
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly colors: number[][],
  ) {
    this.columns = Math.ceil(width / CHUNK);
    this.owners = new Uint8Array(width * height).fill(255);
    this.claims = new Uint8Array(width * height);
    this.progress = new Uint8Array(width * height);
    this.borderColors = colors.map(
      (color) =>
        `rgb(${color.map((c) => Math.round(c + (255 - c) * 0.18)).join(",")})`,
    );
  }
  private key(tile: number) {
    return (
      Math.floor((tile % this.width) / CHUNK) +
      Math.floor(Math.floor(tile / this.width) / CHUNK) * this.columns
    );
  }
  private chunk(key: number): Chunk {
    let chunk = this.chunks.get(key);
    if (chunk) return chunk;
    const x = (key % this.columns) * CHUNK,
      y = Math.floor(key / this.columns) * CHUNK,
      width = Math.min(CHUNK, this.width - x),
      height = Math.min(CHUNK, this.height - y);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    chunk = {
      canvas,
      ctx,
      image: ctx.createImageData(width, height),
      x,
      y,
      width,
      height,
      path: new Path2D(),
      accents: [],
      borderDirty: true,
    };
    this.chunks.set(key, chunk);
    return chunk;
  }
  update(snapshot: Snapshot): void {
    const dirty = new Set<number>();
    const update = (tile: number) => {
      const owner = snapshot.owners[tile],
        claim = snapshot.claims[tile],
        progress = snapshot.progress[tile];
      if (
        this.owners[tile] === owner &&
        this.claims[tile] === claim &&
        this.progress[tile] === progress
      )
        return;
      const key = this.key(tile),
        chunk = this.chunk(key),
        pixel =
          ((tile % this.width) -
            chunk.x +
            (Math.floor(tile / this.width) - chunk.y) * chunk.width) *
          4;
      const capture = claim ? Math.min(1, progress / CAPTURE_TICKS) : 0,
        a = owner ? TERRITORY_ALPHA * (1 - capture) : 0,
        b = TERRITORY_ALPHA * capture,
        total = a + b;
      for (let channel = 0; channel < 3; channel++)
        chunk.image.data[pixel + channel] = total
          ? Math.round(
              ((owner ? this.colors[owner][channel] * a : 0) +
                (claim ? this.colors[claim][channel] * b : 0)) /
                total,
            )
          : 0;
      chunk.image.data[pixel + 3] = Math.round(total * 255);
      dirty.add(key);
      if (this.owners[tile] !== owner) {
        chunk.borderDirty = true;
        if (tile % this.width)
          this.chunk(this.key(tile - 1)).borderDirty = true;
        if (tile >= this.width)
          this.chunk(this.key(tile - this.width)).borderDirty = true;
      }
      this.owners[tile] = owner;
      this.claims[tile] = claim;
      this.progress[tile] = progress;
    };
    // Reconnects/first publications may include changedTiles; initialize all
    // owners once so unseen neighbors never become phantom borders.
    if (this.initialized && snapshot.changedTiles)
      for (const tile of snapshot.changedTiles) update(tile);
    else for (let tile = 0; tile < snapshot.owners.length; tile++) update(tile);
    this.initialized = true;
    for (const key of dirty) {
      const c = this.chunks.get(key)!;
      c.ctx.putImageData(c.image, 0, 0);
    }
  }
  private border(c: Chunk) {
    const path = new Path2D();
    const accents = new Map<number, Accent>();
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height
        ? 0
        : this.owners[y * this.width + x];
    const segment = (
      p: Path2D,
      x: number,
      y: number,
      dx: number,
      dy: number,
    ) => {
      p.moveTo(x, y);
      p.lineTo(x + dx, y + dy);
    };
    const line = (
      x: number,
      y: number,
      horizontal: boolean,
      a: number,
      b: number,
    ) => {
      if (a === b) return;
      const dx = Number(horizontal),
        dy = Number(!horizontal);
      segment(path, x, y, dx, dy);
      // a is the north/west owner; b is the south/east owner. Keeping both
      // accents with this edge preserves the existing left/up invalidation.
      for (const [owner, direction] of [
        [a, horizontal ? 0 : 3],
        [b, horizontal ? 2 : 1],
      ]) {
        if (!owner) continue;
        const key = owner * 4 + direction;
        let accent = accents.get(key);
        if (!accent) {
          accent = {
            path: new Path2D(),
            color: this.borderColors[owner],
            normal: NORMALS[direction],
          };
          accents.set(key, accent);
        }
        segment(accent.path, x, y, dx, dy);
      }
    };
    for (let y = c.y; y < c.y + c.height; y++)
      for (let x = c.x; x < c.x + c.width; x++) {
        const owner = at(x, y);
        line(x + 1, y, false, owner, at(x + 1, y));
        line(x, y + 1, true, owner, at(x, y + 1));
        if (x === 0) line(x, y, false, 0, owner);
        if (y === 0) line(x, y, true, 0, owner);
      }
    c.path = path;
    c.accents = [...accents.values()];
    c.borderDirty = false;
  }
  draw(
    ctx: CanvasRenderingContext2D,
    scale: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
  ): void {
    const style = territoryStyle(scale);
    const visible: Chunk[] = [];
    // Include the screen-space stroke fringe when a chunk is just offscreen.
    const fringe = 4;
    for (const c of this.chunks.values())
      if (
        offsetX + (c.x + c.width) * scale >= -fringe &&
        offsetY + (c.y + c.height) * scale >= -fringe &&
        offsetX + c.x * scale <= width + fringe &&
        offsetY + c.y * scale <= height + fringe
      )
        visible.push(c);
    ctx.save();
    const alpha = ctx.globalAlpha;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = (alpha * style.fillAlpha) / TERRITORY_ALPHA;
    for (const c of visible)
      ctx.drawImage(
        c.canvas,
        offsetX + c.x * scale,
        offsetY + c.y * scale,
        c.width * scale,
        c.height * scale,
      );
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = TERRITORY_BORDER_INK;
    ctx.lineWidth = style.casingWidth / scale;
    for (const c of visible) {
      if (c.borderDirty) this.border(c);
      ctx.stroke(c.path);
    }
    if (style.accentAlpha > 0) {
      ctx.globalAlpha = alpha * style.accentAlpha;
      ctx.lineWidth = style.accentWidth / scale;
      for (const c of visible)
        for (const accent of c.accents) {
          const x = (accent.normal[0] * style.accentInset) / scale,
            y = (accent.normal[1] * style.accentInset) / scale;
          ctx.save();
          ctx.translate(x, y);
          ctx.strokeStyle = accent.color;
          ctx.stroke(accent.path);
          ctx.restore();
        }
    }
    // Final pass across all chunks keeps shared boundaries crisp at seams.
    ctx.globalAlpha = alpha * 0.72;
    ctx.strokeStyle = TERRITORY_BORDER_LIGHT;
    ctx.lineWidth = style.lineWidth / scale;
    for (const c of visible) ctx.stroke(c.path);
    ctx.restore();
  }
}
