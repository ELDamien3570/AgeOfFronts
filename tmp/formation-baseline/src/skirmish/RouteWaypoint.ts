import { FIXED } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";

/** Arrival is crossing a route gate, not hitting a tiny point. The heading is
 * the incoming segment direction, retained until this waypoint is consumed.
 * Lateral bounds prevent a distant avoidance displacement from skipping a waypoint. */
export function crossedWaypoint(
  position: WorldPoint,
  goal: WorldPoint,
  incomingHeading: number,
): boolean {
  const ux = -Math.sin(incomingHeading),
    uy = Math.cos(incomingHeading);
  const dx = position.x - goal.x,
    dy = position.y - goal.y;
  return (
    dx * ux + dy * uy >= 0 &&
    Math.abs(dx * uy - dy * ux) <= FIXED * 0.45 &&
    Math.hypot(dx, dy) <= FIXED * 0.6
  );
}
