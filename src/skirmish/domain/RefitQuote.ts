import { recruitmentVariant } from '../content/FormationRecipes';
import { availableGold } from "./Gold";
import type { Player, Ship, Squad } from "../Protocol";
import { defaultUnit, UNIT, UNITS, VESSEL, VESSELS } from "../content/Units";
import {
  AGES,
  type Cost,
  type Inventory,
  type UnitDefinition,
  type VesselDefinition,
} from "./Definitions";
import { refitBaseGold, refitFloorGold, unitRefitCost } from "./Refitting";
import { costRejection } from "./Supply";

export function affordableRefitCount(
  cost: Cost,
  gold: number,
  inventory: Readonly<Inventory>,
  maximum: number,
): number {
  let count = maximum;
  if ((cost.gold ?? 0) > 0)
    count = Math.min(count, Math.floor(gold / cost.gold!));
  for (const [id, n] of Object.entries(cost.items ?? {}))
    if (n > 0) count = Math.min(count, Math.floor((inventory[id] ?? 0) / n));
  return Math.max(0, count);
}
/** How many leading entries of a per-unit cost list the stock pays for, in
 * order. A refit selection can mix source tiers, which price differently. */
export function affordableRefitPrefix(
  costs: readonly Cost[],
  gold: number,
  inventory: Readonly<Inventory>,
): number {
  let spentGold = 0;
  const spentItems: Record<string, number> = {};
  for (let i = 0; i < costs.length; i++) {
    spentGold += costs[i].gold ?? 0;
    if (spentGold > gold) return i;
    for (const [id, n] of Object.entries(costs[i].items ?? {})) {
      spentItems[id] = (spentItems[id] ?? 0) + n;
      if (n > 0 && spentItems[id] > (inventory[id] ?? 0)) return i;
    }
  }
  return costs.length;
}
export function sumCosts(costs: readonly Cost[]): Cost {
  const items: Record<string, number> = {};
  let gold = 0;
  for (const cost of costs) {
    gold += cost.gold ?? 0;
    for (const [id, n] of Object.entries(cost.items ?? {})) items[id] = (items[id] ?? 0) + n;
  }
  return { gold, items };
}
export function vesselRefitCost(target: VesselDefinition, source: VesselDefinition | null, count = 1): Cost {
  const base = Math.max(
    refitBaseGold(target.age),
    source ? refitFloorGold(target.cost.gold ?? 0, source.cost.gold ?? 0) : 0,
  );
  return {
    gold: base * count,
    items: Object.fromEntries(
      Object.entries(target.cost.items ?? {}).map(([id, n]) => [id, n * count]),
    ),
  };
}
type RefitSquad = Pick<
  Squad,
  | "id"
  | "playerId"
  | "definitionId"
  | "manpower"
  | "kind"
  | "embarkedOn"
  | "refit"
  | "moved"
  | "fighting"
  | "x"
  | "y"
>;
type RefitShip = Pick<
  Ship,
  | "id"
  | "playerId"
  | "definitionId"
  | "kind"
  | "refit"
  | "fighting"
