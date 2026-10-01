import type { LobbySettings } from "../../lobby/LobbyDirectory";
import type { MatchOptions, SpawnState } from "../../Protocol";
import type { EconomyLedgerState } from "../domain/EconomyLedger";
import type { EncodedState } from "../StateCodec";
import type { VerifiedCommit } from "./CommitVerifier";
import type { HostBatch, RuntimeCommit, RuntimeMap } from "./HostedRuntime";

export interface PreparedMatch {
  mapHash: string;
  options: MatchOptions;
}
export interface SpawnReply {
  rejection: string | null;
  state: SpawnState;
}
export type ExecutorRequest =
  | {
      type: "initialize" | "prepare";
      settings: LobbySettings;
      options: MatchOptions;
      map?: RuntimeMap;
    }
  | { type: "select-spawn"; playerId: number; tile: number }
  | { type: "spawn-state"; remainingMs: number }
  | { type: "start" }
  | { type: "restore"; checkpoint: EncodedState; ledger: EconomyLedgerState }
  | { type: "verify"; batch: HostBatch; proposal: RuntimeCommit }
  | { type: "accept"; commit: VerifiedCommit }
  | { type: "baseline" }
  | { type: "map-identity" }
  | { type: "fallback"; batch: HostBatch };
export type ExecutorResult =
  | PreparedMatch
  | SpawnReply
  | SpawnState
  | VerifiedCommit
  | RuntimeCommit
  | EncodedState
  | string
  | undefined;

/** Application port for an isolated, reserved verifier and fallback executor. */
export interface MatchExecutor {
  request<T extends ExecutorResult>(request: ExecutorRequest): Promise<T>;
  close(): Promise<void>;
}
