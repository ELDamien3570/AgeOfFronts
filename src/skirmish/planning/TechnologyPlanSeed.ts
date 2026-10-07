import technologies from "../content/technologies.json";
import { UNITS } from "../content/Units";
import { AGES } from "../domain/Definitions";
import {
  ROLE_NAMES,
  UNIT_ROLES,
  type CivilizationPlan,
  type TechnologyPlan,
} from "./TechnologyPlan";

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
    "Bowmen",
    "Spear Riders",
    "Heavy cavalry",
    "Mounted Archers",
  ],
  [
    "Shield Warriors",
    "Long Spearmen",
    "Archers",
    "Light Horsemen",
    "Armoured Horsemen",
    "Horse Archers",
  ],
  [
    "Rus Axemen",
    "Rus Spearmen",
    "Rus Bowmen",
    "Border Riders",
    "Druzhina Cavalry",
    "Mounted Bowmen",
  ],
  [
    "Boyar Guards",
    "Pikemen",
    "Crossbowmen",
    "Cossack Riders",
    "Boyar Cavalry",
    "Mounted Archers",
  ],
  [
    "Grenadiers",
    "Pike Guards",
    "Streltsy",
    "Cossack Lancers",
    "Cuirassiers",
    "Mounted Musketeers",
  ],
  [
    "Assault Infantry",
    "Tank Hunters",
    "Machine Gunners",
    "Gun Trucks",
    "Armoured Personnel Carriers",
    "Battle Tanks",
  ],
];

/** Proposals are deliberately distinct from approved availability. Heavy cavalry
 * and anti-cavalry introduction ages have not yet been decided for Russians. */
export function createInitialPlan(): TechnologyPlan {
  const baseline: CivilizationPlan = {
    id: "base",
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
                  u.age === age &&
                  u.line === ["infantry", "archer", "cavalry"][lane],
              )
            : undefined;
        return {
          id: `${age.toLowerCase()}-${role.toLowerCase()}`,
          age,
          role,
          name: existing?.name ?? ROLE_NAMES[role],
          availability:
            lane >= 0 ? ("available" as const) : ("undecided" as const),
          prerequisites: existing ? [existing.technologyId] : [],
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
    name: "Russians",
    notes:
      "Draft Russian civilization. Shared technologies are inherited as a starting proposal. Names after Bronze Age are proposals. Heavy cavalry and anti-cavalry starting ages remain open.",
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
                  ? "Confirmed modern role: gun truck / armoured personnel carrier / tank. Name and unlocking technology remain editable."
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
      "Russian Bronze Age mounted warfare: spear riders and mounted archers. Exact unlock links are undecided.";
    bronzeMounted.notes =
      "Proposed replacement for the baseline chariot technology. The inherited ID is retained so existing prerequisite links remain stable.";
  }
  return { schemaVersion: 1, civilizations: [baseline, russian] };
}
