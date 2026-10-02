import type { GameMap } from "../../core/game/GameMap";
import { producerCompatible } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import { resourceTechnology } from "../content/Resources";
import type { LandPaths } from "../Pathfinding";
import type { Building, BuildingType, Player, Squad } from "../Protocol";
import { restoreArray, restoreMap, restoreRecord } from "../StateTransfer";
import { automaticProducer, automaticProduction } from "./AutomaticProduction";
import {
  AGES,
  RESOURCES,
  type Cost,
  type Deposit,
  type Inventory,
  type ProductionJob,
  type ProductionRecipe,
} from "./Definitions";
import { generateDeposits } from "./DepositGeneration";
import type { Progression } from "./Progression";
import { breedingPerSecond, throughputPercent } from "./ResearchEffects";
import { startingResources } from "./StartingResources";
export function productionTicks(
  recipe: ProductionRecipe,
  research: readonly string[],
): number {
  return Math.ceil((recipe.ticks * 100) / throughputPercent(research));
}
export { PRODUCTION_RECIPES, REFINING } from "../content/Production";
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
  checkpoint() {
    return structuredClone({
      inventories: this.inventories,
      jobs: this.jobs,
      deposits: this.deposits,
      goods: this.goods,
      goodsOwners: this.goodsOwners,
      selectedRecipes: this.selectedRecipes,
      priorities: this.priorities,
    });
  }
  restore(saved: ReturnType<Supply["checkpoint"]>): void {
    const state = structuredClone(saved);
    restoreRecord(this.inventories, state.inventories);
    restoreRecord(this.jobs, state.jobs);
    restoreArray(this.deposits, state.deposits);
    restoreMap(this.goods, state.goods);
    restoreMap(this.goodsOwners, state.goodsOwners);
    restoreMap(this.selectedRecipes, state.selectedRecipes);
    restoreRecord(this.priorities, state.priorities ?? {});
  }

  readonly priorities: Record<number, Partial<Record<BuildingType, string[]>>> =
    {};
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
    if (![1, 2, 3, 5].includes(density) || ![1, 2, 3, 5].includes(output))
      throw new Error("Invalid resource rules");
    this.deposits.push(...generateDeposits(map, seed, density, output));
  }
  ensureStartingResources(
    players: readonly Player[],
    owners: Uint8Array,
    paths: LandPaths,
    buildings: readonly Building[],
  ): void {
    const layout = startingResources(
      this.map,
      paths,
      players,
      owners,
      buildings,
      this.deposits,
      this.seed,
      this.output,
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
    if (recipeId === null || recipeId === "auto") {
      if (
        !building ||
        building.playerId !== player.id ||
        building.remainingTicks ||
        (building.health ?? 1) <= 0 ||
        !automaticProducer(building)
      )
        return "Select a completed friendly producer";
      if (recipeId === "auto") this.selectedRecipes.delete(building.id);
      else
        this.selectedRecipes.set(building.id, {
          owner: player.id,
          recipeId: "paused",
        });
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
  setPriorities(
    player: Player,
    buildings: readonly Building[],
    type: BuildingType,
    recipeIds: string[] | null,
  ): string | null {
    const own = buildings.find(
      (b) => b.playerId === player.id && b.type === type && (b.health ?? 1) > 0,
    );
    if (!own || !automaticProducer(own))
      return "Choose an owned production building type";
    if (
      recipeIds !== null &&
      recipeIds.some((id) => {
        const r = PRODUCTION_RECIPES.find((r) => r.id === id);
        return (
          !r ||
          !producerCompatible(type, r.building) ||
          !this.progression.has(player.id, r.technologyId)
        );
      })
    )
      return "Choose researched patterns available to this building type";
    const priorities = (this.priorities[player.id] ??= {});
    if (recipeIds === null) delete priorities[type];
    else priorities[type] = [...new Set(recipeIds)].sort();
    // A type control supersedes legacy per-building repeat/pause commands.
    for (const b of buildings)
      if (b.playerId === player.id && b.type === type)
        this.selectedRecipes.delete(b.id);
    return null;
  }
  resetPriorities(playerId: number): void {
    delete this.priorities[playerId];
    for (const [id, plan] of this.selectedRecipes)
      if (plan.owner === playerId) this.selectedRecipes.delete(id);
  }
  step(
    tick: number,
    players: readonly Player[],
    buildings: readonly Building[],
    owners: Uint8Array,
    squads: readonly Squad[] = [],
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
    const byPlayer = new Map(players.map((p) => [p.id, p]));
    // Automatic jobs have no manual plan, so clean paid work independently.
    for (const [id, job] of Object.entries(this.jobs)) {
      const b = live.get(Number(id));
      if (
        !job ||
        !b ||
        b.playerId !== job.owner ||
        (b.health ?? 1) <= 0 ||
        byPlayer.get(job.owner)?.eliminated
      )
        delete this.jobs[Number(id)];
    }
    for (const b of buildings) {
      const player = byPlayer.get(b.playerId);
      if (
        !player ||
        player.eliminated ||
        b.remainingTicks ||
        (b.health ?? 1) <= 0
      )
        continue;
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
      if (selected && selected.recipeId !== "paused" && !this.jobs[b.id]) {
        const recipe = PRODUCTION_RECIPES.find(
          (r) => r.id === selected.recipeId,
        )!;
        if (
          !productionRejection(
            player.id,
            b,
            recipe,
            this.progression.states[player.id].completed,
          ) &&
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
    if (tick % 20 !== 0) return;
    // Group once per allocation pass; never scan the map or squads per factory.
    const own = new Map<number, Building[]>(),
      counts = new Map<number, number>();
    for (const b of buildings) {
      if (!own.has(b.playerId)) own.set(b.playerId, []);
      own.get(b.playerId)!.push(b);
    }
    for (const squad of squads)
      if (squad.troops > 0)
        counts.set(squad.playerId, (counts.get(squad.playerId) ?? 0) + 1);
    const deposits = new Map(this.deposits.map((d) => [d.tile, d]));
    for (const player of players) {
      if (player.eliminated) continue;
      const buildings = own.get(player.id) ?? [];
      if (!buildings.some(automaticProducer)) continue;
      const incoming: Inventory = {},
        renewable = new Set<string>(),
        busy = new Set<number>();
      for (const b of buildings) {
        const job = this.jobs[b.id];
        if (job) {
          busy.add(b.id);
          const recipe = PRODUCTION_RECIPES.find((r) => r.id === job.recipeId)!;
          for (const [id, n] of Object.entries(recipe.outputs))
            incoming[id] = (incoming[id] ?? 0) + n;
        }
        if (
          b.remainingTicks ||
          (b.health ?? 1) <= 0 ||
          !["mine", "oil-well", "oil-rig"].includes(b.type)
        )
          continue;
        const node = deposits.get(b.tile);
        if (
          node &&
          this.progression.has(player.id, resourceTechnology(node.resource).id)
        )
          renewable.add(node.resource);
      }
      const plans = new Map(
        [...this.selectedRecipes].filter(([, p]) => p.owner === player.id),
      );
      for (const [id, recipeId] of automaticProduction({
        buildings,
        research: this.progression.states[player.id].completed,
        inventory: this.inventories[player.id],
        incoming,
        recipes: PRODUCTION_RECIPES,
        plans,
        busy,
        renewable,
        squadCount: counts.get(player.id) ?? 0,
        priorities: this.priorities[player.id],
        ai: player.ai,
      })) {
        const recipe = PRODUCTION_RECIPES.find((r) => r.id === recipeId)!;
        const inventory = this.inventories[player.id];
        // Manual work has already been paid above. Apply each planned batch
        // through the same spend/job lifecycle, never through a free output path.
        if (costRejection(player, inventory, { items: recipe.inputs }))
          continue;
        spend(player, inventory, { items: recipe.inputs });
        const ticks = productionTicks(
          recipe,
          this.progression.states[player.id].completed,
        );
        this.jobs[id] = {
          recipeId,
          owner: player.id,
          remainingTicks: ticks,
          totalTicks: ticks,
        };
      }
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
