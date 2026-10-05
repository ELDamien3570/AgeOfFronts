import { TICKS_PER_SECOND } from "../Protocol";
import {
  AGE_NAMES,
  AGES,
  type Age,
  type ProductionRecipe,
} from "../domain/Definitions";
import { technologyAt } from "./Technology";

export type EquipmentKind = "troop" | "siege" | "vehicle";
export const equipmentItem = (age: Age, kind: EquipmentKind = "troop") =>
  `equipment:${age.toLowerCase()}${kind === "troop" ? "" : `-${kind}`}`;

export const EQUIPMENT_RECIPES: ProductionRecipe[] = [];
export const EQUIPMENT_NAMES = new Map<string, string>();
for (const [index, age] of AGES.entries()) {
  const material = [
    "stone",
    "bronze",
    "iron",
    "iron",
    "steel",
    "iron",
    "steel",
  ][index];
  for (const kind of [
    "troop",
    "siege",
    ...(age === "Modern" ? ["vehicle" as const] : []),
  ] as const) {
    if (kind === "troop" && !index) continue;
    const item = equipmentItem(age, kind);
    const name = `${AGE_NAMES[index]} ${kind === "troop" ? "" : `${kind} `}equipment`;
    EQUIPMENT_NAMES.set(item, name);
    EQUIPMENT_RECIPES.push({
      id: `make-${age.toLowerCase()}-${kind === "troop" ? "equipment" : `${kind}-equipment`}`,
      name,
      technologyId: technologyAt(
        age,
        "warfare",
        kind === "troop" ? 1 : index < 2 ? 4 : 2,
      ).id,
      building:
        kind === "siege"
          ? "siege-workshop"
          : kind === "vehicle"
            ? "depot"
            : index === 6
              ? "arms-factory"
              : index === 5
                ? "armory"
                : "blacksmith",
      inputs: {
        [material]: kind === "troop" ? 12 : kind === "vehicle" ? 30 : 20,
        ...(kind !== "vehicle" &&
        (index >= 5 || (index >= 4 && kind === "siege"))
          ? { gunpowder: 10 }
          : {}),
        ...(kind === "vehicle" ? { oil: 20 } : {}),
      },
      outputs: { [item]: 1 },
      ticks: (15 + index * 5) * TICKS_PER_SECOND / (kind === "troop" ? 2 : 1),
    });
  }
}

/** Presentation names share the content definition used by production and costs. */
export function supplyItemName(id: string): string {
  return (
    EQUIPMENT_NAMES.get(id) ??
    id.replace(/^equipment:|^payload:/, "").replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}
