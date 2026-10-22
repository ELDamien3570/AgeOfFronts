import type { DomainRouteTask } from "./DomainRoutePorts";

/** Versioned resource limits. Packed cells include unfinished output buffers. */
export const SEA_TRADE_LIMITS = Object.freeze({
  records: 16_384, packedCells: 8_388_608, stagingCells: 2_097_152,
  recoveryCells: 2_097_152, recoveryRecords: 2_048,
  copies: 1_024, discovery: 2_048, catalog: 512, management: 40,
});
export type SeaTradeLimits = typeof SEA_TRADE_LIMITS;
export type LaneId = number;
export type DemandKind = "departure" | "continuation" | "return" | "salvage";
export interface LaneKey { revision: number; lo: number; hi: number }
interface LaneBase {
  id: LaneId; key: LaneKey; epoch: number; firstDemandTick: number;
  nextAttemptTick: number; attempts: number; sponsorId: number;
  lastUseTick: number; references: number;
}
export type LaneRecord = LaneBase & (
  | { state: "queued" }
  | { state: "requested"; requestedKey: string }
  | { state: "staging"; input: number[] }
  | { state: "packing"; packing: { input: number[]; output: Int32Array; offset: number } }
  | { state: "ready"; tiles: Int32Array }
  | { state: "retiring"; requestedKey: string }
);
export interface LaneUse { laneId: LaneId; reverse: boolean }
export interface LegCursor extends LaneUse { next: number; end: number; goalTile: number }
export type SeaWait = "cargo" | "shared-lane" | "admission" | "search" | "packing"
  | "memory" | "market-intake" | "no-market" | "no-owned-receiver" | "handling";
export interface WaitTotals { route: number; intake: number; handling: number }
export interface SeaVoyage {
  actorId: number; shipmentId: number; currentPortTile?: number;
  leg?: LegCursor;
  pending?: { laneId?: LaneId; kind: DemandKind; receiverId: number; startTile: number;
    goalTile: number; owner: number; shipmentId: number; requestTick: number };
  trail: LaneUse[]; returnSpans?: LegCursor[]; returnSpanIndex?: number;
  wait?: { cause: SeaWait; since: number; loading: boolean };
  loadingWaits: WaitTotals; tripWaits: WaitTotals;
  preLoadWaitTicks: number; legacyVoyage: boolean; continuationStartedTick?: number;
}
export type Holder =
  | { type: "source-demand"; sourceKey: string }
  | { type: "actor-demand" | "actor-leg"; actorId: number; shipmentId: number }
  | { type: "actor-trail"; actorId: number; shipmentId: number; trailIndex: number };
export interface Subscription {
  id: number; key: string; laneId: LaneId; owner: number; kind: DemandKind; holder: Holder;
}
export interface SeaLaneTask extends DomainRouteTask {
  owner: "sea-trade"; admissionId: LaneId; memberId: number;
  stage: "lane"; epoch: number;
}
export interface SeaRoutePorts {
  request(task: SeaLaneTask, start: number, goal: number, water: true): boolean;
  cancel(task: SeaLaneTask): void;
  has(key: string): boolean;
}
export interface LaneDemand {
  subscriberKey: string; owner: number; kind: DemandKind; holder: Holder;
  start: number; goal: number; firstDemandTick: number;
}
export type AcquireResult =
  | { kind: "ready"; use: LaneUse }
  | { kind: "waiting"; laneId: LaneId; cause: "admission" | "search" | "packing" | "memory" }
  | { kind: "unreachable" }
  | { kind: "capacity" };
export interface SeaRoutesCheckpoint {
  version: 1; waterRevision: number; nextLaneId: number; nextSubscriptionId: number;
  lanes: LaneRecord[]; subscriptions: Subscription[];
  sourceRetention: [string, LaneId[]][];
  order: { packing: LaneId[]; memory: LaneId[]; retiring: LaneId[]; requested: LaneId[]; cleanup: LaneId[] };
  cursors: { recoveryTurn: number; lastRecoveryOwner: number; lastDepartureOwner: number; maintenanceTurn: number; maintenanceQueue: number; recordPressure: boolean };
}
