import type { CommandOutcome } from "../../CommandApplications";
import type { Skirmish } from "../../Simulation";
import { SimulationFault, stackFrames, type TickFault } from "../../SimulationFault";
import { MATCH_FAULT_CODE, type MatchAdvance, type MatchCommand } from "./MatchExecutor";

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
/** Applies one advance batch and steps the world, containing throws:
 * - a command whose validation threw before any write is already a
 *   rejection receipt (CommandApplications);
 * - any other throw, from a command or from a tick, faults the match. The
 *   half-ticked world is never stepped, read for commands or advanced again.
 * The recent-command ring and the report are diagnostics, not match state. */
export class MatchAdvanceRunner {
  private readonly recent: RecentCommand[] = [];
  private faultReport?: MatchFaultReport;
  constructor(
    private readonly match: Skirmish,
    private readonly context: () => Context,
    private readonly log: (line: string) => void = line => console.error(line),
  ) {}
  get faulted(): MatchFaultReport | undefined { return this.faultReport && structuredClone(this.faultReport); }
  get recentCommands(): readonly RecentCommand[] { return this.recent; }
  /** Throws MatchFaultError once the match faulted. */
  assertHealthy(): void {
    if (this.faultReport || this.match.tickFault) throw new MatchFaultError();
  }
  /** Applies a batch in order. Commands from absent or AI seats are rejected
   * without reaching the simulation, as before. */
  applyCommands(commands: readonly MatchCommand[], collect: (outcome: CommandOutcome) => void): MatchAdvance["rejectedCommands"] {
    this.assertHealthy();
    const rejected: MatchAdvance["rejectedCommands"] = [];
    for (const item of commands) {
      const player = this.match.player(item.command.playerId);
      this.remember(item);
      let outcome: CommandOutcome;
      if (!player || player.ai) {
        outcome = { id: item.id, playerId: item.command.playerId, tick: this.match.tick, status: "rejected", reason: "You are not active in this match" };
        collect(outcome);
      } else {
        try { outcome = this.match.commandApplications.apply(item.id, item.command); }
        catch (error) { this.fault("command", "commands", error); }
      }
      if (outcome.status === "rejected" && outcome.reason)
        rejected.push({ id: item.id, playerId: item.command.playerId, message: outcome.reason });
    }
    return rejected;
  }
  step(ticks: number): void {
    this.assertHealthy();
    for (let i = 0; i < ticks; i++) {
      try { this.match.step(); }
      catch (error) { this.fault("tick", this.match.tickFault?.afterPhase ?? "tick-start", error); }
    }
  }
  private remember(item: MatchCommand): void {
    let command: string;
    try { command = JSON.stringify(item.command) ?? ""; } catch { command = ""; }
    if (command.length > RECENT_COMMAND_BYTES) command = command.slice(0, RECENT_COMMAND_BYTES);
    this.recent.push({
      tick: this.match.tick,
      playerId: item.command?.playerId,
      type: typeof item.command?.type === "string" ? item.command.type.slice(0, 64) : "unknown",
      id: String(item.id).slice(0, 128),
      command,
    });
    if (this.recent.length > RECENT_COMMAND_LIMIT) this.recent.shift();
  }
  private fault(stage: MatchFaultReport["stage"], afterPhase: MatchFaultReport["afterPhase"], error: unknown): never {
    const context = this.context(),
      original = error instanceof SimulationFault && error.original !== undefined ? error.original : error;
    this.faultReport = {
      event: "match-simulation-fault",
      matchId: context.matchId,
      runtimeId: context.runtimeId,
      source: context.source,
      tick: this.match.tick,
      stage,
      afterPhase,
      message: (original instanceof Error ? original.message : String(original)).slice(0, 1024),
      stack: stackFrames(original),
      recentCommands: this.recent.map(entry => ({ ...entry })),
    };
    this.log(JSON.stringify(this.faultReport));
    throw new MatchFaultError();
  }
}
