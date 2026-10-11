import type { Player, Squad } from "../Protocol";
import { UNIT } from "../content/Units";
import type { Cost, Inventory } from "./Definitions";
import { enlargementTerms } from "./Manpower";
import { costRejection } from "./Supply";

export function enlargementEligible(
  s: Pick<
    Squad,
    | "playerId"
    | "x"
    | "y"
    | "embarkedOn"
    | "afloat"
    | "refit"
    | "moved"
    | "fighting"
    | "charge"
    | "manpower"
  >,
  playerId: number,
  owners: Uint8Array,
  width: number,
): boolean {
  return (
    s.playerId === playerId &&
    s.embarkedOn === null &&
    !s.afloat &&
    !s.refit &&
    !s.moved &&
    !s.fighting &&
    !s.charge &&
    !s.manpower?.enlargement &&
    s.manpower?.model === "soldiers" &&
    s.manpower.variant === "base" &&
    owners[Math.floor(s.y / 256) * width + Math.floor(s.x / 256)] === playerId
  );
}
export function quoteEnlargement(
  selected: readonly Omit<
    Squad,
    "path" | "nextPathIndex" | "plannedTile" | "lastPlanTick"
  >[],
  focused: number | undefined,
  player: Player,
  research: readonly string[],
  inventory: Inventory,
  owners: Uint8Array,
  width: number,
) {
  const candidates = selected
    .filter((s) => s.playerId === player.id)
    .sort((a, b) => a.id - b.id);
  const first =
    candidates.find((s) => s.id === focused) ??
    candidates.find((s) => {
      const r = UNIT.get(s.definitionId ?? "")?.formationRecipe;
      return (
        r?.technologyId &&
        research.includes(r.technologyId) &&
        s.manpower?.variant === "base"
      );
    });
  if (!first) return null;
  const target = UNIT.get(first.definitionId ?? "");
  const recipe = target?.formationRecipe;
  if (
    !target ||
    !recipe?.technologyId ||
    !research.includes(recipe.technologyId) ||
    recipe.enlargedCapacity <= recipe.capacity
  )
    return null;
  const row = candidates.filter((s) => s.definitionId === target.id),
    eligible = row.filter((s) =>
      enlargementEligible(s, player.id, owners, width),
    );
  const terms = enlargementTerms(target);
  let count = 0;
  const total = (n: number): Cost => ({
    gold: (terms.cost.gold ?? 0) * n,
    reserves: (terms.cost.reserves ?? 0) * n,
    items: Object.fromEntries(
      Object.entries(terms.cost.items ?? {}).map(([id, v]) => [id, v * n]),
    ),
  });
  while (
    count < eligible.length &&
    !costRejection(player, inventory, total(count + 1))
  )
    count++;
  return {
    target,
    selected: eligible.slice(0, count),
    totalCount: row.length,
    eligibleCount: eligible.length,
    cost: total(count),
    terms,
    reason: count
      ? null
      : !eligible.length
        ? "Needs a base squad, stationary on owned land and out of combat"
        : costRejection(player, inventory, terms.cost),
  };
}
