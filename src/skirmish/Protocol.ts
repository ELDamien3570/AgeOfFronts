import type { GameMap } from "../core/game/GameMap";
import type { ElevationData } from "./Elevation";
import type { EnvironmentProfile } from "./Environment";
import type { EnvironmentData } from "./EnvironmentData";
import type { ForestData } from "./Forest";
import type { MapGeography } from "./Geography";
import type { ResourceTerrainData } from "./ResourceTerrain";
import type {
  Age,
  ArmyOrder,
  ChargeState,
  ExpansionSnapshot,
  RefitJob,
  TechnologySpeed,
} from "./domain/Definitions";

export const FIXED = 256;
export const TICKS_PER_SECOND = 20;
export const SQUAD_TROOPS = 1_000;
export const MAX_SQUADS = 200;
/** Regular factions (humans + AI) a match may hold; tribes are counted separately. */
export const MAX_FACTIONS = 41;
export const CAPTURE_RADIUS = 3;
export const CAPTURE_TICKS = 30;
export const MELEE_RANGE = 384;
export const MAX_QUEUED_ORDERS = 32;

export type Order =
  | { type: "hold" }
  | { type: "replenish" }
  | { type: "board"; shipId: number; tile: number }
  // Formation coordinates are assigned by the domain, never trusted from commands.
  | { type: "move"; tile: number; x?: number; y?: number }
  | { type: "attack"; targetId: number };

export type Command =
  | { type: "create-army"; playerId: number; squadIds: number[] }
  | {
      type: "army-members";
      playerId: number;
      armyId: number;
      squadIds: number[];
      action: "add" | "remove";
    }
  | { type: "disband-army"; playerId: number; armyId: number }
  | { type: "army-auto"; playerId: number; armyId: number; enabled: boolean }
  | {
      type: "army-order";
      playerId: number;
      armyId: number;
      order: ArmyOrder;
      append?: boolean;
    }
  | {
      type: "refit-ships";
      playerId: number;
      shipIds: number[];
      definitionId: string;
    }
  | {
      type: "naval-attack";
      playerId: number;
      shipIds: number[];
      targetId: number;
    }
  | { type: "research"; playerId: number; technologyId: string }
  | { type: "advance-age"; playerId: number }
  | {
      type: "produce";
      playerId: number;
      buildingId: number;
      recipeId: string | null;
    }
  | {
      type: "production-priority";
      playerId: number;
      buildingType: BuildingType;
      recipeIds: string[] | null;
    }
  | { type: "reset-production-priorities"; playerId: number }
  | {
      type: "refit";
      playerId: number;
      squadIds: number[];
      definitionId: string;
    }
  | {
      type: "charge";
      playerId: number;
      squadIds: number[];
      x: number;
      y: number;
      targetId?: number;
    }
  | {
      type: "attack-structure";
      playerId: number;
      squadIds: number[];
      buildingId?: number;
      barrierId?: number;
    }
  | {
      type: "alliance";
      playerId: number;
      otherId: number;
      action: "offer" | "accept" | "reject" | "renew" | "break";
    }
  | {
      type: "repair";
      playerId: number;
      buildingId?: number;
      buildingIds?: number[];
      barrierId?: number;
    }
  | {
      type: "recruit-aircraft";
      playerId: number;
      buildingId: number;
      buildingIds?: number[];
      autoRecruit?: boolean;
      definitionId: "fighter" | "bomber";
    }
  | {
      type: "sortie";
      playerId: number;
      aircraftIds: number[];
      x: number;
      y: number;
    }
  | {
      type: "launch";
      playerId: number;
      launcherId: number;
      payload: "icbm" | "hydrogen" | "mirv";
      x: number;
      y: number;
    }
  | { type: "upgrade-building"; playerId: number; buildingIds: number[] }
  | {
      type: "cancel-recruitment";
      playerId: number;
      category?: "land" | "ship" | "aircraft";
      definitionId?: string;
      kind?: string;
      buildingId?: number;
      buildingIds?: number[];
    }
  | {
      type: "recruit";
      playerId: number;
      buildingId: number;
      buildingIds?: number[];
      autoRecruit?: boolean;
      definitionId?: string;
    }
  | {
      type: "build";
      playerId: number;
      buildingType: BuildingType;
      tile: number;
      age?: Age;
    }
  | {
      type: "recruit-ship";
      playerId: number;
      buildingId: number;
      buildingIds?: number[];
      autoRecruit?: boolean;
      shipType: ShipType;
      definitionId?: string;
    }
  | {
      type: "sail";
      playerId: number;
      shipIds: number[];
      tile: number;
      append?: boolean;
    }
  | { type: "stop-ships"; playerId: number; shipIds: number[] }
  | { type: "load"; playerId: number; shipId: number; squadIds: number[] }
  | { type: "board"; playerId: number; shipId: number; squadIds: number[] }
  | { type: "unload"; playerId: number; shipId: number; tile: number }
  | {
      type: "order";
      playerId: number;
      squadIds: number[];
      order: Order;
      append?: boolean;
    };

