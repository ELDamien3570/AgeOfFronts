import { TerrainType } from "../../core/game/Game";
import type { GameMap } from "../../core/game/GameMap";
import { elevationOf } from "../Elevation";
import type { EnvironmentProfile } from "../Environment";
import { forestOf } from "../Forest";
import type { MapGeography } from "../Geography";
import type { Building } from "../Protocol";
import { TerrainArtwork } from "./TerrainArtwork";
import {
  TERRAIN_CHUNK_CELLS,
  TerrainDecorations,
  type TerrainBounds,
} from "./TerrainDecorations";
import { TerrainEnvironment } from "./TerrainEnvironment";
import { terrainHash as hash, terrainNoise as noise } from "./TerrainNoise";

const CHUNK = TERRAIN_CHUNK_CELLS;
const PIXEL_BUDGET = 12_000_000;
const PALETTES = {
  plains: [127, 148, 88],
  hills: [146, 140, 98],
  mountains: [147, 148, 137],
  ocean: [48, 91, 116],
  shallow: [77, 128, 143],
  coast: [190, 177, 127],
};

export function paintedCell(
  map: GameMap,
  tile: number,
  relief?: Int8Array,
  environment?: TerrainEnvironment,
): { color: string } {
  const x = map.x(tile),
    y = map.y(tile);
  let base: readonly number[];
  if (environment) base = environment.colorAt(tile);
  else {
    const type = map.terrainType(tile),
      neighbors = map.neighbors(tile),
      coast = map.isLand(tile) && neighbors.some((t) => map.isWater(t)),
      shallow = map.isWater(tile) && neighbors.some((t) => map.isLand(t));
    base = coast
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
    if (noise(x, y, 24) > 0.55 && type === TerrainType.Plains && !coast)
      base = [104, 130, 79];
  }
  const shade =
    (noise(x, y, 9) - 0.5) * 16 +
    (noise(x, y, 3) - 0.5) * 5 +
    (relief?.[tile] ?? 0);
  return {
    color: `rgb(${base.map((value) => Math.round(value + shade)).join(",")})`,
  };
}

export function terrainRelief(map: GameMap): Int8Array | undefined {
  const elevation = elevationOf(map);
  if (!elevation) return undefined;
  const shades = new Int8Array(map.width() * map.height());
  const sample = (x: number, y: number) => {
    const tile = map.ref(
      Math.max(0, Math.min(map.width() - 1, x)),
      Math.max(0, Math.min(map.height() - 1, y)),
    );
    return map.isLand(tile) ? elevation.heightAt(tile) : elevation.seaLevel;
  };
  for (let y = 0; y < map.height(); y++)
    for (let x = 0; x < map.width(); x++) {
      const tile = map.ref(x, y);
      if (!map.isLand(tile)) continue;
      // Fixed upper-left light with deliberate visual relief exaggeration.
      // This disposable shade is independent of route costs and elevation data.
      const gradient =
        sample(x + 1, y) -
        sample(x - 1, y) +
        sample(x, y + 1) -
        sample(x, y - 1);
      shades[tile] = Math.round(Math.max(-26, Math.min(26, gradient / 40)));
    }
  return shades;
}

// Disposable presentation chunks read shared cover; camera LOD cannot change
// passability or travel speed. Ground clearance is mirrored from snapshots.
export class PaintedTerrain {
  private readonly artwork: TerrainArtwork;
  private readonly environment: TerrainEnvironment;
  private readonly decorations: TerrainDecorations;
  private readonly relief?: Int8Array;
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
  constructor(
    private readonly map: GameMap,
    geography?: MapGeography,
    environment?: EnvironmentProfile,
  ) {
    this.relief = terrainRelief(map);
    this.environment = new TerrainEnvironment(map, geography, environment);
    this.decorations = new TerrainDecorations(map, this.environment);
    this.artwork = new TerrainArtwork(this.decorations.families, () => {
      this.cache.clear();
      this.pixels = 0;
    });
  }
  updateBuildings(buildings: readonly Pick<Building, "tile" | "type">[]): void {
    for (const tile of forestOf(this.map)?.updateBuildings(
      this.map,
      buildings,
    ) ?? [])
      this.invalidate({
        left: this.map.x(tile),
        top: this.map.y(tile),
        right: this.map.x(tile) + 1,
        bottom: this.map.y(tile) + 1,
      });
    for (const bounds of this.decorations.updateBuildings(buildings))
      this.invalidate(bounds);
  }
  private invalidate(bounds: TerrainBounds): void {
    // Include the shared one-cell gutter, all LODs, and the entire image's
    // transparent padding. Adjacent chunks lose the same accent together.
    for (
      let cy = Math.floor((bounds.top - 1) / CHUNK);
      cy <= Math.floor((bounds.bottom + 1) / CHUNK);
      cy++
    )
      for (
        let cx = Math.floor((bounds.left - 1) / CHUNK);
        cx <= Math.floor((bounds.right + 1) / CHUNK);
        cx++
      )
        for (const detail of [1, 4, 8, 16]) {
          const key = `${cx}:${cy}:${detail}`,
            entry = this.cache.get(key);
          if (!entry) continue;
          this.pixels -= entry.canvas.width * entry.canvas.height;
          this.cache.delete(key);
        }
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
        const cell = paintedCell(
          this.map,
          this.map.ref(xx, yy),
          this.relief,
          this.environment,
        );
        ctx.fillStyle = cell.color;
        ctx.fillRect(xx - x, yy - y, 1, 1);
      }
    if (detail > 1) {
      // Include decoration anchors beyond a chunk edge so adjacent chunks share
      // the same artwork, with no seams or dependence on camera position.
      ctx.imageSmoothingEnabled = true;
      const accents = Array.from(
        this.decorations.visible({
          left: x,
          top: y,
          right: x + width,
          bottom: y + height,
        }),
      ).sort(
        (a, b) =>
          Number(a.accent.role === "canopy") -
            Number(b.accent.role === "canopy") ||
          a.y - b.y ||
          a.id - b.id,
      );
      for (const placed of accents) {
        const image = this.artwork.get(placed.accent.family);
        if (!image) continue;
        const source = placed.accent.sourceRect,
          bounds = placed.imageBounds;
        ctx.globalAlpha = placed.accent.role === "canopy" ? 0.98 : 0.7;
        ctx.drawImage(
          image,
          source[0],
          source[1],
          source[2],
          source[3],
          bounds.left - x,
          bounds.top - y,
          bounds.right - bounds.left,
          bounds.bottom - bounds.top,
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
    const detail = scale >= 12 ? 16 : scale >= 5 ? 8 : scale >= 2 ? 4 : 1;
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
