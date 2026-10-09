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
  mine: {
    name: "Mine",
    glyph: "M",
    cost: 600,
    ticks: 160,
    reserveIncome: 0,
    goldIncome: 0,
  },
  blacksmith: {
    name: "Blacksmith",
    glyph: "K",
    cost: 1500,
    ticks: 200,
    reserveIncome: 0,
    goldIncome: 0,
  },
  armory: {
    name: "Armory",
    glyph: "A",
    cost: 3000,
    ticks: 240,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "arms-factory": {
    name: "Arms factory",
    glyph: "W",
    cost: 5000,
    ticks: 300,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "siege-workshop": {
    name: "Siege workshop",
    glyph: "S",
    cost: 1800,
    ticks: 200,
    reserveIncome: 0,
    goldIncome: 0,
  },
  depot: {
    name: "Vehicle depot",
    glyph: "V",
    cost: 5000,
    ticks: 300,
    reserveIncome: 0,
    goldIncome: 0,
  },
  tower: {
    name: "Tower",
    glyph: "T",
    cost: 900,
    ticks: 160,
    reserveIncome: 0,
    goldIncome: 0,
  },
  airstrip: {
    name: "Military airstrip",
    glyph: "A",
    cost: 7000,
    ticks: 400,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "oil-well": {
    name: "Oil well",
    glyph: "O",
    cost: 4000,
    ticks: 240,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "oil-rig": {
    name: "Oil rig",
    glyph: "O",
    cost: 6000,
    ticks: 300,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "gun-nest": {
    name: "Gun nest",
    glyph: "N",
    cost: 3000,
    ticks: 200,
    reserveIncome: 0,
    goldIncome: 0,
  },
  trench: {
    name: "Trench",
    glyph: "H",
    cost: 1800,
    ticks: 160,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "missile-silo": {
    name: "Missile silo",
    glyph: "I",
    cost: 12000,
    ticks: 600,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "mirv-launcher": {
    name: "MIRV launch complex",
    glyph: "R",
    cost: 16000,
    ticks: 600,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "missile-defence": {
    name: "Missile defence",
    glyph: "D",
    cost: 9000,
    ticks: 400,
    reserveIncome: 0,
    goldIncome: 0,
  },
  "nuclear-facility": {name:"Nuclear weapons facility",glyph:"N",cost:6000,ticks:600,reserveIncome:0,goldIncome:0},
  "anti-air-emplacement": {name:"Anti-aircraft emplacement",glyph:"AA",cost:3000,ticks:300,reserveIncome:0,goldIncome:0},
  "drone-facility": {name:"Drone facility",glyph:"D",cost:4000,ticks:400,reserveIncome:0,goldIncome:0},
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
export const MAX_FACTION_SHIPS = MAX_SHIPS;
export const REPLENISH_DELAY = 3 * TICKS_PER_SECOND;
export const REPLENISH_PER_SECOND = 50;

export const ARCHER_CHARGE_REQUIRED = 100;
export const ARCHER_STATIONARY_CHARGE = 5; // One volley per second.
export const ARCHER_MOVING_CHARGE = 1; // One volley per five seconds.
export const ARCHER_ARROW_TICKS = 12;
