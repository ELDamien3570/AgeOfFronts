/**
 * Public text for terminal and failure boundaries. Internal exception text
 * (property names, file paths, worker diagnostics) stays in server logs; a
 * client only ever sees one of these fixed strings or a message that was
 * deliberately written for players.
 *
 * Strings shown before ". Return to the lobby to play again." must not end
 * in a period (OnlineMatchSession appends one).
 */

/** Every unexpected stop of a running match (tick fault, worker death, clock failure). */
export const MATCH_STOPPED_MESSAGE = "Match stopped unexpectedly";
/** The match worker could not prepare the battlefield; members return to their room. */
export const MATCH_INITIALIZATION_FAILED_MESSAGE =
  "The match could not be started. You are back in your room";
/** A worker request failed for an internal reason. */
export const MATCH_EXECUTOR_FAILED_MESSAGE = "Match executor failed";
/** Worker fatal notifications (the raw cause is logged in the worker). */
export const SNAPSHOT_PUBLICATION_FAILED_MESSAGE = "Snapshot publication failed";
export const SIMULATION_RECOVERY_FAILED_MESSAGE = "Simulation recovery failed";

/** Battlefield setup failures players can act on (change settings and retry). */
export const PUBLIC_SETUP_ERRORS: ReadonlySet<string> = new Set([
  "Not enough room for these factions and tribes. Choose fewer opponents or a larger battlefield.",
  "No viable land for starting camps",
]);

/** Messages the match worker throws deliberately; anything else is internal. */
const PUBLIC_EXECUTOR_ERRORS: ReadonlySet<string> = new Set([
  ...PUBLIC_SETUP_ERRORS,
  "Executor already initialized",
  "Executor not initialized",
  "Spawn selection has closed",
  "This faction is no longer available",
  "Invalid match advance",
  "Match command batch exceeds its budget",
  "Unknown match operation",
]);

const messageOf = (error: unknown): string | undefined =>
  error instanceof Error ? error.message : undefined;

/** Log the raw failure and return the fixed text for a stopped match. */
export function publicStopMessage(error: unknown): string {
  console.error("Match stopped", error);
  return MATCH_STOPPED_MESSAGE;
}

/** Log the raw failure and return text safe to show the reserved members. */
export function publicInitializationMessage(error: unknown): string {
  console.error("Match initialization failed", error);
  const message = messageOf(error);
  return message !== undefined && PUBLIC_SETUP_ERRORS.has(message)
    ? message
    : MATCH_INITIALIZATION_FAILED_MESSAGE;
}

/** Text a worker may post for a failed request (raw error logged by the caller). */
export function publicExecutorError(error: unknown): string {
  const message = messageOf(error);
  return message !== undefined && PUBLIC_EXECUTOR_ERRORS.has(message)
    ? message
    : MATCH_EXECUTOR_FAILED_MESSAGE;
}
