import type { BuildingType, ShipType, SquadType } from "../Protocol";

export const AGES = [
  "StoneAge",
  "BronzeAge",
  "ClassicalAge",
  "EarlyMedieval",
  "LateMedieval",
  "EarlyModern",
  "Modern",
] as const;
export type Age = (typeof AGES)[number];
export const AGE_NAMES = [
  "Stone Age",
  "Bronze Age",
  "Classical Age",
  "Early Medieval",
  "Late Medieval",
  "Early Modern",
  "Modern",
];
export const TREES = ["naval", "warfare", "economic"] as const;
export type Tree = (typeof TREES)[number];
export type TargetTag =
  | "infantry"
  | "ranged"
  | "mounted"
  | "vehicle"
  | "siege"
  | "ship"
  | "aircraft"
  | "structure"
  | "wall";
export type Resource =
  | "horses"
  | "stone"
  | "copper"
  | "tin"
  | "ironOre"
  | "carbon"
  | "sulphur"
  | "nitrate"
  | "bronze"
  | "iron"
  | "steel"
  | "gunpowder"
  | "oil";
export const RESOURCES: readonly Resource[] = [
  "horses",
  "stone",
  "copper",
  "tin",
  "ironOre",
  "carbon",
  "sulphur",
  "nitrate",
  "bronze",
  "iron",
  "steel",
  "gunpowder",
  "oil",
];
export type Inventory = Record<string, number>;
export interface Cost {
  gold?: number;
  reserves?: number;
  items?: Readonly<Inventory>;
}
export interface Technology {
  id: string;
  name: string;
  age: Age;
  tree: Tree;
  slot: number;
  prerequisites: readonly string[];
  gold: number;
  ticks: number;
  capabilities: readonly string[];
  description: string;
}
export interface ResearchJob {
  technologyId: string;
  remainingTicks: number;
  totalTicks: number;
}
export interface ProgressionState {
  cultureId: string;
  age: Age;
  completed: string[];
  research: Partial<Record<Tree, ResearchJob>>;
  advancement: {
    target: Age;
    remainingTicks: number;
    totalTicks: number;
  } | null;
}
export interface AttackProfile {
  channel: "melee" | "ranged";
  damage: number;
  range: number;
  reloadTicks: number;
  movingReloadPercent: number;
  bonuses: Partial<Record<TargetTag, number>>;
  penetration: number;
  projectile?: { diameter: number; speed: number; blastRadius: number };
  targets: readonly TargetTag[];
}
export interface ChargeProfile {
  speedPercent: number;
  damage: number;
  radius: number;
  cooldownTicks: number;
  runupTicks: number;
  maximumDistance: number;
  penetration: number;
}
export interface UnitDefinition {
  id: string;
  name: string;
  age: Age;
  line: SquadType;
  role:
    | "frontline"
    | "ranged"
    | "mounted"
    | "siege"
    | "artillery"
    | "anti-air"
    | "launcher";
  technologyId: string;
  building: BuildingType;
  tags: readonly TargetTag[];
  speedPercent: number;
  meleeArmour: number;
  rangedArmour: number;
  bonusResistance: Partial<Record<TargetTag, number>>;
  attack: AttackProfile;
  charge?: ChargeProfile;
  cost: Cost;
  equipment?: string;
  canCapture: boolean;
  placeholder?: boolean;
}
export interface VesselDefinition {
  id: string;
  name: string;
  age: Age;
  kind: ShipType | "trade";
  technologyId: string;
  cost: Cost;
  health: number;
  speed: number;
  capacity: number;
  attack?: AttackProfile;
}
export interface ProductionRecipe {
  id: string;
  name: string;
  technologyId: string;
  building: BuildingType;
  inputs: Readonly<Inventory>;
  outputs: Readonly<Inventory>;
  ticks: number;
}
export interface ProductionJob {
  recipeId: string;
  remainingTicks: number;
  totalTicks: number;
  owner: number;
}
export interface Deposit {
  id: number;
  tile: number;
  resource: Resource;
  owner: number;
  yieldPerSecond: number;
}
export interface RefitJob {
  targetId: string;
  remainingTicks: number;
  totalTicks: number;
}
export interface ChargeState {
  phase: "approach" | "committed" | "recovery";
  x: number;
  y: number;
  startTick: number;
  committedTick: number;
  targetId?: number;
}
export interface AllianceOffer {
  id: number;
  proposer: number;
  recipient: number;
  expiresTick: number;
}
export interface Alliance {
  id: number;
  a: number;
  b: number;
  expiresTick: number;
  renewal: number[];
}
export interface DiplomacyState {
  offers: AllianceOffer[];
  alliances: Alliance[];
  betrayal: Record<number, number>;
  cooldowns: Record<string, number>;
}
export interface TradeActor {
  id: number;
  playerId: number;
  factoryId: number;
  originPortId?: number;
  definitionId: string;
  naval: boolean;
  x: number;
  y: number;
  cargo: number;
  loaded: number;
  delivered: number;
  lost: number;
  returned: number;
  valuePerGood: number;
  originTile: number;
  capacity: number;
  shipmentId: number;
  stops: number[];
  visited: number[];
  destination: number | null;
  state: "loading" | "outbound" | "returning" | "prize" | "waiting";
  path: number[];
  nextPathIndex: number;
  waitTicks: number;
  quoteAllies: number[];
}
export interface Barrier {
  id: number;
  playerId: number;
  age: Age;
  a: number;
  b: number;
  tiles: number[];
  health: number;
  maxHealth: number;
  gateTile: number | null;
  remainingTicks: number;
}
export interface Projectile {
  id: number;
  playerId: number;
  sourceId: number;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tick: number;
  impactTick: number;
  diameter: number;
  blastRadius: number;
  damage: number;
  channel: "melee" | "ranged";
  bonuses: Partial<Record<TargetTag, number>>;
  penetration: number;
  targets?: readonly TargetTag[];
  kind: "shell" | "bomb" | "icbm" | "mirv" | "warhead";
  warheads: number;
  impacted: boolean;
  impactAt?: number;
}
export interface Aircraft {
  id: number;
  playerId: number;
  definitionId: "fighter" | "bomber";
  airfieldId: number;
  x: number;
  y: number;
  health: number;
  target: { x: number; y: number } | null;
  state: "ready" | "outbound" | "returning";
  reloadTick: number;
  fuelTicks: number;
}
export interface ExpansionSnapshot {
  rulesetId: string;
  contentHash: string;
  events: MatchEvent[];
  roadRevision: number;
  roads?: Uint32Array;
  progression: Record<number, ProgressionState>;
  inventories: Record<number, Inventory>;
  production: Record<number, ProductionJob | undefined>;
  deposits: Deposit[];
  diplomacy: DiplomacyState;
  traders: Omit<TradeActor, "path" | "nextPathIndex">[];
  barriers: Barrier[];
  projectiles: Projectile[];
  aircraft: Aircraft[];
  victoryMode: "solo" | "allied";
  winners: number[];
  deliveredGold: Record<number, number>;
}
export interface MatchEvent {
  id: number;
  tick: number;
  actorId: number;
  otherId?: number;
  kind: "age" | "conquest" | "diplomacy";
  age?: Age;
  action?: "offer" | "accept" | "reject" | "renew" | "break" | "expire";
}
