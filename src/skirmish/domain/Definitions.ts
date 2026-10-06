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
/** Starting presets do not add tiers to the gameplay content catalogue. */
export const STARTING_AGES = [...AGES, "PostModern"] as const;
export type StartingAge = (typeof STARTING_AGES)[number];
export function startingGameplayAge(start: StartingAge): Age {
  return start === "PostModern" ? "Modern" : start;
}
export function startingAgeName(start: StartingAge): string {
  return start === "PostModern" ? "Post-Modern" : AGE_NAMES[AGES.indexOf(start)];
}
export const TREES = ["naval", "warfare", "economic"] as const;
export type Tree = (typeof TREES)[number];
export type TechnologySpeed = 1 | 2 | 3;
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
  armourKind: "points" | "percentage";
  meleeArmour: number;
  rangedArmour: number;
  bonusResistance: Partial<Record<TargetTag, number>>;
  attack: AttackProfile;
  charge?: ChargeProfile;
  cost: Cost;
  equipment?: string;
  canCapture: boolean;
  undefendedCaptureTicks?: number;
  placeholder?: boolean;
}
export interface VesselDefinition {
  id: string;
  name: string;
  age: Age;
  /** Transports are not fleet vessels: they are the hull of an afloat squad. */
  kind: ShipType | "transport" | "trade";
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
export interface RecruitmentJob {
  id: number;
  playerId: number;
  buildingId: number;
  category: "land" | "ship" | "aircraft";
  kind: SquadType | ShipType | "fighter" | "bomber";
  definitionId?: string;
  cost: Cost;
  totalTicks: number;
  remainingTicks: number;
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
  longTerm?: boolean;
}
export interface Alliance {
  id: number;
  a: number;
  b: number;
  expiresTick: number;
  renewal: number[];
  longTerm?: boolean;
  ending?: boolean;
}
export interface DiplomacyState {
  offers: AllianceOffer[];
  alliances: Alliance[];
  betrayal: Record<number, number>;
  cooldowns: Record<string, number>;
  wars?: { a: number; b: number }[];
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
  visitedTiles?: number[];
  tripStartedTick?: number;
  tripGold?: number;
  supplyWaitTicks?: number;
  supplyWaitStartedTick?: number;
  tripSupplyTicks?: number;
  routeOriginOwner?: number;
  destination: number | null;
  state: "loading" | "outbound" | "returning" | "prize" | "waiting";
  path: number[];
  nextPathIndex: number;
  waitTicks: number;
  quoteAllies: number[];
}
export interface Barrier {
  readonly kind?: "trench";
  readonly id: number;
  readonly playerId: number;
  readonly age: Age;
  readonly a: number;
  readonly b: number;
  readonly tiles: readonly number[];
  readonly health: number;
  readonly maxHealth: number;
  readonly remainingTicks: number;
}
export type CombatSourceKind = "squad" | "ship" | "building" | "aircraft";
export interface Projectile {
  id: number;
  playerId: number;
  sourceId: number;
  sourceKind: CombatSourceKind;
  attackScale?: number;
  definitionId?: string;
  originTile?: number;
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
  targetBuildingId?: number;
  impacted: boolean;
  impactAt?: number;
  interception?: { defenseId: number; playerId: number; tick: number; impactTick: number; fromX: number; fromY: number; toX: number; toY: number };
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
  tradeSites?: { kind?: "city"; playerId: number; tile: number; naval: boolean; cargo: number;
    maxCargo: number; shipmentCapacity: number; receiving?: { value: number; max: number } }[];
  tradeReceipts?: TradeReceipt[];
  fallout?: Uint32Array;
  startingAge?: Age;
  armies: Army[];
  rulesetId: string;
  contentHash: string;
  technologySpeed: TechnologySpeed;
  fortificationRevision: number;
  events: MatchEvent[];
  roadRevision: number;
  roads?: Uint32Array;
  progression: Record<number, ProgressionState>;
  inventories: Record<number, Inventory>;
  production: Record<number, ProductionJob | undefined>;
  recruitment?: readonly Readonly<RecruitmentJob>[];
  productionPlans: Record<number, { owner: number; recipeId: string }>;
  productionPriorities?: Record<number, Partial<Record<BuildingType, string[]>>>;
  deposits: readonly Deposit[];
  /** Decoder-owned transport revisions; unversioned imports use exact scans. */
  depositGeometryRevision?: number;
  depositOwnershipRevision?: number;
  diplomacy: DiplomacyState;
  /** Undirected active AI offensive pairs; presentation only, separate from wars. */
  activeOffensives?: { a: number; b: number }[];
  pairRelations?: import("./PairRelations").PairRelationRow[];
  traders: (Omit<TradeActor, "path" | "nextPathIndex"> & { waitingForCargo?: boolean })[];
  barriers: readonly Barrier[];
  projectiles: Projectile[];
  aircraft: Aircraft[];
  victoryMode: "solo" | "allied";
  winners: number[];
  deliveredGold: Record<number, number>;
  tradeCapturedValue?: Record<number, number>;
  tradeLostValue?: Record<number, number>;
  tradeControls?: Record<number, { landPaused: boolean; seaPaused: boolean; blocked: number[]; landBlocked?: number[]; seaBlocked?: number[] }>;
  tradeEnemies?: Record<number, number[]>;
}
export type ArmyOrder =
  | { type: "move" | "deploy" | "regroup"; tile: number }
  | {
      type: "attack" | "flank-left" | "flank-right" | "fire-retreat";
      targetId: number;
    }
  | { type: "hold" };
export interface Army {
  id: number;
  playerId: number;
  name: string;
  memberIds: number[];
  leaderId: number;
  x: number;
  y: number;
  facing: number;
  state:
    | "holding"
    | "assembling"
    | "marching"
    | "deploying"
    | "fighting"
    | "regrouping"
    | "blocked";
  order: ArmyOrder;
  queuedOrders: ArmyOrder[];
  autoTactics: boolean;
  manual: boolean;
  revision: number;
  reason: string | null;
}
export interface TradeReceipt { id: number; tick: number; playerId: number; tile: number; gold: number }
export interface MatchEvent {
  id: number;
  tick: number;
  actorId: number;
  otherId?: number;
  kind: "age" | "conquest" | "diplomacy" | "promotion" | "war";
  age?: Age;
  action?: "offer" | "offer-long-term" | "accept" | "reject" | "renew" | "break" | "end-long-term" | "expire" | "declare" | "withdraw";
}
