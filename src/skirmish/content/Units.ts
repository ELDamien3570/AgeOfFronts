import { FIXED, TICKS_PER_SECOND, type SquadType } from "../Protocol";
import { damageAmount } from "../domain/Combat";
import {
  AGES,
  isCavalryTroopClass,
  type Age,
  type AttackProfile,
  type ProductionRecipe,
  type TargetTag,
  type UnitDefinition,
  type VesselDefinition,
} from "../domain/Definitions";
import {
  EQUIPMENT_RECIPES,
  equipmentItem,
  type EquipmentKind,
} from "./Equipment";
import { RUSSIAN_RECRUITMENT } from "./RussianRecruitment";
import {
  canonicalTechnologyId,
  packageTechnology,
  TECHNOLOGY,
} from "./Technology";
import { weaponCycle } from "./WeaponCycles";
const ground: readonly TargetTag[] = [
  "infantry",
  "ranged",
  "mounted",
  "vehicle",
  "siege",
  "structure",
  "wall",
];
export const UNITS: UnitDefinition[] = [];
export const RECIPES: ProductionRecipe[] = EQUIPMENT_RECIPES;
function addEquipment(
  unit: UnitDefinition,
  index: number,
  kind: EquipmentKind = "troop",
): void {
  if (!index && kind === "troop") return;
  const item = equipmentItem(unit.age, kind);
  unit.equipment = item;
  unit.cost = {
    ...unit.cost,
    items: {
      ...unit.cost.items,
      [item]: unit.tags.includes("mounted") ? 2 : 1,
      ...(kind === "vehicle" ? { [equipmentItem(unit.age, "siege")]: 1 } : {}),
    },
  };
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
  const siegeNames = [
    "Field ram",
    "Battering ram",
    "Onager",
    "Trebuchet",
    "Bombard",
    "Early howitzer",
    "Modern howitzer",
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
    if (index >= 6 && field) {
      attack.bonuses = { infantry: 80, ranged: 100 };
      attack.range = 7 * FIXED;
      attack.reloadTicks = 20;
    }
    if (!contact && !(index >= 6 && field))
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
      technologyId: packageTechnology(age, "siege"),
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
    const sourceEra =
      age === "Napoleonic"
        ? "earlymodern"
        : age === "EarlyModern"
          ? "modern"
          : age.toLowerCase();
    const unlock = TECHNOLOGY.get(
      `russian-support-${sourceEra}-${field ? "field-support" : "siege"}`,
    );
    if (unlock?.age === age) unit.technologyId = unlock.id;
    addEquipment(unit, index, index >= 6 && field ? "troop" : "siege");
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
    age: role === "anti-air" ? "EarlyModern" : "Modern",
    line: "cavalry",
    role,
    technologyId:
      role === "launcher"
        ? packageTechnology("Modern", "mirvs-drones")
        : packageTechnology("EarlyModern", "fortifications"),
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
    cost: { gold: 3000, reserves: 1000 },
    canCapture: false,
    placeholder: true,
  };
  addEquipment(unit, AGES.indexOf(unit.age), "vehicle");
  UNITS.push(unit);
}
// The six authored classes share the existing movement/collider families.
// Primary IDs stay stable for command and presentation hooks.
const classProfiles = {
  frontline: {
    hp: 60,
    damage: 6,
    bonus: 8,
    melee: 1,
    pierce: 0,
    reload: 2,
    speed: 100,
  },
  antiCavalry: {
    hp: 60,
    damage: 4,
    bonus: 24,
    melee: 0,
    pierce: 0,
    reload: 3,
    speed: 90,
  },
  rangedInfantry: {
    hp: 30,
    damage: 4,
    bonus: 6,
    melee: 0,
    pierce: 0,
    reload: 2,
    speed: 90,
  },
  lightCavalry: {
    hp: 80,
    damage: 8,
    bonus: 10,
    melee: 1,
    pierce: 1,
    reload: 2,
    speed: 160,
  },
  heavyCavalry: {
    hp: 100,
    damage: 10,
    bonus: 18,
    melee: 2,
    pierce: 2,
    reload: 1.8,
    speed: 130,
  },
  rangedCavalry: {
    hp: 50,
    damage: 6,
    bonus: 8,
    melee: 0,
    pierce: 0,
    reload: 2,
    speed: 150,
  },
} as const;
for (const troop of RUSSIAN_RECRUITMENT.units) {
  const age = troop.age as Age,
    index = AGES.indexOf(age),
    factor = 1.5 ** index;
  const cls = troop.troopClass as keyof typeof classProfiles,
    stats = classProfiles[cls];
  const mounted = isCavalryTroopClass(cls),
    vehicle = mounted && index >= 6;
  const rangedAttack =
    cls === "rangedInfantry" ||
    cls === "rangedCavalry" ||
    index >= 6 ||
    (age === "Napoleonic" && cls === "frontline");
  const line = mounted
    ? "cavalry"
    : cls === "rangedInfantry"
      ? "archer"
      : "infantry";
  const primary =
    cls === "frontline" || cls === "rangedInfantry" || cls === "lightCavalry";
  const points = (value: number) => Math.round(((value * 1000) / 60) * factor);
  const spearBonus = stats.bonus;
  const bonuses =
    cls === "antiCavalry"
      ? {
          mounted: points(spearBonus),
          vehicle: points(spearBonus),
          armoured: points(14),
        }
      : cls === "rangedInfantry" || cls === "rangedCavalry"
        ? { infantry: points(stats.bonus) }
        : { ranged: points(stats.bonus) };
  const unit: UnitDefinition = {
    id: primary ? `${age.toLowerCase()}-${line}` : troop.id,
    name: troop.name,
    age,
    line,
    troopClass: cls,
    trainingSeconds: troop.trainingSeconds,
    role: mounted
      ? "mounted"
      : cls === "rangedInfantry"
        ? "ranged"
        : "frontline",
    technologyId: troop.technologyId,
    building: vehicle
      ? "depot"
      : mounted
        ? "stables"
        : line === "archer"
          ? "archery"
          : "barracks",
    tags: vehicle
      ? [
          "vehicle",
          ...(cls === "heavyCavalry" || cls === "rangedCavalry"
            ? ["armoured" as const]
            : []),
        ]
      : mounted
        ? [
            "mounted",
            ...(cls === "heavyCavalry" ? ["armoured" as const] : []),
            ...(cls === "rangedCavalry" ? ["ranged" as const] : []),
          ]
        : cls === "rangedInfantry"
          ? ["ranged"]
          : ["infantry"],
    speedPercent: vehicle ? 120 : stats.speed,
    armourKind: "points",
    healthPercent: Math.round(
      ((cls === "heavyCavalry" && index === 4 ? 150 : stats.hp) / 60) *
        100 *
        factor,
    ),
    meleeArmour: points(stats.melee),
    rangedArmour: points(stats.pierce),
    bonusResistance: {},
    attack: profile(
      rangedAttack ? "ranged" : "melee",
      points(stats.damage),
      rangedAttack
        ? index >= 6
          ? cls === "frontline"
            ? 4
            : cls === "antiCavalry" || cls === "rangedCavalry"
              ? 8
              : cls === "rangedInfantry"
                ? 10
                : 5
          : cls === "rangedCavalry"
            ? 5
            : 6
        : 1.5,
      stats.reload,
      bonuses,
    ),
    cost: {
      gold: troop.gold,
      reserves: 1000,
      items: mounted && !vehicle ? { horses: 20 } : {},
    },
    canCapture: true,
    ...(mounted && !vehicle && cls !== "rangedCavalry"
      ? {
          charge: {
            speedPercent: 250,
            damage: points(6),
            radius: Math.round(1.25 * FIXED),
            cooldownTicks: 20 * TICKS_PER_SECOND,
            runupTicks: 10,
            maximumDistance: 10 * FIXED,
            penetration: 2500,
          },
        }
      : {}),
  };
  if (vehicle && (cls === "rangedCavalry" || cls === "heavyCavalry"))
    unit.attack.projectile = {
      diameter: FIXED / 4,
      speed: FIXED * 2,
      blastRadius: 0,
    };
  const cycle = weaponCycle(unit);
  if (cycle && rangedAttack) {
    const sustained =
      ((cycle.rounds - 1) * cycle.interval + cycle.reload) / cycle.rounds;
    const multiplier = Math.min(1, sustained / unit.attack.reloadTicks);
    unit.attack.damage = Math.max(
      1,
      Math.round(unit.attack.damage * multiplier),
    );
    unit.attack.bonuses = Object.fromEntries(
      Object.entries(unit.attack.bonuses).map(([tag, n]) => [
        tag,
        Math.round(n * multiplier),
      ]),
    );
    unit.attack.reloadTicks = cycle.interval;
  }
  if (age === "Napoleonic" && cls === "frontline") {
    unit.attack.range = 3 * FIXED;
    unit.charge = {
      speedPercent: 150,
      damage: points(4),
      radius: FIXED,
      cooldownTicks: 400,
      runupTicks: 6,
      maximumDistance: 6 * FIXED,
      penetration: 1000,
    };
  }
  if (rangedAttack && index < 5)
    unit.attack.projectile = {
      diameter: FIXED / 10,
      speed: FIXED * 0.4,
      blastRadius: 0,
    };
  addEquipment(unit, index, vehicle ? "vehicle" : "troop");
  UNITS.push(unit);
}
for (const unit of UNITS)
  unit.technologyId = canonicalTechnologyId(unit.technologyId);
