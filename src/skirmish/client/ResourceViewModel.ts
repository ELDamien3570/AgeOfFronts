import { resourceTechnology, resourceVisibleAtAge } from "../content/Resources";
import { TECHNOLOGY } from "../content/Technology";
import {
  AGES,
  RESOURCES,
  type Age,
  type Inventory,
  type Resource,
} from "../domain/Definitions";
import { PRODUCTION_RECIPES } from "../domain/Supply";

// Project discovery from content, never from stock amounts or completed jobs.
// The ledger retains every item; hidden stocks are neither deleted nor spent.
const itemAges = new Map<string, Age>(
  RESOURCES.filter(resource => resource !== "sulphur" && resource !== "nitrate").map((resource) => [resource, resourceTechnology(resource).age]),
);
for (const recipe of PRODUCTION_RECIPES) {
  const age = TECHNOLOGY.get(recipe.technologyId)!.age;
  for (const item of Object.keys(recipe.outputs)) {
    const previous = itemAges.get(item);
    if (!previous || AGES.indexOf(age) < AGES.indexOf(previous))
      itemAges.set(item, age);
  }
}

export class ResourceViewModel {
  readonly stocks: Inventory;

  constructor(
    readonly age: Age,
    inventory: Readonly<Inventory>,
  ) {
    this.stocks = Object.fromEntries(
      [...itemAges]
        .filter(([, firstAge]) => AGES.indexOf(firstAge) <= AGES.indexOf(age))
        .map(([item]) => [item, inventory[item] ?? 0]),
    );
  }

  depositVisible(resource: Resource): boolean {
    return resourceVisibleAtAge(resource, this.age);
  }
}
