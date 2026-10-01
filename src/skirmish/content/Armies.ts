import { technologyAt } from "./Technology";

export const ARMY_TECHNOLOGY = "bronzeage-armies";
export const ARMY_CAPS = Object.freeze([
  { technologyId: ARMY_TECHNOLOGY, capacity: 20 },
  { technologyId: technologyAt("ClassicalAge", "warfare", 1).id, capacity: 25 },
  {
    technologyId: technologyAt("EarlyMedieval", "warfare", 1).id,
    capacity: 30,
  },
  { technologyId: technologyAt("LateMedieval", "warfare", 1).id, capacity: 35 },
  { technologyId: technologyAt("EarlyModern", "warfare", 1).id, capacity: 40 },
  { technologyId: technologyAt("Modern", "warfare", 1).id, capacity: 50 },
]);
export function armyCapacity(completed: readonly string[]): number {
  if (!completed.includes(ARMY_TECHNOLOGY)) return 0;
  return ARMY_CAPS.reduce(
    (cap, rule) =>
      completed.includes(rule.technologyId) ? rule.capacity : cap,
    20,
  );
}
