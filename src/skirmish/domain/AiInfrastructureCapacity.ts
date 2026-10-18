import { secondsToTicks, type BuildingType } from "../Protocol";
import {
  producerCompatible,
  productionBuildingType,
} from "../content/Buildings";
import { extractionYieldMultiplier } from "../content/Economy";
import { PRODUCTION_RECIPES } from "../content/Production";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import type { Deposit, Inventory, ProductionRecipe, Resource } from "./Definitions";
import { productionTicks } from "./Supply";

/** A capacity quote, never purchasing credit. Paid output and construction
 * count toward the same five-minute horizon used by military development. */
export const AI_CAPACITY_SECONDS = 300;

export function infrastructureCapacity(
  snapshot: AiEconomicSnapshot,
  demand?: AiProductionDemand,
) {
  const work = new Map<BuildingType, number>();
  const extractionByDeposits = new WeakMap<
    readonly Deposit[],
    Map<string, number>
  >();
  const bootstrap = new Set<BuildingType>();
  const ready = new Set<BuildingType>();
  // Construction on a shared tile is sequential. A paid second foundation
  // cannot contribute as though it starts concurrently with the first.
  const completion = new Map<number, number>();
  const tileDelay = new Map<number, number>();
  for (const building of [...snapshot.buildings].sort((a, b) => a.id - b.id)) {
    if ((building.health ?? 1) <= 0) continue;
    const delay = building.remainingTicks > 0 ? (tileDelay.get(building.tile) ?? 0) + building.remainingTicks : 0;
    if (building.remainingTicks > 0) tileDelay.set(building.tile, delay);
    completion.set(building.id, delay);
  }
  const recipes = PRODUCTION_RECIPES.filter(
    (recipe) =>
      !recipe.manualOnly && snapshot.research.includes(recipe.technologyId),
  );
  const byOutput = new Map<string, ProductionRecipe>();
  const funded = new Map<BuildingType, number>();
  for (const recipe of recipes)
    for (const item of Object.keys(recipe.outputs)) byOutput.set(item, recipe);
  for (const type of new Set(
    recipes.map((recipe) =>
      productionBuildingType(recipe.building, snapshot.age, snapshot.research),
    ),
  )) {
    funded.set(
      type,
      snapshot.buildings
        .filter(
          (building) =>
            (building.health ?? 1) > 0 &&
            producerCompatible(building.type, type),
        )
        .reduce(
          (ticks, building) =>
            ticks +
            Math.max(
              0,
              secondsToTicks(AI_CAPACITY_SECONDS) - (completion.get(building.id) ?? 0),
            ),
          0,
        ),
    );
  }
  const unavailable = new Set(
    demand?.bottlenecks
      ?.filter((b) => b.reason === "resource" || b.reason === "research")
      .map((b) => b.item),
  );
  const wanted = (item: string) =>
    (demand?.equipment[item] ?? 0) + (demand?.materials[item] ?? 0);
  const shortage = (item: string) =>
    Math.max(
      0,
      wanted(item) -
        (snapshot.liquid.items?.[item] ?? 0) -
        (snapshot.incoming[item] ?? 0),
    );
  // Recipes have one canonical automatic producer per output. Include each
  // recipe once so a multi-output batch is not charged once for every output.
  for (const recipe of recipes) {
    const batches = Math.max(
      0,
      ...Object.entries(recipe.outputs).map(([item, count]) =>
        Math.ceil(shortage(item) / count),
      ),
    );
    const type = productionBuildingType(
      recipe.building,
      snapshot.age,
      snapshot.research,
    );
    if (
      batches &&
      Object.entries(recipe.inputs).every(
        ([item, amount]) => (snapshot.liquid.items?.[item] ?? 0) >= amount,
      )
    )
      ready.add(type);
    if (
      batches &&
      [...Object.keys(recipe.outputs), ...Object.keys(recipe.inputs)].some(
        (item) => unavailable.has(item),
      )
    ) {
      // Extra production lines cannot repair explicitly unavailable inputs.
      // Preserve one bootstrap workshop and the intended equipment demand.
      bootstrap.add(type);
      continue;
    }
    work.set(
      type,
      (work.get(type) ?? 0) +
        batches * productionTicks(recipe, snapshot.research),
    );
  }
  // A full stock goal is not permission to mine inputs that the already-paid
  // downstream chain cannot process. Carry the tightest funded capacity ratio
  // through the dependency path; multiplying ratios would count the same
  // bottleneck repeatedly. Raw resources spent directly by recruits stay roots.
  const rawConsumption: Inventory = {};
  const derivedMaterials: Inventory = {};
  let visits = 0;
  const consume = (
    item: string,
    amount: number,
    ratio: number,
    seen: ReadonlySet<string>,
  ) => {
    if (++visits > 256 || seen.size >= 8 || seen.has(item)) return;
    const recipe = byOutput.get(item);
    if (!recipe) {
      rawConsumption[item] = (rawConsumption[item] ?? 0) + amount * ratio;
      return;
    }
    const type = productionBuildingType(
      recipe.building,
      snapshot.age,
      snapshot.research,
    );
    const nextRatio = Math.min(
      ratio,
      (funded.get(type) ?? 0) / Math.max(1, work.get(type) ?? 0),
      1,
    );
    const batches = Math.ceil(
      Math.max(
        0,
        amount -
          (snapshot.liquid.items?.[item] ?? 0) -
          (snapshot.incoming[item] ?? 0),
      ) / recipe.outputs[item],
    );
    const next = new Set(seen);
    next.add(item);
    for (const [input, quantity] of Object.entries(recipe.inputs)) {
      derivedMaterials[input] =
        (derivedMaterials[input] ?? 0) + batches * quantity;
      consume(input, batches * quantity, nextRatio, next);
    }
  };
  for (const [item, amount] of Object.entries(demand?.equipment ?? {}))
    consume(item, amount, 1, new Set());
  const depth = (
    item: string,
    seen: ReadonlySet<string> = new Set(),
  ): number => {
    if (seen.has(item) || seen.size >= 8) return 0;
    const recipe = byOutput.get(item);
    if (!recipe) return 0;
    const next = new Set(seen);
    next.add(item);
    return (
      1 +
      Math.max(
        0,
        ...Object.keys(recipe.inputs).map((input) => depth(input, next)),
      )
    );
  };
  // Defence and other direct material requests may accompany equipment. Add
  // only their residual roots, processing parents before their dependencies,
  // so an expanded steel request does not count its iron and ore a second time.
  for (const [item, amount] of Object.entries(demand?.materials ?? {}).sort(
    ([a], [b]) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0),
  )) {
    const extra = Math.max(0, amount - (derivedMaterials[item] ?? 0));
    if (extra) consume(item, extra, 1, new Set());
  }
  const extractionQuote = (resource: Resource, deposits: readonly Deposit[]) => {
    const held = (snapshot.liquid.items?.[resource] ?? 0) + (snapshot.incoming[resource] ?? 0);
    const target = wanted(resource);
    let extraction = extractionByDeposits.get(deposits);
    if (!extraction) {
      extraction = new Map();
      const byTile = new Map(deposits.map((source) => [source.tile, source]));
      for (const building of snapshot.buildings) {
        if (!["mine", "oil-well", "oil-rig"].includes(building.type) || (building.health ?? 1) <= 0) continue;
        const source = byTile.get(building.tile);
        if (!source) continue;
        const output = source.yieldPerSecond * extractionYieldMultiplier(building.age ?? "StoneAge") *
          Math.max(0, AI_CAPACITY_SECONDS - (completion.get(building.id) ?? 0) / secondsToTicks(1));
        extraction.set(source.resource, (extraction.get(source.resource) ?? 0) + output);
      }
      extractionByDeposits.set(deposits, extraction);
    }
    const forecast = extraction.get(resource) ?? 0;
    const required = forecast > 0 ? Math.min(target, rawConsumption[resource] ?? 0) : target;
    const shortage = Math.max(0, required - held - forecast);
    return { target, held, required, forecast, shortage, needed: shortage > 0 };
  };
  return {
    extractionQuote,
    processingReady(type: BuildingType) {
      return ready.has(type);
    },
    workshops: new Map(
      [...new Set([...work.keys(), ...bootstrap])].map((type) => [
        type,
        Math.max(
          bootstrap.has(type) ? 1 : 0,
          Math.ceil(
            (work.get(type) ?? 0) / secondsToTicks(AI_CAPACITY_SECONDS),
          ),
        ),
      ]),
    ),
    extractionNeeded(deposit: Deposit, deposits: readonly Deposit[]) {
      return extractionQuote(deposit.resource, deposits).needed;
    },
  };
}
