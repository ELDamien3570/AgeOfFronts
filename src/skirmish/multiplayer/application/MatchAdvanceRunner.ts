import { COMMAND_VALIDATION_FAILURE, type CommandOutcome } from "../../CommandApplications";
import type { Skirmish } from "../../Simulation";
import { SimulationFault, stackFrames, type TickFault } from "../../SimulationFault";
import { MATCH_FAULT_CODE, type MatchAdvance, type MatchCommand } from "./MatchExecutor";
import { MatchJournal, type JournalEntry } from "./MatchJournal";

export const RECENT_COMMAND_LIMIT = 64;
export const RECENT_COMMAND_BYTES = 512;
export interface RecentCommand {
  tick: number;
  playerId: number;
  type: string;
  id: string;
  /** Compact JSON of the command, truncated to RECENT_COMMAND_BYTES. */
  command: string;
}
export interface MatchFaultReport {
  event: "match-simulation-fault";
  matchId: string;
  runtimeId: string;
  source: string;
  tick: number;
  /** "command" when applying input threw after a write, else "tick". */
  stage: "command" | "tick";
  /** Last completed tick phase; the throw came from the phase after it. */
  afterPhase: TickFault["afterPhase"] | "commands";
  message: string;
  stack: string[];
  recentCommands: RecentCommand[];
  /** Present when the runner can roll back: "rolled-back" when the match
   * continued from the last checkpoint, "failed" when no replay with changed
   * inputs succeeded, "budget" when the rollback budget was spent. */
  recovery?: "rolled-back" | "failed" | "budget";
  /** Ticks replayed from the checkpoint before the faulting advance. */
  replayedTicks?: number;
  /** Commands of the faulting advance dropped by the rollback. */
  droppedCommandIds?: string[];
}
/** The executor-level signal a host maps to a fixed player-facing ending.
 * Its message is the stable code, never the internal error text. */
export class MatchFaultError extends Error {
  readonly code = MATCH_FAULT_CODE;
  constructor() {
    super(MATCH_FAULT_CODE);
    this.name = "MatchFaultError";
  }
}
interface Context { matchId: string; runtimeId: string; source: string }
/** How the host rebuilds its simulation for a rollback. */
export interface MatchRecovery {
  /** A fresh simulation from the match's exact map and options, no observers. */
  create(): Skirmish;
  /** Attach the host's observers (outcomes, progress, phases). Called after the
   * replay, so receipts already published are not sent again. */
  attach(match: Skirmish): void;
  /** The recovered simulation replaced the faulted one. */
  installed(match: Skirmish): void;
}
export interface AdvanceInput {
  commands: readonly MatchCommand[];
  ticks: number;
  disconnectedPlayerIds?: readonly number[];
}
export interface AdvanceResult {
  rejectedCommands: MatchAdvance["rejectedCommands"];
  /** The faulting advance was rolled back and re-run with changed inputs. */
  rolledBack: boolean;
}
type Advance = Extract<JournalEntry, { kind: "advance" }>;
/** Wall and thread-CPU time of the stages of the last advance (I-0
 * diagnostics only; never match state). CPU is undefined without a clock. */
export interface AdvanceStageTimings {
  /** Absent when the advance took no checkpoint. */
  checkpoint?: { wall: number; cpu?: number };
  commands: { wall: number; cpu?: number };
  ticks: { wall: number; cpu?: number };
}
/** Clocks for stage timings; wall in ms, thread CPU in ms. */
export interface StageClock { wall(): number; cpu(): number | undefined }
/** A throw while running one advance on one simulation instance. */
class StageFault {
  constructor(
    readonly stage: MatchFaultReport["stage"],
    readonly afterPhase: MatchFaultReport["afterPhase"],
    readonly error: unknown,
    readonly commandIndex?: number,
  ) {}
}
/** Applies one advance batch and steps the world, containing throws:
 * - a command whose validation threw before any write is already a
 *   rejection receipt (CommandApplications);
 * - any other throw, from a command or from a tick, faults the match. The
 *   half-ticked world is never stepped, read for commands or advanced again.
 *
 * With a MatchRecovery the runner rolls back instead: it holds the last good
 * checkpoint (every CHECKPOINT_INTERVAL_TICKS) and the inputs since, rebuilds
 * a fresh simulation from it, replays those inputs and re-runs the faulting
 * advance without the faulting command (command stage) or without the faulting
 * advance's commands (tick stage). The simulation is deterministic, so a
 * replay with unchanged inputs would throw again: it is never attempted. A
 * replay that throws, or a fault beyond the rollback budget, faults the match.
 * The recent-command ring and the report are diagnostics, not match state. */
