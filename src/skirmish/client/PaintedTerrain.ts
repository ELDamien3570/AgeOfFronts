import { TerrainType } from "../../core/game/Game";
import type { GameMap } from "../../core/game/GameMap";

const CHUNK = 64;
const PIXEL_BUDGET = 12_000_000;
const ATLAS = new URL(
  "../../../Art/Terrain/painted-accents.png",
  import.meta.url,
).href;
const PALETTES = {
  plains: [127, 148, 88],
  hills: [146, 140, 98],
  mountains: [147, 148, 137],
  ocean: [48, 91, 116],
  shallow: [77, 128, 143],
  coast: [190, 177, 127],
};

function hash(x: number, y: number): number {
  let n = Math.imul(x ^ 0x3d45, 0x45d9f3b) ^ Math.imul(y ^ 0x1567, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n >>> 0) / 0xffffffff;
}
function noise(x: number, y: number, size: number): number {
  const xx = Math.floor(x / size),
    yy = Math.floor(y / size),
    u = x / size - xx,
    v = y / size - yy;
  const sx = u * u * (3 - 2 * u),
    sy = v * v * (3 - 2 * v);
  return (
    (hash(xx, yy) * (1 - sx) + hash(xx + 1, yy) * sx) * (1 - sy) +
    (hash(xx, yy + 1) * (1 - sx) + hash(xx + 1, yy + 1) * sx) * sy
  );
}
export function paintedCell(
  map: GameMap,
  tile: number,
): { color: string; decoration: number | null } {
  const x = map.x(tile),
    y = map.y(tile),
    type = map.terrainType(tile);
  const neighbors = map.neighbors(tile);
  const coast = map.isLand(tile) && neighbors.some((t) => map.isWater(t));
  const shallow = map.isWater(tile) && neighbors.some((t) => map.isLand(t));
  let base = coast
    ? PALETTES.coast
    : shallow
      ? PALETTES.shallow
      : type === TerrainType.Plains
        ? PALETTES.plains
        : type === TerrainType.Highland
          ? PALETTES.hills
          : type === TerrainType.Mountain
            ? PALETTES.mountains
            : PALETTES.ocean;
  const forest =
    noise(x, y, 24) > 0.55 && type === TerrainType.Plains && !coast;
  if (forest) base = [104, 130, 79];
  const shade = (noise(x, y, 9) - 0.5) * 16 + (noise(x, y, 3) - 0.5) * 5;
  return {
    color: `rgb(${base.map((value) => Math.round(value + shade)).join(",")})`,
    decoration:
      coast || map.isWater(tile)
        ? null
        : type === TerrainType.Mountain || type === TerrainType.Highland
          ? 1
          : forest
            ? noise(x, y, 60) > 0.58
              ? 3
              : 0
            : 2,
  };
}

