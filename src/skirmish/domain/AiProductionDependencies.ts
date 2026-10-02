import { producerCompatible } from "../content/Buildings";
import { PRODUCTION_RECIPES } from "../content/Production";
import type { AiEconomicSnapshot } from "./AiEconomicSnapshot";
import type { Inventory, ProductionRecipe } from "./Definitions";
export type AiDependencyAvailability = "available" | "unavailable" | "deferred";

/** Bounded researched dependency quotes. A missing workshop is an investment
 * prerequisite; it does not make attainable ore into an impossible equipment
 * chain. This quote grants neither goods nor purchasing credit.
 */
export class AiProductionDependencies {
  private readonly recipes: ProductionRecipe[];
  deferred = false;
  constructor(
    private readonly snapshot: AiEconomicSnapshot,
    private readonly renewable: ReadonlySet<string>,
  ) {
    this.recipes = PRODUCTION_RECIPES.filter((r) =>
      snapshot.research.includes(r.technologyId),
    ).sort(
      (a, b) =>
        Number(this.producer(b)) - Number(this.producer(a)) ||
        a.ticks - b.ticks ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }
  private producer(recipe: ProductionRecipe): boolean {
    return this.snapshot.buildings.some(
      (b) =>
        !b.remainingTicks &&
        (b.health ?? 1) > 0 &&
        producerCompatible(b.type, recipe.building),
    );
  }
  private held(id: string): number {
    return (
      (this.snapshot.liquid.items?.[id] ?? 0) +
      (this.snapshot.incoming[id] ?? 0)
    );
  }
  available(id: string, amount: number): boolean {
    return this.availability(id, amount) === "available";
  }
  availability(id: string, amount: number): AiDependencyAvailability {
    let nodes = 0;
    const visit = (
      item: string,
      count: number,
      depth: number,
      seen: ReadonlySet<string>,
    ): AiDependencyAvailability => {
      if (++nodes > 32) return "deferred";
      if (this.held(item) >= count || this.renewable.has(item))
        return "available";
      if (seen.has(item)) return "unavailable";
      const recipes = this.recipes.filter((r) => r.outputs[item]);
      if (!recipes.length) return "unavailable";
      if (depth >= 3) return "deferred";
      const next = new Set(seen);
      next.add(item);
      let unknown = recipes.length > 4;
      for (const recipe of recipes.slice(0, 4)) {
        const batches = Math.ceil(
          Math.max(0, count - this.held(item)) / recipe.outputs[item],
        );
        let blocked = false,
          deferred = false;
        for (const [input, n] of Object.entries(recipe.inputs)) {
          const status = visit(input, n * batches, depth + 1, next);
          if (status === "unavailable") {
            blocked = true;
            break;
          }
          deferred ||= status === "deferred";
        }
        if (!blocked && !deferred) return "available";
        unknown ||= !blocked && deferred;
      }
      return unknown ? "deferred" : "unavailable";
    };
    const status = visit(id, amount, 0, new Set());
    this.deferred ||= status === "deferred";
    return status;
  }
  /** Expand aggregate deficits once per level. Shared stock/paid incoming is
   * subtracted after merging callers' claims, rather than credited per recipe.
   */
  materials(equipment: Readonly<Inventory>): Inventory {
    const wanted: Inventory = { ...equipment },
      result: Inventory = {},
      expanded = new Set<string>();
    for (let depth = 0; depth < 3; depth++) {
      const batch = Object.keys(wanted)
        .filter((id) => !expanded.has(id))
        .sort();
      for (const id of batch) {
        expanded.add(id);
        const recipe = this.recipes
          .filter((r) => r.outputs[id])
          .slice(0, 4)
          .find((r) =>
            Object.entries(r.inputs).every(([input, n]) =>
              this.available(input, n),
            ),
          );
        if (!recipe) continue;
        const batches = Math.ceil(
          Math.max(0, wanted[id] - this.held(id)) / recipe.outputs[id],
        );
        for (const [input, n] of Object.entries(recipe.inputs)) {
          wanted[input] = (wanted[input] ?? 0) + n * batches;
          result[input] = (result[input] ?? 0) + n * batches;
        }
      }
    }
    return result;
  }
}
