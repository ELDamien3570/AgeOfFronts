import { TICKS_PER_SECOND } from "../../Protocol";
import {TICK_MS} from '../../Protocol';
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

/** Plays the intro once, repeats the ramming strokes (frames 2-3) while the weapon is
 * still reloading, then finishes on the closing frames exactly as the window ends. */
export function reloadClipTime(clip: ActorClip, elapsed: number, window: number, ramming = true): number {
  const frames = clip.durations ?? Array(clip.frameCount).fill(1000 / (clip.fps ?? 6));
  const total = frames.reduce((a, b) => a + b, 0);
  if (!ramming || frames.length < 5) return Math.min(total, Math.max(0, (elapsed / Math.max(1, window)) * total));
  const sum = (a: number, b: number) => frames.slice(a, b).reduce((x, y) => x + y, 0);
  const intro = sum(0, 2), loop = sum(2, 4), outro = sum(4, frames.length);
  const t = Math.max(0, elapsed);
  if (t < intro) return t;
  const loopEnd = Math.max(intro, window - outro);
  if (t >= loopEnd) return Math.min(total, intro + loop + (t - loopEnd));
  return intro + ((t - intro) % loop);
}

/** Return authored milliseconds, with the release pose on the authoritative shot tick. */
export function javelinThrowTime(
  squad: Snapshot["squads"][number],
  tick: number,
  clip: ActorClip,
): number | undefined {
  const timing = throwTiming(clip);
  const since = (tick - (squad.lastAttackTick ?? -Infinity)) * TICK_MS;
  if (since >= 0 && since < timing.duration - timing.release)
    return timing.release + since;
  const releaseTick =
    (squad.lastAttackTick ?? -Infinity) > tick
      ? squad.lastAttackTick!
      : (squad.nextAttackTick ?? Infinity);
  const until = (releaseTick - tick) * TICK_MS;
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
  targetSoldierId?: number;
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
  /** The frozen hand/muzzle attachments used by this exact shot's flight. */
  releases(id: number): readonly Launch[] { return this.launches.get(id) ?? []; }
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
    flightTicks = 0.6*TICKS_PER_SECOND,
    targetOffsets: readonly {x:number;y:number}[] = [],
    targets: readonly { id: number; x: number; y: number }[] = [],
    releaseLifetimeTicks = flightTicks,
  ): FlyingJavelin[] {
    const progress = (tick - volley.tick) / Math.max(1, flightTicks);
    if (progress < 0 || tick - volley.tick >= Math.max(flightTicks, releaseLifetimeTicks)) return [];
    let launches = this.launches.get(volley.id);
    if (!launches) {
      const frame =
        clip.frames[Math.min(clip.releaseFrame ?? 3, clip.frames.length - 1)];
      // Calibrated against Attack-v3 frame 3: the extended throwing hand.
      const attacking = throwers.filter((soldier) => soldier.throwing);
      const cx = attacking.reduce((n, s) => n + s.x, 0) / Math.max(1, attacking.length);
      const cy = attacking.reduce((n, s) => n + s.y, 0) / Math.max(1, attacking.length);
      // One shared bearing for the whole line, so lateral position can carry over
      // to the target: the right flank fires at the enemy's right, never across.
      const lineBearing = Math.atan2(volley.toY / FIXED - cy, volley.toX / FIXED - cx);
      // Pair shooters with the enemy front rank by lateral order, so every shot
      // lands on a soldier and the right flank hits the enemy's right.
      const side = (p: { x: number; y: number }) =>
        (p.x - cx) * -Math.sin(lineBearing) + (p.y - cy) * Math.cos(lineBearing);
      const depth = (p: { x: number; y: number }) =>
        (p.x - cx) * Math.cos(lineBearing) + (p.y - cy) * Math.sin(lineBearing);
      const frontDepth = Math.min(Infinity, ...targets.map(depth));
      const front = targets
        .filter((t) => depth(t) <= frontDepth + 1.5)
        .sort((a, b) => side(a) - side(b));
      const ordered = [...attacking].sort((a, b) => side(a) - side(b));
      const pairing = new Map<number, number>();
      ordered.forEach((soldier, i) => {
        if (front.length)
          pairing.set(soldier.id, front[Math.floor(((i + 0.5) * front.length) / ordered.length)].id);
      });
      launches = attacking.flatMap((soldier) =>
        releasePoints.map((point) => {
          const size = footprint * soldier.scale * (clip.scale ?? 1);
          const localX = (point.x - frame.pivot.x / frame.width) * size;
          const localY = (point.y - frame.pivot.y / frame.height) * size;
          const angle = soldier.angle + facingOffset;
          const x =
            soldier.x + localX * Math.cos(angle) - localY * Math.sin(angle);
          const y =
            soldier.y + localX * Math.sin(angle) + localY * Math.cos(angle);
          const spread = Math.max(-0.5, Math.min(0.5, side(soldier)));
          const receiving = targetOffsets[(soldier.id+volley.id)%Math.max(1,targetOffsets.length)] ?? {x:0,y:0};
          return {
            soldierId: soldier.id,
            targetSoldierId: pairing.get(soldier.id),
            x,
            y,
            toX: volley.toX / FIXED + receiving.x - Math.sin(lineBearing) * spread,
            toY: volley.toY / FIXED + receiving.y + Math.cos(lineBearing) * spread,
          };
        }),
      );
      // A projectile may arrive before its visible shooter has decoded/drawn.
      // Do not freeze an empty cache; retry once its actor pose is available.
      if (launches.length) this.launches.set(volley.id, launches);
    }
    // A short bullet can have finished by the time a sparse publication is
    // shown. Capture its muzzle for lingering smoke without replaying its flight.
    if (progress >= 1) return [];
    const live = new Map(targets.map((t) => [t.id, t]));
    return launches.map((start) => {
      // Re-read the paired soldier each frame so shots land on moving targets.
      const mark = start.targetSoldierId === undefined ? undefined : live.get(start.targetSoldierId);
      if (mark) {
        start.toX = mark.x;
        start.toY = mark.y;
      }
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
