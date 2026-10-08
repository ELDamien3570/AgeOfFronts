import type { GameMap } from "../../core/game/GameMap";
import { buildingGroundBounds } from "../BuildingFootprint";
import type { Snapshot } from "../Protocol";
import { RoadArtwork } from "./RoadArtwork";

const CHUNK = 32;
const PIXEL_BUDGET = 12_000_000;
interface RoadTile {
  tile: number;
  age: number;
  mask: number;
}
interface RoadChunk {
  key: number;
  x: number;
  y: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

// Disposable view cache. Road revisions and occupied tiles invalidate only
// affected chunks; camera motion never changes trade routes or passability.
export class RoadLayer {
  private readonly artwork = new RoadArtwork(() => this.clear());
  private readonly roads = new Map<number, RoadTile>();
  private readonly chunks = new Map<number, RoadTile[]>();
  private readonly cache = new Map<string, RoadChunk>();
  private occupied = new Set<number>();
  private revision = -1;
  private pixels = 0;
  private readonly columns: number;
  constructor(private readonly map: GameMap) {
    this.columns = Math.ceil(map.width() / CHUNK);
  }

  private key(tile: number): number {
    return (
      Math.floor(this.map.x(tile) / CHUNK) +
      Math.floor(this.map.y(tile) / CHUNK) * this.columns
    );
  }
  private invalidateTile(tile: number, dirty: Set<number>): void {
    const x = this.map.x(tile),
      y = this.map.y(tile);
    // Adjacent gutters also contain this tile, even when their interiors do not.
    for (const xx of [x - 1, x, x + 1])
      for (const yy of [y - 1, y, y + 1])
        if (this.map.isValidCoord(xx, yy))
          dirty.add(this.key(this.map.ref(xx, yy)));
  }
  private clear(): void {
    this.cache.clear();
    this.pixels = 0;
  }
  update(snapshot: Snapshot): void {
    const dirty = new Set<number>();
    const revision = snapshot.expansion?.roadRevision ?? 0;
    if (revision !== this.revision) {
      const next = new Map<number, RoadTile>();
      const packed = snapshot.expansion?.roads;
      for (let i = 0; packed && i < packed.length; i += 3) {
        const road = {
          tile: packed[i],
          age: packed[i + 1],
          mask: packed[i + 2],
        };
        next.set(road.tile, road);
        const previous = this.roads.get(road.tile);
        if (
          !previous ||
          previous.age !== road.age ||
          previous.mask !== road.mask
        )
          this.invalidateTile(road.tile, dirty);
      }
      for (const tile of this.roads.keys())
        if (!next.has(tile)) this.invalidateTile(tile, dirty);
      this.roads.clear();
      this.chunks.clear();
      for (const [tile, road] of next) {
        this.roads.set(tile, road);
        const key = this.key(tile);
        let chunk = this.chunks.get(key);
        if (!chunk) this.chunks.set(key, (chunk = []));
        chunk.push(road);
      }
      this.revision = revision;
    }
    const occupied = new Set<number>();
    for (const building of snapshot.buildings) {
      const bounds = buildingGroundBounds(
        this.map,
        building.tile,
        building.type,
      );
      for (
        let y = bounds.top;
        y < Math.min(this.map.height(), bounds.bottom);
        y++
      )
        for (
          let x = bounds.left;
          x < Math.min(this.map.width(), bounds.right);
          x++
        )
          occupied.add(this.map.ref(x, y));
    }
    for (const tile of occupied)
      if (!this.occupied.has(tile) && this.roads.has(tile))
        this.invalidateTile(tile, dirty);
    for (const tile of this.occupied)
      if (!occupied.has(tile) && this.roads.has(tile))
        this.invalidateTile(tile, dirty);
    this.occupied = occupied;
    for (const [key, chunk] of this.cache)
      if (dirty.has(chunk.key)) {
        this.pixels -= chunk.canvas.width * chunk.canvas.height;
        this.cache.delete(key);
      }
  }

  private chunk(key: number, detail: number): RoadChunk | undefined {
    const roads = this.chunks.get(key);
    if (!roads?.length) return;
    const cacheKey = `${key}:${detail}`;
    const old = this.cache.get(cacheKey);
    if (old) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, old);
      return old;
    }
    const x = (key % this.columns) * CHUNK;
    const y = Math.floor(key / this.columns) * CHUNK;
    const width = Math.min(CHUNK, this.map.width() - x);
    const height = Math.min(CHUNK, this.map.height() - y);
    const canvas = document.createElement("canvas");
    canvas.width = (width + 2) * detail;
    canvas.height = (height + 2) * detail;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    // One-cell gutters preserve filtering at chunk boundaries. Draw the same
    // neighboring road pixels in both gutters, then crop each chunk's interior.
    for (
      let cy = Math.max(0, Math.floor((y - 1) / CHUNK));
      cy <= Math.floor((y + height) / CHUNK);
      cy++
    )
      for (
        let cx = Math.max(0, Math.floor((x - 1) / CHUNK));
        cx <= Math.floor((x + width) / CHUNK);
        cx++
      )
        for (const road of this.chunks.get(cx + cy * this.columns) ?? []) {
          const xx = this.map.x(road.tile),
            yy = this.map.y(road.tile);
          if (
            xx < x - 1 ||
            xx > x + width ||
            yy < y - 1 ||
            yy > y + height ||
            this.occupied.has(road.tile)
          )
            continue;
          const image = this.artwork.frame(road.age);
          if (!image) continue;
          ctx.drawImage(
            image,
            (road.mask % 4) * 260 + 2,
            Math.floor(road.mask / 4) * 260 + 2,
            256,
            256,
            (xx - x + 1) * detail,
            (yy - y + 1) * detail,
            detail,
            detail,
          );
        }
    const chunk = { key, x, y, width, height, canvas };
    // Loading atlases invalidate on completion; failed assets stay transparent
    // without allocating a fresh canvas on every animation frame.
    {
      this.cache.set(cacheKey, chunk);
      this.pixels += canvas.width * canvas.height;
      while (this.pixels > PIXEL_BUDGET && this.cache.size > 1) {
        const oldest = this.cache.keys().next().value!;
        const entry = this.cache.get(oldest)!;
        this.pixels -= entry.canvas.width * entry.canvas.height;
        this.cache.delete(oldest);
      }
    }
    return chunk;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    scale: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
  ): void {
    if (scale < 2) return;
    const detail = Math.min(32, 2 ** Math.ceil(Math.log2(scale)));
    const left = Math.max(0, Math.floor(-offsetX / scale / CHUNK));
    const right = Math.min(
      this.columns - 1,
      Math.floor((width - offsetX) / scale / CHUNK),
    );
    const top = Math.max(0, Math.floor(-offsetY / scale / CHUNK));
    const bottom = Math.min(
      Math.ceil(this.map.height() / CHUNK) - 1,
      Math.floor((height - offsetY) / scale / CHUNK),
    );
    ctx.imageSmoothingEnabled = true;
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const chunk = this.chunk(x + y * this.columns, detail);
        if (chunk)
          ctx.drawImage(
            chunk.canvas,
            detail,
            detail,
            chunk.width * detail,
            chunk.height * detail,
            offsetX + chunk.x * scale,
            offsetY + chunk.y * scale,
            chunk.width * scale,
            chunk.height * scale,
          );
      }
  }
}
