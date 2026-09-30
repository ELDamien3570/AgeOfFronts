import type { GameMap } from "../../core/game/GameMap";
import type { Building, Player } from "../Protocol";
import { producerCompatible } from "../content/Buildings";
import { technologyAt } from "../content/Technology";
import { RECIPES } from "../content/Units";
import {
  AGES,
  RESOURCES,
  type Cost,
  type Deposit,
  type Inventory,
  type ProductionJob,
  type ProductionRecipe,
  type Resource,
} from "./Definitions";
import type { Progression } from "./Progression";
import { breedingPerSecond, throughputPercent } from "./ResearchEffects";
const raws: readonly Resource[] = [
  "horses",
  "stone",
  "copper",
  "tin",
  "ironOre",
  "carbon",
  "sulphur",
  "nitrate",
  "oil",
];
const unlock = (r: Resource): string =>
  r === "horses"
    ? technologyAt("StoneAge", "warfare", 3).id
    : r === "stone"
      ? technologyAt("StoneAge", "economic", 3).id
      : r === "copper" || r === "tin"
        ? technologyAt("BronzeAge", "economic", 1).id
        : r === "ironOre"
          ? technologyAt("ClassicalAge", "economic", 1).id
          : r === "carbon"
            ? technologyAt("LateMedieval", "economic", 1).id
            : r === "sulphur" || r === "nitrate"
              ? technologyAt("LateMedieval", "economic", 2).id
              : technologyAt("Modern", "economic", 1).id;
