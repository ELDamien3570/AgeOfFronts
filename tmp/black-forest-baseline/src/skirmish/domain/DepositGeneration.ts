import { TerrainType } from "../../core/game/Game";
import type { GameMap } from "../../core/game/GameMap";
import { resourceTerrainOf } from "../ResourceTerrain";
import { coastalRanges } from "../content/CoastalTerritory";
import { coastalWaterDistances } from "./CoastalReach";
import type { Deposit, Resource } from "./Definitions";

export const DEPOSIT_RULES = Object.freeze({
  revision: 4,
  baseDensity: 2,
  originalDenominator: 6300,
  mountainRadius: 6,
  metalWeight: 3,
  plainsHorseWeight: 3,
  desertOilWeight: 4,
  powderAbundance: 2,
  startingPreferredReach: 24,
  startingReach: 36,
});
export const DEPOSIT_RESOURCES: readonly Resource[] = [
  "horses",
  "stone",
  "copper",
  "tin",
  "ironOre",
  "carbon",
  "gunpowder",
  "oil",
];
function random(tile: number, seed: number): number {
  let value = Math.imul(tile ^ seed ^ 0x6d2b79f5, 1597334677) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 2246822519) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 3266489917) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}
function mountainDistances(map: GameMap): Uint8Array {
  const size = map.width() * map.height(),
    distances = new Uint8Array(size).fill(255),
    queue = new Uint32Array(size);
  let head = 0,
    tail = 0;
  for (let tile = 0; tile < size; tile++)
    if (
      map.isLand(tile) &&
      (map.terrainType(tile) === TerrainType.Mountain || map.isImpassable(tile))
    ) {
      distances[tile] = 0;
      queue[tail++] = tile;
    }
  while (head < tail) {
    const tile = queue[head++],
      distance = distances[tile] + 1;
    if (distance > DEPOSIT_RULES.mountainRadius) continue;
    map.forEachNeighbor(tile, (neighbor) => {
      if (!map.isLand(neighbor) || distances[neighbor] <= distance) return;
      distances[neighbor] = distance;
      queue[tail++] = neighbor;
    });
  }
  return distances;
}
/** Normalized terrain weighting redistributes deposits without inflating their total. */
export function generateDeposits(
  map: GameMap,
  seed: number,
  density = 1,
  output = 1,
): Deposit[] {
  const size = map.width() * map.height(),
    mountains = mountainDistances(map),
    desert = resourceTerrainOf(map)?.desert;
  const waterDistances = coastalWaterDistances(map), oilReach = coastalRanges(map).oilTiles;
  const sums = new Float64Array(DEPOSIT_RESOURCES.length),
    eligible = new Uint32Array(DEPOSIT_RESOURCES.length);
  const weight = (tile: number, index: number): number => {
    const resource = DEPOSIT_RESOURCES[index];
    if (map.isImpassable(tile)) return 0;
    if (!map.isLand(tile))
      return resource === "oil" && map.isWater(tile) && waterDistances[tile] <= oilReach ? 1 : 0;
    if (
      ["copper", "tin", "ironOre"].includes(resource) &&
      mountains[tile] <= DEPOSIT_RULES.mountainRadius
    )
      return DEPOSIT_RULES.metalWeight;
    if (resource === "horses" && map.terrainType(tile) === TerrainType.Plains)
      return DEPOSIT_RULES.plainsHorseWeight;
    if (resource === "oil" && desert?.[tile])
      return DEPOSIT_RULES.desertOilWeight;
    return 1;
  };
  for (let tile = 0; tile < size; tile++)
    for (let i = 0; i < sums.length; i++) {
      const w = weight(tile, i);
      sums[i] += w;
      if (w) eligible[i]++;
    }
  const rates = [...sums].map((sum, i) =>
    sum
      ? ((eligible[i] * DEPOSIT_RULES.baseDensity * density) /
          DEPOSIT_RULES.originalDenominator /
          sum) *
        (DEPOSIT_RESOURCES[i] === "gunpowder"
          ? DEPOSIT_RULES.powderAbundance
          : 1)
      : 0,
  );
  const deposits: Deposit[] = [];
  const add = (tile: number, resource: Resource) =>
    deposits.push({
      id: deposits.length + 1,
      tile,
      resource,
      owner: 0,
      yieldPerSecond: (resource === "horses" ? 2 : 3) * output,
    });
  for (let tile = 0; tile < size; tile++) {
    const roll = random(tile, seed) / 0x100000000;
    let threshold = 0;
    for (let i = 0; i < rates.length; i++) {
      threshold += rates[i] * weight(tile, i);
      if (roll < threshold) {
        add(tile, DEPOSIT_RESOURCES[i]);
        break;
      }
    }
  }
  // Small scenarios retain coverage, with unique, seed-dependent deposit tiles.
  if (size < 20000) {
    const occupied = new Set(deposits.map((d) => d.tile));
    const land = Array.from({ length: size }, (_, tile) => tile).filter(
      (tile) => map.isLand(tile) && !map.isImpassable(tile),
    );
    for (const [i, resource] of DEPOSIT_RESOURCES.entries()) {
      if (deposits.some((d) => d.resource === resource) || !land.length)
        continue;
      const start = random(i, seed) % land.length;
      for (let offset = 0; offset < land.length; offset++) {
        const tile = land[(start + offset) % land.length];
        if (occupied.has(tile)) continue;
        add(tile, resource);
        occupied.add(tile);
        break;
      }
    }
  }
  return deposits;
}
