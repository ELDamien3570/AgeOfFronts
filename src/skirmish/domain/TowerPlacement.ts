import type { GameMap } from "../../core/game/GameMap";
import type { Building } from "../Protocol";
import { AGES, type Age } from "./Definitions";

export interface TowerSiteIndex {
  at(tile: number): readonly Building[];
  nearby(tile: number, radius: number): Iterable<Building>;
}

/** Exact production auto-link policy shared by domain quotes and presentation. */
export function quoteTowerPlan(
  map: GameMap,
  tile: number,
  owner: number,
  age: Age,
  buildings: readonly Building[] | TowerSiteIndex,
  wallAt: (tile: number) => boolean,
) {
  const links: { a: number; tiles: number[] }[] = [];
  const indexed = Array.isArray(buildings)
      ? undefined
      : (buildings as TowerSiteIndex),
    facts = indexed
      ? [...indexed.nearby(tile, 12)]
      : (buildings as readonly Building[]),
    occupied = indexed
      ? undefined
      : new Set(facts.filter((b) => b.tile !== tile).map((b) => b.tile));
  const nearby = facts
    .filter(
      (b) =>
        b.type === "tower" &&
        b.playerId === owner &&
        (b.health ?? 1) > 0 &&
        !b.remainingTicks &&
        (b.age ?? "StoneAge") === age &&
        b.tile !== tile &&
        map.euclideanDistSquared(b.tile, tile) <= 144,
    )
    .sort(
      (a, b) =>
        map.euclideanDistSquared(a.tile, tile) -
          map.euclideanDistSquared(b.tile, tile) || a.id - b.id,
    );
  for (const other of nearby) {
    const tiles: number[] = [];
    let x = map.x(tile),
      y = map.y(tile);
    while (x !== map.x(other.tile)) {
      x += Math.sign(map.x(other.tile) - x);
      tiles.push(map.ref(x, y));
    }
    while (y !== map.y(other.tile)) {
      y += Math.sign(map.y(other.tile) - y);
      tiles.push(map.ref(x, y));
    }
    tiles.pop();
    if (
      tiles.length &&
      tiles.every(
        (t) =>
          map.isLand(t) &&
          !map.isImpassable(t) &&
          !(indexed ? indexed.at(t).length : occupied!.has(t)) &&
          !wallAt(t) &&
          !links.some((l) => l.tiles.includes(t)),
      )
    )
      links.push({ a: other.id, tiles });
    if (links.length === 2) break;
  }
  return {
    links,
    gold: links.reduce(
      (sum, l) => sum + l.tiles.length * 25 * (AGES.indexOf(age) + 1),
      0,
    ),
  };
}
