import { TerrainType } from "../../core/game/Game";
import type { GameMap } from "../../core/game/GameMap";
import { elevationOf } from "../Elevation";
import { elevationRelief } from "./ElevationRelief";
import type { EnvironmentProfile } from "../Environment";
import { forestOf } from "../Forest";
import type { MapGeography } from "../Geography";
import type { Building } from "../Protocol";
import { EARTH_ACCENTS } from "./EarthTerrainCatalog";
import type { BakeSource } from "./GroundBake";
import { TerrainArtwork } from "./TerrainArtwork";
import {
  TERRAIN_CHUNK_CELLS,
  TerrainDecorations,
  type TerrainBounds,
} from "./TerrainDecorations";
import { TerrainEnvironment } from "./TerrainEnvironment";
import type { FieldInputs } from "./TerrainFields";
import { terrainHash as hash, terrainNoise as noise } from "./TerrainNoise";

const CHUNK = TERRAIN_CHUNK_CELLS;
const PIXEL_BUDGET = 12_000_000;
const CANOPY_DETAIL = 2;
const CANOPY_BAKE_DETAIL = 4;
const CANOPY_STAND_SCALE = 2.6;
const CANOPY_STAND_PADDING = Math.ceil(
  Math.max(
    ...EARTH_ACCENTS.filter((accent) => accent.role === "canopy").flatMap(
      (accent) => {
        const ratio =
            accent.visibleFootprintCells /
            Math.max(accent.alphaBounds[2], accent.alphaBounds[3]),
          left = accent.pivot[0] * ratio,
          top = accent.pivot[1] * ratio;
        return [
          left,
          top,
          accent.imageSizeCells[0] - left,
          accent.imageSizeCells[1] - top,
        ];
      },
    ),
  ) *
    (CANOPY_STAND_SCALE - 1),
);
const PALETTES = {
  plains: [127, 148, 88],
  hills: [146, 140, 98],
  mountains: [147, 148, 137],
  ocean: [48, 91, 116],
  shallow: [77, 128, 143],
  coast: [190, 177, 127],
};

// Unclamped, rounded channels of the painted ground colour for one tile. The
// 2D chunks and the WebGL ground texture both derive from this one function.
export function paintedRgb(
  map: GameMap,
  tile: number,
  relief?: Int8Array,
  environment?: TerrainEnvironment,
): number[] {
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
  return base.map((value) => Math.round(value + shade));
}

