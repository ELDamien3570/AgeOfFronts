import technologies from "../content/technologies.json";
import { UNITS } from "../content/Units";

import {
  ROLE_NAMES,
  UNIT_ROLES,
  type CivilizationPlan,
  type TechnologyPlan,
} from "./TechnologyPlan";
import { legacyPlanAges } from "./TechnologyPlanMigration";
import { applyRussianTroopAvailability } from "./TroopTreePlan";

const AGES = legacyPlanAges().map((a) => a.id);
const russianNames = [
  [
    "Clubmen",
    "Spearmen",
    "Javelin Throwers",
    "Mounted Spearmen",
    "Heavy cavalry",
    "Ranged cavalry",
  ],
  [
    "Bronze Axemen",
    "Bronze Spearmen",
    "Archers",
    "Spear Riders",
    "Heavy cavalry",
    "Mounted Archers",
  ],
  [
    "Varangians",
    "Heavy Spearmen",
    "Recurve Bowmen",
    "Light Horsemen",
    "Armoured Horsemen",
    "Horse Archers",
  ],
  [
    "Rus Woodsman",
    "Mail Spearman",
    "Rus Bowmen",
    "Rus Lancer",
    "Druzhina",
    "Early Cossack Archer",
  ],
  [
    "Boyar Guards",
    "Plate Spearman",
    "Rus Crossbowman",
    "Cossack Riders",
    "Boyar Cavalry",
    "Heavy Cossack Archer",
  ],
  [
    "Grenadiers",
    "Pikeman",
    "Rus Musketeer",
    "Cossack Lancers",
    "Cuirassiers",
    "Streltsy",
  ],
  [
    "Mosin Nagant Squad",
    "PTRD-41 Crew",
    "DP-28 Crew",
    "Gun Trucks",
    "Tsar Tank",
    "T-34",
  ],
];

/** Proposed names remain separate from confirmed class starting ages. */
export function createInitialPlan(): TechnologyPlan {
  const baseline: CivilizationPlan = {
    id: "base",
    ages: legacyPlanAges(),
    name: "Base",
    notes:
      "Current shared gameplay baseline. The existing cavalry line is placed in the light/mobile lane for comparison; its Modern tank is not a confirmed light-cavalry design.",
    technologies: technologies.map((t) => ({
      id: t.id,
      name: t.name,
      age: t.age as (typeof AGES)[number],
      tree: t.tree as "warfare" | "naval" | "economic",
      order: t.slot,
      prerequisites: [...t.prerequisites],
      description: t.description,
      notes: "",
      decision: "baseline",
      kind: "unlock",
      gold: t.gold,
      researchSeconds: Math.round(t.ticks / 20),
    })),
    units: AGES.flatMap((age) =>
      UNIT_ROLES.map((role) => {
        const lane =
          role === "frontline"
            ? 0
            : role === "rangedInfantry"
              ? 1
              : role === "lightCavalry"
                ? 2
                : -1;
        const existing =
          lane >= 0
            ? UNITS.find(
                (u) =>
                  u.age ===
                    (age === "EarlyModern"
                      ? "Napoleonic"
                      : age === "Modern"
                        ? "EarlyModern"
                        : age) &&
                  u.line === ["infantry", "archer", "cavalry"][lane] &&
                  u.troopClass === role,
              )
            : undefined;
        return {
          id: `${age.toLowerCase()}-${role.toLowerCase()}`,
          age,
          role,
          name: existing?.name ?? ROLE_NAMES[role],
          availability:
            lane >= 0 ? ("available" as const) : ("undecided" as const),
          prerequisites:
            lane >= 0
              ? [
                  technologies.find(
                    (t) =>
                      t.age === age &&
                      t.tree === "warfare" &&
                      t.slot === lane + 1,
                  )!.id,
                ]
              : [],
          notes:
            lane < 0
              ? "New class; not present in the current gameplay baseline. Unlock age and technology are undecided."
              : role === "lightCavalry"
                ? "Current unsplit cavalry/mobile line. Future class placement is undecided."
                : "",
          decision: "baseline" as const,
        };
      }),
    ),
  };
  const russian: CivilizationPlan = {
    id: "russians",
    ages: legacyPlanAges(),
    name: "Russians",
    notes:
      "Draft Russian civilization. Shared technologies are inherited as a starting proposal. Names after Bronze Age are proposals. Anti-cavalry begins in Bronze Age. Heavy cavalry begins in Early Medieval and peaks in Late Medieval.",
    technologies: baseline.technologies.map((t) => ({
      ...structuredClone(t),
      decision: "proposed",
    })),
    units: AGES.flatMap((age, index) =>
      UNIT_ROLES.map((role, lane) => {
        const unavailable =
          index === 0 &&
          ["antiCavalry", "heavyCavalry", "rangedCavalry"].includes(role);
        const undecided =
          index > 0 &&
          ["antiCavalry", "heavyCavalry"].includes(role) &&
          !(index === 6 && role === "heavyCavalry");
        return {
          id: `${age.toLowerCase()}-${role.toLowerCase()}`,
          age,
          role,
          name: russianNames[index][lane],
          availability: unavailable
            ? ("unavailable" as const)
            : undecided
              ? ("undecided" as const)
              : ("available" as const),
          prerequisites: [],
          notes: unavailable
            ? "Confirmed: this class is not unlocked in Russian Stone Age."
            : undecided
              ? "Introduction age is undecided. Name is a proposal; no unlocking technology assigned."
              : index === 1 && ["lightCavalry", "rangedCavalry"].includes(role)
                ? "Confirmed Bronze Age mounted role. No chariots. Unlocking technology is undecided."
                : index === 6 && lane >= 3
                  ? "Confirmed Early Modern role: gun truck / WWI tank / WWII tank. Name and unlocking technology remain editable."
                  : "Proposed name. Unlocking technology is undecided.",
          decision:
            unavailable ||
            (index === 1 && ["lightCavalry", "rangedCavalry"].includes(role)) ||
            (index === 6 && lane >= 3)
              ? ("confirmed" as const)
              : ("proposed" as const),
        };
      }),
    ),
  };
  const bronzeMounted = russian.technologies.find(
    (t) => t.id === "bronzeage-chariot-warfare",
  );
  if (bronzeMounted) {
    bronzeMounted.name = "Bronze Horsemanship";
    bronzeMounted.description =
      "Russian Bronze Age mounted warfare: spear riders. Ranged cavalry is excluded in this age; exact unlock links are undecided.";
    bronzeMounted.notes =
      "Proposed replacement for the baseline chariot technology. The inherited ID is retained so existing prerequisite links remain stable.";
  }
  applyRussianTroopAvailability(russian);
  return { schemaVersion: 2, civilizations: [baseline, russian] };
}
