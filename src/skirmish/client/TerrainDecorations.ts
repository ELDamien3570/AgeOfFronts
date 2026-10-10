import type { GameMap } from "../../core/game/GameMap";
import {
  buildingClearedBounds,
  buildingGroundBounds,
} from "../BuildingFootprint";
import type { Building, BuildingType } from "../Protocol";
import {
  FAMILY_ACCENTS,
  type TerrainAccent,
  type TerrainFamily,
} from "./EarthTerrainCatalog";
import { TerrainEnvironment } from "./TerrainEnvironment";
import { terrainHash } from "./TerrainNoise";

export const TERRAIN_CHUNK_CELLS = 64;
const BUCKET = 16;
const CANOPY_SPACING = 1.15;
const ACCENT_SPACING = 4;
export interface TerrainBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface PlacedTerrainAccent {
  id: number;
  x: number;
  y: number;
  accent: TerrainAccent;
  bounds: TerrainBounds;
  imageBounds: TerrainBounds;
}
export function overlaps(a: TerrainBounds, b: TerrainBounds): boolean {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}
export function buildingTerrainFootprint(
  map: GameMap,
  tile: number,
  type: BuildingType,
): TerrainBounds {
  return buildingGroundBounds(map, tile, type);
}

// Disposable spatial index of cosmetic accents. One blocked count per accent
// supports neighbouring footprints; a building stack occupies only one site.
export class TerrainDecorations {
  readonly families = new Set<TerrainFamily>();
  private readonly buckets = new Map<string, PlacedTerrainAccent[]>();
  private readonly blocked: Uint32Array;
  private padding = 0;
  private sites = new Map<number, BuildingType>();
  private roads = new Set<number>();
  constructor(
    private readonly map: GameMap,
    environment: TerrainEnvironment,
  ) {
    let id = 0;
    const place = (
      px: number,
      py: number,
      accent: TerrainAccent,
      scale = 1,
    ) => {
      const ratio =
          (accent.visibleFootprintCells * scale) /
          Math.max(accent.alphaBounds[2], accent.alphaBounds[3]),
        width = accent.alphaBounds[2] * ratio,
        height = accent.alphaBounds[3] * ratio,
        bounds = {
          left: px - width / 2,
          right: px + width / 2,
          top: py - height / 2,
          bottom: py + height / 2,
        };
      // Silhouettes must remain on passable land, including narrow shores.
      for (let yy = Math.floor(bounds.top); yy < Math.ceil(bounds.bottom); yy++)
        for (
          let xx = Math.floor(bounds.left);
          xx < Math.ceil(bounds.right);
          xx++
        )
          if (
            !map.isValidCoord(xx, yy) ||
            !map.isLand(map.ref(xx, yy)) ||
            map.isImpassable(map.ref(xx, yy))
          )
            return;
      const left = px - accent.pivot[0] * ratio,
        top = py - accent.pivot[1] * ratio,
        placed = {
          id: id++,
          x: px,
          y: py,
          accent,
          bounds,
          imageBounds: {
            left,
            top,
            right: left + accent.imageSizeCells[0] * scale,
            bottom: top + accent.imageSizeCells[1] * scale,
          },
        },
        key = this.key(px, py);
      let bucket = this.buckets.get(key);
      if (!bucket) this.buckets.set(key, (bucket = []));
      bucket.push(placed);
      this.padding = Math.max(
        this.padding,
        px - left,
        py - top,
        placed.imageBounds.right - px,
        placed.imageBounds.bottom - py,
      );
      this.families.add(accent.family);
    };
    // Low accents belong to open ground. Forest stands use their own canopy
    // layer, never a random draw from a pool mixing trees, rocks and shrubs.
    for (let y = 0; y < map.height(); y += ACCENT_SPACING)
      for (let x = 0; x < map.width(); x += ACCENT_SPACING) {
        const px = x + 0.8 + terrainHash(x, y) * 2.4,
          py = y + 0.8 + terrainHash(y + 503, x - 151) * 2.4;
        if (!map.isValidCoord(Math.floor(px), Math.floor(py))) continue;
        const tile = map.ref(Math.floor(px), Math.floor(py));
        if (!map.isLand(tile) || environment.coverAt(tile) > 0.4) continue;
        const family = environment.familyAt(tile),
          density =
            family === "desert-xeric"
              ? 0.3
              : family === "grassland-steppe"
                ? 0.4
                : 0.75;
        if (terrainHash(x + 811, y - 613) > density) continue;
        const candidates = FAMILY_ACCENTS.get(family)!.filter(
          (accent) => accent.role !== "canopy",
        );
        if (candidates.length)
          place(
            px,
            py,
            candidates[
              Math.min(
                candidates.length - 1,
                Math.floor(terrainHash(x - 331, y + 223) * candidates.length),
              )
            ],
          );
      }
    // Staggered, lightly jittered anchors overlap into continuous woodland.
    // Density and dense/open variants follow the shared cover field; local
    // hashes vary details inside stands without defining the forest boundary.
    for (let row = 0, y = 0; y < map.height(); row++, y += CANOPY_SPACING)
      for (
        let column = 0, x = 0;
        x < map.width();
        column++, x += CANOPY_SPACING
      ) {
        const px =
            x +
            CANOPY_SPACING * (row % 2 ? 0.5 : 0) +
            (terrainHash(column + 157, row - 331) - 0.5) * 0.65,
          py = y + (terrainHash(row - 89, column + 271) - 0.5) * 0.65;
        if (!map.isValidCoord(Math.floor(px), Math.floor(py))) continue;
        const tile = map.ref(Math.floor(px), Math.floor(py)),
          cover = environment.coverAt(tile);
        if (
          !map.isLand(tile) ||
          cover < 0.15 ||
          terrainHash(column - 417, row + 193) > Math.min(1, cover * 1.65)
        )
          continue;
        const candidates = FAMILY_ACCENTS.get(
          environment.familyAt(tile),
        )!.filter((accent) => accent.role === "canopy");
        if (!candidates.length) continue;
        const dense = cover >= 0.55;
        // Dense forms dominate interiors, with occasional open groves to break
        // repeated silhouettes. Edge stands use open forms; cover stays fixed.
        const variant =
          candidates.length === 1 ||
          (dense && terrainHash(column + 877, row - 941) < 0.82)
            ? 0
            : 1;
        place(
          px,
          py,
          candidates[variant],
          0.9 + terrainHash(column - 647, row + 773) * 0.1,
        );
      }
    this.blocked = new Uint32Array(id);
  }
  private key(x: number, y: number): string {
    return `${Math.floor(x / BUCKET)}:${Math.floor(y / BUCKET)}`;
  }
  private *near(bounds: TerrainBounds): Iterable<PlacedTerrainAccent> {
    // Derived from authored bounds so future generations cannot silently fall
    // outside the neighbourhood query when their transparent padding changes.
    const padding = this.padding;
    for (
      let cy = Math.floor((bounds.top - padding) / BUCKET);
      cy <= Math.floor((bounds.bottom + padding) / BUCKET);
      cy++
    )
      for (
        let cx = Math.floor((bounds.left - padding) / BUCKET);
        cx <= Math.floor((bounds.right + padding) / BUCKET);
        cx++
      )
        yield* this.buckets.get(`${cx}:${cy}`) ?? [];
  }
  *visible(bounds: TerrainBounds): Iterable<PlacedTerrainAccent> {
    for (const accent of this.near(bounds))
      if (!this.blocked[accent.id] && overlaps(accent.imageBounds, bounds))
        yield accent;
  }
  // Clears accents whose crown core sits on a road cell. Edge crowns may still
  // overhang the road shoulder, like trees lining a forest track.
  updateRoads(tiles: ReadonlySet<number>): TerrainBounds[] {
    const dirty: TerrainBounds[] = [];
    const change = (tile: number, delta: number) => {
      const x = this.map.x(tile),
        y = this.map.y(tile),
        cell = { left: x, top: y, right: x + 1, bottom: y + 1 };
      for (const placed of this.near(cell)) {
        const { left, top, right, bottom } = placed.bounds,
          insetX = (right - left) / 4,
          insetY = (bottom - top) / 4,
          core = {
            left: left + insetX,
            top: top + insetY,
            right: right - insetX,
            bottom: bottom - insetY,
          };
        if (!overlaps(core, cell)) continue;
        const wasVisible = this.blocked[placed.id] === 0;
        this.blocked[placed.id] += delta;
        if (wasVisible !== (this.blocked[placed.id] === 0))
          dirty.push(placed.imageBounds);
      }
    };
    for (const tile of tiles) if (!this.roads.has(tile)) change(tile, 1);
    for (const tile of this.roads) if (!tiles.has(tile)) change(tile, -1);
    this.roads = new Set(tiles);
    return dirty;
  }
  updateBuildings(
    buildings: readonly Pick<Building, "tile" | "type">[],
  ): TerrainBounds[] {
    const next = new Map(
        buildings.map((building) => [building.tile, building.type]),
      ),
      dirty: TerrainBounds[] = [];
    const change = (tile: number, type: BuildingType, delta: number) => {
      const footprint = buildingClearedBounds(this.map, tile, type);
      for (const placed of this.near(footprint)) {
        if (!overlaps(placed.bounds, footprint)) continue;
        const wasVisible = this.blocked[placed.id] === 0;
        this.blocked[placed.id] += delta;
        if (wasVisible !== (this.blocked[placed.id] === 0))
          dirty.push(placed.imageBounds);
      }
    };
    // Apply additions first so a changed building type doesn't briefly restore
    // an accent beneath a still-occupied footprint.
    for (const [tile, type] of next)
      if (this.sites.get(tile) !== type) change(tile, type, 1);
    for (const [tile, type] of this.sites)
      if (next.get(tile) !== type) change(tile, type, -1);
    this.sites = next;
    return dirty;
  }
}
