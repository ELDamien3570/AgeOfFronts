import type { GameMap } from "../../core/game/GameMap";
import type { WaterPaths } from "../Pathfinding";

/** One bounded search per fleet itinerary, never one search per ship or tick.
 * Follow connected water within three cells of friendly shore. Exact route
 * admission still owns travel between the sampled waypoints. */
export function coastalPatrol(map: GameMap, water: WaterPaths, owners: ArrayLike<number>,
  playerId: number, anchor: number): number[] {
  const sea = water.component[anchor], parents = new Map<number, number>([[anchor, anchor]]);
  const queue = [anchor];
  const shoreDistances = new Map<number, number>();
  const nearShore = (tile: number) => {
    if(shoreDistances.has(tile))return shoreDistances.get(tile)! <= 3;
    const x = map.x(tile), y = map.y(tile);
    let distance=4;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 3 || !map.isValidCoord(x + dx, y + dy)) continue;
      const land = map.ref(x + dx, y + dy);
      if (map.isLand(land) && owners[land] === playerId)
        distance=Math.min(distance,Math.abs(dx)+Math.abs(dy));
    }
    shoreDistances.set(tile,distance);
    return distance<=3;
  };
  for (let cursor = 0; cursor < queue.length && queue.length < 512; cursor++) {
    for (const tile of map.neighbors(queue[cursor])) {
      if (parents.has(tile) || water.component[tile] !== sea || !water.walkable(tile) ||
          map.euclideanDistSquared(anchor, tile) > 48 ** 2 || !nearShore(tile)) continue;
      parents.set(tile, queue[cursor]); queue.push(tile);
      if (queue.length === 512) break;
    }
  }
  const farthest = (from: number) => queue.reduce((best, tile) =>
    map.euclideanDistSquared(from, tile) > map.euclideanDistSquared(from, best) ? tile : best, anchor);
  const a = farthest(anchor), b = farthest(a);
  const ancestry = (tile: number) => {
    const path = [tile];
    while (tile !== anchor) { tile = parents.get(tile)!; path.push(tile); }
    return path;
  };
  const left = ancestry(a), right = ancestry(b), positions = new Map(left.map((t, i) => [t, i]));
  const join = right.findIndex(t => positions.has(t));
  const path = [...left.slice(0, positions.get(right[join])! + 1), ...right.slice(0, join).reverse()];
  const route = path.filter((_, i) => i % 8 === 0 || i === path.length - 1).map(tile => {
    // Prefer a little breathing room off shore without searching another route.
    let best=tile;
    for(const candidate of queue) if(map.euclideanDistSquared(tile,candidate)<=2**2 &&
      (shoreDistances.get(candidate) ?? 0)>(shoreDistances.get(best) ?? 0)) best=candidate;
    return best;
  }).filter((tile,i,route)=>i===0 || tile!==route[i-1]);
  // Ping-pong along the coast rather than repeatedly returning to the berth.
  return route.length > 1 ? [...route, ...route.slice(1, -1).reverse()] : [];
}
