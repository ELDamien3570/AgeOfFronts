import type { LobbySettings } from "../../lobby/LobbyDirectory";
import type { MatchOptions } from "../../Protocol";
import type { EconomyLedgerState } from "../domain/EconomyLedger";
import type { EncodedState } from "../StateCodec";
import type { VerifiedCommit } from "./CommitVerifier";
import type { HostBatch, RuntimeCommit, RuntimeMap } from "./HostedRuntime";

export type ExecutorRequest =
  | {
      type: "initialize";
      settings: LobbySettings;
      options: MatchOptions;
      map?: RuntimeMap;
    }
  | { type: "restore"; checkpoint: EncodedState; ledger: EconomyLedgerState }
  | { type: "verify"; batch: HostBatch; proposal: RuntimeCommit }
  | { type: "accept"; commit: VerifiedCommit }
  | { type: "baseline" }
  | { type: "map-identity" }
  | { type: "fallback"; batch: HostBatch };
export type ExecutorResult =
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
