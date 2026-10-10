import { FIXED, type ArcherVolley, type Snapshot } from "../../Protocol";
import type { WorldSoldier } from "../FormationSoldierMotion";
import type { ActorClip } from "./TroopFormationModel";

export function throwTiming(clip: ActorClip): {
  release: number;
  duration: number;
} {
  const frames =
    clip.durations ?? Array(clip.frameCount).fill(1000 / (clip.fps ?? 6));
  return {
    release: frames
      .slice(0, clip.releaseFrame ?? 3)
      .reduce((sum, duration) => sum + duration, 0),
    duration: frames.reduce((sum, duration) => sum + duration, 0),
  };
}

/** Return authored milliseconds, with the release pose on the authoritative shot tick. */
export function javelinThrowTime(
  squad: Snapshot["squads"][number],
  tick: number,
  clip: ActorClip,
): number | undefined {
  const timing = throwTiming(clip);
  const since = (tick - (squad.lastAttackTick ?? -Infinity)) * 50;
  if (since >= 0 && since < timing.duration - timing.release)
    return timing.release + since;
  const releaseTick =
    (squad.lastAttackTick ?? -Infinity) > tick
      ? squad.lastAttackTick!
      : (squad.nextAttackTick ?? Infinity);
  const until = (releaseTick - tick) * 50;
  if (squad.fighting && until > 0 && until <= timing.release)
    return timing.release - until;
  return undefined;
}

export interface VolleyThrower extends WorldSoldier {
  throwing: boolean;
}
interface Launch {
  soldierId: number;
  x: number;
  y: number;
  toX: number;
  toY: number;
}
export interface FlyingJavelin {
  soldierId: number;
  x: number;
  y: number;
  angle: number;
}

/** Frozen world-space releases, one visual javelin per planted thrower in every rank. */
export class TroopVolley {
  private readonly launches = new Map<number, Launch[]>();
  clear(): void {
    this.launches.clear();
  }
  prune(volleys: readonly { id: number }[]): void {
    const ids = new Set(volleys.map((volley) => volley.id));
    for (const id of this.launches.keys())
      if (!ids.has(id)) this.launches.delete(id);
  }
  sample(
    volley: ArcherVolley,
    tick: number,
    throwers: readonly VolleyThrower[],
    clip: ActorClip,
    footprint: number,
    releasePoints: readonly { x: number; y: number }[] = [
      { x: 180 / 512, y: 370 / 512 },
    ],
    facingOffset = 0,
    ballistic = true,
    flightTicks = 12,
  ): FlyingJavelin[] {
    const progress = (tick - volley.tick) / Math.max(1, flightTicks);
    if (progress < 0 || progress >= 1) return [];
    let launches = this.launches.get(volley.id);
    if (!launches) {
      const frame =
        clip.frames[Math.min(clip.releaseFrame ?? 3, clip.frames.length - 1)];
      // Calibrated against Attack-v3 frame 3: the extended throwing hand.
      const attacking = throwers.filter((soldier) => soldier.throwing);
      launches = attacking.flatMap((soldier, index) =>
        releasePoints.map((point) => {
          const size = footprint * soldier.scale * (clip.scale ?? 1);
          const localX = (point.x - frame.pivot.x / frame.width) * size;
          const localY = (point.y - frame.pivot.y / frame.height) * size;
          const angle = soldier.angle + facingOffset;
          const x =
            soldier.x + localX * Math.cos(angle) - localY * Math.sin(angle);
          const y =
            soldier.y + localX * Math.sin(angle) + localY * Math.cos(angle);
          const bearing = Math.atan2(
            volley.toY / FIXED - y,
            volley.toX / FIXED - x,
          );
          const spread = (index - (attacking.length - 1) / 2) * 0.08;
          return {
            soldierId: soldier.id,
            x,
            y,
            toX: volley.toX / FIXED - Math.sin(bearing) * spread,
            toY: volley.toY / FIXED + Math.cos(bearing) * spread,
          };
        }),
      );
      // A projectile may arrive before its visible shooter has decoded/drawn.
      // Do not freeze an empty cache; retry once its actor pose is available.
      if (launches.length) this.launches.set(volley.id, launches);
    }
    return launches.map((start) => {
      const dx = start.toX - start.x,
        dy = start.toY - start.y;
      const lift = ballistic ? Math.min(0.55, Math.hypot(dx, dy) / 6) : 0;
      return {
        soldierId: start.soldierId,
        x: start.x + dx * progress,
        y: start.y + dy * progress - Math.sin(Math.PI * progress) * lift,
        angle: Math.atan2(
          dy - Math.PI * lift * Math.cos(Math.PI * progress),
          dx,
        ),
      };
    });
  }
}
