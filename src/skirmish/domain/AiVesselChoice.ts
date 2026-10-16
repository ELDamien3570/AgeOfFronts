import { AGES } from "./Definitions";
import type { VesselDefinition } from "./Definitions";

/**
 * AI vessel preference (I7, R2-M15). Newest age first; within an age the
 * hull with the most health per gold wins, so an identical submarine copy
 * at 1.25x cost never displaces the same-age warship. Id breaks ties.
 */
export function aiVesselPreference(vessels: readonly VesselDefinition[]): VesselDefinition[] {
  const value = (v: VesselDefinition) => v.health / Math.max(1, v.cost.gold ?? 0);
  return [...vessels].sort((a, b) =>
    AGES.indexOf(b.age) - AGES.indexOf(a.age) || value(b) - value(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
