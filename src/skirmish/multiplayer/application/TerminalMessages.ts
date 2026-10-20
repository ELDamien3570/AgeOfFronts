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
/** Every human seat has been eliminated (13 R2.1); the match ends shortly after. */
export const NO_LIVING_HUMAN_MESSAGE = "Every human empire has been defeated";
/** The match worker could not prepare the battlefield; members return to their room. */
export const MATCH_INITIALIZATION_FAILED_MESSAGE =
  "The match could not be started. You are back in your room";
/** A second spawn choice arrived while the guest's previous one was still being checked. */
export const SPAWN_SELECTION_BUSY_MESSAGE =
  "Your last spawn choice is still being checked. Wait a moment and try again.";
/** A worker request failed for an internal reason. */
export const MATCH_EXECUTOR_FAILED_MESSAGE = "Match executor failed";
/** Worker fatal notifications (the raw cause is logged in the worker). */
export const SNAPSHOT_PUBLICATION_FAILED_MESSAGE = "Snapshot publication failed";
export const SIMULATION_RECOVERY_FAILED_MESSAGE = "Simulation recovery failed";

/** The browser hosting a custom match closed or lost its connection. */
export const HOST_LEFT_MESSAGE = "The host left the match";
/** The custom room owner's browser never opened the match it was to host. */
export const HOST_UNAVAILABLE_MESSAGE =
  "The host's browser did not start the match. You are back in your room";
/** Hosting failures players can understand; anything else stays generic. */
const PUBLIC_HOST_ERRORS: ReadonlySet<string> = new Set([HOST_LEFT_MESSAGE, HOST_UNAVAILABLE_MESSAGE]);

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
  const message = messageOf(error);
  if (message === HOST_LEFT_MESSAGE) return message;
  console.error("Match stopped", error);
  return MATCH_STOPPED_MESSAGE;
}

/** Log the raw failure and return text safe to show the reserved members. */
export function publicInitializationMessage(error: unknown): string {
  const message = messageOf(error);
  if (message === HOST_LEFT_MESSAGE) return HOST_UNAVAILABLE_MESSAGE;
  if (message !== undefined && PUBLIC_HOST_ERRORS.has(message)) return message;
  console.error("Match initialization failed", error);
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
