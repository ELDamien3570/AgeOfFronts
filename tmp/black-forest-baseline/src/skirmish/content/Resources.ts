import { AGES, type Age, type Resource } from "../domain/Definitions";
import { TECHNOLOGY } from "./Technology";

// Discovery follows the age of the resource's extraction/refining technology.
// Discovery does not grant that technology or authorize production.
export const RESOURCE_TECHNOLOGIES: Readonly<Record<Resource, string>> = {
  horses: "stoneage-horsemanship",
  stone: "stoneage-stone-mining",
  copper: "bronzeage-bronze-metallurgy",
  tin: "bronzeage-bronze-metallurgy",
  bronze: "bronzeage-bronze-metallurgy",
  ironOre: "classicalage-ironworking",
  iron: "classicalage-ironworking",
  carbon: "latemedieval-steelmaking",
  steel: "latemedieval-steelmaking",
  sulphur: "latemedieval-powder-milling",
  nitrate: "latemedieval-powder-milling",
  gunpowder: "latemedieval-powder-milling",
  oil: "modern-petroleum-extraction",
};

export function resourceTechnology(resource: Resource) {
  const technology = TECHNOLOGY.get(RESOURCE_TECHNOLOGIES[resource]);
  if (!technology) throw new Error(`Missing resource technology: ${resource}`);
  return technology;
}

export function resourceVisibleAtAge(resource: Resource, age: Age): boolean {
  return AGES.indexOf(age) >= AGES.indexOf(resourceTechnology(resource).age);
}
