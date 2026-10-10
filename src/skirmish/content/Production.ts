import type { ProductionRecipe } from "../domain/Definitions";
import {
  canonicalTechnologyId,
  packageTechnology,
} from "./Technology";
import { RECIPES } from "./Units";

export const REFINING: ProductionRecipe[] = [
  {
    id: "refine-bronze",
    name: "Smelt bronze",
    technologyId: packageTechnology("BronzeAge", "factories-mines"),
    building: "factory",
    inputs: { copper: 8, tin: 2 },
    outputs: { bronze: 10 },
    ticks: 200,
  },
  {
    id: "refine-iron",
    name: "Smelt iron",
    technologyId: packageTechnology("ClassicalAge", "factories-mines"),
    building: "factory",
    inputs: { ironOre: 10 },
    outputs: { iron: 10 },
    ticks: 200,
  },
  {
    id: "refine-steel",
    name: "Make steel",
    technologyId: packageTechnology("LateMedieval", "factories-mines"),
    building: "factory",
    inputs: { iron: 8, carbon: 2 },
    outputs: { steel: 10 },
    ticks: 240,
  },
  ...["icbm", "hydrogen", "mirv"].map((name, i) => ({
    id: `make-${name}`,
    name: `${name.toUpperCase()} payload`,
    technologyId:
      name === "mirv" ? "russian-mirv-systems" : "modern-strategic-weapons",
    building: "arms-factory" as const,
    inputs: {
      steel: 200 + i * 100,
      gunpowder: 150 + i * 100,
      oil: 100 + i * 50,
      copper: 30 + i * 10,
      tin: 10 + i * 5,
    },
    outputs: { [`payload:${name}`]: 1 },
    ticks: (2400 + i * 600) / 2,
  })),
];
REFINING.push({
  id: "make-atomic",
  name: "Atomic bomb",
  technologyId: packageTechnology("EarlyModern", "nuclear-weapons"),
  building: "nuclear-facility",
  inputs: { steel: 200, gunpowder: 150, oil: 100 },
  outputs: { "payload:atomic": 1 },
  ticks: 1200,
});
// Explicit salvage orders only: automatic input dependencies must not turn
// equipment manufacture/recycling into a circular production graph.
for (const age of [
  "BronzeAge",
  "ClassicalAge",
  "EarlyMedieval",
  "LateMedieval",
] as const) {
  for (const kind of ["", "-siege"] as const)
    REFINING.push({
      id: `recycle-${age.toLowerCase()}${kind}-equipment`,
      name: `Recycle ${age}${kind} equipment`,
      technologyId: packageTechnology("EarlyModern", "factories-mines"),
      building: "blacksmith",
      manualOnly: true,
      inputs: { [`equipment:${age.toLowerCase()}${kind}`]: 1 },
      outputs:
        age === "BronzeAge"
          ? { copper: kind ? 12 : 7, tin: kind ? 3 : 2 }
          : { iron: kind ? 15 : 9 },
      ticks: 200,
    });
}
for (const recipe of [...REFINING, ...RECIPES])
  recipe.technologyId = canonicalTechnologyId(recipe.technologyId);
export const PRODUCTION_RECIPES = [...REFINING, ...RECIPES];
