import type { MatchDiagnostics } from "../../RuntimeDiagnostics";
import type { ElevationData } from "../../Elevation";
import type { CommandOutcome } from "../../CommandApplications";
import type { ForestData } from "../../Forest";
import type { LobbySettings } from "../../lobby/LobbyDirectory";
import type { Command, MatchOptions, SpawnState } from "../../Protocol";
import type { ResourceTerrainData } from "../../ResourceTerrain";
import type { EncodedState } from "../StateCodec";

export interface RuntimeMap {
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation?: ElevationData;
  forest?: ForestData;
  resourceTerrain?: ResourceTerrainData;
}
export interface PreparedMatch {
  mapHash: string;
  options: MatchOptions;
}
export interface SpawnReply {
  rejection: string | null;
  state: SpawnState;
}
export interface MatchCommand {
  id: string;
  command: Command;
}
export interface RuntimeSeat {
  playerId: number;
  name: string;
  ai: boolean;
  kind: "regular" | "tribe";
  eliminated: boolean;
}
export interface SeatStatus {
  seats: RuntimeSeat[];
}
export interface JoinBarrier extends SeatStatus {
  tick: number;
  winner: number | null;
  packet: EncodedState;
  baseline: EncodedState;
}
export interface MatchAdvance {
  diagnostics?: MatchDiagnostics;
  seats?: RuntimeSeat[];
  tick: number;
  winner: number | null;
  packet?: EncodedState;
  rejectedCommands: { id: string; playerId: number; message: string }[];
  commandOutcomes?: CommandOutcome[];
}
export interface MatchPublication { tick: number; packet: EncodedState }
export interface ClientBaseline {tick:number;winner:number|null;baseline:EncodedState;}
/** Error message an executor uses for a faulted simulation. Hosts end the
 * match with MATCH_FAULT_MESSAGE instead of forwarding internal error text. */
export const MATCH_FAULT_CODE = "simulation-fault";
/** Server-side English text for logs and older clients. Current clients show
 * the translated `skirmish_match.simulation_fault` text for this ending. */
export const MATCH_FAULT_MESSAGE = "The match stopped because of an internal simulation error";
export const MAX_ADVANCE_TICKS = 4;
export const MAX_COMMAND_BATCH = 100;
export type ExecutorRequest =
  | {
      type: "initialize" | "prepare";
      streamPublications?: boolean;
      diagnosticContext?: { matchId: string; runtimeId: string };
      settings: LobbySettings;
      options: MatchOptions;
      map?: RuntimeMap;
    }
  | { type: "select-spawn"; playerId: number; tile: number }
  | { type: "spawn-state"; remainingMs: number }
  | { type: "start" }
  | {
      type: "advance";
      ticks: number;
      commands: MatchCommand[];
      disconnectedPlayerIds: number[];
      publish: boolean;
    }
  | { type: "baseline" }
  | {type:"client-baseline"}
  | { type: "seat-status" }
  | { type: "join-barrier"; playerId: number }
  | { type: "set-controller"; playerId: number; ai: boolean };
export type ExecutorResult =
  | PreparedMatch
  | SpawnReply
  | SpawnState
  | MatchAdvance
  | EncodedState
  | SeatStatus
  | JoinBarrier
  | ClientBaseline;
// A baseline result carries its capture tick; coordinator timing must never
// relabel an asynchronously captured state with a later simulation tick.

/** One isolated worker owns and advances the authoritative simulation. */
export interface MatchExecutor {
  /** Becomes "stopped" when the executor can no longer serve requests (exit,
   * fatal error, timeout or close), even if no request was in flight. */
  readonly lifecycle?: { readonly state: "running" | "stopped" };
  onPublication?(listener: (publication: MatchPublication) => void): () => void;
  request<T extends ExecutorResult>(request: ExecutorRequest): Promise<T>;
  close(): Promise<void>;
}
