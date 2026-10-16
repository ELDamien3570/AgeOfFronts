
import type { GameMap } from "../core/game/GameMap";
import type { ElevationData } from "./Elevation";
import type { EnvironmentProfile } from "./Environment";
import type { EnvironmentData } from "./EnvironmentData";
import type { ForestData } from "./Forest";import type { DeploymentLine } from "./FormationLine";
import type { MapGeography } from "./Geography";
import type { ResourceTerrainData } from "./ResourceTerrain";
import type {
  Age,
  ArmyOrder,
  ChargeState, ExpansionSnapshot,
  RefitJob,
  StartingAge, TechnologySpeed,
} from "./domain/Definitions";

export const FIXED = 256;
export const TICKS_PER_SECOND = 8;
/** Canonical fixed step; render and wall-clock schedules are independent. */
export const TICK_MS = 1000 / TICKS_PER_SECOND;
export const secondsToTicks = (seconds: number): number => Math.ceil(seconds * TICKS_PER_SECOND);
export const SQUAD_TROOPS = 1_000;
export const MAX_SQUADS = 200;
/** Regular factions (humans + AI) a match may hold; tribes are counted separately. */
export const MAX_FACTIONS = 41;
export const CAPTURE_RADIUS = 3;
export const CAPTURE_TICKS = secondsToTicks(1.5);
export const MELEE_RANGE = 384;
export const MAX_QUEUED_ORDERS = 32;

export type Order =
  | { type: "hold"; facing?: number }
  | { type: "replenish" }
  // Formation coordinates are assigned by the domain, never trusted from commands.
  | { type: "move"; tile: number; x?: number; y?: number; facing?: number; formationIntent?: {shape:import("./domain/FormationGeometry").FormationShape;frontage?:number} }
  | { type: "attack"; targetId: number; cavalryMode?: "ranks" };

export type Command =
  | {type:"occupy";playerId:number;squadIds:number[];tile:number;frontageTiles?:number[];append?:boolean}
  | {type:"stance";playerId:number;squadIds:number[];stance:"default"|"skirmish"}
  | { type: "army-posture"; playerId: number; armyId: number; posture: "line" | "defend" | "skirmish" }
  | { type:"formation";playerId:number;squadIds:number[];shape:import("./domain/FormationGeometry").FormationShape;facing?:number;frontage?:number;shapeLock?:boolean }
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
  | { type: "naval-priority"; playerId: number; shipIds: number[]; priority: import("./domain/NavalCombat").NavalPriority }
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
  | { type: "trade-pause"; playerId: number; naval: boolean; paused: boolean }
  | { type: "trade-block"; playerId: number; otherId: number; blocked: boolean; naval?: boolean }
  | {
      type: "refit";
      playerId: number;
      squadIds: number[];
      definitionId: string;
    }
  | {
      type: "charge"; playerId: number;
      squadIds: number[];
      x: number;
      y: number;
      targetId?: number;
      fallbackOrder?:
        | { type: "move"; tile: number }
        | { type: "attack"; targetId: number };
    }
  | {
      type: "attack-structure";
      playerId: number;
      squadIds: number[];
      buildingId?: number;
      barrierId?: number;
    }
  | {
      type: "alliance"; playerId: number;
      otherId: number;
      action:
        | "offer"
        | "offer-long-term"
        | "accept"
        | "reject"
        | "renew"
        | "break"
        | "declare"
        | "end-long-term"
        | "offer-peace"
        | "accept-peace"
        | "reject-peace"
        | "dont-embargo"
        | "allow-embargo";
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
      definitionId: "fighter" | "bomber" | "drone";
    }
  | {
      type: "transfer-aircraft";
      playerId: number;
      aircraftIds: number[];
      buildingId: number;
    }
  | {
      type: "sortie";
      targetBuildingId?: number;
      targetUnitId?: number;
      mission?: "bombing" | "patrol" | "atomic" | "drone";
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
      buildingId?: number;
      x: number;
      y: number;
    }
  | { type: "upgrade-building"; playerId: number; buildingIds: number[] }
  | { type: "delete-building"; playerId: number; buildingId: number }
  | { type: "delete-ship"; playerId: number; shipId: number }
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
  | { type: 'enlarge'; playerId:number; squadIds:number[]; definitionId:string }
  | { type: 'cancel-enlarge'; playerId:number; squadIds:number[] }
  | { type: "stop-ships"; playerId: number; shipIds: number[] }
  | {
      type: "order";
      playerId: number;
      squadIds: number[];
      order: Order;
      deploymentLine?: DeploymentLine;
      append?: boolean;
    };

export type MovementBlockReason =
  | "crowd"
  | "yielding"
  | "terrain"
  | "restricted"
  | "planning"
  | "blocked";
export interface MovementStatus {
  reason: MovementBlockReason;
  since: number;
  blockerIds: readonly number[];
}

