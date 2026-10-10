import type { Building, BuildingType } from "../Protocol";
import { producerCompatible } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import { TECHNOLOGY } from "../content/Technology";
import type { AiProductionDemand } from "./AiMilitaryDemand";
import { AGES, type Inventory, type ProductionRecipe } from "./Definitions";

export interface ProductionPlan {
  owner: number;
  recipeId: string;
}

export interface AutomaticProductionContext {
  buildings: readonly Building[];
  research: readonly string[];
  inventory: Inventory;
  incoming: Inventory;
  recipes: readonly ProductionRecipe[];
  plans: ReadonlyMap<number, ProductionPlan>;
  busy: ReadonlySet<number>;
  /** Resources with a completed, researched extractor (or a horse deposit). */
  renewable: ReadonlySet<string>;
  squadCount: number;
  ai: boolean;
  priorities?: Partial<Record<BuildingType, readonly string[]>>;
  aiDemand?: AiProductionDemand;
  protectedInputs?: Inventory;
}

export const automaticProducer = (building: Building) =>
  [
    "factory",
    "blacksmith",
    "armory",
    "arms-factory",
    "nuclear-facility",
    "siege-workshop",
    "depot",
  ].includes(building.type);

const equipmentKind = (recipe: ProductionRecipe) => {
  const item = Object.keys(recipe.outputs)[0];
  return !item.startsWith("equipment:")
    ? null
    : item.endsWith("-vehicle")
      ? "vehicle"
      : item.endsWith("-siege")
        ? "siege"
        : "troop";
}
const rank = (recipe: ProductionRecipe) =>
  AGES.indexOf(TECHNOLOGY.get(recipe.technologyId)!.age)
const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Age-based button highlights; material availability only affects actual jobs. */
export function automaticProductionPriorities(type: BuildingType,
  research: readonly string[],
): string[] {
  const available = PRODUCTION_RECIPES.filter(
    (r) =>
      producerCompatible(type, r.building) &&
      !r.manualOnly &&
      research.includes(r.technologyId) &&
      !Object.keys(r.outputs)[0].startsWith("payload:"),
  ).sort((a, b) => rank(b) - rank(a) || compareId(a.id, b.id));
  const groups = new Set<string>()
  return available
    .filter((r) => {
      const group = equipmentKind(r) ?? "metal";
      if (groups.has(group)) return false;
      groups.add(group);
      return true;
    })
    .map((r) => r.id);
}

/**
 * Plan once per second, per player. Pure and checkpoint-independent: stock plus
 * already-paid output determines fairness, never array order or wall time.
 * Targets are recruit/refit kits, not equal piles of differently priced goods.
 */
