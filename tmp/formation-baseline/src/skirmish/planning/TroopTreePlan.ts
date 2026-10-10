import {
  ROLE_NAMES,
  type CivilizationPlan,
  type PlannedUnit,
  type UnitRole,
} from "./TechnologyPlan";

export const TROOP_STATS = [
  "health",
  "attack",
  "armour",
  "speed",
  "range",
] as const;
export type TroopStat = (typeof TROOP_STATS)[number];
export interface TroopProposal {
  unit: PlannedUnit;
  gold: number;
  trainingSeconds: number;
  stats: Record<TroopStat, number>;
  counter: string;
  targetBonus: number;
  specialty: string;
}
export const TROOP_ROLE_DESIGN: Record<
  UnitRole,
  {
    gold: number;
    seconds: number;
    stats: Record<TroopStat, number>;
    counter: string;
    bonus: number;
    specialty: string;
    color: string;
  }
> = {
  frontline: {
    gold: 60,
    seconds: 12,
    stats: { health: 55, attack: 50, armour: 45, speed: 50, range: 10 },
    counter: "General-purpose",
    bonus: 1,
    specialty:
      "Cheap, quick to train and useful in most fights. No specialist damage bonus.",
    color: "#b8b9ab",
  },
  antiCavalry: {
    gold: 90,
    seconds: 20,
    stats: { health: 55, attack: 42, armour: 40, speed: 40, range: 15 },
    counter: "All cavalry classes",
    bonus: 2,
    specialty:
      "Dedicated cavalry and vehicle counter. Modest damage against other targets.",
    color: "#e1bf78",
  },
  rangedInfantry: {
    gold: 100,
    seconds: 24,
    stats: { health: 35, attack: 58, armour: 20, speed: 45, range: 80 },
    counter: "Infantry",
    bonus: 1.75,
    specialty:
      "Counters regular and anti-cavalry infantry at range; vulnerable when cavalry closes.",
    color: "#8cbda5",
  },
  lightCavalry: {
    gold: 170,
    seconds: 30,
    stats: { health: 60, attack: 55, armour: 35, speed: 95, range: 15 },
    counter: "Ranged infantry",
    bonus: 1.6,
    specialty:
      "Fast flanker that hunts ranged infantry. Represented by machine-gun trucks in Early Modern and VPK Bumerang in Modern.",
    color: "#81b8dc",
  },
  heavyCavalry: {
    gold: 390,
    seconds: 60,
    stats: { health: 85, attack: 72, armour: 85, speed: 60, range: 10 },
    counter: "Ranged infantry",
    bonus: 1.8,
    specialty:
      "Expensive, durable ranged-infantry counter. Peaks relative to its era in Late Medieval; represented by WWI tanks in Early Modern and T-14 in Modern.",
    color: "#c8a0e3",
  },
  rangedCavalry: {
    gold: 230,
    seconds: 40,
    stats: { health: 60, attack: 65, armour: 40, speed: 75, range: 65 },
    counter: "Infantry",
    bonus: 1.8,
    specialty:
      "Mobile ranged counter to regular and anti-cavalry infantry. Represented by WWII tanks in Early Modern and 2K22 Tunguska in Modern.",
    color: "#df967e",
  },
};

/** Confirmed availability decisions, independent from proposed combat numbers. */
export function applyRussianTroopAvailability(civ: CivilizationPlan): void {
  const ages = civ.ages.map((a) => a.id);
  for (const unit of civ.units) {
    const index = ages.indexOf(unit.age);
    if (unit.role === "rangedCavalry" && index <= 1) {
      unit.availability = "unavailable";
      unit.prerequisites = [];
      unit.notes =
        "Confirmed: ranged cavalry is absent in Stone and Bronze ages.";
      unit.decision = "confirmed";
    }
    if (unit.role === "antiCavalry") {
      unit.availability = index >= 1 ? "available" : "unavailable";
      unit.notes =
        index >= 1
          ? "Confirmed: anti-cavalry infantry is available from the start of Bronze Age. Troop name and exact research prerequisite remain proposals."
          : "Confirmed: anti-cavalry infantry is absent in Stone Age.";
      unit.decision = "confirmed";
    }
    if (unit.role === "heavyCavalry") {
      unit.availability = index >= 3 ? "available" : "unavailable";
      unit.notes =
        index >= 3
          ? "Confirmed: Russian heavy cavalry begins in Early Medieval, peaks relative to its era in Late Medieval and remains expensive. Name and exact research prerequisite are proposals."
          : "Confirmed: Russian heavy cavalry is absent before Early Medieval.";
      unit.decision = "confirmed";
    }
  }
}

/** Ratings compare units within the same era, not historical absolute firepower.
 * Costs and training times are provisional and never modify runtime definitions. */
export function buildTroopProposals(civ: CivilizationPlan): TroopProposal[] {
  const factors = [1, 1.45, 2.1, 3, 4.3, 6.2, 9, 13.5];
  return civ.units
    .filter((u) => u.availability === "available")
    .map((unit) => {
      const ageIndex = civ.ages.findIndex((a) => a.id === unit.age);
      const design = TROOP_ROLE_DESIGN[unit.role];
      const stats = { ...design.stats };
      let gold = design.gold;
      if (unit.role === "heavyCavalry" && unit.age === "LateMedieval") {
        Object.assign(stats, { health: 95, attack: 85, armour: 95, speed: 55 });
        gold = 480;
      }
      if (ageIndex >= 6) {
        if (unit.role === "lightCavalry") stats.range = 45;
        if (unit.role === "heavyCavalry") {
          stats.range = 40;
          stats.speed = 65;
        }
        if (unit.role === "rangedCavalry")
          Object.assign(stats, { armour: 70, range: 85, speed: 60 });
        if (unit.role === "frontline") stats.range = 45;
        if (unit.role === "antiCavalry") stats.range = 70;
      }
      return {
        unit,
        gold: Math.round((gold * (factors[ageIndex] ?? 13.5)) / 5) * 5,
        trainingSeconds:
          design.seconds +
          (unit.role === "heavyCavalry" && unit.age === "LateMedieval"
            ? 10
            : 0),
        stats,
        counter: design.counter,
        targetBonus: design.bonus,
        specialty: design.specialty,
      };
    });
}
export const troopTypeName = (role: UnitRole) =>
  role === "frontline" ? "Regular infantry" : ROLE_NAMES[role];
