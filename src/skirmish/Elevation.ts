import { RESOURCE_SUITABILITY_ORDER, type ResourceTerrainData } from "./ResourceTerrain";
import type { GameMap } from "../core/game/GameMap";
import { GameMapImpl } from "../core/game/GameMap";
import { ForestField, type ForestData } from "./Forest";

// Static, calibrated map data. Display contrast never changes these metres.
export interface ElevationData {
  values: Float32Array;
  minimum: number;
  maximum: number;
  seaLevel: number;
  /** Presentation-only relief gain; never changes heights or movement. */
  reliefScale?: number;
  /** Opt-in shading above dense canopy; independent of terrain mechanics. */
  canopyRelief?: boolean;
}

export class ElevationField {
  private readonly values: Float32Array;
  readonly minimum: number;
  readonly maximum: number;
  readonly seaLevel: number;
  readonly reliefScale?: number;
  readonly canopyRelief?: boolean;
  constructor(size: number, data: ElevationData) {
    if (
      !(data.values instanceof Float32Array) ||
      data.values.length !== size ||
      !Number.isFinite(data.minimum) ||
      !Number.isFinite(data.maximum) ||
      data.maximum <= data.minimum ||
      !Number.isFinite(data.seaLevel) ||
      data.seaLevel < data.minimum ||
      data.seaLevel > data.maximum ||
      (data.reliefScale !== undefined && (!Number.isFinite(data.reliefScale) || data.reliefScale <= 0 || data.reliefScale > 10)) ||
      (data.canopyRelief !== undefined && typeof data.canopyRelief !== "boolean")
    )
      throw new Error("Invalid elevation field");
    for (const value of data.values)
      if (
        !Number.isFinite(value) ||
        value < data.minimum - 0.01 ||
        value > data.maximum + 0.01
      )
        throw new Error("Elevation sample is outside its calibrated range");
    this.values = data.values.slice();
    this.minimum = data.minimum;
    this.maximum = data.maximum;
    this.seaLevel = data.seaLevel;
    this.reliefScale = data.reliefScale;
    this.canopyRelief = data.canopyRelief;
  }
  heightAt(tile: number): number {
    return this.values[tile];
  }
}

export class SkirmishMap extends GameMapImpl {
  readonly elevation?: ElevationField;
  readonly forest?: ForestField;
  readonly resourceTerrain?: ResourceTerrainData;
  constructor(
    width: number,
    height: number,
    terrain: Uint8Array,
    elevation?: ElevationData,
    forest?: ForestData,
    resourceTerrain?: ResourceTerrainData,
  ) {
    let land = 0;
    for (const cell of terrain)
      if ((cell & 128) !== 0 && (cell & 31) !== 31) land++;
    super(width, height, terrain, land);
    if (resourceTerrain) {
      if (!(resourceTerrain.desert instanceof Uint8Array) || resourceTerrain.desert.length !== terrain.length)
        throw new Error("Invalid resource biome inputs");
      const { suitability, marine } = resourceTerrain;
      if (suitability && (!(suitability instanceof Uint8Array) || suitability.length !== terrain.length * RESOURCE_SUITABILITY_ORDER.length))
        throw new Error("Invalid resource suitability inputs");
      if (marine && (!(marine instanceof Uint8Array) || marine.length !== terrain.length))
        throw new Error("Invalid resource marine inputs");
      this.resourceTerrain = {
        desert: resourceTerrain.desert.slice(),
        ...(suitability ? { suitability: suitability.slice() } : {}),
        ...(marine ? { marine: marine.slice() } : {}),
      };
    }
    if (elevation)
      this.elevation = new ElevationField(width * height, elevation);
    if (forest) {
      this.forest = new ForestField(width * height, forest);
      for (let tile = 0; tile < terrain.length; tile++)
        if (
          (!this.isLand(tile) || this.isImpassable(tile)) &&
          forest.cover[tile]
        )
          throw new Error("Forest cover must be on passable land");
    }
  }
}

export class ElevatedMap extends SkirmishMap {
  declare readonly elevation: ElevationField;
  constructor(
    width: number,
    height: number,
    terrain: Uint8Array,
    elevation: ElevationData,
  ) {
    super(width, height, terrain, elevation);
  }
}

export function elevationOf(map: GameMap): ElevationField | undefined {
  return map instanceof SkirmishMap ? map.elevation : undefined;
}

export function createSkirmishMap(
  width: number,
  height: number,
  terrain: Uint8Array,
  elevation?: ElevationData,
  forest?: ForestData,
  resourceTerrain?: ResourceTerrainData,
): GameMapImpl {
  return new SkirmishMap(width, height, terrain, elevation, forest, resourceTerrain);
}
