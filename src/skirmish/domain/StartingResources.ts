import type { GameMap } from "../../core/game/GameMap";
import { BUILDING_BORDER, buildingFootprint } from "../BuildingFootprint";
import { boundsOverlap, buildingReservationBounds } from "../BuildingFootprint";
import type { LandPaths } from "../Pathfinding";
import type { Building, BuildingType, Player } from "../Protocol";
import type { Deposit } from "./Definitions";
import { DEPOSIT_RESOURCES, DEPOSIT_RULES } from "./DepositGeneration";
import { startingCamp } from "./StartingCamp";
import { CAMP_RADIUS } from "./SpawnSelection";

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
  const extraction = buildingFootprint("mine");
  const extractionSpan = extraction.width + 2 * BUILDING_BORDER;
  const blocked = new Uint8Array(map.width() * map.height());
  // Mask candidate extraction anchors, rather than occupied terrain cells.
  const reserve = (tile: number, type: BuildingType = "mine") => {
    const bounds = buildingReservationBounds(map, tile, type);
    for (
      let y = Math.max(0, bounds.top - extraction.height);
      y <= Math.min(map.height() - 1, bounds.bottom);
      y++
    )
      for (
        let x = Math.max(0, bounds.left - extraction.width);
        x <= Math.min(map.width() - 1, bounds.right);
        x++
      ) {
        const anchor = map.ref(x, y);
        if (
          boundsOverlap(bounds, buildingReservationBounds(map, anchor, "mine"))
        )
          blocked[anchor] = 1;
      }
  };
  for (const player of players) {
    const camp=startingCamp(map,paths,player.base,CAMP_RADIUS);
    if(camp && !buildings.some(b=>b.playerId===player.id && b.type==="barracks"))
      reserve(camp.barracks,"barracks");
  }
  for (const building of buildings) reserve(building.tile, building.type);
  const extractionLand = (tile: number, playerId: number) => {
    const x = map.x(tile),
      y = map.y(tile);
    if (!map.isValidCoord(x + extraction.width - 1, y + extraction.height - 1)) return false;
    for (let yy = y; yy < y + extraction.height; yy++)
      for (let xx = x; xx < x + extraction.width; xx++) {
        const cell = map.ref(xx, yy);
        if (
          !paths.walkable(cell) ||
          (owners[cell] && owners[cell] !== playerId)
        )
          return false;
      }
    return true;
  };
  // Allocate the accessibility floor before the random world roll. Larger
  // reservations must not let incidental deposits crowd out a required resource.
  const result = deposits
    .filter((d) => d.resource === "horses")
    .map((d) => ({ ...d, owner: owners[d.tile] }));
  const occupied = new Map(result.map((d) => [d.tile, d]));
  let nextId = deposits.reduce((next, d) => Math.max(next, d.id + 1), 1);
  for (const deposit of result)
    if (deposit.resource !== "horses") reserve(deposit.tile);
  // Allocate constrained camps first so roomy neighbors cannot consume their
  // few usable extraction patches. This ordering is deterministic.
  const regions = players
    .map((player) => {
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
      return {
        player,
        distance,
        queue,
        capacity: queue.filter((tile) => extractionLand(tile, player.id))
          .length,
      };
    })
    .sort((a, b) => a.capacity - b.capacity || a.player.id - b.player.id);
  for (const { player, distance, queue } of regions) {
    // Use the camp perimeter first, leaving the interior for ordinary buildings.
    const tie = (tile: number) =>
      Math.imul(tile ^ seed ^ player.id, 1597334677) >>> 0;
    const fullyOwned = new Set(
      queue.filter(
        (tile) =>
          extractionLand(tile, player.id) &&
          Array.from({length: extraction.height}, (_, dy) =>
            Array.from({length: extraction.width}, (_, dx) => tile + dy * map.width() + dx))
            .flat().every(cell => owners[cell] === player.id),
      ),
    );
    const candidates = queue.sort((a, b) => {
      const ownA = fullyOwned.has(a),
        ownB = fullyOwned.has(b);
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
    // Pack the missing extraction sites together. A lattice phase guarantees
    // disjoint extraction reservations, avoiding greedy perimeter choices that strand
    // the final resource in a narrow camp. Choose the best viable phase by
    // the existing proximity/ownership ranking.
    // A cramped island is a valid risky start. Allocate Bronze inputs before
    // optional later-age resources when the complete floor cannot fit.
    const required = ["copper", "tin", "ironOre", "carbon", "stone", "gunpowder", "oil"] as const;
    const reusable = new Map(
      required.flatMap((resource) => {
        const tile = candidates.find(
          (t) =>
            occupied.get(t)?.resource === resource &&
            extractionLand(t, player.id),
        );
        return tile === undefined ? [] : [[resource, tile] as const];
      }),
    );
    const missing = required.length - reusable.size;
    const available = candidates.filter(
      (tile) =>
        !blocked[tile] &&
        extractionLand(tile, player.id) &&
        !occupied.has(tile),
    );
    const rank = new Map(candidates.map((tile, index) => [tile, index]));
    let packed: number[] = [];
    let score = Infinity;
    for (let phaseY = 0; phaseY < extractionSpan; phaseY++)
      for (let phaseX = 0; phaseX < extractionSpan; phaseX++) {
        const sites = available
          .filter(
            (tile) =>
              map.x(tile) % extractionSpan === phaseX &&
              map.y(tile) % extractionSpan === phaseY,
          )
          .sort(
            (a, b) =>
              Number(distance.get(a)! > DEPOSIT_RULES.startingPreferredReach) -
                Number(
                  distance.get(b)! > DEPOSIT_RULES.startingPreferredReach,
                ) || rank.get(a)! - rank.get(b)!,
          )
          .slice(0, missing);
        const cost = sites.reduce(
          (sum, tile) =>
            sum +
            rank.get(tile)! +
            (distance.get(tile)! > DEPOSIT_RULES.startingPreferredReach
              ? candidates.length
              : 0),
          0,
        );
        if (sites.length > packed.length || (sites.length === packed.length && cost < score)) {
          score = cost;
          packed = sites;
        }
      }
    if (packed.length < missing) {
      // Narrow irregular patches may need mixed lattice phases. Search only
      // the local candidate set, with a deterministic finite work budget.
      let visits = 0;
      const search = (
        sites: number[],
        chosen: number[],
      ): number[] | undefined => {
        if (chosen.length === missing) return chosen;
        if (sites.length < missing - chosen.length || ++visits > 100_000)
          return;
        for (let i = 0; i <= sites.length - (missing - chosen.length); i++) {
          const tile = sites[i],
            x = map.x(tile),
            y = map.y(tile);
          const rest = sites
            .slice(i + 1)
            .filter(
              (other) =>
                Math.abs(map.x(other) - x) >= extractionSpan ||
                Math.abs(map.y(other) - y) >= extractionSpan,
            );
          const result = search(rest, [...chosen, tile]);
          if (result) return result;
        }
      };
      const complete = search(
          available
            .slice()
            .sort((a, b) => map.y(a) - map.y(b) || map.x(a) - map.x(b)),
          [],
        );
      if (complete) packed = complete;
      else {
        // Preserve the best partial lattice and use any compatible gaps.
        // Missing resources stay missing; never overlap extraction footprints.
        for (const tile of available) {
          if (packed.length >= missing) break;
          if (packed.every(other => Math.abs(map.x(other)-map.x(tile)) >= extractionSpan ||
            Math.abs(map.y(other)-map.y(tile)) >= extractionSpan)) packed.push(tile);
        }
      }
    }
    // Minerals and oil require spaced buildings; horses are collected by ownership.
    for (const resource of [
      ...required,
      "horses" as const,
    ]) {
      const eligible = (tile: number) =>
        (resource === "horses" ||
          ((!blocked[tile] || occupied.get(tile)?.resource === resource) &&
            extractionLand(tile, player.id))) &&
        (!occupied.has(tile) || occupied.get(tile)!.resource === resource) &&
        (resource === "horses" ||
          Array.from({length: extraction.height}, (_, dy) =>
            Array.from({length: extraction.width}, (_, dx) => tile + dy * map.width() + dx))
            .flat().every(
            (cell) =>
              !occupied.has(cell) || occupied.get(cell)!.resource === "horses",
          ));
      const tile =
        resource === "horses"
          ? candidates.find((t) => eligible(t))
          : (reusable.get(resource) ?? packed.shift());
      if (tile === undefined) continue;
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
  // Preserve compatible world deposits. Reject sites whose occupied patch
  // cannot support their extraction building, or whose reservation intersects
  // the allocated floor or a previously retained random site.
  for (const deposit of deposits) {
    if (
      deposit.resource === "horses" ||
      blocked[deposit.tile] ||
      occupied.has(deposit.tile)
    )
      continue;
    const x = map.x(deposit.tile),
      y = map.y(deposit.tile);
    if (!map.isValidCoord(x + extraction.width - 1, y + extraction.height - 1)) continue;
    const water = map.isWater(deposit.tile);
    if (water && deposit.resource !== "oil") continue;
    let valid = true;
    for (let yy = y; yy < y + extraction.height; yy++)
      for (let xx = x; xx < x + extraction.width; xx++) {
        const cell = map.ref(xx, yy);
        if (
          map.isImpassable(cell) ||
          (water ? !map.isWater(cell) : !map.isLand(cell))
        )
          valid = false;
      }
    if (!valid) continue;
    result.push({ ...deposit, owner: owners[deposit.tile] });
    occupied.set(deposit.tile, deposit);
    reserve(deposit.tile);
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
      boundsOverlap(
        buildingReservationBounds(map, d.tile, "mine"),
        buildingReservationBounds(map, tile, type),
      ),
  )
    ? "Leave room for resource extraction sites"
    : null;
}