export interface Squad {
  readonly id: number;
  readonly playerId: number;
  readonly x: number;
  readonly y: number;
  readonly troops: number;
  readonly kind: SquadType;
  readonly embarkedOn: number | null;
  readonly lastCombatTick: number;
  readonly moved: boolean;
  readonly firingCharge: number;
  readonly order: Readonly<Order>;
  readonly queuedOrders: readonly Readonly<Order>[];
  readonly path: readonly number[];
  readonly nextPathIndex: number;
  readonly plannedTile: number;
  readonly lastPlanTick: number;
  readonly fighting: boolean;
  // The simulation's chosen attack target; taking damage alone is not an attack.
  readonly combatTargetId: number | null;
  readonly definitionId?: string;
  readonly xp?: number;
  readonly nextAttackTick?: number;
  readonly lastAttackTick?: number;
  readonly planningPaused?: boolean;
  readonly refit?: Readonly<RefitJob> | null;
  readonly charge?: Readonly<ChargeState> | null;
  readonly chargeReadyTick?: number;
  readonly deploymentTicks?: number;
  readonly structureTarget?: Readonly<{ buildingId?: number; barrierId?: number }> | null;
}

export interface Player {
  id: number;
  name: string;
  factionId?: string;
  personalityId?: import("./domain/AiPersonality").AiPersonalityId;
  ai: boolean;
  kind: "regular" | "tribe";
  base: number;
  reserves: number;
  gold: number;
  land: number;
  losses: number;
  /** Individual enemy soldiers killed; absent in older snapshots. */
  kills?: number;
  recruited: number;
  eliminated: boolean;
}

export type SquadType = "infantry" | "archer" | "cavalry";
export type BuildingType =
  | "barracks"
  | "archery"
  | "stables"
  | "city"
  | "factory"
  | "port"
  | "mine"
  | "blacksmith"
  | "armory"
  | "arms-factory"
  | "siege-workshop"
  | "depot"
  | "tower"
  | "airstrip"
  | "oil-well"
  | "oil-rig"
  | "gun-nest"
  | "trench"
  | "missile-silo"
  | "mirv-launcher"
  | "missile-defence";
export type ShipType = "transport" | "warship";

export interface Building {
  readonly id: number;
  readonly playerId: number;
  readonly type: BuildingType;
  readonly tile: number;
  readonly remainingTicks: number;
  readonly buildTicks?: number;
  readonly age?: Age;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly nextAttackTick?: number;
  readonly launchReadyTick?: number;
}

export interface Ship {
  readonly id: number;
  readonly playerId: number;
  readonly kind: ShipType;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly destination: number | null;
  readonly waypoints: readonly number[];
  readonly path: readonly number[];
  readonly nextPathIndex: number;
  readonly fighting: boolean;
  readonly boarding: BoardingMeeting | null;
  // Domain-owned temporary voyage; these vessels cannot become a free navy.
  readonly shoreTransfer?: {
    readonly destinationTile: number;
    readonly landingTile: number;
    readonly waterPath: readonly number[];
    readonly capacity: number;
    readonly phase: "boarding" | "sailing" | "landing";
    readonly queued: readonly { readonly squadId: number; readonly orders: readonly Readonly<Order>[] }[];
  };
  readonly definitionId?: string;
  readonly nextAttackTick?: number;
  readonly xp?: number;
  readonly planningPaused?: boolean;
  readonly refit?: Readonly<RefitJob> | null;
  readonly attackTargetId?: number | null;
  readonly lastPlanTick?: number;
  readonly patrolTile?: number | null;
  readonly patrolDwellTicks?: number;
  readonly lastCombatTick?: number;
  readonly repairPortId?: number | null;
  readonly repairState?:
    | "idle"
    | "patrolling"
    | "returning-to-dock"
    | "waiting-for-dock"
    | "repairing"
    | "returning-to-patrol";
}

export interface BoardingMeeting {
  readonly landTile: number;
  readonly waterTile: number;
  readonly squadIds: readonly number[];
}

