import { buildingFoundationTechnology as buildingTechnology } from "../content/Buildings";
import { technologyAt } from "../content/Technology";
import { UNITS } from "../content/Units";
import type { Age, Tree } from "../domain/Definitions";
import { AGES } from "../domain/Definitions";
import type { BuildingType } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import type { CivilizationPlan } from "./TechnologyPlan";

export interface RussianBuildingUnlock {
  id: string;
  age: string;
  name: string;
  tree: Tree;
  parents: string[];
  artFolder: string;
}
export const buildingUnlockId = (age: string, type: string) =>
  `russian-building-${age.toLowerCase()}-${type}`;
const sourceAge = (age: string): Age => age as Age;
const buildingFolders: Partial<Record<BuildingType, string>> = {
  archery: "Archery Range",
  "arms-factory": "Arms Factory",
  "siege-workshop": "Siege Workshop",
  depot: "Vehicle Depot",
  airstrip: "Military Airstrip",
  "oil-well": "Oil Well",
  "oil-rig": "Oil Rig",
  "gun-nest": "Gun Nest",
  "missile-silo": "Missile Silo",
  "mirv-launcher": "MIRV Launch Complex",
  "missile-defence": "Missile Defence",
};

/** Explicit planning catalog: existing building types at their supported tiers,
 * plus Russian art-only proposals. Does not enable any runtime construction. */
export function russianBuildingUnlocks(
  civ: CivilizationPlan,
): RussianBuildingUnlock[] {
  const result: RussianBuildingUnlock[] = [];
  for (const age of civ.ages) {
    const legacy = sourceAge(age.id);
    for (const type of Object.keys(BUILDING_RULES) as BuildingType[]) {
      const parent = buildingTechnology(type, legacy);
      if (!parent) continue;
      // The MIRV branch belongs to present day in the eight-age proposal.
      if (type === "mirv-launcher" && age.id === "EarlyModern") continue;
      const folder = buildingFolders[type] ?? BUILDING_RULES[type].name;
      result.push({
        id: buildingUnlockId(age.id, type),
        age: age.id,
        name: BUILDING_RULES[type].name,
        tree:
          type === "port" || type === "oil-rig"
            ? "naval"
            : ["city", "factory", "mine", "oil-well"].includes(type)
              ? "economic"
              : "warfare",
        parents:
          type === "barracks" && age.id === "BronzeAge"
            ? []
            : type === "mirv-launcher"
              ? ["russian-mirv-systems"]
              : [
                    "barracks",
                    "archery",
                    "depot",
                    "siege-workshop",
                    "arms-factory",
                  ].includes(type) && ["EarlyModern", "Modern"].includes(age.id)
                ? [
                    age.id === "Modern"
                      ? "russian-networked-command"
                      : "modern-modern-armaments",
                  ]
                : [parent],
        artFolder: `${age.id}/${folder}`,
      });
    }
    if (civ.ages.indexOf(age) <= 5) {
      for (const [type, name] of [
        ["walls", age.id === "StoneAge" ? "Palisades" : "Walls"],
        ["gates", "Gates"],
      ])
        result.push({
          id: buildingUnlockId(age.id, type),
          age: age.id,
          name,
          tree: "warfare",
          parents: [technologyAt(legacy, "warfare", 4).id],
          artFolder: `${age.id}/${name}`,
        });
    }
  }
  const extra = (
    age: string,
    type: string,
    name: string,
    tree: Tree,
    parent: string,
  ) =>
    result.push({
      id: buildingUnlockId(age, type),
      age,
      name,
      tree,
      parents: [parent],
      artFolder: `${age}/${name}`,
    });
  for (const age of ["EarlyModern", "Modern"]) {
    extra(
      age,
      "anti-aircraft-emplacement",
      "Anti-Aircraft Emplacement",
      "warfare",
      "russian-anti-aircraft-guns",
    );
    extra(
      age,
      "rail-terminal",
      "Rail Terminal",
      "economic",
      age === "Modern"
        ? "russian-advanced-rail-networks"
        : "russian-rail-freight",
    );
  }
  extra(
    "EarlyModern",
    "oil-refinery",
    "Oil Refinery",
    "economic",
    "russian-oil-refining",
  );
  extra(
    "EarlyModern",
    "nuclear-weapons-facility",
    "Nuclear Weapons Facility",
    "warfare",
    "modern-strategic-weapons",
  );
  extra(
    "Modern",
    "drone-facility",
    "Drone Facility",
    "warfare",
    "russian-battlefield-drones",
  );
  extra(
    "Modern",
    "warehouse",
    "Warehouse",
    "economic",
    "russian-intelligent-warehouses",
  );
  return result;
}