export class MatchAdvanceRunner {
  private readonly recent: RecentCommand[] = [];
  private faultReport?: MatchFaultReport;
  private current: Skirmish;
  private readonly journal: MatchJournal;
  constructor(
    match: Skirmish,
    private readonly context: () => Context,
    private readonly log: (line: string) => void = line => console.error(line),
    private readonly recovery?: MatchRecovery,
    journal?: MatchJournal,
  ) {
    this.current = match;
    this.journal = journal ?? new MatchJournal();
  }
  /** Set by a host that reports stage timings (serverMatchWorker). */
  clock?: StageClock;
  /** Stage timings of the last advance, when a clock is set. A rolled-back
   * advance reports the replay under "ticks". */
  lastTimings?: AdvanceStageTimings;
  private stage(): { wall: number; cpu?: number } | undefined {
    return this.clock && { wall: this.clock.wall(), cpu: this.clock.cpu() };
  }
  private since(start: { wall: number; cpu?: number } | undefined): { wall: number; cpu?: number } {
    const end = this.stage();
    if (!start || !end) return { wall: 0 };
    return { wall: end.wall - start.wall, ...(start.cpu !== undefined && end.cpu !== undefined ? { cpu: end.cpu - start.cpu } : {}) };
  }
  /** The live simulation; replaced by a rollback. */
  get match(): Skirmish { return this.current; }
  get faulted(): MatchFaultReport | undefined { return this.faultReport && structuredClone(this.faultReport); }
  get recentCommands(): readonly RecentCommand[] { return this.recent; }
  /** Throws MatchFaultError once the match faulted. */
  assertHealthy(): void {
    if (this.faultReport || this.current.tickFault) throw new MatchFaultError();
  }
  /** Hands a seat to the AI or back, recorded for a replay. */
  setController(playerId: number, ai: boolean): void {
    this.assertHealthy();
    this.journal.record({ kind: "control", playerId, ai });
    this.current.setAiController(playerId, ai);
  }
  /** One worker advance: disconnected seats go to the AI, the commands apply
   * in order, then the world steps `ticks` times. */
  advance(input: AdvanceInput, collect: (outcome: CommandOutcome) => void): AdvanceResult {
    this.assertHealthy();
    const match = this.current;
    if (this.clock) this.lastTimings = { commands: { wall: 0 }, ticks: { wall: 0 } };
    if (this.recovery && this.journal.shouldCheckpoint(match.tick)) {
      const started = this.stage();
      this.journal.hold(match.tick, match.checkpoint());
      if (this.lastTimings) this.lastTimings.checkpoint = this.since(started);
    }
    const entry: Advance = { kind: "advance", disconnectedPlayerIds: [...input.disconnectedPlayerIds ?? []], commands: [...input.commands], ticks: input.ticks };
    this.journal.record(entry);
    try {
      return { rejectedCommands: this.execute(match, entry, collect, true), rolledBack: false };
    } catch (fault) {
      if (!(fault instanceof StageFault)) throw fault;
      return this.recover(fault, entry, collect);
    }
  }
  /** Applies a batch in order. Commands from absent or AI seats are rejected
   * without reaching the simulation, as before. */
  applyCommands(commands: readonly MatchCommand[], collect: (outcome: CommandOutcome) => void): MatchAdvance["rejectedCommands"] {
    return this.advance({ commands, ticks: 0 }, collect).rejectedCommands;
  }
  step(ticks: number): void {
    this.advance({ commands: [], ticks }, () => {});
  }
  private execute(match: Skirmish, entry: Advance, collect: (outcome: CommandOutcome) => void, live: boolean, drop?: ReadonlySet<number>): MatchAdvance["rejectedCommands"] {
    for (const id of entry.disconnectedPlayerIds) if (match.player(id)) match.setAiController(id, true);
    const rejected: MatchAdvance["rejectedCommands"] = [];
    const commandsStarted = live ? this.stage() : undefined;
    entry.commands.forEach((item, index) => {
      const player = match.player(item.command.playerId);
      if (live) this.remember(item, match.tick);
      let outcome: CommandOutcome;
      if (drop?.has(index)) {
        outcome = { id: item.id, playerId: item.command.playerId, tick: match.tick, status: "rejected", reason: COMMAND_VALIDATION_FAILURE };
        collect(outcome);
      } else if (!player || player.ai) {
        outcome = { id: item.id, playerId: item.command.playerId, tick: match.tick, status: "rejected", reason: "You are not active in this match" };
        collect(outcome);
      } else {
        try { outcome = match.commandApplications.apply(item.id, item.command); }
        catch (error) { throw new StageFault("command", "commands", error, index); }
      }
      if (outcome.status === "rejected" && outcome.reason)
        rejected.push({ id: item.id, playerId: item.command.playerId, message: outcome.reason });
    });
    const ticksStarted = live ? this.stage() : undefined;
    if (live && this.lastTimings) this.lastTimings.commands = this.since(commandsStarted);
    try {
      for (let i = 0; i < entry.ticks; i++) {
        try { match.step(); }
        catch (error) { throw new StageFault("tick", match.tickFault?.afterPhase ?? "tick-start", error); }
      }
    } finally {
      if (live && this.lastTimings) this.lastTimings.ticks = this.since(ticksStarted);
    }
    return rejected;
  }
  private recover(fault: StageFault, entry: Advance, collect: (outcome: CommandOutcome) => void): AdvanceResult {
    const report = this.report(fault);
    const checkpoint = this.journal.checkpoint;
    if (!this.recovery || !checkpoint) return this.fail(report);
    const drop = new Set(fault.stage === "command" ? [fault.commandIndex!] : entry.commands.keys());
    report.droppedCommandIds = [...drop].map(index => String(entry.commands[index].id).slice(0, 128));
    report.replayedTicks = 0;
    // Unchanged inputs reproduce the same throw: there is nothing to replay.
    if (!drop.size) return this.fail({ ...report, recovery: "failed" });
    if (!this.journal.admitRollback(report.tick)) return this.fail({ ...report, recovery: "budget" });
    const earlier = this.journal.entries.slice(0, this.journal.entries.lastIndexOf(entry));
    let fresh: Skirmish, rejectedCommands: MatchAdvance["rejectedCommands"];
    const replayStarted = this.stage();
    try {
      fresh = this.recovery.create();
      fresh.restore(checkpoint);
      for (const previous of earlier) {
        if (previous.kind === "control") fresh.setAiController(previous.playerId, previous.ai);
        else { this.execute(fresh, previous, () => {}, false); report.replayedTicks += previous.ticks; }
      }
      this.recovery.attach(fresh);
      rejectedCommands = this.execute(fresh, entry, collect, false, drop);
    } catch {
      return this.fail({ ...report, recovery: "failed" });
    }
    if (this.lastTimings) this.lastTimings.ticks = this.since(replayStarted);
    this.current = fresh;
    // The recovered timeline differs from the journal; the next advance
    // checkpoints it afresh.
    this.journal.reset();
    this.recovery.installed(fresh);
    this.log(JSON.stringify({ ...report, recovery: "rolled-back" }));
    return { rejectedCommands, rolledBack: true };
  }
  private remember(item: MatchCommand, tick: number): void {
    let command: string;
    try { command = JSON.stringify(item.command) ?? ""; } catch { command = ""; }
    if (command.length > RECENT_COMMAND_BYTES) command = command.slice(0, RECENT_COMMAND_BYTES);
    this.recent.push({
      tick,
      playerId: item.command?.playerId,
      type: typeof item.command?.type === "string" ? item.command.type.slice(0, 64) : "unknown",
      id: String(item.id).slice(0, 128),
      command,
    });
    if (this.recent.length > RECENT_COMMAND_LIMIT) this.recent.shift();
  }
  private report(fault: StageFault): MatchFaultReport {
    const context = this.context(), error = fault.error,
      original = error instanceof SimulationFault && error.original !== undefined ? error.original : error;
    return {
      event: "match-simulation-fault",
      matchId: context.matchId,
      runtimeId: context.runtimeId,
      source: context.source,
      tick: this.current.tick,
      stage: fault.stage,
      afterPhase: fault.afterPhase,
      message: (original instanceof Error ? original.message : String(original)).slice(0, 1024),
      stack: stackFrames(original),
      recentCommands: this.recent.map(entry => ({ ...entry })),
    };
  }
  private fail(report: MatchFaultReport): never {
    this.faultReport = report;
    this.log(JSON.stringify(report));
    throw new MatchFaultError();
  }
}
