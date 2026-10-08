import { UNITS } from "../../content/Units";
import catalogue from "../../content/RussianTroopActors.json";
import type { TroopActorDefinition } from "./TroopActors";

const sources: Record<string, { key: string; assetRoot: string; memberScale: number; projectile: string }> = catalogue;
export const RUSSIAN_TROOP_ACTORS = new Map<string, TroopActorDefinition>();
for (const unit of UNITS) {
  if (!unit.troopClass) continue;
  const source = sources[`${unit.age}:${unit.troopClass}`];
  if (!source) continue;
  RUSSIAN_TROOP_ACTORS.set(unit.id, {
    name: source.key,
    age: unit.age,
    mounted: unit.troopClass.endsWith("Cavalry"),
    ranged: unit.attack.channel !== "melee",
    memberScale: source.memberScale,
    assetRoot: source.assetRoot,
    projectile: source.projectile as TroopActorDefinition["projectile"],
  });
}