>;
interface Context {
  player: Player;
  research: readonly string[];
  inventory: Inventory;
}
interface Choice<T, D> {
  selected: T[];
  affordable: T[];
  eligibleCount: number;
  totalCount: number;
  target?: D;
  cost?: Cost;
  reason: string | null;
}
function choose<T extends { id: number }, D>(
  selected: readonly T[],
  focusedId: number | undefined,
  group: (s: T) => string,
  upgrade: (s: T) => D | undefined,
  eligible: (s: T) => boolean,
  price: (d: D, n: number, source: T) => Cost,
  context: Context,
  noUpgrade: string,
  ineligibleReason: string,
): Choice<T, D> | null {
  if (!selected.length) return null;
  const focused = selected.find((s) => s.id === focusedId),
    groups = new Map<string, T[]>();
  for (const s of selected) {
    const key = group(s),
      row = groups.get(key) ?? [];
    row.push(s);
    groups.set(key, row);
  }
  const rows = focused
    ? [groups.get(group(focused))!]
    : [...groups.values()].sort((a, b) => {
        const upgradeableA = upgrade(a[0]) ? a.filter(eligible).length : 0,
          upgradeableB = upgrade(b[0]) ? b.filter(eligible).length : 0;
        return (
          upgradeableB - upgradeableA ||
          b.length - a.length ||
          a[0].id - b[0].id
        );
      });
  const row = rows[0],
    target = upgrade(row[0]),
    valid = row.filter(eligible).sort((a, b) => a.id - b.id);
  if (!target)
    return {
      selected: [],
      affordable: [],
      eligibleCount: valid.length,
      totalCount: row.length,
      reason: noUpgrade,
    };
  const count = affordableRefitCount(
    price(target, 1, row[0]),
    availableGold(context.player),
    context.inventory,
    valid.length,
  );
  const affordable = valid.slice(0, count),
    cost = price(target, count, row[0]);
  const reason = count
    ? null
    : !valid.length
      ? ineligibleReason
      : (costRejection(context.player, context.inventory, price(target, 1, row[0])) ??
        "No eligible refit");
  return {
    selected: affordable,
    affordable,
    eligibleCount: valid.length,
    totalCount: row.length,
    target,
    cost,
    reason,
  };
}
export function quoteLandRefits<T extends RefitSquad>(
  selected: readonly T[],
  focusedId: number | undefined,
  context: Context,
  owners: Uint8Array,
  width: number,
) {
  const definition = (s: RefitSquad) =>
    UNIT.get(s.definitionId ?? "") ?? defaultUnit(s.kind);
  return choose<T, UnitDefinition>(
    selected,
    focusedId,
    (s) => definition(s).id,
    (s) => {
      const current = definition(s);
      const targets = UNITS.filter(
        (u) =>
          u.line === current.line &&
          u.role === current.role &&
          u.troopClass === current.troopClass && u.formationRecipe?.model===current.formationRecipe?.model &&
          AGES.indexOf(u.age) > AGES.indexOf(current.age) &&
          context.research.includes(u.technologyId),
      ).sort((a, b) => AGES.indexOf(b.age) - AGES.indexOf(a.age));
      return targets.find((u) =>
        affordableRefitCount(unitRefitCost(u,current,1,recruitmentVariant(u.id,context.research)), availableGold(context.player),
          context.inventory, 1) > 0,
      ) ?? targets[0];
    },
    (s) =>
      s.playerId === context.player.id &&
      s.embarkedOn === null &&
      !s.refit && !s.manpower?.enlargement &&
      !s.moved &&
      !s.fighting &&
      owners[Math.floor(s.y / 256) * width + Math.floor(s.x / 256)] ===
        context.player.id,
    (d,n,s)=>unitRefitCost(d,definition(s),n,recruitmentVariant(d.id,context.research)),
    context,
    selected.every((s) => AGES.indexOf(definition(s).age) === AGES.length - 1)
      ? "Maximum tier reached"
      : "Research a later tier to unlock a refit",
    "Needs owned land and no combat or active refit",
  );
}
export function quoteShipRefits<T extends RefitShip>(
  selected: readonly T[],
  focusedId: number | undefined,
  context: Context,
) {
  const definition = (s: RefitShip) =>
    VESSEL.get(s.definitionId ?? `stoneage-${s.kind}`)!;
  return choose<T, VesselDefinition>(
    selected,
    focusedId,
    (s) => definition(s).id,
    (s) => {
      const current = definition(s);
      return VESSELS.find(
        (v) =>
          v.kind === current.kind &&
          v.kind !== "trade" &&
          AGES.indexOf(v.age) > AGES.indexOf(current.age) &&
          context.research.includes(v.technologyId),
      );
    },
    (s) =>
      s.playerId === context.player.id &&
      !s.refit &&
      !s.fighting,
    (d,n,s)=>vesselRefitCost(d,definition(s),n),
    context,
    "Research the next vessel tier",
    "Needs no combat or active refit",
  );
}
