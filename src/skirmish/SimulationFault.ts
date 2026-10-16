import type { RuntimePhase } from "./RuntimeDiagnostics";

/** A throw that left authoritative state partly written: a tick that stopped
 * part-way, or a command that threw after it started mutating. The match must
 * not continue from that world. It is never converted into a rejection. */
export class SimulationFault extends Error {
  /** The original throw, when this fault wraps one. */
  readonly original?: unknown;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "SimulationFault";
    this.original = options?.cause;
  }
}
export interface TickFault {
  tick: number;
  /** The last phase the tick completed; the throw came from the next one. */
  afterPhase: RuntimePhase | "tick-start";
  message: string;
}
/** At most this many stack frames are logged for a contained throw. */
export const LOGGED_STACK_FRAMES = 10;
export const stackFrames = (error: unknown): string[] =>
  error instanceof Error && error.stack
    ? error.stack.split("\n").slice(1, 1 + LOGGED_STACK_FRAMES).map(line => line.trim())
    : [];