UNITS.sort(
  (a, b) =>
    AGES.indexOf(a.age) - AGES.indexOf(b.age) ||
    Number(
      ["frontline", "rangedInfantry", "lightCavalry"].includes(
        a.troopClass ?? "",
      ),
    ) -
      Number(
        ["frontline", "rangedInfantry", "lightCavalry"].includes(
          b.troopClass ?? "",
        ),
      ) ||
    a.id.localeCompare(b.id, "en"),
);
export const UNIT = new Map(UNITS.map((u) => [u.id, u]));
export function defaultUnit(
  line: SquadType,
  age: Age = "StoneAge",
): UnitDefinition {
  return UNIT.get(`${age.toLowerCase()}-${line}`)!;
}
export const VESSELS: VesselDefinition[] = [];
export const TRANSPORT_CAPACITIES = [10, 12, 14, 16, 18, 20, 25, 30] as const;
for (const [index, age] of AGES.entries())
  for (const kind of ["transport", "warship", "trade"] as const) {
    const slot = kind === "warship" ? 3 : kind === "trade" || index > 1 ? 2 : 1;
    const actualSlot = index === 0 && kind === "transport" ? 2 : slot;
    VESSELS.push({
      id: `${age.toLowerCase()}-${kind}`,
      name: `${age === "StoneAge" ? "Canoe" : age === "Modern" ? "Powered" : age.replace(/Age$/, "")} ${kind === "trade" ? "merchant vessel" : kind}`,
      age,
      kind,
      technologyId: packageTechnology(
        age,
        age === "StoneAge"
          ? kind === "transport"
            ? "cargo-canoes"
            : kind === "warship" ? "warships" : "port-sea-trade"
          : kind === "warship"
            ? "warships"
            : kind === "trade"
              ? "sea-traders"
              : "ports",
      ),
      cost: {
        gold: (kind === "warship" ? 700 : 300) * (index + 1),
      },
      health:
        kind === "transport"
          ? Math.round(
              damageAmount(
                {
                  ...profile(
                    "ranged",
                    Math.round(160 * 1.3 ** index),
                    7 + index,
                    2,
                  ),
                  targets: ["ship"],
                },
                {
                  tags: ["ship"],
                  meleeArmour: 1000,
                  rangedArmour: 2000,
                  bonusResistance: {},
                },
              ) *
                (1 + index * 0.5),
            )
          : Math.round((kind === "warship" ? 1000 : 600) * 1.3 ** index),
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
for (const age of ["EarlyModern", "Modern"] as const) {
  const ship = VESSELS.find((v) => v.age === age && v.kind === "warship")!;
  VESSELS.push({
    ...ship,
    id: `${age.toLowerCase()}-submarine`,
    name: age === "Modern" ? "Nuclear submarine" : "Diesel submarine",
    technologyId: packageTechnology(age, "submarines"),
    cost: { gold: (ship.cost.gold ?? 0) * 1.25 },
  });
}
export const VESSEL = new Map(VESSELS.map((v) => [v.id, v]));
