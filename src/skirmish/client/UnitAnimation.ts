import cavalry from "../../../Art/Soldier Icons/Cavalry/StoneAge/animations.json";
import infantry from "../../../Art/Soldier Icons/Melee/StoneAge/animations.json";
import archer from "../../../Art/Soldier Icons/Ranged/StoneAge/animations.json";
import { TICKS_PER_SECOND, type SquadType } from "../Protocol";

export type AnimationClip = "idle" | "running" | "attack";
export interface AnimationPose {
  clip: AnimationClip;
  frame: number;
}

// Authored frame rectangles and pivots are the asset contract. Playback only
// observes simulation time; it never schedules movement, projectiles, or hits.
export const UNIT_ANIMATIONS = { infantry, archer, cavalry };
export const RANGED_RELEASE_FRAME = 5;
export const ATLAS_FRAME_SIZE = 128;
// These sheets reserve transparent margins around a roughly 384px silhouette.
// Keep a fixed scale and pivot across all poses rather than fitting each frame.
export const SPRITE_FOOTPRINT = 384 / 512;

// Visual calibration for the current Stone Age attack sheets. Their strongest
// extension is frame 5 (the sixth frame). These cues never schedule damage.
const MELEE_LUNGES = {
  infantry: { startFrame: 3, contactFrame: 5, returnFrame: 8, sizeRatio: 0.09 },
  cavalry: { startFrame: 3, contactFrame: 5, returnFrame: 8, sizeRatio: 0.055 },
};
export const MAX_MELEE_LUNGE_RATIO = MELEE_LUNGES.infantry.sizeRatio;

export function meleeLungeRatio(
  kind: SquadType,
  elapsedTicks: number,
  maximumRatio = Infinity,
): number {
  if (kind === "archer") return 0;
  const cue = MELEE_LUNGES[kind];
  const clip = UNIT_ANIMATIONS[kind].animations.attack;
  const frame =
    ((Math.max(0, elapsedTicks) * clip.suggestedFramesPerSecond) /
      TICKS_PER_SECOND) %
    clip.frameCount;
  if (frame <= cue.startFrame || frame >= cue.returnFrame) return 0;
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const amount =
    frame <= cue.contactFrame
      ? smooth((frame - cue.startFrame) / (cue.contactFrame - cue.startFrame))
      : 1 -
        smooth(
          (frame - cue.contactFrame) / (cue.returnFrame - cue.contactFrame),
        );
  return Math.min(cue.sizeRatio, maximumRatio) * amount;
}

export function animationFrame(
  kind: SquadType,
  clip: AnimationClip,
  elapsedTicks: number,
  repeat = false,
): number {
  const definition = UNIT_ANIMATIONS[kind].animations[clip];
  const frame = Math.floor(
    (Math.max(0, elapsedTicks) * definition.suggestedFramesPerSecond) /
      TICKS_PER_SECOND,
  );
  return definition.loop || repeat
    ? frame % definition.frameCount
    : Math.min(definition.frameCount - 1, frame);
}

export function squadSpriteSize(scale: number, troops: number): number {
  // Match the visible city artwork: roughly two cells, capped near its 44px
  // interior. Distant art switches to a formation symbol instead of inflating.
  return (
    Math.min(44, scale * 2) *
    (0.8 + (0.2 * Math.max(0, Math.min(1_000, troops))) / 1_000)
  );
}

export class PresentationClock {
  private tick: number | undefined;
  private receivedAt = 0;

  reset(): void {
    this.tick = undefined;
    this.receivedAt = 0;
  }

  update(tick: number, now: number): void {
    // Commands and pause changes can republish the same simulation tick.
    if (tick === this.tick) return;
    this.tick = tick;
    this.receivedAt = now;
  }

  sample(now: number, speed: number, paused: boolean): number {
    const tick = this.tick ?? 0;
    if (paused) return tick;
    // Stop extrapolating if the worker stalls; don't invent further actions.
    return (
      tick +
      Math.min(
        speed,
        ((Math.max(0, now - this.receivedAt) * TICKS_PER_SECOND) / 1_000) *
          speed,
      )
    );
  }
}
