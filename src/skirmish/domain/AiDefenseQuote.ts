import type { GameMap } from "../../core/game/GameMap";
import { BuildingIndex, type BuildingQueries } from "../BuildingIndex";
import { constructionRejection } from "../Construction";
import type { Building, BuildingType, Player } from "../Protocol";
import { buildingCost, buildingTicks } from "../content/Buildings";
import type { Age, Cost, Inventory } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import type { Fortifications } from "./Fortifications";
import type { ResourceSiteIndex } from "./ResourceSiteIndex";
import { quoteTowerPlan } from "./TowerPlacement";

export interface AiDefenseSite {
  type: BuildingType;
  tile: number;
}
export interface AiDefenseStep extends AiDefenseSite {
  cost: Cost;
  ticks: number;
  earliestStart: number;
  links: { a: number; tiles: number[] }[];
}
export interface AiDefenseQuote {
  steps: AiDefenseStep[];
  cost: Cost;
  ticks: number;
}

/** Scratch construction uses the production wall planner and count scaling.
 * Every step waits for its predecessor to finish; unfinished hypothetical
 * towers never accidentally claim links that construction cannot produce.
 */
export function quoteAiDefense(input: {
  map: GameMap;
  owners: Uint8Array;
  player: Player;
  age: Age;
  buildings: readonly Building[];
  buildingFacts?: BuildingQueries;
  fortifications: Fortifications;
  diplomacy: Diplomacy;
  resources: ResourceSiteIndex;
  sites: readonly AiDefenseSite[];
  allowedWall?: (tile: number) => boolean;
}): AiDefenseQuote | string {
  if (input.sites.length > 32) return "Defense candidate exceeds site budget";
  let live = input.buildingFacts;
  if (!live) {
    const rebuilt = new BuildingIndex(input.map);
    rebuilt.rebuild(input.buildings);
    live = rebuilt;
  }
  const base = live,
    additions = new BuildingIndex(input.map),
    walls = new Set<number>();
  const index = {
    at(tile: number): readonly Building[] {
      const original = base.at(tile),
        extra = additions.at(tile);
      return !extra.length
        ? original
        : !original.length
          ? extra
          : [...original, ...extra];
    },
    *nearby(tile: number, radius: number) {
      yield* base.nearby(tile, radius);
      yield* additions.nearby(tile, radius);
    },
    *towersNearby(tile: number, radius: number) {
      yield* base.towersNearby(tile, radius);
      yield* additions.towersNearby(tile, radius);
    },
    countOfType(owner: number, type: BuildingType) {
      return base.countOfType(owner, type) + additions.countOfType(owner, type);
    },
  };
  const steps: AiDefenseStep[] = [],
    items: Inventory = {},
    cost: Cost = { gold: 0, items };
  let nextId = base.highestId + 1,
    totalTicks = 0;
  for (const site of input.sites) {
    if (!["tower", "trench", "gun-nest"].includes(site.type))
      return "Unsupported defense site";
    const rejected =
      constructionRejection(
        input.map,
        input.owners,
        index,
        input.player,
        site.type,
        site.tile,
        false,
      ) ?? input.resources.rejection(site.type, site.tile);
    if (rejected) return rejected;
    if (input.fortifications.blocked(site.tile, input.player.id))
      return "Intact wall occupies defense site";
    const count = index.countOfType(input.player.id, site.type),
      stepCost = buildingCost(site.type, input.age, count),
      ticks = buildingTicks(site.type, count),
      plan =
        (site.type === "tower" || site.type === "trench")
          ? quoteTowerPlan(
              input.map,
              site.tile,
              input.player.id,
              input.age,
              {
                at: (tile) => index.at(tile),
                nearby: (tile, radius) => site.type === "tower" ? index.towersNearby(tile, radius) : index.nearby(tile, radius),
              },
              (tile) =>
                walls.has(tile) || input.fortifications.barriersAt(tile).some(b => b.health > 0) ||
                (site.type === "trench" && input.owners[tile] !== input.player.id),
              site.type,
            )
          : { links: [], gold: 0 };
    if (
      input.allowedWall &&
      plan.links.some((link) =>
        link.tiles.some((tile) => !input.allowedWall!(tile)),
      )
    )
      return "Automatic tower link leaves planned perimeter";
    stepCost.gold = (stepCost.gold ?? 0) + plan.gold;
    steps.push({
      ...site,
      cost: stepCost,
      ticks,
      earliestStart: totalTicks,
      links: plan.links,
    });
    cost.gold! += stepCost.gold;
    for (const [id, n] of Object.entries(stepCost.items ?? {}))
      items[id] = (items[id] ?? 0) + n;
    totalTicks += Math.max(20, ticks);
    const building: Building = {
      ...site,
      id: nextId++,
      playerId: input.player.id,
      age: input.age,
      type: site.type,
      remainingTicks: 0,
    };
    additions.add(building);
    for (const link of plan.links)
      for (const tile of link.tiles) walls.add(tile);
  }
  return { steps, cost, ticks: totalTicks };
}

/** Four corners are retained; intermediate side gaps are evenly distributed. */
export function rectangularDefensePerimeter(
  map: GameMap,
  bounds: { left: number; top: number; right: number; bottom: number },
): number[] | null {
  const { left, top, right, bottom } = bounds;
  if (
    ![left, top, right, bottom].every(Number.isInteger) ||
    right - left < 3 ||
    bottom - top < 3 ||
    !map.isValidCoord(left, top) ||
    !map.isValidCoord(right, bottom)
  )
    return null;
  const corners = [
      [left, top],
      [right, top],
      [right, bottom],
      [left, bottom],
    ],
    tiles: number[] = [];
  for (let side = 0; side < 4; side++) {
    const [x, y] = corners[side],
      [ex, ey] = corners[(side + 1) % 4],
      length = Math.abs(ex - x) + Math.abs(ey - y),
      pieces = Math.ceil(length / 12);
    // Minimum spacing is the same three-tile separate-site construction rule.
    if (length / pieces < 3) return null;
    for (let part = 0; part < pieces; part++)
      tiles.push(
        map.ref(
          x + Math.round(((ex - x) * part) / pieces),
          y + Math.round(((ey - y) * part) / pieces),
        ),
      );
  }
  return tiles;
}
