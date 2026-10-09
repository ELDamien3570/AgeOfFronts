import type { ProductionRecipe } from "../domain/Definitions";
import { technologyAt, canonicalTechnologyId, packageTechnology } from "./Technology";
import { RECIPES } from "./Units";

export const REFINING: ProductionRecipe[] = [
  {
    id: "refine-bronze",
    name: "Smelt bronze",
    technologyId: technologyAt("BronzeAge", "economic", 1).id,
    building: "factory",
    inputs: { copper: 8, tin: 2 },
    outputs: { bronze: 10 },
    ticks: 200,
  },
  {
    id: "refine-iron",
    name: "Smelt iron",
    technologyId: technologyAt("ClassicalAge", "economic", 1).id,
    building: "factory",
    inputs: { ironOre: 10 },
    outputs: { iron: 10 },
    ticks: 200,
  },
  {
    id: "refine-steel",
    name: "Make steel",
    technologyId: technologyAt("LateMedieval", "economic", 1).id,
    building: "factory",
    inputs: { iron: 8, carbon: 2 },
    outputs: { steel: 10 },
    ticks: 240,
  },
  ...["icbm", "hydrogen", "mirv"].map((name, i) => ({
    id: `make-${name}`,
    name: `${name.toUpperCase()} payload`,
    technologyId: name === "mirv" ? "russian-mirv-systems" : "modern-strategic-weapons",
    building: "arms-factory" as const,
    inputs: {
      steel: 200 + i * 100,
      gunpowder: 150 + i * 100,
      oil: 100 + i * 50,
    },
    outputs: { [`payload:${name}`]: 1 },
    ticks: (2400 + i * 600) / 2,
  })),
];
REFINING.push({id:"make-atomic",name:"Atomic bomb",technologyId:packageTechnology("EarlyModern","nuclear-weapons"),building:"nuclear-facility",inputs:{steel:200,gunpowder:150,oil:100},outputs:{"payload:atomic":1},ticks:1200});
for(const recipe of [...REFINING,...RECIPES]) recipe.technologyId=canonicalTechnologyId(recipe.technologyId);
export const PRODUCTION_RECIPES = [...REFINING, ...RECIPES];