/** Additive, idempotent review of a draft. Stable IDs preserve authored links. */
export function applyRussianExplicitUnlocks(civ: CivilizationPlan): void {
  const add = (
    id: string,
    age: string,
    tree: Tree,
    name: string,
    parents: string[],
    description: string,
    free = false,
  ) => {
    let node = civ.technologies.find((t) => t.id === id);
    if (!node) {
      const index = civ.ages.findIndex((a) => a.id === age);
      node = {
        id,
        age,
        tree,
        name,
        prerequisites: [...new Set(parents)],
        description,
        order:
          Math.max(
            0,
            ...civ.technologies
              .filter((t) => t.age === age && t.tree === tree)
              .map((t) => t.order),
          ) + 1,
        kind: "unlock",
        gold: free
          ? 0
          : [200, 700, 1800, 3500, 6500, 14000, 35000, 80000][index],
        researchSeconds: free ? 0 : [15, 25, 35, 45, 55, 65, 100, 120][index],
        notes:
          "Explicit planning unlock. Research price and dependencies are proposals; no runtime capability is enabled.",
        decision: "proposed",
      };
      civ.technologies.push(node);
    }
    return node;
  };
  for (const b of russianBuildingUnlocks(civ))
    add(
      b.id,
      b.age,
      b.tree,
      b.name,
      b.parents,
      `Unlock ${b.name} construction in ${civ.ages.find((a) => a.id === b.age)!.name}. Separate node for this building tier; earlier tiers remain available.`,
      b.age === "BronzeAge" && b.name === "Barracks",
    );

  const foundationSlot = {
    frontline: 1,
    antiCavalry: 1,
    rangedInfantry: 2,
    lightCavalry: 3,
    heavyCavalry: 3,
    rangedCavalry: 3,
  } as const;
  for (const u of civ.units.filter((u) => u.availability === "available")) {
    const earlyAnti = u.age === "BronzeAge" && u.role === "antiCavalry";
    if (earlyAnti) {
      // This class arrives with bronze equipment, rather than a free age grant
      // or a separate research click. Keep the authored equipment prerequisite.
      u.prerequisites = ["bronzeage-bronze-equipment"];
      u.notes = "Unlocked by Bronze Equipment.";
      const obsolete = civ.technologies.findIndex(
        (t) => t.id === `russian-troop-${u.id}`,
      );
      if (obsolete >= 0) civ.technologies.splice(obsolete, 1);
      continue;
    }
    const oldLinks = [...u.prerequisites];
    const linked =
      oldLinks.length === 1
        ? civ.technologies.find((t) => t.id === oldLinks[0])
        : undefined;
    const dedicated =
      linked?.kind === "unlock" &&
      linked.age === u.age &&
      (linked.id.startsWith("russian-troop-") ||
        (linked.id.startsWith("russian-") &&
          !["russian-infantry-optics", "russian-vehicle-electronics"].includes(
            linked.id,
          ))) &&
      civ.units.filter(
        (other) =>
          other.availability === "available" &&
          other.prerequisites.includes(linked.id),
      ).length === 1;
    const producer = ["frontline", "antiCavalry"].includes(u.role)
      ? "barracks"
      : u.role === "rangedInfantry"
        ? "archery"
        : civ.ages.findIndex((a) => a.id === u.age) >= 6
          ? "depot"
          : "stables";
    const building = buildingUnlockId(u.age, producer);
    const parents = [
      ...oldLinks,
      ...(oldLinks.length
        ? []
        : [
            technologyAt(sourceAge(u.age), "warfare", foundationSlot[u.role])
              .id,
          ]),
      building,
    ];
    const node = dedicated
      ? linked!
      : add(
          `russian-troop-${u.id}`,
          u.age,
          "warfare",
          u.name,
          parents,
          `Unlock ${u.name}.`,
        );
    node.name = u.name;
    node.description = `Unlock ${u.name}: ${u.role}. Produced at ${BUILDING_RULES[producer as BuildingType].name}.`;
    if (dedicated)
      node.prerequisites = [...new Set([...node.prerequisites, building])];
    u.prerequisites = [node.id];
  }
  // Siege units sit outside the six troop lanes but need individual research too.
  for (const u of UNITS.filter(
    (u) => u.role === "siege" || u.role === "artillery",
  )) {
    if (
      u.age === "Modern" ||
      (u.age === "EarlyModern" && u.role === "artillery")
    )
      continue;
    const age = u.age;
    const legacyId = u.id
      .replace(/^napoleonic-/, "earlymodern-")
      .replace(
        /^earlymodern-/,
        u.age === "EarlyModern" ? "modern-" : "earlymodern-",
      );
    add(
      `russian-support-${legacyId}`,
      age,
      "warfare",
      u.name,
      [
        technologyAt(
          age,
          "warfare",
          u.role === "artillery" && AGES.indexOf(age) > 1
            ? 2
            : AGES.indexOf(age) >= 6
              ? 2
              : 4,
        ).id,
        buildingUnlockId(age, "siege-workshop"),
      ],
      `Unlock ${u.name} at the Siege workshop.`,
    );
  }
  // Inherited pre-Napoleonic foundations must not claim obsolete generic troops.
  const foundations: Record<string, [string, string]> = {
    "earlymodern-musket-and-artillery-drill": [
      "Musket Drill",
      "Musket equipment foundation. Rus Musketeer has a separate unlock.",
    ],
    "earlymodern-pistoliers": [
      "Lancer Training",
      "Mounted lance training. Cossack Lancers have a separate unlock.",
    ],
    "stoneage-flint-weapons": [
      "Flint Weapons",
      "Foundation for Stone Age weapons. Barracks and troop unlocks are separate nodes.",
    ],
    "stoneage-spear-throwing": [
      "Spear Throwing",
      "Foundation for thrown weapons. Javelin Throwers have a separate unlock.",
    ],
    "stoneage-horsemanship": [
      "Horsemanship",
      "Horse handling and breeding. Stables and mounted troops have separate unlocks.",
    ],
    "bronzeage-bronze-equipment": [
      "Bronze Equipment",
      "Unlock Bronze Spearmen and develop bronze troop equipment. Bronze Axemen and Blacksmith have separate unlocks.",
    ],
    "bronzeage-bowcraft": [
      "Bowcraft",
      "Bronze bow equipment. Archers have a separate unlock.",
    ],
    "bronzeage-chariot-warfare": [
      "Bronze Horsemanship",
      "Mounted spear equipment and horse training. Spear Riders have a separate unlock; no chariots or ranged cavalry.",
    ],
    "classicalage-professional-infantry": [
      "Professional Infantry",
      "Infantry equipment and army capacity. Varangians and Heavy Spearmen have separate unlocks.",
    ],
    "classicalage-ranged-warfare": [
      "Ranged Warfare",
      "Ranged equipment. Recurve Bowmen, Mangonel and Siege workshop have separate unlocks.",
    ],
    "classicalage-cavalry-tactics": [
      "Cavalry Tactics",
      "Mounted combat training. Light Horsemen and Horse Archers have separate unlocks; no heavy cavalry.",
    ],
    "earlymedieval-mail-equipment": [
      "Mail Equipment",
      "Mail equipment and army capacity. Rus Woodsman and Mail Spearman have separate unlocks.",
    ],
    "earlymedieval-bow-and-bolt-warfare": [
      "Bow Warfare",
      "Bow equipment. Rus Bowmen and Ballista have separate unlocks.",
    ],
    "earlymedieval-mounted-spearmen": [
      "Rus Horsemanship",
      "Mounted combat training. Rus Lancer, Druzhina and Early Cossack Archer have separate unlocks.",
    ],
    "latemedieval-steel-equipment": [
      "Steel Equipment",
      "Steel equipment and army capacity. Boyar Guards and Plate Spearman have separate unlocks.",
    ],
    "latemedieval-crossbows-and-field-guns": [
      "Crossbow and Field Gun Engineering",
      "Equipment foundation. Rus Crossbowman, Organ gun and Siege workshop have separate unlocks.",
    ],
    "latemedieval-lance-knights": [
      "Cossack and Boyar Horsemanship",
      "Mounted combat training. Cossack Riders, Boyar Cavalry and Heavy Cossack Archer have separate unlocks.",
    ],
  };
  for (const [id, [name, description]] of Object.entries(foundations)) {
    const node = civ.technologies.find((t) => t.id === id);
    if (node) Object.assign(node, { name, description, kind: "upgrade" });
  }
  for (const node of civ.technologies.filter(
    (t) => !t.id.startsWith("russian-") && !foundations[t.id],
  )) {
    if (
      !node.description.includes("In this draft,") &&
      (node.description.includes("Unlocks") ||
        node.description.includes("Unlock "))
    )
      node.description +=
        " In this draft, troop and building construction requires the separately named unlock nodes; this foundation does not grant them automatically.";
  }
  const electronics = civ.technologies.find(
    (t) => t.id === "russian-vehicle-electronics",
  );
  if (electronics)
    Object.assign(electronics, {
      kind: "upgrade",
      description:
        "Develop modern vehicle electronics. VPK Bumerang, T-14 and 2K22 Tunguska each have their own unlock.",
    });
}
