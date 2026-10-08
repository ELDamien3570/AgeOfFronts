import type { GameMap } from "../core/game/GameMap";
import type { WaterPaths } from "./Pathfinding";
/** Short cardinal water connectors avoid global A* for routine patrols and
 * nearby interception. Failure leaves the existing voyage intact. */
export function navalLocalRoute(
  map: GameMap,
  water: WaterPaths,
  start: number,
  goal: number,
  maximum = 32,
): number[] | undefined {
  if (!water.connected(start, goal)) return;
  const path = [start];
  let tile = start;
  for (let i = 0; i < maximum && tile !== goal; i++) {
    const x = map.x(tile),
      y = map.y(tile),
      dx = Math.sign(map.x(goal) - x),
      dy = Math.sign(map.y(goal) - y);
    const next = [
      [x + dx, y],
      [x, y + dy],
    ].find(
      ([nx, ny]) =>
        map.isValidCoord(nx, ny) &&
        (nx !== x || ny !== y) &&
        water.walkable(map.ref(nx, ny)),
    );
    if (!next) return;
    tile = map.ref(next[0], next[1]);
    path.push(tile);
  }
  return tile === goal ? path : undefined;
}

/** Bounded route look-ahead gives a slower hull a chance to cut across a lane.
 * This proposes a tile; the normal water connector/admission still validates it. */
export function navalInterceptTile(
  map: GameMap,
  pursuer: { x: number; y: number; speed: number },
  target: {
    x: number;
    y: number;
    speed: number;
    path: readonly number[];
    nextPathIndex: number;
  },
  fixed: number,
  anchor: number,
  leash = 32,
): number {
  const current = map.ref(
    Math.floor(target.x / fixed),
    Math.floor(target.y / fixed),
  );
  let distance = 0,
    x = target.x,
    y = target.y;
  for (
    let index = target.nextPathIndex;
    index < Math.min(target.path.length, target.nextPathIndex + 24);
    index++
  ) {
    const tile = target.path[index],
      tx = (map.x(tile) + 0.5) * fixed,
      ty = (map.y(tile) + 0.5) * fixed;
    distance += Math.hypot(tx - x, ty - y);
    x = tx;
    y = ty;
    if (map.euclideanDistSquared(anchor, tile) > leash ** 2) break;
    if (
      Math.hypot(tx - pursuer.x, ty - pursuer.y) / Math.max(1, pursuer.speed) <=
      distance / Math.max(1, target.speed)
    )
      return tile;
  }
  return current;
}