export interface Squad {
  readonly aiWithdrawal?: Readonly<{owner:number;since:number;deadline:number;phase:"withdrawing"|"recovery"}>;
  readonly stance?: "default"|"skirmish";
  readonly lastWithdrawTick?: number;
  readonly occupancy?: import("./domain/TrenchOccupancy").OccupancyView;
  readonly manpower?: Readonly<import('./domain/Manpower').ManpowerState>;
  readonly id: number;
  readonly playerId: number;
  readonly x: number;
  readonly y: number;
  readonly troops: number;
  readonly kind: SquadType;
  readonly embarkedOn: number | null;
  readonly lastCombatTick: number;
  readonly moved: boolean;
  readonly formation?: Readonly<import("./domain/FormationGeometry").FormationState>;
  readonly locomotion?: Readonly<import("./FormationLocomotion").FormationMotion>;
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
  readonly meleeStrike?: import("./domain/MeleeStrike").MeleeStrike;
  readonly combatFact?: import('./domain/CombatFact').CombatFact;
  readonly chargeImpact?: import("./domain/ChargeImpact").ChargeImpact;
  readonly cavalryEngagement?: import('./domain/CavalryEngagement').CavalryEngagement;
  readonly cavalryMelee?: import('./domain/CavalryMelee').CavalryMelee;
  readonly weaponState?: import("./domain/WeaponTiming").WeaponState;
  readonly magazineShots?: number;
  readonly reloadStartedTick?: number;
  readonly planningPaused?: boolean;
  readonly movementStatus?: Readonly<MovementStatus>;
  readonly refit?: Readonly<RefitJob> | null;
  readonly charge?: Readonly<ChargeState> | null;
  readonly chargeReadyTick?: number;
  readonly deploymentTicks?: number;
  readonly structureTarget?: Readonly<{ buildingId?: number; barrierId?: number }> | null;
  /** Present while the squad is on water, travelling as its transport. */
  readonly afloat?: Readonly<Afloat> | null;
}

/** Hull damage also harms passengers; sinking kills all remaining passengers.
 * A fresh hull is issued on embarkation without repairing passenger damage. */
export interface Afloat {
  hull: number;
  maxHull: number;
  vesselId: string;
  /** Health at embarkation, in native manpower subunits (legacy: troop units). */
  passengerHealth?: number;
  /** Cumulative applied hull damage, for partition-independent fractional damage. */
  passengerHullDamage?: number;
}

