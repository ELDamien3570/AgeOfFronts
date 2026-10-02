import type { GameMap } from "../../core/game/GameMap";
import { BuildingIndex } from "../BuildingIndex";
import { constructionRejection } from "../Construction";
import type { Building, BuildingType, Player } from "../Protocol";
import { buildingCost, buildingTicks } from "../content/Buildings";
import type { Age, Cost, Inventory } from "./Definitions";
import type { Diplomacy } from "./Diplomacy";
import { Fortifications } from "./Fortifications";
import type { ResourceSiteIndex } from "./ResourceSiteIndex";

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
  fortifications: Fortifications;
  diplomacy: Diplomacy;
  resources: ResourceSiteIndex;
  sites: readonly AiDefenseSite[];
  allowedWall?: (tile: number) => boolean;
}): AiDefenseQuote | string {
  if (input.sites.length > 32) return "Defense candidate exceeds site budget";
  const buildings = input.buildings.map((b) => ({ ...b })),
    index = new BuildingIndex(input.map),
    forts = new Fortifications(input.map, input.diplomacy),
    steps: AiDefenseStep[] = [],
    items: Inventory = {},
    cost: Cost = { gold: 0, items };
  forts.restore(input.fortifications.checkpoint());
  let nextId = buildings.reduce((n, b) => Math.max(n, b.id), 0) + 1,
    totalTicks = 0;
  index.rebuild(buildings);
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
    if (forts.blocked(site.tile, input.player.id))
      return "Intact wall occupies defense site";
    const count = index.countOfType(input.player.id, site.type),
      stepCost = buildingCost(site.type, input.age, count),
      ticks = buildingTicks(site.type, count),
      plan =
        site.type === "tower"
          ? forts.towerPlan(site.tile, input.player.id, input.age, {
              at: (tile) => index.at(tile),
              nearby: (tile, radius) => index.towersNearby(tile, radius),
            })
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
    buildings.push(building);
    index.add(building);
    if (site.type === "tower") forts.addTower(building, plan);
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