export function paintedCell(
  map: GameMap,
  tile: number,
  relief?: Int8Array,
  environment?: TerrainEnvironment,
): { color: string } {
  return {
    color: `rgb(${paintedRgb(map, tile, relief, environment).join(",")})`,
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
    // Inland river channels retain their calibrated bed elevation. Flattening
    // all water to sea level would invent cliffs along high inland banks.
    return Math.max(elevation.seaLevel, elevation.heightAt(tile));
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
      const relief = elevation.reliefScale === undefined ? gradient / 40 :
        elevationRelief(sample, x, y, elevation.reliefScale);
      const limit = elevation.reliefScale === undefined ? 26 : 42;
      shades[tile] = Math.round(Math.max(-limit, Math.min(limit, relief)));
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
  private decorationsOnly = false;
  private canopyScratch?: HTMLCanvasElement;
  private roadTiles: ReadonlySet<number> = new Set();
  constructor(
    private readonly map: GameMap,
    geography?: MapGeography,
    environment?: EnvironmentProfile,
    invalidated: () => void = () => {},
  ) {
    this.relief = terrainRelief(map);
    this.environment = new TerrainEnvironment(map, geography, environment);
    this.decorations = new TerrainDecorations(map, this.environment);
    this.artwork = new TerrainArtwork(this.decorations.families, () => {
      this.cache.clear();
      this.pixels = 0;
      invalidated();
    });
  }
  // When the WebGL ground layer paints the terrain, chunks hold only the
  // decoration accents on transparent canvases, including distant canopy.
  setDecorationsOnly(value: boolean): void {
    if (value === this.decorationsOnly) return;
    this.decorationsOnly = value;
    this.cache.clear();
    this.pixels = 0;
  }
  // Inputs for the GL ground bakes: same colour function as the 2D chunks.
  groundColorSource(): BakeSource {
    const { map, relief, environment } = this,
      land = new Uint8Array(map.width() * map.height());
    for (let tile = 0; tile < land.length; tile++)
      land[tile] = map.isLand(tile) ? 1 : 0;
    return {
      width: map.width(),
      height: map.height(),
      land,
      rgbAt: (tile) => paintedRgb(map, tile, relief, environment),
    };
  }
  groundFieldInputs(source: BakeSource): FieldInputs {
    const elevation = elevationOf(this.map);
    let heights: Float32Array | undefined;
    if (elevation) {
      heights = new Float32Array(source.width * source.height);
      for (let tile = 0; tile < heights.length; tile++)
        heights[tile] = elevation.heightAt(tile);
    }
    return {
      width: source.width,
      height: source.height,
      land: source.land,
      elevation:
        elevation && heights
          ? { heights, seaLevel: elevation.seaLevel, reliefScale: elevation.reliefScale }
          : undefined,
    };
  }
  // Returns the tiles whose forest cover changed so a GL ground can re-bake.
  updateBuildings(
    buildings: readonly Pick<Building, "tile" | "type">[],
  ): readonly number[] {
    const changed =
      forestOf(this.map)?.updateBuildings(this.map, buildings) ?? [];
    for (const tile of changed)
      this.invalidate({
        left: this.map.x(tile),
        top: this.map.y(tile),
        right: this.map.x(tile) + 1,
        bottom: this.map.y(tile) + 1,
      });
    for (const bounds of this.decorations.updateBuildings(buildings))
      this.invalidate(bounds);
    return changed;
  }
  // Returns road tiles whose view cover changed so a GL ground can re-bake.
  updateRoads(tiles: ReadonlySet<number>): readonly number[] {
    const toggled = [
      ...[...tiles].filter((tile) => !this.roadTiles.has(tile)),
      ...[...this.roadTiles].filter((tile) => !tiles.has(tile)),
    ];
    const previous = toggled.map((tile) => this.environment.coverAt(tile));
    this.environment.setRoads(tiles);
    this.roadTiles = tiles;
    const changed = toggled.filter(
      (tile, i) => this.environment.coverAt(tile) !== previous[i],
    );
    for (const tile of changed)
      this.invalidate({
        left: this.map.x(tile),
        top: this.map.y(tile),
        right: this.map.x(tile) + 1,
        bottom: this.map.y(tile) + 1,
      });
    for (const bounds of this.decorations.updateRoads(tiles))
      this.invalidate(bounds);
    return changed;
  }
  private invalidate(bounds: TerrainBounds): void {
    // Include the shared one-cell gutter, all LODs, and the entire image's
    // transparent padding. Adjacent chunks lose the same accent together.
    for (const detail of [CANOPY_DETAIL, 4, 8, 16]) {
      const padding = 1 + (detail === CANOPY_DETAIL ? CANOPY_STAND_PADDING : 0);
      for (
        let cy = Math.floor((bounds.top - padding) / CHUNK);
        cy <= Math.floor((bounds.bottom + padding) / CHUNK);
        cy++
      )
        for (
          let cx = Math.floor((bounds.left - padding) / CHUNK);
          cx <= Math.floor((bounds.right + padding) / CHUNK);
          cx++
        ) {
          const key = `${cx}:${cy}:${detail}`,
            entry = this.cache.get(key);
          if (!entry) continue;
          this.pixels -= entry.canvas.width * entry.canvas.height;
          this.cache.delete(key);
        }
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
    const distant = detail === CANOPY_DETAIL,
      bakeDetail = distant ? CANOPY_BAKE_DETAIL : detail,
      canvas = distant
        ? (this.canopyScratch ??= document.createElement("canvas"))
        : document.createElement("canvas");
    // One reusable oversampled surface filters crowns before storing the small
    // distant mip. A full 1000-square map fits within the existing pixel budget.
    canvas.width = width * bakeDetail;
    canvas.height = height * bakeDetail;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(bakeDetail, bakeDetail);
    if (!this.decorationsOnly)
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
    {
      // Include decoration anchors beyond a chunk edge so adjacent chunks share
      // the same artwork, with no seams or dependence on camera position.
      ctx.imageSmoothingEnabled = true;
      if (distant) {
        // Distant crowns represent groups of trees. Clip those larger shapes
        // to shared forest cover so clearings, shores and building sites stay open.
        ctx.save();
        ctx.beginPath();
        for (let yy = y; yy < y + height; yy++) {
          let run = -1;
          for (let xx = x; xx <= x + width; xx++) {
            const tile = xx < x + width ? this.map.ref(xx, yy) : -1,
              wooded =
                tile >= 0 &&
                this.map.isLand(tile) &&
                this.environment.coverAt(tile) >= 0.15;
            if (wooded && run < 0) run = xx;
            else if (!wooded && run >= 0) {
              ctx.rect(run - x, yy - y, xx - run, 1);
              run = -1;
            }
          }
        }
        ctx.clip();
      }
      const padding = distant ? CANOPY_STAND_PADDING : 0;
      const accents = Array.from(
        this.decorations.visible({
          left: x - padding,
          top: y - padding,
          right: x + width + padding,
          bottom: y + height + padding,
        }),
      )
        .filter(
          (placed) =>
            !distant ||
            (placed.accent.role === "canopy" &&
              hash(Math.floor(placed.x * 13), Math.floor(placed.y * 13)) < 0.2),
        )
        .sort(
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
          bounds = placed.imageBounds,
          enlargement = distant ? CANOPY_STAND_SCALE : 1;
        ctx.globalAlpha = placed.accent.role === "canopy" ? 0.98 : 0.7;
        ctx.drawImage(
          image,
          source[0],
          source[1],
          source[2],
          source[3],
          placed.x + (bounds.left - placed.x) * enlargement - x,
          placed.y + (bounds.top - placed.y) * enlargement - y,
          (bounds.right - bounds.left) * enlargement,
          (bounds.bottom - bounds.top) * enlargement,
        );
      }
      if (distant) ctx.restore();
      ctx.globalAlpha = 1;
      // Opt-in inland forest lighting is baked with the chunk, never per frame.
      // Read effective cover so construction clearing also clears canopy shade.
      if (elevationOf(this.map)?.canopyRelief && this.relief) {
        for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
          const tile = this.map.ref(x + xx, y + yy),
            cover = this.environment.coverAt(tile), shade = this.relief[tile];
          if (cover < 0.15 || !shade || !this.map.isLand(tile)) continue;
          ctx.fillStyle = shade < 0 ? "#000" : "#fff";
          ctx.globalAlpha = Math.min(0.24, Math.abs(shade) / 120) * cover;
          ctx.fillRect(xx, yy, 1, 1);
        }
        ctx.globalAlpha = 1;
      }
      // Restrained strokes give water a painted surface at tactical zoom.
      // The GL ground's water shader replaces them.
      ctx.strokeStyle = "#b3dbe520";
      ctx.lineWidth = 0.12;
      for (let yy = y + 2; yy < y + height; yy += 5)
        for (let xx = x + 2; xx < x + width; xx += 7)
          if (
            !this.decorationsOnly &&
            !distant &&
            this.map.isWater(this.map.ref(xx, yy)) &&
            hash(xx, yy) > 0.5
          ) {
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
    let cachedCanvas = canvas;
    if (distant) {
      cachedCanvas = document.createElement("canvas");
      cachedCanvas.width = width * detail;
      cachedCanvas.height = height * detail;
      const reduced = cachedCanvas.getContext("2d")!;
      reduced.imageSmoothingEnabled = true;
      reduced.imageSmoothingQuality = "high";
      reduced.drawImage(canvas, 0, 0, cachedCanvas.width, cachedCanvas.height);
    }
    cached = { canvas: cachedCanvas, x, y, width, height };
    this.cache.set(key, cached);
    this.pixels += cachedCanvas.width * cachedCanvas.height;
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
    const detail =
      scale >= 12 ? 16 : scale >= 5 ? 8 : scale >= 2 ? 4 : CANOPY_DETAIL;
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