export interface Player {
  reserveRemainder?: number;
  id: number;
  name: string;
  /** Optional lobby palette reservation; absent in older matches. */
  colorIndex?: number;
  /** Starting palette category, retained when a tribe becomes a civilization. */
  colorKind?: "regular" | "tribe";
  factionId?: string;
  personalityId?: import("./domain/AiPersonality").AiPersonalityId;
  ai: boolean;
  kind: "regular" | "tribe";
  base: number;
  reserves: number;
  gold: number;
  /** Human-only purchasing rule; actual gold balances remain finite. */
  infiniteGold?: boolean;
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
  | "missile-defence"
  | "nuclear-facility"
  | "drone-facility"
  | "anti-air-emplacement";
/** Squads cross water themselves (see Afloat); carriers are mobile aircraft bases. */
export type ShipType = "warship" | "carrier";

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
  readonly definitionId?: string;
  readonly nextAttackTick?: number;
  readonly airDefenseTick?: number;
  readonly xp?: number;
  readonly planningPaused?: boolean;
  readonly refit?: Readonly<RefitJob> | null;
  readonly attackTargetId?: number | null;
  readonly lastPlanTick?: number;
  readonly patrolTile?: number | null;
  readonly patrolDwellTicks?: number;
  readonly navalTargetId?: number;
  readonly navalTargetKind?: "ship" | "trade" | "transport";
  readonly navalPriority?: import("./domain/NavalCombat").NavalPriority;
  readonly autonomousVoyage?: boolean;
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

// An actual released volley, retained briefly for presentation. Damage is
// resolved by the simulation; arrow animation never determines casualties.
export interface ArcherVolley {
  /** Exact squad carriers at impact, including a squad removed by this hit. */
  combatRoots?: {sourceX:number;sourceY:number;targetX:number;targetY:number};
  id: number;
  tick: number;
  squadId: number;
    definitionId?: string; playerId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  sourceKind?: "squad" | "aircraft";
  targetKind?: "squad" | "aircraft";
      targetId?: number;
  damage?: number;
  melee?: boolean;
  impact?: boolean;
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
  /** Palette reservations corresponding to the ordered human seats. */
  humanColors?: readonly (number | null)[];
  /** Human reservations accepted during setup; absent seats use seeded fallback. */
  humanSpawns?: readonly { playerId: number; tile: number }[];
  resourceDensity?: 1 | 2 | 3 | 5;
  resourceOutput?: 1 | 2 | 3 | 5;
  infiniteGoldForPlayers?: boolean;
  alliances?: boolean;
  runAi?: boolean;
  /** Experimental authoritative squad turns/acceleration, enabled by the troop demo. */
  formationLocomotion?: boolean;
  /** Experimental individual turn-in-place instead of slow whole-layout rotation. */
  formationReorientation?: boolean;
  /** Experimental crowd velocity steering without formation-facing travel gates. */
  formationFreeTravel?: boolean;
  /** Economic demand policy. Normal games enable the shared AI policy defaults. */
  aiEconomy?: boolean;
  /** Bounded transactional route admission. Explicit false preserves legacy replay. */
  deferredPlanning?: boolean;
  /** Optional two-second deadline for local autonomous searches. */
  autonomousRouteDeadlineTicks?: 16;
  /** Optional 1.5-second cadence for local autonomous decisions. */
  autonomousDecisionInterval?: 12;
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
  /** Omission preserves historical saves/replays; new games record explicit permissions. */
  diplomacyRules?: "raids-v1";
  /** Coordinated travel policy, recorded for checkpoint/replay compatibility. */
  armyTravel?: "corridors-v1";
  victoryMode?: "solo" | "allied";
  technologySpeed?: TechnologySpeed;
  startingAge?: StartingAge;
  /** Optional scenario ceiling; omitted in normal matches. */
  maximumAge?: Age;
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
  ships: Omit<Ship, "path" | "nextPathIndex">[];
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
  traderChanges?: import("./TraderStream").TraderChanges;
  formationRulesVersion?: number;
  /** Versioned transferable presentation records; legacy object details remain readable. */
  details?: import("./SnapshotDetails").PackedSnapshotDetails;
  barrierChanges?: { reset: boolean; rows: NonNullable<Snapshot["expansion"]>["barriers"]; removed: Int32Array;
    states?: readonly { id: number; health: number; remainingTicks: number }[] };
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
  expansionMode?: "full" | "delta";
  /** N5/P12: present when `expansion.progression` is in the endTick wire form
   * of ProgressionReplication (only changed factions in "delta" mode). Absent
   * in legacy packets, whose progression is a complete remainingTicks map. */
  progressionMode?: "full" | "delta";
  expansion?: Partial<Omit<ExpansionSnapshot, "deposits">> & {
    /** Full resource facts at a baseline or geometry revision only. */
    deposits?: ExpansionSnapshot["deposits"];
    /** Resource id/owner pairs applied to retained canonical facts. */
    depositOwners?: Int32Array;
  };
  squadDetails?: {
    formation?: Squad["formation"];
    manpower?: Squad['manpower'];
    id: number;
    definitionId?: string;
    xp?: number;
    deploymentTicks?: number;
    lastAttackTick?: number;
    meleeStrike?: import("./domain/MeleeStrike").MeleeStrike;
    combatFact?: import('./domain/CombatFact').CombatFact;
    chargeImpact?: import("./domain/ChargeImpact").ChargeImpact;
    cavalryEngagement?: import('./domain/CavalryEngagement').CavalryEngagement;
    cavalryMelee?: import('./domain/CavalryMelee').CavalryMelee;
    nextAttackTick?: number;
    stance?: "default"|"skirmish";
    lastWithdrawTick?: number;
    occupancy?: import("./domain/TrenchOccupancy").OccupancyView;
    weaponState?: import("./domain/WeaponTiming").WeaponState;
    magazineShots?: number;
    reloadStartedTick?: number;
    planningPaused?: boolean;
    movementStatus?: MovementStatus;
    aiWithdrawal?: Squad['aiWithdrawal'];
    refit?: RefitJob | null;
    charge?: ChargeState | null;
    chargeReadyTick?: number;
    locomotion?: Squad["locomotion"];
    structureTarget?: Squad["structureTarget"];
    afloat?: Afloat | null;
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
      /** Local diagnostic replay only; the domain restore validates the state. */
      checkpoint?: ReturnType<import("./Simulation").Skirmish["checkpoint"]>;
      diagnostics?: boolean;
    }
  | { type: "command"; command: Command; diagnosticId?: number }
  | { type: "select-spawn"; tile: number }
  | { type: "pause"; paused: boolean }
  | { type: "resync" }
  | { type: "speed"; speed: 1 | 2 | 4 };

export type WorkerResponse =
  | { type: "command-admitted"; diagnosticId: number; tick: number; rejected: boolean }
  | { type: "diagnostics"; tick: number; pace: ReturnType<import("./RuntimeDiagnostics").RuntimeProgress["snapshot"]>; timings: ReturnType<import("./RuntimeDiagnostics").RuntimeDiagnostics["snapshot"]>; squads: number; ships: number; planner?: import("./RuntimeDiagnostics").PlannerCohort[] }
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