// Disposable presentation chunks. Neither visual forests nor camera LOD can
// alter the map's domain terrain, passability, or travel speed.
export class PaintedTerrain {
  private readonly atlas = new Image();
  private readonly cache = new Map<
    string,
    {
      canvas: HTMLCanvasElement;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  >();
  private pixels = 0;
  constructor(private readonly map: GameMap) {
    this.atlas.onload = () => {
      this.cache.clear();
      this.pixels = 0;
    };
    this.atlas.src = ATLAS;
  }
  private chunk(cx: number, cy: number, detail: number) {
    const key = `${cx}:${cy}:${detail}`;
    let cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    // A shared one-cell gutter prevents fractional-scale canvas seams. Both
    // neighbors paint the same world coordinates in their overlapping gutter.
    const x = Math.max(0, cx * CHUNK - 1),
      y = Math.max(0, cy * CHUNK - 1),
      width = Math.min((cx + 1) * CHUNK + 1, this.map.width()) - x,
      height = Math.min((cy + 1) * CHUNK + 1, this.map.height()) - y;
    const canvas = document.createElement("canvas");
    canvas.width = width * detail;
    canvas.height = height * detail;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(detail, detail);
    for (let yy = y; yy < y + height; yy++)
      for (let xx = x; xx < x + width; xx++) {
        const cell = paintedCell(this.map, this.map.ref(xx, yy));
        ctx.fillStyle = cell.color;
        ctx.fillRect(xx - x, yy - y, 1, 1);
      }
    if (detail > 1 && this.atlas.complete && this.atlas.naturalWidth) {
      // Include decoration anchors beyond a chunk edge so adjacent chunks share
      // the same artwork, with no seams or dependence on camera position.
      ctx.imageSmoothingEnabled = true;
      const cellWidth = this.atlas.naturalWidth / 2,
        cellHeight = this.atlas.naturalHeight / 2;
      for (let yy = Math.floor((y - 8) / 8) * 8; yy < y + height + 8; yy += 8)
        for (
          let xx = Math.floor((x - 8) / 8) * 8;
          xx < x + width + 8;
          xx += 8
        ) {
          const px = xx + 2 + hash(xx, yy) * 4,
            py = yy + 2 + hash(yy, xx) * 4;
          if (!this.map.isValidCoord(Math.floor(px), Math.floor(py))) continue;
          const tile = this.map.ref(Math.floor(px), Math.floor(py)),
            cell = paintedCell(this.map, tile);
          if (
            cell.decoration === null ||
            (cell.decoration === 2 && hash(xx + 19, yy) < 0.8)
          )
            continue;
          let inland = true;
          for (const dx of [-3, 0, 3])
            for (const dy of [-3, 0, 3])
              if (
                !this.map.isValidCoord(
                  Math.floor(px) + dx,
                  Math.floor(py) + dy,
                ) ||
                !this.map.isLand(
                  this.map.ref(Math.floor(px) + dx, Math.floor(py) + dy),
                )
              )
                inland = false;
          if (!inland) continue;
          const size = cell.decoration === 2 ? 1.05 : 2.1;
          ctx.globalAlpha = cell.decoration === 2 ? 0.45 : 0.76;
          ctx.drawImage(
            this.atlas,
            (cell.decoration % 2) * cellWidth,
            Math.floor(cell.decoration / 2) * cellHeight,
            cellWidth,
            cellHeight,
            px - x - size / 2,
            py - y - size / 2,
            size,
            size,
          );
        }
      ctx.globalAlpha = 1;
      // Restrained strokes give water a painted surface at tactical zoom.
      ctx.strokeStyle = "#b3dbe520";
      ctx.lineWidth = 0.12;
      for (let yy = y + 2; yy < y + height; yy += 5)
        for (let xx = x + 2; xx < x + width; xx += 7)
          if (this.map.isWater(this.map.ref(xx, yy)) && hash(xx, yy) > 0.5) {
            ctx.beginPath();
            ctx.moveTo(xx - x, yy - y);
            ctx.quadraticCurveTo(
              xx - x + 0.6,
              yy - y - 0.16,
              xx - x + 1.4,
              yy - y,
            );
            ctx.stroke();
          }
    }
    cached = { canvas, x, y, width, height };
    this.cache.set(key, cached);
    this.pixels += canvas.width * canvas.height;
    while (this.pixels > PIXEL_BUDGET && this.cache.size > 1) {
      const oldest = this.cache.keys().next().value!;
      const entry = this.cache.get(oldest)!;
      this.pixels -= entry.canvas.width * entry.canvas.height;
      this.cache.delete(oldest);
    }
    return cached;
  }
  draw(
    ctx: CanvasRenderingContext2D,
    scale: number,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number,
  ) {
    const detail = scale >= 5 ? 8 : scale >= 2 ? 4 : 1;
    const left = Math.max(0, Math.floor(-offsetX / scale / CHUNK)),
      right = Math.min(
        Math.ceil(this.map.width() / CHUNK) - 1,
        Math.floor((width - offsetX) / scale / CHUNK),
      );
    const top = Math.max(0, Math.floor(-offsetY / scale / CHUNK)),
      bottom = Math.min(
        Math.ceil(this.map.height() / CHUNK) - 1,
        Math.floor((height - offsetY) / scale / CHUNK),
      );
    ctx.imageSmoothingEnabled = true;
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const chunk = this.chunk(x, y, detail);
        ctx.drawImage(
          chunk.canvas,
          offsetX + chunk.x * scale,
          offsetY + chunk.y * scale,
          chunk.width * scale,
          chunk.height * scale,
        );
      }
  }
}
