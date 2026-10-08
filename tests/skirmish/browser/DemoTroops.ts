import { defaultUnit, UNIT } from "../../../src/skirmish/content/Units";
import type { Age } from "../../../src/skirmish/domain/Definitions";
import type { SquadType } from "../../../src/skirmish/Protocol";

// Explicit demo roster: art readiness does not silently become production balance.
export const DEMO_TROOPS = [
  {
    name: "Clubman",
    age: "StoneAge",
    kind: "infantry",
    mounted: false,
    ranged: false,
  },
  {
    name: "Javelinist",
    age: "StoneAge",
    kind: "archer",
    mounted: false,
    ranged: true,
  },
  {
    name: "Scout",
    age: "StoneAge",
    kind: "cavalry",
    mounted: true,
    ranged: false,
  },
  {
    name: "ShieldWarrior",
    age: "ClassicalAge",
    kind: "infantry",
    mounted: false,
    ranged: false,
  },
  {
    name: "Pikeman",
    age: "ClassicalAge",
    kind: "infantry",
    mounted: false,
    ranged: false,
  },
  {
    name: "RecurveArcher",
    age: "ClassicalAge",
    kind: "archer",
    mounted: false,
    ranged: true,
  },
  {
    name: "LightCavalry",
    age: "ClassicalAge",
    kind: "cavalry",
    mounted: true,
    ranged: false,
  },
  {
    name: "HorseArcher",
    age: "ClassicalAge",
    kind: "cavalry",
    mounted: true,
    ranged: true,
  },
] as const;
export type DemoTroopName = (typeof DEMO_TROOPS)[number]["name"];
export const demoTroopId = (troop: (typeof DEMO_TROOPS)[number]) =>
  `demo-russian-${troop.age.toLowerCase()}-${troop.name.toLowerCase()}`;
export const DEMO_TROOP_BY_ID = new Map(
  DEMO_TROOPS.map((t) => [demoTroopId(t), t]),
);
export const DEMO_FACTIONS = [1, 2, 3, 4] as const;
export const DEMO_SQUADS_PER_FACTION = 100;
export const DEMO_WORLD_SIZE = 128;

/** Register only fixture IDs in the browser/worker module, never production defaults. */
export function registerDemoTroops(): void {
  for (const troop of DEMO_TROOPS) {
    const base = defaultUnit(troop.kind as SquadType, troop.age as Age);
    const ranged = defaultUnit("archer", troop.age);
    UNIT.set(demoTroopId(troop), {
      ...base,
      id: demoTroopId(troop),
      name: troop.name,
      ...(troop.mounted && troop.ranged
        ? {
            attack: { ...ranged.attack },
            charge: undefined,
            canCapture: false,
            tags: [...base.tags, "ranged" as const],
          }
        : {}),
    });
  }
}