// An actual released volley, retained briefly for presentation. Damage is
// resolved by the simulation; arrow animation never determines casualties.
export interface ArcherVolley {
  id: number;
  tick: number;
  squadId: number;
  definitionId?: string;
  playerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

// Defense zones are a movement modifier, never a passive damage source.
// No defense upgrades are exposed in this first skirmish.
export interface DefenseZone {
  playerId: number;
  tile: number;
  radius: number;
  speedPercent: number;
}

export interface MatchOptions {
  seed: number;
  aiCount: number;
  /** Ordered human seats; IDs are 1..N. Omitted for the existing solo game. */
  humanNames?: readonly string[];
  /** Human reservations accepted during setup; absent seats use seeded fallback. */
  humanSpawns?: readonly { playerId: number; tile: number }[];
  resourceDensity?: 1 | 2 | 3 | 5;
  resourceOutput?: 1 | 2 | 3 | 5;
  alliances?: boolean;
  runAi?: boolean;
  /** Experimental policy; stays opt-in until the ARM performance gate passes. */
  aiEconomy?: boolean;
  /** Transactional route admission; opt-in until planning gates pass. */
  deferredPlanning?: boolean;
  /** City defense trials require the shared opt-in economy coordinator. */
  aiDefenses?: boolean;
  /** Fleet mission trials require economy and deferred route admission. */
  aiNaval?: boolean;
  /** Optional strategic declarations; physical human combat rules are unchanged. */
  aiWarPolicy?: boolean;
  tribes?: boolean;
  /** Tribes to deploy when `tribes` is set; defaults to the map size's base. */
  tribeCount?: number;
  territoryIncomeScale?: number;
  ruleset?: "sandbox-v1" | "ages-v1";
  victoryMode?: "solo" | "allied";
  technologySpeed?: TechnologySpeed;
  startingAge?: Age;
}

export interface Snapshot {
  /** Presentation context supplied by the session adapter, never by the simulation. */
  localPlayerId?: number;
  disconnectedPlayerIds?: readonly number[];
  tick: number;
  width: number;
  height: number;
  owners: Uint8Array;
  claims: Uint8Array;
  progress: Uint8Array;
  players: Player[];
  buildings: Building[];
  ships: (Omit<Ship, "path" | "nextPathIndex" | "shoreTransfer"> & {
    shoreTransfer?: Pick<
      NonNullable<Ship["shoreTransfer"]>,
      "capacity" | "phase" | "destinationTile" | "landingTile"
    >;
  })[];
  squads: Omit<
    Squad,
    "path" | "nextPathIndex" | "plannedTile" | "lastPlanTick"
  >[];
  winner: number | null;
  combatTicks: number;
  volleys: ArcherVolley[];
  // Transport hint for presentation caches. Omitted by ordinary domain snapshots.
  changedTiles?: Uint32Array;
  expansion?: ExpansionSnapshot;
}

export interface SnapshotPacket {
  reset: boolean;
  /** Absent in legacy packets, which carry complete squad/ship views. */
  entityMode?: "full" | "delta";
  removedSquads?: Int32Array;
  removedShips?: Int32Array;
  tick: number;
  width: number;
  height: number;
  tiles: Uint32Array;
  squads: Int32Array;
  orders: Int32Array;
  buildingChanges: Int32Array;
  removedBuildings: Int32Array;
  players: Player[];
  ships: Snapshot["ships"];
  volleys: ArcherVolley[];
  winner: number | null;
  combatTicks: number;
  expansion?: Omit<ExpansionSnapshot, "deposits"> & {
    /** Full resource facts at a baseline or geometry revision only. */
    deposits?: ExpansionSnapshot["deposits"];
    /** Resource id/owner pairs applied to retained canonical facts. */
    depositOwners?: Int32Array;
  };
  squadDetails?: {
    id: number;
    definitionId?: string;
    xp?: number;
    nextAttackTick?: number;
    planningPaused?: boolean;
    refit?: RefitJob | null;
    charge?: ChargeState | null;
    chargeReadyTick?: number;
    structureTarget?: Squad["structureTarget"];
  }[];
  buildingDetails?: {
    id: number;
    buildTicks?: number;
    age?: Age;
    health?: number;
    maxHealth?: number;
    nextAttackTick?: number;
    launchReadyTick?: number;
  }[];
}

export interface SpawnState {
  remainingMs: number;
  reservations: { playerId: number; tile: number }[];
}

export type WorkerRequest =
  | {
      type: "start";
      width: number;
      height: number;
      terrain: Uint8Array;
      elevation?: ElevationData;
      forest?: ForestData;
      resourceTerrain?: ResourceTerrainData;
      options: MatchOptions;
    }
  | { type: "command"; command: Command }
  | { type: "select-spawn"; tile: number }
  | { type: "pause"; paused: boolean }
  | { type: "speed"; speed: 1 | 2 | 4 };

export type WorkerResponse =
  | { type: "spawn"; state: SpawnState }
  | { type: "state"; packet: SnapshotPacket; snapshot?:Snapshot; paused: boolean; speed: number }
  | { type: "rejected"; message: string }
  | { type: "error"; message: string };

export interface LoadedMap {
  map: GameMap;
  terrain: Uint8Array;
  name: string;
  territoryIncomeScale: number;
  elevation?: ElevationData;
  forest?: ForestData;
  resourceTerrain?: ResourceTerrainData;
  environment?: EnvironmentProfile;
  environmentData?: EnvironmentData;
  geography?: MapGeography;
  attribution?: { label: string; url: string };
}
