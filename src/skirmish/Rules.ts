import type { BuildingType, ShipType, SquadType } from "./Protocol";
import { FIXED, MELEE_RANGE, TICKS_PER_SECOND } from "./Protocol";

// Playtest balance lives here. The simulation owns all costs and eligibility;
// the client only presents these definitions and submits player commands.
export const SQUAD_RULES: Record<
  SquadType,
  {
    name: string;
    glyph: string;
    speedPercent: number;
    range: number;
    damage: number;
    closeDamage: number;
  }
> = {
  infantry: {
    name: "Infantry",
    glyph: "I",
    speedPercent: 100,
    range: MELEE_RANGE,
    damage: 7,
    closeDamage: 7,
  },
  archer: {
    name: "Archers",
    glyph: "A",
    speedPercent: 90,
    range: 6 * FIXED,
    damage: 25, // Per volley; melee classes still deal damage per tick.
    closeDamage: 10,
  },
  cavalry: {
    name: "Cavalry",
    glyph: "C",
    speedPercent: 160,
    range: MELEE_RANGE,
    damage: 9,
    closeDamage: 9,
  },
};

export const BUILDING_RULES: Record<
  BuildingType,
  {
    name: string;
    glyph: string;
    cost: number;
    ticks: number;
    squad?: SquadType;
    reserveIncome: number;
    goldIncome: number;
  }
> = {
  barracks: {
    name: "Barracks",
    glyph: "B",
    cost: 400,
    ticks: 5 * TICKS_PER_SECOND,
    squad: "infantry",
    reserveIncome: 0,
    goldIncome: 0,
  },
  archery: {
    name: "Archery range",
    glyph: "A",
    cost: 500,
    ticks: 6 * TICKS_PER_SECOND,
    squad: "archer",
    reserveIncome: 0,
    goldIncome: 0,
  },
  stables: {
    name: "Stables",
    glyph: "C",
    cost: 700,
    ticks: 8 * TICKS_PER_SECOND,
    squad: "cavalry",
    reserveIncome: 0,
    goldIncome: 0,
  },
  city: {
    name: "City",
    glyph: "◆",
    cost: 800,
    ticks: 8 * TICKS_PER_SECOND,
    reserveIncome: 40,
    goldIncome: 0,
  },
  factory: {
    name: "Factory",
    glyph: "F",
    cost: 1000,
    ticks: 10 * TICKS_PER_SECOND,
    reserveIncome: 0,
    goldIncome: 20,
  },
  port: {
    name: "Port",
    glyph: "P",
    cost: 900,
    ticks: 10 * TICKS_PER_SECOND,
    reserveIncome: 0,
    goldIncome: 12,
  },
};

export const SHIP_RULES: Record<
  ShipType,
  {
    name: string;
    glyph: string;
    cost: number;
    health: number;
    speed: number;
    capacity: number;
    range: number;
    damage: number;
  }
> = {
  transport: {
    name: "Transport",
    glyph: "T",
    cost: 300,
    health: 600,
    speed: 70,
    capacity: 4,
    range: 0,
    damage: 0,
  },
  warship: {
    name: "Warship",
    glyph: "W",
    cost: 700,
    health: 1000,
    speed: 55,
    capacity: 0,
    range: 7 * FIXED,
    damage: 8,
  },
};

export const STARTING_GOLD = 3000;
export const MAX_BUILDINGS = Infinity;
export const MAX_SHIPS = 64;
export const BUILDING_SPACING = 3;
export const REPLENISH_DELAY = 3 * TICKS_PER_SECOND;
export const REPLENISH_PER_SECOND = 50;

export const ARCHER_CHARGE_REQUIRED = 100;
export const ARCHER_STATIONARY_CHARGE = 5; // One volley per second.
export const ARCHER_MOVING_CHARGE = 1; // One volley per five seconds.
export const ARCHER_ARROW_TICKS = 12;
