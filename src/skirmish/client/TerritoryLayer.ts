import type { Snapshot } from "../Protocol";
import { CAPTURE_TICKS } from "../Protocol";
import { TERRITORY_ALPHA, TERRITORY_BORDER_COLOR } from "./TerritoryBorders";

const CHUNK = 64;
interface Chunk {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  x: number;
  y: number;
  width: number;
  height: number;
  path: Path2D;
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
  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly colors: number[][],
  ) {
    this.columns = Math.ceil(width / CHUNK);
    this.owners = new Uint8Array(width * height).fill(255);
    this.claims = new Uint8Array(width * height);
    this.progress = new Uint8Array(width * height);
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
    if (snapshot.changedTiles)
      for (const tile of snapshot.changedTiles) update(tile);
    else for (let tile = 0; tile < snapshot.owners.length; tile++) update(tile);
    for (const key of dirty) {
      const c = this.chunks.get(key)!;
      c.ctx.putImageData(c.image, 0, 0);
    }
  }
  private border(c: Chunk) {
    const path = new Path2D();
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.width || y >= this.height
        ? 0
        : this.owners[y * this.width + x];
    const line = (x: number, y: number, dx: number, dy: number) => {
      path.moveTo(x, y);
      path.lineTo(x + dx, y + dy);
    };
    for (let y = c.y; y < c.y + c.height; y++)
      for (let x = c.x; x < c.x + c.width; x++) {
        const owner = at(x, y);
        if (owner !== at(x + 1, y)) line(x + 1, y, 0, 1);
        if (owner !== at(x, y + 1)) line(x, y + 1, 1, 0);
        if (x === 0 && owner) line(x, y, 0, 1);
        if (y === 0 && owner) line(x, y, 1, 0);
      }
    c.path = path;
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
    const visible: Chunk[] = [];
    for (const c of this.chunks.values())
      if (
        offsetX + (c.x + c.width) * scale >= 0 &&
        offsetY + (c.y + c.height) * scale >= 0 &&
        offsetX + c.x * scale <= width &&
        offsetY + c.y * scale <= height
      )
        visible.push(c);
    ctx.imageSmoothingEnabled = false;
    for (const c of visible)
      ctx.drawImage(
        c.canvas,
        offsetX + c.x * scale,
        offsetY + c.y * scale,
        c.width * scale,
        c.height * scale,
      );
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    ctx.strokeStyle = TERRITORY_BORDER_COLOR;
    ctx.lineWidth = 1.5 / scale;
    ctx.lineCap = "square";
    for (const c of visible) {
      if (c.borderDirty) this.border(c);
      ctx.stroke(c.path);
    }
    ctx.restore();
  }
}
