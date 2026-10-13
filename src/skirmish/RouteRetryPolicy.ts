export const LIMITED_ROUTE_ATTEMPTS = 3;
export const ROUTE_CAPACITY_REASON =
  "Route planning capacity exhausted; replace with a shorter waypoint";

/** A logical attempt owns one game-time deadline through preparation/retries.
 * Omission preserves historical replays and unbounded interactive planning. */
export function planningDeadline(tick: number, limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(limit) || limit < 1)
    throw Error("Invalid planning deadline");
  return tick + limit;
}

/** Deterministic retry contract. Replacement owners reject; committed owners
 * pause without dropping later orders. Legacy checkpoints retain backoff. */
export function limitedRouteRetry(
  attempts: number,
  tick: number,
  bounded = true,
) {
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 0 ||
    !Number.isSafeInteger(tick) ||
    tick < 0
  )
    throw new Error("Invalid route retry state");
  const next = attempts + 1;
  return {
    attempts: next,
    retryAt: tick + 20 * Math.min(10, next),
    exhausted: bounded && next >= LIMITED_ROUTE_ATTEMPTS,
  };
}
