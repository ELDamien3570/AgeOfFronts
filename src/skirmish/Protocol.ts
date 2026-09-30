import type { GameMap } from "../core/game/GameMap";

export const FIXED = 256;
export const TICKS_PER_SECOND = 20;
export const SQUAD_TROOPS = 1_000;
export const MAX_SQUADS = 200;
export const MAX_FACTIONS = 20;
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
  | { type: "recruit"; playerId: number; buildingId: number }
  | {
      type: "build";
      playerId: number;
      buildingType: BuildingType;
      tile: number;
    }
  | {
      type: "recruit-ship";
      playerId: number;
      buildingId: number;
      shipType: ShipType;
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
  id: number;
  playerId: number;
  x: number;
  y: number;
  troops: number;
  kind: SquadType;
  embarkedOn: number | null;
  lastCombatTick: number;
  moved: boolean;
  firingCharge: number;
  order: Order;
  queuedOrders: Order[];
  path: number[];
  nextPathIndex: number;
  plannedTile: number;
  lastPlanTick: number;
  fighting: boolean;
  // The simulation's chosen attack target; taking damage alone is not an attack.
  combatTargetId: number | null;
}

export interface Player {
  id: number;
  name: string;
  ai: boolean;
  base: number;
  reserves: number;
  gold: number;
  land: number;
  losses: number;
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
  | "port";
export type ShipType = "transport" | "warship";

export interface Building {
  id: number;
  playerId: number;
  type: BuildingType;
  tile: number;
  remainingTicks: number;
}

export interface Ship {
  id: number;
  playerId: number;
  kind: ShipType;
  x: number;
  y: number;
  health: number;
  destination: number | null;
  waypoints: number[];
  path: number[];
  nextPathIndex: number;
  fighting: boolean;
  boarding: BoardingMeeting | null;
}

export interface BoardingMeeting {
  landTile: number;
  waterTile: number;
  squadIds: number[];
}

// An actual released volley, retained briefly for presentation. Damage is
// resolved by the simulation; arrow animation never determines casualties.
export interface ArcherVolley {
  id: number;
  tick: number;
  squadId: number;
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
  runAi?: boolean;
  territoryIncomeScale?: number;
}

export interface Snapshot {
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
}

export interface SnapshotPacket {
  reset: boolean;
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
}

export type WorkerRequest =
  | {
      type: "start";
      width: number;
      height: number;
      terrain: Uint8Array;
      options: MatchOptions;
    }
  | { type: "command"; command: Command }
  | { type: "pause"; paused: boolean }
  | { type: "speed"; speed: 1 | 2 | 4 };

export type WorkerResponse =
  | { type: "state"; packet: SnapshotPacket; paused: boolean; speed: number }
  | { type: "rejected"; message: string }
  | { type: "error"; message: string };

export interface LoadedMap {
  map: GameMap;
  terrain: Uint8Array;
  name: string;
  territoryIncomeScale: number;
}
