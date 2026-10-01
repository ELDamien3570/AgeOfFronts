import { FIXED, TICKS_PER_SECOND, type SquadType } from "../Protocol";
import {
  AGES,
  type Age,
  type AttackProfile,
  type ProductionRecipe,
  type TargetTag,
  type UnitDefinition,
  type VesselDefinition,
} from "../domain/Definitions";
import { technologyAt } from "./Technology";
const ground: readonly TargetTag[] = [
  "infantry",
  "ranged",
  "mounted",
  "vehicle",
  "siege",
  "structure",
  "wall",
];
const frontline = [
  "Clubmen",
  "Bronze swordsmen",
  "Sword-and-shield infantry",
  "Mail infantry",
  "Plate swordsmen",
  "Short-gun infantry",
  "Rifle infantry",
];
const ranged = [
  "Javelinists",
  "Bronze archers",
  "Classical archers",
  "Bowmen",
  "Crossbowmen",
  "Musketeers",
  "Marksmen",
];
const mobile = [
  "Mounted spearmen",
  "Chariots",
  "Mounted swordsmen",
  "Mounted spearmen",
  "Lance knights",
  "Pistoliers",
  "Tanks",
];
const materials = [
  null,
  "bronze",
  "iron",
  "iron",
  "steel",
  "gunpowder",
  "steel",
] as const;
export const UNITS: UnitDefinition[] = [];
export const RECIPES: ProductionRecipe[] = [];
function addEquipment(unit: UnitDefinition, index: number): void {
  if (!index) return;
  const item = `equipment:${unit.id}`;
  unit.equipment = item;
  unit.cost = { ...unit.cost, items: { ...unit.cost.items, [item]: 1 } };
  RECIPES.push({
    id: `make-${unit.id}`,
    name: `${unit.name} equipment`,
    technologyId: unit.technologyId,
    building:
      index === 6 ? "arms-factory" : index === 5 ? "armory" : "blacksmith",
    inputs: {
      [materials[index]!]:
        unit.role === "frontline" || unit.role === "ranged" ? 12 : 20,
      ...(index >= 5 ? { gunpowder: 10 } : {}),
    },
    outputs: { [item]: 1 },
    ticks: (15 + index * 5) * TICKS_PER_SECOND,
  });
}
const profile = (
  channel: "melee" | "ranged",
  damage: number,
  range: number,
  reload: number,
  bonuses: AttackProfile["bonuses"] = {},
): AttackProfile => ({
  channel,
  damage,
  range: Math.round(range * FIXED),
  reloadTicks: reload * TICKS_PER_SECOND,
  movingReloadPercent: channel === "ranged" ? 500 : 100,
  bonuses,
  penetration: 0,
  targets: ground,
});
for (const [index, age] of AGES.entries()) {
  const factor = 1.5 ** index;
  // Authored tier equipment, not a hidden age-gap damage multiplier. Increasing
  // attack and flat armour together keeps contemporary battles from becoming
  // exponentially faster while obsolete weapons struggle against new armour.
  const protection = [0, 0.48, 0.64, 0.74, 0.8, 0.84, 0.88][index];
  for (const [line, slot, names] of [
    ["infantry", 1, frontline],
    ["archer", 2, ranged],
    ["cavalry", 3, mobile],
  ] as const) {
    const vehicle = index === 6 && line === "cavalry",
      mounted = line === "cavalry" && !vehicle;
    const firearm = index >= 5;
    const attack =
      line === "archer"
        ? profile(
            "ranged",
            Math.round((firearm ? 114 : 35) * factor),
            firearm ? 12 + index - 5 : 6 + index * 0.5,
            2,
            {
              mounted: Math.round(12 * factor),
            },
          )
        : line === "infantry"
          ? profile(
              firearm ? "ranged" : "melee",
              Math.round(120 * factor),
              firearm ? 5 + index : 1.5,
              firearm ? 2 : 1.5,
              { ranged: Math.round(10 * factor) },
            )
          : profile(
              index >= 5 ? "ranged" : "melee",
              Math.round(145 * factor),
              vehicle ? 8 : firearm ? 4 : 1.5,
              vehicle ? 3 : 2,
              { ranged: Math.round(18 * factor) },
            );
    if (index === 4 && line === "archer") attack.penetration = 2000;
    if (vehicle)
      attack.projectile = {
        diameter: FIXED / 5,
        speed: FIXED * 2,
        blastRadius: FIXED,
      };
    const unit: UnitDefinition = {
      id: `${age.toLowerCase()}-${line}`,
      name: names[index],
      age,
      line,
      role: vehicle
        ? "mounted"
        : line === "infantry"
          ? "frontline"
          : line === "archer"
            ? "ranged"
            : "mounted",
      technologyId: technologyAt(age, "warfare", vehicle ? 2 : slot).id,
      building: vehicle
        ? "depot"
        : line === "infantry"
          ? "barracks"
          : line === "archer"
            ? "archery"
            : "stables",
      tags: vehicle
        ? ["vehicle"]
        : mounted
          ? ["mounted"]
          : line === "archer"
            ? ["infantry", "ranged"]
            : ["infantry"],
      speedPercent: vehicle
        ? 120
        : mounted
          ? 160
          : line === "archer"
            ? 90
            : 100,
      armourKind: "points",
      meleeArmour: Math.round(120 * factor * protection),
      rangedArmour: Math.round((firearm ? 120 : 35) * factor * protection),
      bonusResistance: {
        infantry: Math.round(10 * (factor - 1)),
        ranged: Math.round(12 * (factor - 1)),
        mounted: Math.round(15 * (factor - 1)),
      },
      attack,
      cost: {
        gold: (line === "infantry"
          ? [100, 200, 350, 600, 1000, 1800, 3000]
          : line === "archer"
            ? [150, 300, 500, 850, 1400, 2300, 4000]
            : [250, 450, 750, 1200, 2000, 3200, 5000])[index],
        reserves: 1000,
        items: mounted
          ? { horses: index === 1 ? 40 : 20 }
          : vehicle
            ? { steel: 30, oil: 20 }
            : {},
      },
      canCapture: true,
      ...(mounted && index < 5
        ? {
            charge: {
              speedPercent: 280,
              damage: Math.round(120 * factor),
              radius: Math.round(1.25 * FIXED),
              cooldownTicks: 20 * TICKS_PER_SECOND,
              runupTicks: 10,
              maximumDistance: 10 * FIXED,
              penetration: 2500,
            },
          }
        : {}),
    };
    addEquipment(unit, index);
    UNITS.push(unit);
  }
  const siegeNames = [
    "Field ram",
    "Battering ram",
    "Onager",
    "Trebuchet",
    "Bombard",
    "Early howitzer",
    "Modern howitzer",
  ];
  const fieldNames = [
    "",
    "Assault siege tower",
    "Mangonel",
    "Ballista",
    "Organ gun",
    "Field cannon",
    "Machine-gun crew",
  ];
  for (const field of index ? [false, true] : [false]) {
    const contact = index < 2,
      id = `${age.toLowerCase()}-${field ? "field-support" : "siege"}`;
    const attack = profile(
      contact ? "melee" : "ranged",
      Math.round((contact ? (field ? 70 : 90) : field ? 160 : 240) * factor),
      contact ? 1.5 : field ? 8 : 11,
      contact ? 2 : field ? 4 : 6,
      {
        structure: Math.round((field ? 100 : 350) * factor),
        wall: Math.round((field ? 100 : 500) * factor),
      },
    );
    if (index === 6 && field) {
      attack.bonuses = { infantry: 80, ranged: 100 };
      attack.range = 7 * FIXED;
      attack.reloadTicks = 20;
    }
    if (!contact && !(index === 6 && field))
      attack.projectile = {
        diameter: Math.round(FIXED * 0.25),
        speed: FIXED,
        blastRadius: Math.round(FIXED * (field ? 1 : 1.5)),
      };
    const unit: UnitDefinition = {
      id,
      name: field ? fieldNames[index] : siegeNames[index],
      age,
      line: "archer",
      role: field ? "artillery" : "siege",
      technologyId: technologyAt(
        age,
        "warfare",
        field && index > 1 ? 2 : index === 6 ? 2 : 4,
      ).id,
      building: "siege-workshop",
      tags: ["siege"],
      speedPercent: contact ? 25 : 55,
      armourKind: "points",
      meleeArmour: Math.round(10 * factor),
      rangedArmour: Math.round(15 * factor),
      bonusResistance: {},
      attack,
      cost: { gold: 500 + index * 500, reserves: 1000 },
      canCapture: contact,
      ...(contact ? { undefendedCaptureTicks: 4 } : {}),
      placeholder: index === 0,
    };
    addEquipment(unit, index);
    UNITS.push(unit);
  }
}
for (const [role, name, targets] of [
  ["anti-air", "Anti-air vehicle", ["aircraft"]],
  ["launcher", "Mobile MIRV launcher", []],
] as const) {
  const unit: UnitDefinition = {
    id: `modern-${role}`,
    name,
    age: "Modern",
    line: "cavalry",
    role,
    technologyId: technologyAt("Modern", "warfare", role === "launcher" ? 4 : 2)
      .id,
    building: "depot",
    tags: ["vehicle"],
    speedPercent: 90,
    armourKind: "points",
    meleeArmour: 700,
    rangedArmour: 900,
    bonusResistance: {},
    attack: {
      ...profile("ranged", role === "anti-air" ? 150 : 0, 12, 2),
      targets: [...targets],
    },
    cost: { gold: 3000, reserves: 1000, items: { steel: 30, oil: 15 } },
    canCapture: false,
    placeholder: true,
  };
  addEquipment(unit, 6);
  UNITS.push(unit);
}
export const UNIT = new Map(UNITS.map((u) => [u.id, u]));
export function defaultUnit(
  line: SquadType,
  age: Age = "StoneAge",
): UnitDefinition {
  return UNIT.get(`${age.toLowerCase()}-${line}`)!;
}
export const VESSELS: VesselDefinition[] = [];
export const TRANSPORT_CAPACITIES = [10, 12, 14, 16, 18, 20, 25] as const;
for (const [index, age] of AGES.entries())
  for (const kind of ["transport", "warship", "trade"] as const) {
    const slot = kind === "warship" ? 3 : kind === "trade" || index > 1 ? 2 : 1;
    const actualSlot = index === 0 && kind === "transport" ? 2 : slot;
    VESSELS.push({
      id: `${age.toLowerCase()}-${kind}`,
      name: `${age === "StoneAge" ? "Canoe" : age === "Modern" ? "Powered" : age.replace(/Age$/, "")} ${kind === "trade" ? "merchant vessel" : kind}`,
      age,
      kind,
      technologyId: age === "StoneAge" && kind !== "warship" ? "stoneage-cargo-canoes" : technologyAt(age, "naval", actualSlot).id,
      cost: {
        gold: (kind === "warship" ? 700 : 300) * (index + 1),
        items:
          index >= 4 && kind === "warship"
            ? { gunpowder: 10, ...(index === 6 ? { oil: 20, steel: 20 } : {}) }
            : {},
      },
      health: Math.round((kind === "warship" ? 1000 : 600) * 1.3 ** index),
      speed: (kind === "warship" ? 55 : 70) + index * 6,
      capacity:
        kind === "transport"
          ? TRANSPORT_CAPACITIES[index]
          : kind === "trade"
            ? 20 + index * 10
            : 0,
      ...(kind === "warship"
        ? {
            attack: {
              ...profile(
                "ranged",
                Math.round(160 * 1.3 ** index),
                7 + index,
                2,
              ),
              targets: ["ship", "structure"],
              ...(index >= 4
                ? {
                    projectile: {
                      diameter: FIXED / 5,
                      speed: FIXED * 2,
                      blastRadius: FIXED,
                    },
                  }
                : {}),
            },
          }
        : {}),
    });
  }
export const VESSEL = new Map(VESSELS.map((v) => [v.id, v]));
