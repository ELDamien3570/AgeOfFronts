import type { GameMap } from "../../core/game/GameMap";
import { coastalRanges } from "../content/CoastalTerritory";

const cache = new WeakMap<GameMap, { version: number; distances: Uint16Array }>();
// Distance counts water steps from land, rather than encoded terrain height.
// Generation and authoritative placement share this topology-aware band.
export function coastalWaterDistances(map: GameMap): Uint16Array {
  const previous = cache.get(map);
  if (previous?.version === map.waterVersion()) return previous.distances;
  const size = map.width() * map.height(), max = coastalRanges(map).claimTiles;
  const distances = new Uint16Array(size).fill(65535), queue = new Uint32Array(size);
  let head = 0, tail = 0;
  for (let tile = 0; tile < size; tile++) if (map.isLand(tile)) {
    distances[tile] = 0;
    map.forEachNeighbor(tile, n => {
      if (map.isWater(n) && distances[n] === 65535) { distances[n] = 1; queue[tail++] = n; }
    });
  }
  while(head < tail) {
    const tile = queue[head++], distance = distances[tile] + 1;
    if (distance > max) continue;
    map.forEachNeighbor(tile, n => {
      if (!map.isWater(n) || distances[n] <= distance) return;
      distances[n] = distance; queue[tail++] = n;
    });
  }
  cache.set(map, { version: map.waterVersion(), distances });
  return distances;
}
