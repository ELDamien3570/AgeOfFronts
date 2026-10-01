import type { GameMap } from "../../core/game/GameMap";
import type { LandPaths } from "../Pathfinding";
import type { Building, BuildingType, Player } from "../Protocol";
import { BUILDING_SPACING } from "../Rules";
import type { Deposit } from "./Definitions";
import { DEPOSIT_RESOURCES, DEPOSIT_RULES } from "./DepositGeneration";

/** A seeded accessibility floor supplements the terrain-weighted world deposits.
 * Owned starting land comes first; cramped camps use nearby neutral land on the
 * same walkable landmass. Resource sites retain room for their extraction buildings.
 */
export function startingResources(
  map: GameMap,
  paths: Pick<LandPaths, "walkable">,
  players: readonly Pick<Player, "id" | "base">[],
  owners: Uint8Array,
  buildings: readonly Building[],
  deposits: readonly Deposit[],
  seed: number,
  output: number,
): Deposit[] {
  const blocked = new Uint8Array(map.width() * map.height());
  const reserve = (tile: number) => {
    const x = map.x(tile),
      y = map.y(tile);
    for (let dy = -BUILDING_SPACING; dy <= BUILDING_SPACING; dy++)
      for (let dx = -BUILDING_SPACING; dx <= BUILDING_SPACING; dx++)
        if (
          dx * dx + dy * dy < BUILDING_SPACING ** 2 &&
          map.isValidCoord(x + dx, y + dy)
        )
          blocked[map.ref(x + dx, y + dy)] = 1;
  };
  for (const player of players) reserve(player.base);
  for (const building of buildings) reserve(building.tile);
  // The camp's core must remain buildable even if the random world roll put a
  // mineral there. The coverage pass replaces those sites outside the core.
  const result = deposits
    .filter((d) => d.resource === "horses" || !blocked[d.tile])
    .map((d) => ({ ...d, owner: owners[d.tile] }));
  const occupied = new Map(result.map((d) => [d.tile, d]));
  let nextId = deposits.reduce((next, d) => Math.max(next, d.id + 1), 1);
  for (const deposit of result)
    if (deposit.resource !== "horses") reserve(deposit.tile);
  for (const player of [...players].sort((a, b) => a.id - b.id)) {
    const distance = new Map([[player.base, 0]]),
      queue = [player.base];
    for (let head = 0; head < queue.length; head++) {
      const tile = queue[head],
        nextDistance = distance.get(tile)! + 1;
      if (nextDistance > DEPOSIT_RULES.startingReach) continue;
      map.forEachNeighbor(tile, (next) => {
        if (
          distance.has(next) ||
          !paths.walkable(next) ||
          (owners[next] && owners[next] !== player.id)
        )
          return;
        distance.set(next, nextDistance);
        queue.push(next);
      });
    }
    // Use the camp perimeter first, leaving the interior for ordinary buildings.
    const tie = (tile: number) =>
      Math.imul(tile ^ seed ^ player.id, 1597334677) >>> 0;
    const candidates = queue.sort((a, b) => {
      const ownA = owners[a] === player.id,
        ownB = owners[b] === player.id;
      return (
        Number(ownB) - Number(ownA) ||
        (ownA
          ? map.euclideanDistSquared(b, player.base) -
            map.euclideanDistSquared(a, player.base)
          : distance.get(a)! - distance.get(b)!) ||
        tie(a) - tie(b) ||
        a - b
      );
    });
    // Minerals and oil require spaced buildings; horses are collected by ownership.
    for (const resource of [
      ...DEPOSIT_RESOURCES.filter((r) => r !== "horses"),
      "horses" as const,
    ]) {
      const eligible = (tile: number) =>
        (resource === "horses" || !blocked[tile]) &&
        (!occupied.has(tile) || occupied.get(tile)!.resource === resource);
      const tile = candidates.find((t) => eligible(t));
      if (tile === undefined)
        throw new Error(
          `Starting camp ${player.id} lacks nearby buildable land for ${resource}`,
        );
      if (!occupied.has(tile)) {
        const deposit: Deposit = {
          id: nextId++,
          tile,
          resource,
          owner: owners[tile],
          yieldPerSecond: (resource === "horses" ? 2 : 3) * output,
        };
        result.push(deposit);
        occupied.set(tile, deposit);
      }
      if (resource !== "horses") reserve(tile);
    }
  }
  return result;
}

/** Shared by authoritative construction and the placement preview. */
export function resourceSiteRejection(
  map: GameMap,
  deposits: readonly Deposit[],
  type: BuildingType,
  tile: number,
): string | null {
  if (["mine", "oil-well", "oil-rig"].includes(type)) return null;
  return deposits.some(
    (d) =>
      d.resource !== "horses" &&
      map.isLand(d.tile) &&
      map.euclideanDistSquared(d.tile, tile) < BUILDING_SPACING ** 2,
  )
    ? "Leave room for resource extraction sites"
    : null;
}
