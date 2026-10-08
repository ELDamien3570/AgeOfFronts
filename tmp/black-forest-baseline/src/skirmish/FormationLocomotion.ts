import {
  FORMATION_MOVEMENT,
  formationMovementProfile,
} from "./FormationMovementProfile";
import type { MovementIntent } from "./LocalAvoidance";
import { FIXED, TICKS_PER_SECOND, type Squad } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";

export interface FormationMotion {
  /** Radians; artwork faces down at zero. */
  heading: number;
  targetHeading: number;
  /** Fixed world units per simulation tick, after collision admission. */
  speed: number;
}
export const FORMATION_MOTION = {
  turnRate: FORMATION_MOVEMENT.foot.squadTurnRate / TICKS_PER_SECOND,
  prepareTicks: 4 * TICKS_PER_SECOND,
  pivotThreshold: Math.PI / 9,
  launchAlignment: Math.PI / 15,
  chargeAlignment: Math.PI / 15,
  steeringCone: Math.PI / 7,
} as const;
export const headingDifference = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const pointHeading = (from: WorldPoint, to: WorldPoint) =>
  Math.atan2(to.y - from.y, to.x - from.x) - Math.PI / 2;
const normalize = (angle: number) =>
  Math.atan2(Math.sin(angle), Math.cos(angle));

/** One fixed-tick squad controller, upstream of the existing swept collision solver.
 * It never consults artwork or individual soldier state. */
export function formationLocomotion(
  squad: Squad,
  intent: MovementIntent | undefined,
  maximum: number,
  reorientInPlace = false,
): { motion: FormationMotion; intent: MovementIntent } {
  const previous = squad.locomotion;
  let heading =
    previous?.heading ?? (intent ? pointHeading(squad, intent.goal) : 0);
  let targetHeading = previous?.targetHeading ?? heading;
  let speed = previous?.speed ?? 0;
  const preparing = squad.charge?.phase === "preparing";
  const engagedHold =
    squad.fighting && squad.order.type !== "move" && !squad.charge;
  const goal = preparing
    ? squad.charge!
    : engagedHold
      ? undefined
      : intent?.goal;
  const remaining = goal
    ? Math.max(
        0,
        Math.hypot(goal.x - squad.x, goal.y - squad.y) -
          (intent?.stopDistance ?? 0),
      )
    : 0;
  if (goal && remaining > 0.5) targetHeading = pointHeading(squad, goal);
  else if (!goal)
    targetHeading =
      squad.order.type === "hold" && squad.order.facing !== undefined
        ? squad.order.facing
        : heading;
  // Combat attention belongs to individual soldiers. Do not rotate the logical
  // travel heading behind a footprint that is holding its combat position.
  const profile = formationMovementProfile(squad.kind === "cavalry");
  const turnRate =
    (reorientInPlace ? profile.reformTurnRate : profile.squadTurnRate) /
    TICKS_PER_SECOND;
  const acceleration =
    (profile.squadAcceleration * FIXED) / TICKS_PER_SECOND ** 2;
  const brake = (profile.squadBraking * FIXED) / TICKS_PER_SECOND ** 2;
  const error = headingDifference(heading, targetHeading);
  const reverse = Math.abs(error) > FORMATION_MOTION.pivotThreshold;
  // Brake in the old direction before a large turn; no instantaneous U-turn.
  if (!reverse || speed <= brake) {
    if (reverse) speed = 0;
    heading = normalize(
      heading + Math.max(-turnRate, Math.min(turnRate, error)),
    );
  }
  const alignment = Math.max(
    0,
    Math.cos(headingDifference(heading, targetHeading)),
  );
  const requested =
    !intent ||
    preparing ||
    engagedHold ||
    reverse ||
    (speed <= brake &&
      Math.abs(headingDifference(heading, targetHeading)) >
        FORMATION_MOTION.launchAlignment)
      ? 0
      : Math.min(
          maximum * alignment * alignment,
          Math.sqrt(2 * brake * remaining),
          remaining,
        );
  speed =
    requested < speed
      ? Math.max(requested, speed - brake)
      : Math.min(requested, speed + acceleration);
  if (squad.refit || squad.afloat || squad.charge?.phase === "recovery")
    speed = 0;
  // Only use goal-length capping when aligned: braking a reversal still travels
  // in the old direction and must pass the ordinary terrain/enemy sweep guard.
  const travel =
    goal && alignment > 0.99 && !preparing ? Math.min(speed, remaining) : speed;
  const velocity = {
    x: Math.round(-Math.sin(heading) * travel) || 0,
    y: Math.round(Math.cos(heading) * travel) || 0,
  };
  return {
    motion: { heading, targetHeading: normalize(targetHeading), speed },
    intent: {
      ...intent,
      squad,
      speed: Math.hypot(velocity.x, velocity.y),
      goal: intent?.goal ?? {
        x: squad.x + velocity.x,
        y: squad.y + velocity.y,
      },
      preferredVelocity: velocity,
      movementHeading: heading,
    },
  };
}

export function chargeAligned(squad: Squad): boolean {
  return (
    !!squad.charge &&
    !!squad.locomotion &&
    Math.abs(
      headingDifference(
        squad.locomotion.heading,
        pointHeading(squad, squad.charge),
      ),
    ) <= FORMATION_MOTION.chargeAlignment
  );
}
