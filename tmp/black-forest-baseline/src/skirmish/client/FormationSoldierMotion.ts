export interface SoldierSlot {
  id: number;
  x: number;
  y: number;
  angle?: number;
  scale: number;
  front: boolean;
  /** An intentional small reserve step, rather than aggregate position noise. */
  step?: boolean;
}
export interface WorldSoldier extends SoldierSlot {
  angle: number;
  speed: number;
  gaitDistance: number;
  turning?: boolean;
  facingError?: number;
  backstepping?: boolean;
}
interface Member {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  targetX: number;
  targetY: number;
  goalX: number;
  goalY: number;
  gaitDistance: number;
  repositioning: boolean;
  lastSpeed: number;
  turnVelocity: number;
  stepMode?: "forward" | "backward";
}
interface MotionOptions {
  footprint: number;
  mounted: boolean;
  engaged: boolean;
  /** Cosmetic attack foot plant; the aggregate squad continues independently. */
  planted?: ReadonlySet<number>;
  /** Independent attack-facing with bounded, turn-first combat footwork. */
  combatFootwork?: boolean;
  reformInPlace?: boolean;
}
const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/** Cosmetic world-space followers. No soldier influences orders, collision or damage. */
export class FormationSoldierMotion {
  private readonly members = new Map<number, Member>();
  private previous?: { x: number; y: number; now: number };
  private leaderVX = 0;
  private leaderVY = 0;
  constructor(private readonly variant = 0) {}
  position(id: number): { x: number; y: number; angle: number } | undefined {
    const member = this.members.get(id);
    return member && { x: member.x, y: member.y, angle: member.angle };
  }
  sample(
    now: number,
    anchor: { x: number; y: number },
    heading: number,
    slots: readonly SoldierSlot[],
    options: MotionOptions,
  ): WorldSoldier[] {
    const profile = formationMovementProfile(options.mounted);
    const elapsed = this.previous ? Math.max(0, now - this.previous.now) : 0;
    const resumed = elapsed > 250;
    const dt = resumed ? 0 : Math.min(0.25, elapsed / 1000);
    const cos = Math.cos(heading),
      sin = Math.sin(heading);
    const anchorDX = this.previous ? anchor.x - this.previous.x : 0;
    const anchorDY = this.previous ? anchor.y - this.previous.y : 0;
    if (resumed) {
      // Rebase a culled/resumed formation once; retain its individual offsets.
      for (const member of this.members.values()) {
        member.x += anchorDX;
        member.y += anchorDY;
        member.targetX += anchorDX;
        member.targetY += anchorDY;
        member.goalX += anchorDX;
        member.goalY += anchorDY;
        member.vx = member.vy = 0;
        member.turnVelocity = 0;
      }
      this.leaderVX = this.leaderVY = 0;
    } else if (dt) {
      const follow =
        1 -
        Math.exp(
          -dt /
            (options.combatFootwork
              ? options.engaged
                ? 0.1
                : 0.05
              : options.engaged
                ? 0.22
                : 0.12),
        );
      const seconds = elapsed / 1000;
      this.leaderVX += (anchorDX / seconds - this.leaderVX) * follow;
      this.leaderVY += (anchorDY / seconds - this.leaderVY) * follow;
    }
    this.previous = { ...anchor, now };
    const leaderSpeed = Math.hypot(this.leaderVX, this.leaderVY);
    const live = new Set<number>();
    const result: WorldSoldier[] = [];
    for (const slot of slots) {
      live.add(slot.id);
      const goalX =
        anchor.x + (slot.x * cos - slot.y * sin) * options.footprint;
      const goalY =
        anchor.y + (slot.x * sin + slot.y * cos) * options.footprint;
      const facing = heading + (slot.angle ?? 0);
      let member = this.members.get(slot.id);
      if (!member) {
        member = {
          x: goalX,
          y: goalY,
          vx: 0,
          vy: 0,
          angle: facing,
          targetX: goalX,
          targetY: goalY,
          goalX,
          goalY,
          gaitDistance: 0,
          repositioning: false,
          lastSpeed: 0,
          turnVelocity: 0,
        };
        this.members.set(slot.id, member);
      }
      const startX = member.x,
        startY = member.y;
      if (dt) {
        const total = dt,
          steps = Math.ceil(total * 60);
        const slotVX = (goalX - member.goalX) / total;
        const slotVY = (goalY - member.goalY) / total;
        for (let step = 1; step <= steps; step++) {
          const dt = total / steps;
          const intermediateX =
            member.goalX + ((goalX - member.goalX) * step) / steps;
          const intermediateY =
            member.goalY + ((goalY - member.goalY) * step) / steps;
          const variation = ((slot.id * 7 + this.variant * 3) % 11) / 10;
          const response =
            1 -
            Math.exp(
              -dt /
                (options.combatFootwork
                  ? 0.04 + variation * 0.05
                  : 0.06 + variation * 0.1),
            );
          if (options.combatFootwork) {
            // The squad and baked tracks already supply a continuous trajectory.
            // Filtering that trajectory again adds artificial formation lag.
            member.targetX = intermediateX;
            member.targetY = intermediateY;
          } else {
            member.targetX += (intermediateX - member.targetX) * response;
            member.targetY += (intermediateY - member.targetY) * response;
          }
          const dx = member.targetX - member.x,
            dy = member.targetY - member.y;
          const distance = Math.hypot(dx, dy);
          const plantedCombat =
            options.engaged &&
            leaderSpeed < (options.combatFootwork ? 0.12 : 0.6);
          const slack = plantedCombat ? 0.025 : 0.015;
          // Hysteresis: tolerate small combat corrections, then take a definite
          // step and settle. A continuous spring makes attacking feet creep.
          if (!plantedCombat) member.repositioning = true;
          else if (
            !member.repositioning &&
            distance > (slot.step ? 0.06 : 0.24 + variation * 0.08)
          )
            member.repositioning = true;
          else if (
            member.repositioning &&
            distance <= (options.combatFootwork ? slack : 0.015)
          )
            // Use the same arrival radius that stops translation. Otherwise a
            // finished step can keep owning facing indefinitely and block attacks.
            member.repositioning = false;
          let correction =
            Math.max(0, distance - slack) * (options.engaged ? 4 : 7);
          if (plantedCombat && member.repositioning)
            correction = Math.max(0.65, correction);
          const carry = plantedCombat ? 0 : 1;
          let desiredVX =
            (options.combatFootwork ? slotVX : this.leaderVX) * carry +
            (distance ? (dx / distance) * correction : 0);
          let desiredVY =
            (options.combatFootwork ? slotVY : this.leaderVY) * carry +
            (distance ? (dy / distance) * correction : 0);
          if (leaderSpeed < 0.08 && distance <= slack)
            desiredVX = desiredVY = 0;
          if (
            (plantedCombat && !member.repositioning) ||
            options.planted?.has(slot.id)
          ) {
            desiredVX = desiredVY = 0;
            member.vx = member.vy = 0;
          }
          const stepping =
            options.combatFootwork &&
            plantedCombat &&
            member.repositioning &&
            !options.planted?.has(slot.id);
          const reversingTranslation =
            options.combatFootwork &&
            Math.hypot(member.vx, member.vy) > 0.04 &&
            member.vx * (goalX - member.x) + member.vy * (goalY - member.y) < 0;
          const stepFacing =
            (reversingTranslation
              ? Math.atan2(goalY - member.y, goalX - member.x)
              : Math.atan2(desiredVY, desiredVX)) -
            Math.PI / 2;
          const rearError = Math.abs(angleDelta(facing + Math.PI, stepFacing));
          const backstepDistance = Math.max(
            options.mounted ? 0.4 : 0.5,
            slot.scale * options.footprint * (options.mounted ? 1 : 2),
          );
          if (!stepping) member.stepMode = undefined;
          else {
            if (reversingTranslation) member.stepMode = undefined;
            member.stepMode ??=
              distance <= backstepDistance && rearError < Math.PI / 4
                ? "backward"
                : "forward";
            // A longer or substantially redirected step must become a normal
            // walk. Do not switch a long walk to backsteps just as it arrives.
            if (
              member.stepMode === "backward" &&
              (distance > backstepDistance || rearError > Math.PI / 3)
            )
              member.stepMode = "forward";
          }
          const backstepping = stepping && member.stepMode === "backward";
          if (stepping) {
            // Short rearward corrections keep attention on the opponent. Other
            // steps pivot into travel, and every reposition pauses its attack.
            const alignment = Math.max(
              0,
              Math.cos(
                angleDelta(member.angle, backstepping ? facing : stepFacing),
              ),
            );
            const requested = Math.hypot(desiredVX, desiredVY);
            const limit =
              (backstepping
                ? options.mounted
                  ? 0.6
                  : 0.75
                : profile.stepSpeed) *
              alignment *
              alignment;
            if (requested > limit) {
              desiredVX *= limit / requested;
              desiredVY *= limit / requested;
            }
          }
          if (
            options.reformInPlace &&
            !options.engaged &&
            Math.abs(angleDelta(member.angle, facing)) > Math.PI / 12
          ) {
            // Brake and pivot before following the newly assigned travel slot.
            // The squad uses the same capacity envelope; no backward launch.
            desiredVX = desiredVY = 0;
          }
          const maximum =
            (options.combatFootwork
              ? Math.max(profile.stepSpeed, leaderSpeed * 1.1 + 0.15)
              : Math.max(options.mounted ? 9 : 6, leaderSpeed * 1.15 + 0.5)) *
            (0.97 + variation * 0.06);
          const requested = Math.hypot(desiredVX, desiredVY);
          if (requested > maximum) {
            desiredVX *= maximum / requested;
            desiredVY *= maximum / requested;
          }
          const responseVariation = 0.94 + variation * 0.12;
          // Travel can build considerably more speed than a short reserve step.
          // Use the same actual braking rate in the stopping envelope and integrator.
          const braking =
            (stepping ? profile.stepBraking : profile.followerBraking) *
            responseVariation;
          if (options.combatFootwork) {
            const velocity = Math.hypot(member.vx, member.vy);
            const wanted = Math.hypot(desiredVX, desiredVY);
            // Stop old momentum before accelerating into a reversed instruction.
            if (
              reversingTranslation ||
              (velocity > 0.04 &&
                member.vx * desiredVX + member.vy * desiredVY < 0)
            ) {
              desiredVX = desiredVY = 0;
            } else if (wanted > 0) {
              const remaining = Math.max(
                0,
                Math.min(
                  distance,
                  Math.hypot(goalX - member.x, goalY - member.y),
                ) - 0.015,
              );
              // Account for this integration step as well as the remaining brake run.
              const targetTravel =
                carry && distance
                  ? Math.max(0, (slotVX * dx + slotVY * dy) / distance)
                  : 0;
              const arrivalSpeed =
                targetTravel +
                Math.sqrt((braking * dt) ** 2 + 2 * braking * remaining) -
                braking * dt;
              const factor = Math.min(1, arrivalSpeed / wanted);
              desiredVX *= factor;
              desiredVY *= factor;
            }
          }
          const slowing =
            Math.hypot(desiredVX, desiredVY) < Math.hypot(member.vx, member.vy);
          const acceleration =
            options.combatFootwork && slowing
              ? braking
              : (options.combatFootwork
                  ? stepping
                    ? profile.stepAcceleration
                    : profile.followerAcceleration
                  : options.mounted
                    ? 20
                    : 14) * responseVariation;
          const changeX = desiredVX - member.vx,
            changeY = desiredVY - member.vy;
          const change = Math.hypot(changeX, changeY);
          const factor = change ? Math.min(1, (acceleration * dt) / change) : 0;
          member.vx += changeX * factor;
          member.vy += changeY * factor;
          let stepX = member.vx * dt,
            stepY = member.vy * dt;
          // A finite integration step cannot cross the slot's arrival plane.
          // This also catches an angled approach, where step length alone misses it.
          const closing = stepX * dx + stepY * dy;
          if (
            options.combatFootwork &&
            Math.hypot(slotVX, slotVY) < 0.001 &&
            distance < 0.00001
          ) {
            stepX = stepY = 0;
            member.vx = member.vy = 0;
          } else if (
            options.combatFootwork &&
            distance > 0 &&
            closing >= distance * distance
          ) {
            const fraction = (distance * distance) / closing;
            stepX *= fraction;
            stepY *= fraction;
            const normalX = dx / distance,
              normalY = dy / distance;
            const outward =
              (member.vx - slotVX * carry) * normalX +
              (member.vy - slotVY * carry) * normalY;
            if (outward > 0) {
              member.vx -= outward * normalX;
              member.vy -= outward * normalY;
            }
          } else if (
            leaderSpeed < 0.08 &&
            Math.hypot(stepX, stepY) >= distance &&
            stepX * dx + stepY * dy > 0
          ) {
            stepX = dx;
            stepY = dy;
            member.vx = member.vy = 0;
          }
          member.x += stepX;
          member.y += stepY;
          member.gaitDistance += Math.hypot(stepX, stepY);
          const speed = Math.hypot(member.vx, member.vy);
          // Combat permits small backward/sideways steps while facing the enemy.
          const desiredFacing =
            stepping && !backstepping
              ? stepFacing
              : options.engaged || options.reformInPlace || speed < 0.12
                ? facing
                : Math.atan2(member.vy, member.vx) - Math.PI / 2;
          const turnRate =
            ((options.combatFootwork
              ? (options.reformInPlace && !options.engaged
                  ? profile.reformPivotSpeed
                  : profile.pivotSpeed) +
                variation * profile.pivotVariation
              : options.engaged
                ? 55
                : options.mounted
                  ? 110
                  : 90) *
              Math.PI) /
            180;
          const error = angleDelta(member.angle, desiredFacing);
          let rotation: number;
          if (options.combatFootwork) {
            const angularAcceleration =
              ((options.reformInPlace && !options.engaged
                ? profile.reformPivotAcceleration
                : profile.pivotAcceleration) *
                (0.88 + variation * 0.24) *
                Math.PI) /
              180;
            const angularBraking = angularAcceleration * 1.5;
            const reversing = member.turnVelocity * error < 0;
            const desiredTurn = reversing
              ? 0
              : Math.sign(error) *
                Math.min(
                  turnRate,
                  Math.sqrt(2 * angularBraking * Math.abs(error)),
                );
            const slowingTurn =
              Math.abs(desiredTurn) < Math.abs(member.turnVelocity);
            const change =
              (slowingTurn ? angularBraking : angularAcceleration) * dt;
            member.turnVelocity += Math.max(
              -change,
              Math.min(change, desiredTurn - member.turnVelocity),
            );
            rotation = member.turnVelocity * dt;
            if (
              rotation * error >= 0 &&
              Math.abs(rotation) >= Math.abs(error)
            ) {
              rotation = error;
              member.turnVelocity = 0;
            }
          } else {
            const turn = turnRate * dt;
            rotation = Math.max(-turn, Math.min(turn, error));
          }
          member.angle += rotation;
          if (options.combatFootwork)
            member.gaitDistance += Math.abs(rotation) * 0.06;
        }
        member.goalX = goalX;
        member.goalY = goalY;
      }
      if (dt)
        member.lastSpeed =
          Math.hypot(member.x - startX, member.y - startY) / dt;
      else if (resumed) member.lastSpeed = 0;
      result.push({
        ...slot,
        x: member.x,
        y: member.y,
        angle: member.angle,
        // Animation describes displacement this frame, including the final
        // settling step, rather than velocity after the arrival clamp.
        speed: member.lastSpeed,
        gaitDistance: member.gaitDistance,
        facingError: Math.abs(angleDelta(member.angle, facing)),
        backstepping: member.stepMode === "backward",
        turning:
          options.combatFootwork &&
          Math.abs(angleDelta(member.angle, facing)) > Math.PI / 18,
      });
    }
    for (const id of this.members.keys())
      if (!live.has(id)) this.members.delete(id);
    return result;
  }
}
import { formationMovementProfile } from "../FormationMovementProfile";
