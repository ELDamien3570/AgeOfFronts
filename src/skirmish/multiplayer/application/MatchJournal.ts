import { secondsToTicks } from "../../Protocol";
import type { Skirmish } from "../../Simulation";
import type { MatchCommand } from "./MatchExecutor";

/** Ticks between rollback checkpoints (owner decision OD-3, provisional).
 * tests/skirmish/perf/CheckpointCost.ts measures the cost and prints the
 * interval its decision rule selects; update this constant from it. */
export const CHECKPOINT_INTERVAL_TICKS = 20;
/** At most this many rollbacks within ROLLBACK_WINDOW_TICKS (OD-7). Beyond
 * it a fault ends the match, so a client cannot force repeated replays. */
export const ROLLBACK_BUDGET = 3;
export const ROLLBACK_WINDOW_TICKS = secondsToTicks(60);

/** Everything the server worker feeds the simulation between checkpoints. A
 * missing record would make a replay diverge. Start and spawn selection come
 * before the first checkpoint; baselines and encoders are not simulation input. */
export type JournalEntry =
  | {
      kind: "advance";
      /** Seats handed to the AI before the commands apply. */
      disconnectedPlayerIds: readonly number[];
      commands: readonly MatchCommand[];
      ticks: number;
    }
  | { kind: "control"; playerId: number; ai: boolean };
export type Checkpoint = ReturnType<Skirmish["checkpoint"]>;

/** The last good checkpoint and the inputs applied since it. Holds exactly one
 * checkpoint (a deep copy of the world). Diagnostics and recovery data only:
 * nothing here is match state. */
export class MatchJournal {
  private saved?: { tick: number; checkpoint: Checkpoint };
  private readonly log: JournalEntry[] = [];
  private readonly rollbacks: number[] = [];
  constructor(readonly interval = CHECKPOINT_INTERVAL_TICKS) {
    if (!Number.isSafeInteger(interval) || interval < 1) throw new Error("Invalid checkpoint interval");
  }
  get checkpoint(): Checkpoint | undefined { return this.saved?.checkpoint; }
  get checkpointTick(): number | undefined { return this.saved?.tick; }
  get entries(): readonly JournalEntry[] { return this.log; }
  shouldCheckpoint(tick: number): boolean {
    return !this.saved || tick - this.saved.tick >= this.interval;
  }
  /** Replace the held checkpoint; the entries before it are no longer needed. */
  hold(tick: number, checkpoint: Checkpoint): void {
    this.saved = { tick, checkpoint };
    this.log.length = 0;
  }
  /** Record an input. Inputs before the first checkpoint are part of it. */
  record(entry: JournalEntry): void {
    if (this.saved) this.log.push(entry);
  }
  /** Forget the checkpoint, so the next advance takes a new one. */
  reset(): void {
    this.saved = undefined;
    this.log.length = 0;
  }
  /** Whether another rollback fits the budget at `tick`; uses it if so. */
  admitRollback(tick: number): boolean {
    while (this.rollbacks.length && this.rollbacks[0] <= tick - ROLLBACK_WINDOW_TICKS) this.rollbacks.shift();
    if (this.rollbacks.length >= ROLLBACK_BUDGET) return false;
    this.rollbacks.push(tick);
    return true;
  }
}