export function automaticProduction(
  context: AutomaticProductionContext,
): Map<number, string> {
  const {
    buildings,
    research,
    inventory,
    incoming,
    recipes,
    plans,
    busy,
    renewable,
    squadCount,
    priorities = {},
  } = context
  const completed = new Set(research)
  const own = [...buildings]
    .filter(
      (b) => !b.remainingTicks && (b.health ?? 1) > 0 && automaticProducer(b),
    )
    .sort((a, b) => a.id - b.id)
  const automatic = own.filter((b) => !plans.has(b.id))
  // Keep flexible higher-tier workshops available for recipes that only they
  // can make; IDs still break ties deterministically within each capability.
  const capability = (type: BuildingType) =>
    type === "arms-factory" ? 2 : type === "armory" ? 1 : 0
  const byCapability = [...automatic].sort(
    (a, b) => capability(a.type) - capability(b.type) || a.id - b.id,
  )
  const available = recipes.filter(
    (r) => completed.has(r.technologyId) &&
      (!r.manualOnly ||
        Object.values(priorities).some((ids) => ids?.includes(r.id))),
  );
  // Selected refining patterns retain their upstream dependencies (steel needs
  // iron), while other manually excluded patterns stay excluded.
  const allowed = new Map<BuildingType, Set<string>>()
  for (const b of own) {
    const selected = priorities[b.type];
    if (selected === undefined || allowed.has(b.type)) continue;
    const ids = new Set(selected);
    if (b.type === "factory") {
      for (const id of ids) {
        const r = available.find((r) => r.id === id);
        if (r)
          for (const input of Object.keys(r.inputs)) {
            const upstream = available.find(
              (r) => r.building === "factory" && r.outputs[input],
            );
            if (upstream) ids.add(upstream.id);
          }
      }
    }
    allowed.set(b.type, ids);
  }
  const defaultsByType = new Map<BuildingType, Set<string>>()
  const compatible = (b: Building, r: ProductionRecipe) =>
    producerCompatible(b.type, r.building) &&
    (!allowed.has(b.type) || allowed.get(b.type)!.has(r.id)) &&
    (!equipmentKind(r) ||
      !defaultsByType.has(b.type) ||
      defaultsByType.get(b.type)!.has(r.id))
  const canProduce = (r: ProductionRecipe) =>
    own.some(
      (b) =>
        producerCompatible(b.type, r.building) &&
        (plans.has(b.id)
          ? plans.get(b.id)!.recipeId === r.id
          : compatible(b, r)),
    )
  const automaticRecipes = available.filter((r) =>
    automatic.some((b) => compatible(b, r)),
  )
  const smelting = available
    .filter((r) => r.building === "factory" && canProduce(r))
    .sort((a, b) => rank(b) - rank(a) || compareId(a.id, b.id))
  const refiners = new Map(
    smelting.flatMap((r) =>
      Object.keys(r.outputs).map((id) => [id, r] as const),
    ),
  )
  const held = (id: string) => (inventory[id] ?? 0) + (incoming[id] ?? 0)
  // Avoid reserving iron for steel forever when carbon cannot be obtained. A
  // finite affordable batch is valid too; no free inputs or speculative credit.
  const sustainable = (r: ProductionRecipe, depth = 0): boolean =>
    depth < 8 &&
    Object.entries(r.inputs).every(([id, n]) => {
      if (held(id) >= n || renewable.has(id)) return true;
      const upstream = refiners.get(id);
      return !!upstream && sustainable(upstream, depth + 1);
    })

  // A type's controls govern that type only: another group's Bronze override
  // must not commandeer an automatic Modern arms factory after its buffer fills.
  for (const b of automatic) {
    if (priorities[b.type] !== undefined || defaultsByType.has(b.type))
      continue;
    const selected = new Set<string>();
    for (const kind of ["troop", "siege", "vehicle"] as const) {
      const candidates = available
        .filter(
          (r) =>
            producerCompatible(b.type, r.building) && equipmentKind(r) === kind,
        )
        .sort((a, b) => rank(b) - rank(a) || compareId(a.id, b.id));
      const recipe =
        candidates.find(
          (r) =>
            Object.keys(r.outputs).some((id) => held(id) > 0) || sustainable(r),
        ) ?? candidates[0];
      if (recipe) selected.add(recipe.id);
    }
    defaultsByType.set(b.type, selected);
  }

  const targets = new Map<ProductionRecipe, number>()
  const continuous = new Set<ProductionRecipe>()
  const troopCapacity = automatic.filter((b) => ["blacksmith", "armory", "arms-factory"].includes(b.type),
  ).length;
  // Keep several batches per workshop ready for a human recruitment/refit burst.
  // AI demand below replaces these buffers with its exact economic quote.
  const troopTarget = Math.min(180, Math.max(12, troopCapacity * 3, Math.ceil(squadCount / 3)))
  const vehicleTarget = Math.min(6, Math.max(2, Math.ceil(squadCount / 12)))
  const siegeTarget = Math.min(4, Math.max(2, Math.ceil(squadCount / 16)))
  for (const kind of ["troop", "vehicle", "siege"] as const) {
    const candidates = automaticRecipes
      .filter((r) => equipmentKind(r) === kind)
      .sort((a, b) => rank(b) - rank(a) || compareId(a.id, b.id));
    const manual = candidates.filter((r) =>
      automatic.some(
        (b) => priorities[b.type]?.includes(r.id) && compatible(b, r),
      ),
    );
    const defaults = candidates.filter((r) =>
      automatic.some(
        (b) => priorities[b.type] === undefined && compatible(b, r),
      ),
    );
    const preferred = defaults[0];
    const chosen = [...new Set([...manual, ...(preferred ? [preferred] : [])])];
    const baseTarget =
      kind === "troop"
        ? troopTarget
        : kind === "vehicle"
          ? vehicleTarget
          : siegeTarget;
    for (const recipe of chosen) {
      // Split the category buffer across explicit choices rather than giving
      // every checked recipe a new unlimited claim on the shared stockpile.
      let target = Math.max(1, Math.ceil(baseTarget / chosen.length));
      if (kind === "siege")
        for (const [vehicle, count] of targets)
          if (
            equipmentKind(vehicle) === "vehicle" &&
            rank(vehicle) === rank(recipe)
          )
            target += count;
      targets.set(recipe, target);
    }
    // Older automatic building types still honor their highlighted pattern,
    // but keep only a two-kit reserve instead of diluting the newest buffer.
    for (const recipe of defaults)
      if (!targets.has(recipe)) targets.set(recipe, 2);
  }
  // Explicit payload orders keep running. A common weight balances finished
  // plus already-paid output equally across the selected payload recipes.
  // Unselected AI payloads retain their two-item automatic reserve.
  for (const r of automaticRecipes)
    if (
      Object.keys(r.outputs)[0].startsWith("payload:") &&
      automatic.some(
        (b) =>
          (priorities[b.type]?.includes(r.id) ?? false) ||
          (context.ai && priorities[b.type] === undefined && compatible(b, r)),
      )
    ) {
      const selected = automatic.some(
        (b) => priorities[b.type]?.includes(r.id) && compatible(b, r),
      );
      targets.set(r, selected ? 1 : 2);
      if (selected) continuous.add(r);
    }

  if (context.ai && context.aiDemand) {
    targets.clear();
    continuous.clear();
    for (const recipe of automaticRecipes) {
      const requested = context.aiDemand.equipment[Object.keys(recipe.outputs)[0]] ?? 0;
      if (requested > 0) targets.set(recipe, requested);
    }
  }
  const budget = { ...inventory }
  if (context.ai)
    for (const [id, n] of Object.entries(context.protectedInputs ?? {}))
      budget[id] = Math.max(0, (budget[id] ?? 0) - n);
  const allocated = { ...incoming }
  const result = new Map<number, string>()
  const idle = new Set(
    automatic.filter((b) => !busy.has(b.id)).map((b) => b.id),
  )
  const output = (r: ProductionRecipe) => Object.keys(r.outputs)[0]
  const amount = (r: ProductionRecipe) =>
    (inventory[output(r)] ?? 0) + (allocated[output(r)] ?? 0)
  const deficit = (r: ProductionRecipe, target: number) =>
    continuous.has(r) ? 1 : Math.max(0, target - amount(r))
  const producer = (r: ProductionRecipe) =>
    byCapability.find((b) => idle.has(b.id) && compatible(b, r))
  const affordable = (r: ProductionRecipe) =>
    Object.entries(r.inputs).every(([id, n]) => (budget[id] ?? 0) >= n)
  const reserve = (r: ProductionRecipe) => {
    for (const [id, n] of Object.entries(r.inputs))
      budget[id] = Math.max(0, (budget[id] ?? 0) - n);
  }
  const start = (r: ProductionRecipe, b: Building) => {
    reserve(r);
    idle.delete(b.id);
    result.set(b.id, r.id);
    for (const [id, n] of Object.entries(r.outputs))
      allocated[id] = (allocated[id] ?? 0) + n;
  }
  // Fund a blocked priority's immediate refining chain before a lower-tier
  // recipe can reserve those same materials. Outputs remain in flight; they
  // cannot pay another job until its batch actually completes.
  const fundRefiningInputs = (r: ProductionRecipe, depth = 0): void => {
    if (depth >= 8) return;
    for (const [id, required] of Object.entries(r.inputs)) {
      const upstream = refiners.get(id);
      if (!upstream) continue;
      while ((budget[id] ?? 0) + (allocated[id] ?? 0) < required) {
        const building = producer(upstream);
        if (!building) break;
        if (affordable(upstream)) start(upstream, building);
        else {
          fundRefiningInputs(upstream, depth + 1);
          break;
        }
      }
    }
  }

  // Globally compare stock coverage, rather than letting building insertion
  // order decide who gets scarce steel. Reserve only the next blocked batch;
  // unrelated resources remain available to other specialties.
  const blocked = new Set<ProductionRecipe>()
  const priority = (r: ProductionRecipe) =>
    equipmentKind(r) === "troop" ? 0 : equipmentKind(r) === "siege" ? 1 : 2
  while (idle.size) {
    const next = [...targets]
      .filter(
        ([r, target]) =>
          !blocked.has(r) && deficit(r, target) > 0 && producer(r),
      )
      .sort(
        ([a, at], [b, bt]) =>
          (equipmentKind(a) === null ? 1 : 0) -
            (equipmentKind(b) === null ? 1 : 0) ||
          amount(a) * bt - amount(b) * at ||
          priority(a) - priority(b) ||
          rank(b) - rank(a) ||
          compareId(a.id, b.id),
      )[0];
    if (!next) break;
    const [recipe] = next;
    if (affordable(recipe)) start(recipe, producer(recipe)!);
    else {
      // Impossible recipes must not hoard another specialty's finite inputs.
      if (sustainable(recipe)) {
        if (equipmentKind(recipe)) fundRefiningInputs(recipe);
        reserve(recipe);
      }
      blocked.add(recipe);
    }
  }

  const materialTargets: Inventory = context.ai && context.aiDemand ? { ...context.aiDemand.materials } : {}
  // The demand quote already expanded aggregate equipment inputs once. Adding
  // those deficits again would double the AI's refining/material claims.
  if(!(context.ai && context.aiDemand))for (const [r, target] of targets) {
    for (const [id, n] of Object.entries(r.inputs))
      if (refiners.has(id))
        materialTargets[id] = Math.min(
          Math.max(120, n),
          (materialTargets[id] ?? 0) + deficit(r, target) * n,
        );
  }
  // A manual equipment order also drives its upstream factory automatically.
  for (const plan of plans.values()) {
    const r = available.find((r) => r.id === plan.recipeId);
    if (r)
      for (const [id, n] of Object.entries(r.inputs))
        if (refiners.has(id))
          materialTargets[id] = Math.max(materialTargets[id] ?? 0, n * 2);
  }
  const metalBuffer = context.ai
    ? 60
    : Math.max(
        60,
          Math.min(
          3000, automatic.filter((b) => b.type === "factory").length * 60,
        ),
      );
  const newestMetal = smelting.find(
    (r) => held(Object.keys(r.outputs)[0]) >= metalBuffer || sustainable(r),
  )
  if (newestMetal && !(context.ai && context.aiDemand))
    materialTargets[output(newestMetal)] = Math.max(
      metalBuffer,
      materialTargets[output(newestMetal)] ?? 0,
    );

  for (const r of smelting)
    if (priorities.factory?.includes(r.id))
      materialTargets[output(r)] = Math.max(
        metalBuffer,
        materialTargets[output(r)] ?? 0,
      );

  // Expand only actual shortfalls, so a full steel buffer doesn't keep turning
  // all ore into iron. Advanced smelting is first, with prerequisite iron next.
  for (const r of smelting) {
    const batches = Math.ceil(
      Math.max(0, (materialTargets[output(r)] ?? 0) - amount(r)) /
        r.outputs[output(r)],
    );
    for (const [id, n] of Object.entries(r.inputs))
      if (refiners.has(id))
        materialTargets[id] = Math.max(
          materialTargets[id] ?? 0,
          Math.min(120, batches * n),
        );
  }
  const blockedSmelting = new Set<ProductionRecipe>()
  while (idle.size) {
    const orderedSmelting =
      priorities.factory === undefined
        ? smelting
        : [...smelting].sort((a, b) => {
            const at = materialTargets[output(a)] ?? 0,
              bt = materialTargets[output(b)] ?? 0;
            const ap = priorities.factory!.includes(a.id),
              bp = priorities.factory!.includes(b.id);
            return (
              Number(bp) - Number(ap) ||
              (ap && bp ? amount(a) * bt - amount(b) * at : 0) ||
              rank(b) - rank(a)
            );
          });
    const r = orderedSmelting.find(
      (r) =>
        !blockedSmelting.has(r) &&
        producer(r) &&
        amount(r) < (materialTargets[output(r)] ?? 0),
    );
    if (!r) break;
    if (affordable(r)) start(r, producer(r)!);
    else blockedSmelting.add(r);
  }

  return result;
}
