import { FIXED, type Building } from "../Protocol";
import type { Barrier } from "./Definitions";
/** Shared player preview and command topology. No pathfinding for soldiers. */
export function trenchFrontage(
  width: number,
  owner: number,
  buildings: readonly Building[],
  barriers: readonly Barrier[],
  start: { x: number; y: number },
  end: { x: number; y: number },
): number[] | undefined {
  const tiles = new Set<number>();
  for (const b of buildings)
    if (
      b.playerId === owner &&
      b.type === "trench" &&
      !b.remainingTicks &&
      (b.health ?? 1) > 0
    )
      tiles.add(b.tile);
  for (const b of barriers)
    if (
      b.playerId === owner &&
      b.kind === "trench" &&
      !b.remainingTicks &&
      b.health > 0
    )
      for (const tile of b.tiles) tiles.add(tile);
  const point = (t: number) => ({
    x: ((t % width) + 0.5) * FIXED,
    y: (Math.floor(t / width) + 0.5) * FIXED,
  });
  const nearest = (p: typeof start) =>
    [...tiles]
      .filter((t) => {
        const q = point(t);
        return Math.hypot(p.x - q.x, p.y - q.y) <= FIXED;
      })
      .sort((a, b) => {
        const aa = point(a),
          bb = point(b);
        return (
          Math.hypot(aa.x - p.x, aa.y - p.y) -
            Math.hypot(bb.x - p.x, bb.y - p.y) || a - b
        );
      })[0];
  const a = nearest(start),
    b = nearest(end);
  if (a === undefined || b === undefined) return;
  const queue = [a],
    previous = new Map<number, number | null>([[a, null]]);
  for (let i = 0; i < queue.length && i < 256; i++) {
    const tile = queue[i];
    if (tile === b) {
      const path: number[] = [];
      let t: number | null = b;
      while (t !== null) {
        path.push(t);
        t = previous.get(t)!;
      }
      return path.reverse().slice(0, 64);
    }
    for (const next of [tile - width, tile - 1, tile + 1, tile + width])
      if (
        tiles.has(next) &&
        !previous.has(next) &&
        Math.abs((next % width) - (tile % width)) +
          Math.abs(Math.floor(next / width) - Math.floor(tile / width)) ===
          1
      ) {
        previous.set(next, tile);
        queue.push(next);
      }
  }
}
