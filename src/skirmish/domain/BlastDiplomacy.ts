import type { GameMap } from "../../core/game/GameMap";
import { FIXED, type Building, type Ship, type Squad } from "../Protocol";
import type { Barrier } from "./Definitions";

interface BlastWorld {
  map?: GameMap;
  owners?: Uint8Array;
  buildings: readonly Building[];
  squads: readonly Squad[];
  ships: readonly Ship[];
  tradeOwnersInBlast?(x: number, y: number, radius: number): Iterable<number>;
}

/** Factions exposed to the same centre-based blast footprint as impact damage.
 * Include land and detached structures: ownership need not match after a blast. */
export function* blastOwners(world: BlastWorld, x: number, y: number, radius: number,
  barriers: readonly Barrier[] = []): Generator<number> {
  const inside = (px: number, py: number) => (px - x) ** 2 + (py - y) ** 2 <= radius ** 2;
  const map = world.map;
  if (map) {
    const pointInside = (tile: number) => inside((map.x(tile) + 0.5) * FIXED, (map.y(tile) + 0.5) * FIXED);
    if (world.owners) {
      const left = Math.max(0, Math.ceil((x - radius) / FIXED - 0.5)), right = Math.min(map.width() - 1, Math.floor((x + radius) / FIXED - 0.5));
      const top = Math.max(0, Math.ceil((y - radius) / FIXED - 0.5)), bottom = Math.min(map.height() - 1, Math.floor((y + radius) / FIXED - 0.5));
      for (let cy = top; cy <= bottom; cy++)
        for (let cx = left; cx <= right; cx++)
          if (inside((cx + 0.5) * FIXED, (cy + 0.5) * FIXED)) yield world.owners[map.ref(cx, cy)];
    }
    for (const b of world.buildings) if ((b.health ?? 1) > 0 && pointInside(b.tile)) yield b.playerId;
    for (const b of barriers) if (b.health > 0 && b.tiles.some(pointInside)) yield b.playerId;
  }
  for (const s of world.squads) if (s.troops > 0 && inside(s.x, s.y)) yield s.playerId;
  for (const s of world.ships) if (s.health > 0 && inside(s.x, s.y)) yield s.playerId;
}

export function blastHitsAlly(world: BlastWorld, playerId: number, x: number, y: number, radius: number,
  allied: (a: number, b: number) => boolean, barriers: readonly Barrier[] = []): boolean {
  for (const owner of blastOwners(world, x, y, radius, barriers))
    if (owner !== 0 && owner !== playerId && allied(playerId, owner)) return true;
  for (const owner of world.tradeOwnersInBlast?.(x, y, radius) ?? [])
    if (owner !== 0 && owner !== playerId && allied(playerId, owner)) return true;
  return false;
}