export const REFINING: ProductionRecipe[] = [
  {
    id: "refine-bronze",
    name: "Smelt bronze",
    technologyId: technologyAt("BronzeAge", "economic", 1).id,
    building: "factory",
    inputs: { copper: 8, tin: 2 },
    outputs: { bronze: 10 },
    ticks: 200,
  },
  {
    id: "refine-iron",
    name: "Smelt iron",
    technologyId: technologyAt("ClassicalAge", "economic", 1).id,
    building: "factory",
    inputs: { ironOre: 10 },
    outputs: { iron: 10 },
    ticks: 200,
  },
  {
    id: "refine-steel",
    name: "Make steel",
    technologyId: technologyAt("LateMedieval", "economic", 1).id,
    building: "factory",
    inputs: { iron: 8, carbon: 2 },
    outputs: { steel: 10 },
    ticks: 240,
  },
  {
    id: "refine-gunpowder",
    name: "Mill gunpowder",
    technologyId: technologyAt("LateMedieval", "economic", 2).id,
    building: "factory",
    inputs: { nitrate: 6, sulphur: 2, carbon: 2 },
    outputs: { gunpowder: 10 },
    ticks: 200,
  },
  ...["icbm", "hydrogen", "mirv"].map((name, i) => ({
    id: `make-${name}`,
    name: `${name.toUpperCase()} payload`,
    technologyId: technologyAt("Modern", "warfare", 4).id,
    building: "arms-factory" as const,
    inputs: {
      steel: 200 + i * 100,
      gunpowder: 150 + i * 100,
      oil: 100 + i * 50,
    },
    outputs: { [`payload:${name}`]: 1 },
    ticks: 2400 + i * 600,
  })),
  ...["fighter", "bomber"].map((name) => ({
    id: `make-${name}`,
    name: `${name} airframe`,
    technologyId: technologyAt("Modern", "warfare", 3).id,
    building: "arms-factory" as const,
    inputs: { steel: 40, gunpowder: 20, oil: 20 },
    outputs: { [`equipment:${name}`]: 1 },
    ticks: 600,
  })),
];
export const PRODUCTION_RECIPES = [...REFINING, ...RECIPES];
export function costRejection(
  player: Pick<Player, "gold" | "reserves">,
  inventory: Inventory,
  cost: Cost,
): string | null {
  if (player.gold < (cost.gold ?? 0)) return "Not enough gold";
  if (player.reserves < (cost.reserves ?? 0))
    return "Not enough reserve troops";
  for (const [item, amount] of Object.entries(cost.items ?? {}))
    if ((inventory[item] ?? 0) < amount)
      return `Needs ${amount} ${item.replace(/^equipment:|^payload:/, "")}`;
  return null;
}
export function spend(player: Player, inventory: Inventory, cost: Cost): void {
  player.gold -= cost.gold ?? 0;
  player.reserves -= cost.reserves ?? 0;
  for (const [item, amount] of Object.entries(cost.items ?? {}))
    inventory[item] = (inventory[item] ?? 0) - amount;
}
export class Supply {
  readonly inventories: Record<number, Inventory> = {};
  readonly jobs: Record<number, ProductionJob | undefined> = {};
  readonly deposits: Deposit[] = [];
  readonly goods = new Map<number, number>();
  private readonly goodsOwners = new Map<number, number>();
  private readonly selectedRecipes = new Map<
    number,
    { owner: number; recipeId: string }
  >();
  constructor(
    private readonly map: GameMap,
    private readonly progression: Progression,
    seed: number,
  ) {
    let n = 1;
    for (let tile = 0; tile < map.width() * map.height(); tile++) {
      let hash = Math.imul(tile ^ seed, 1597334677) >>> 0;
      hash = Math.imul(hash ^ (hash >>> 16), 2246822519) >>> 0;
      if (hash % 700 !== 0 || map.isImpassable(tile)) continue;
      const resource = raws[(hash >>> 10) % raws.length];
      if (!map.isLand(tile) && !(map.isWater(tile) && resource === "oil"))
        continue;
      this.deposits.push({
        id: n++,
        tile,
        resource,
        owner: 0,
        yieldPerSecond: resource === "horses" ? 2 : 3,
      });
    }
    // Tiny test scenarios still have deterministic sources; real maps use the
    // seeded distribution rather than terrain colours or identical home grants.
    if (map.width() * map.height() < 20000)
      for (const [i, resource] of raws.entries()) {
        if (this.deposits.some((d) => d.resource === resource)) continue;
        const land = Array.from(
          { length: map.width() * map.height() },
          (_, t) => t,
        ).filter((t) => map.isLand(t) && !map.isImpassable(t));
        if (land.length)
          this.deposits.push({
            id: n++,
            tile: land[Math.floor(((i + 1) * land.length) / (raws.length + 1))],
            resource,
            owner: 0,
            yieldPerSecond: resource === "horses" ? 2 : 3,
          });
      }
  }
  add(playerId: number): void {
    this.inventories[playerId] = Object.fromEntries(
      RESOURCES.map((r) => [r, 0]),
    );
  }
  setProduction(
    player: Player,
    building: Building | undefined,
    recipeId: string,
  ): string | null {
    const recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId);
    if (!building || building.playerId !== player.id || building.remainingTicks)
      return "Needs a completed owned producer";
    if (!recipe || !producerCompatible(building.type, recipe.building))
      return "This producer cannot make that recipe";
    if (!this.progression.has(player.id, recipe.technologyId))
      return "Research this production pattern first";
    this.selectedRecipes.set(building.id, { owner: player.id, recipeId });
    return null;
  }
  step(
    tick: number,
    players: readonly Player[],
    buildings: readonly Building[],
    owners: Uint8Array,
  ): void {
    const live = new Map(buildings.map((b) => [b.id, b]));
    for (const [id, owner] of this.goodsOwners)
      if (!live.has(id) || live.get(id)!.playerId !== owner) {
        this.goods.delete(id);
        this.goodsOwners.delete(id);
      }
    for (const [id, selected] of this.selectedRecipes)
      if (!live.has(id) || live.get(id)!.playerId !== selected.owner) {
        this.selectedRecipes.delete(id);
        delete this.jobs[id];
      }
    for (const b of buildings) {
      const player = players.find((p) => p.id === b.playerId);
      if (!player || player.eliminated || b.remainingTicks) continue;
      const inventory = this.inventories[player.id],
        job = this.jobs[b.id];
      if (job && --job.remainingTicks <= 0) {
        const recipe = PRODUCTION_RECIPES.find((r) => r.id === job.recipeId)!;
        if (job.owner === b.playerId)
          for (const [item, amount] of Object.entries(recipe.outputs))
            inventory[item] = (inventory[item] ?? 0) + amount;
        delete this.jobs[b.id];
      }
      const selected = this.selectedRecipes.get(b.id);
      if (selected && !this.jobs[b.id]) {
        const recipe = PRODUCTION_RECIPES.find(
          (r) => r.id === selected.recipeId,
        )!;
        if (
          this.progression.has(player.id, recipe.technologyId) &&
          !costRejection(player, inventory, { items: recipe.inputs })
        ) {
          spend(player, inventory, { items: recipe.inputs });
          const ticks = Math.ceil(
            (recipe.ticks * 100) /
              throughputPercent(this.progression.states[player.id].completed),
          );
          this.jobs[b.id] = {
            recipeId: recipe.id,
            remainingTicks: ticks,
            totalTicks: ticks,
            owner: player.id,
          };
        }
      }
      if (tick % 20 !== 0) continue;
      const index = AGES.indexOf(b.age ?? "StoneAge");
      if (b.type === "factory") {
        this.goodsOwners.set(b.id, player.id);
        this.goods.set(
          b.id,
          Math.min(1000, (this.goods.get(b.id) ?? 0) + 2 * (index + 1)),
        );
      }
      if (
        b.type === "stables" &&
        this.progression.has(player.id, unlock("horses"))
      )
        inventory.horses +=
          breedingPerSecond(this.progression.states[player.id].completed) ||
          (tick % 80 === 0 ? 1 : 0);
      if (b.type === "mine" || b.type === "oil-well" || b.type === "oil-rig") {
        const node = this.deposits.find((d) => d.tile === b.tile);
        if (
          node &&
          node.resource !== "horses" &&
          this.progression.has(player.id, unlock(node.resource))
        )
          inventory[node.resource] +=
            node.yieldPerSecond * (1 + Math.floor(index / 2));
      }
    }
    for (const node of this.deposits) {
      node.owner = owners[node.tile];
      if (
        tick % 20 === 0 &&
        node.owner &&
        node.resource === "horses" &&
        this.progression.has(node.owner, unlock("horses"))
      )
        this.inventories[node.owner].horses += node.yieldPerSecond;
    }
  }
}
