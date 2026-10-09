import catalogue from "../../content/RussianTroopActors.json";
import { UNITS } from "../../content/Units";
import { isCavalryTroopClass } from "../../domain/Definitions";
import type { TroopActorDefinition } from "./TroopActors";

const sources: Record<
  string,
  Omit<
    TroopActorDefinition,
    "name" | "age" | "mounted" | "ranged" | "projectile"
  > & { key: string; projectile: string }
> = catalogue;
export const RUSSIAN_TROOP_ACTORS = new Map<string, TroopActorDefinition>();
for (const unit of UNITS) {
  if (!unit.troopClass) continue;
  const source = sources[`${unit.age}:${unit.troopClass}`];
  if (!source) continue;
  RUSSIAN_TROOP_ACTORS.set(unit.id, {
    ...source,
    name: source.key,
    age: unit.age,
    mounted: !source.vehicle && isCavalryTroopClass(unit.troopClass),
    ranged: unit.attack.channel !== "melee",
    memberScale: source.memberScale,
    assetRoot: source.assetRoot,
    projectile: source.projectile as TroopActorDefinition["projectile"],
  });
}
