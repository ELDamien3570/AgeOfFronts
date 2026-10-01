import { generateDeposits } from "./DepositGeneration";
import { startingResources } from "./StartingResources";
import type { LandPaths } from "../Pathfinding";
import { restoreArray, restoreMap, restoreRecord } from "../StateTransfer";
import type { GameMap } from "../../core/game/GameMap";
import type { Building, Player } from "../Protocol";
import { producerCompatible } from "../content/Buildings";
import { resourceTechnology } from "../content/Resources";
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
} from "./Definitions";
import type { Progression } from "./Progression";
import { breedingPerSecond, throughputPercent } from "./ResearchEffects";
export function productionTicks(
  recipe: ProductionRecipe,
  research: readonly string[],
): number {
  return Math.ceil((recipe.ticks * 100) / throughputPercent(research));
}
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
  checkpoint() { return structuredClone({inventories:this.inventories, jobs:this.jobs, deposits:this.deposits, goods:this.goods, goodsOwners:this.goodsOwners, selectedRecipes:this.selectedRecipes}); }
  restore(saved: ReturnType<Supply["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreRecord(this.inventories,state.inventories);
    restoreRecord(this.jobs,state.jobs);
    restoreArray(this.deposits,state.deposits);
    restoreMap(this.goods,state.goods);
    restoreMap(this.goodsOwners,state.goodsOwners);
    restoreMap(this.selectedRecipes,state.selectedRecipes);

  }

  readonly inventories: Record<number, Inventory> = {};
  readonly jobs: Record<number, ProductionJob | undefined> = {};
  readonly deposits: Deposit[] = [];
  readonly goods = new Map<number, number>();
  private readonly goodsOwners = new Map<number, number>();
  private readonly selectedRecipes = new Map<
    number,
    { owner: number; recipeId: string }
  >();
  productionPlans(): Record<number, { owner: number; recipeId: string }> {
    return Object.fromEntries(
      [...this.selectedRecipes].map(([id, plan]) => [id, { ...plan }]),
    );
  }
  constructor(
    private readonly map: GameMap,
    private readonly progression: Progression,
    private readonly seed: number,
    density: 1 | 2 | 3 | 5 = 1,
    private readonly output: 1 | 2 | 3 | 5 = 1,
  ) {
    if (![1,2,3,5].includes(density) || ![1,2,3,5].includes(output)) throw new Error("Invalid resource rules");
    this.deposits.push(...generateDeposits(map, seed, density, output));
  }
  ensureStartingResources(
    players: readonly Player[],
    owners: Uint8Array,
    paths: LandPaths,
    buildings: readonly Building[],
  ): void {
    const layout = startingResources(
      this.map, paths, players, owners, buildings, this.deposits, this.seed, this.output,
    );
    this.deposits.splice(0, this.deposits.length, ...layout);
  }
  add(playerId: number): void {
    this.inventories[playerId] = Object.fromEntries(
      RESOURCES.map((r) => [r, 0]),
    );
  }
  setProduction(
    player: Player,
    building: Building | undefined,
    recipeId: string | null,
  ): string | null {
    if (recipeId === null) {
      if (
        !building ||
        building.playerId !== player.id ||
        building.remainingTicks
      )
        return "Select a completed friendly producer";
      this.selectedRecipes.delete(building.id);
      return null; // An already paid batch still finishes normally.
    }
    const recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId);
    const rejection = productionRejection(
      player.id,
      building,
      recipe,
      this.progression.states[player.id].completed,
    );
    if (rejection) return rejection;
    this.selectedRecipes.set(building!.id, { owner: player.id, recipeId });
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
          const ticks = productionTicks(
            recipe,
            this.progression.states[player.id].completed,
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
        this.progression.has(player.id, resourceTechnology("horses").id)
      )
        inventory.horses +=
          breedingPerSecond(this.progression.states[player.id].completed) ||
          (tick % 80 === 0 ? 1 : 0);
      if (b.type === "mine" || b.type === "oil-well" || b.type === "oil-rig") {
        const node = this.deposits.find((d) => d.tile === b.tile);
        if (
          node &&
          node.resource !== "horses" &&
          this.progression.has(player.id, resourceTechnology(node.resource).id)
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
        this.progression.has(node.owner, resourceTechnology("horses").id)
      )
        this.inventories[node.owner].horses += node.yieldPerSecond;
    }
  }
}
export function productionRejection(
  playerId: number,
  building: Building | undefined,
  recipe: ProductionRecipe | undefined,
  completed: readonly string[],
): string | null {
  if (
    !building ||
    building.playerId !== playerId ||
    building.remainingTicks ||
    (building.health ?? 1) <= 0
  )
    return "Needs a completed owned producer";
  if (!recipe || !producerCompatible(building.type, recipe.building))
    return "This producer cannot make that recipe";
  if (!completed.includes(recipe.technologyId))
    return "Research this production pattern first";
  return null;
}
