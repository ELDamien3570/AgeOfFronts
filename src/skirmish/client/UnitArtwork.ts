import type { SquadType } from "../Protocol";
import {
  ATLAS_FRAME_SIZE,
  SPRITE_FOOTPRINT,
  UNIT_ANIMATIONS,
  type AnimationClip,
  type AnimationPose,
} from "./UnitAnimation";

// Presentation assets only. Ages and combat classes remain domain decisions.
export const STONE_AGE: Record<SquadType, string> = {
  infantry: new URL(
    "../../../Art/Soldier Icons/Melee/Melee_StoneAge.png",
    import.meta.url,
  ).href,
  archer: new URL(
    "../../../Art/Soldier Icons/Ranged/Range_StoneAge.png",
    import.meta.url,
  ).href,
  cavalry: new URL(
    "../../../Art/Soldier Icons/Cavalry/Cav_StoneAge.png",
    import.meta.url,
  ).href,
};

const SHEETS: Record<SquadType, Record<AnimationClip, string>> = {
  infantry: {
    idle: new URL(
      "../../../Art/Soldier Icons/Melee/StoneAge/Idle.png",
      import.meta.url,
    ).href,
    running: new URL(
      "../../../Art/Soldier Icons/Melee/StoneAge/Running.png",
      import.meta.url,
    ).href,
    attack: new URL(
      "../../../Art/Soldier Icons/Melee/StoneAge/Attack.png",
      import.meta.url,
    ).href,
  },
  archer: {
    idle: new URL(
      "../../../Art/Soldier Icons/Ranged/StoneAge/Idle.png",
      import.meta.url,
    ).href,
    running: new URL(
      "../../../Art/Soldier Icons/Ranged/StoneAge/Running.png",
      import.meta.url,
    ).href,
    attack: new URL(
      "../../../Art/Soldier Icons/Ranged/StoneAge/Attack.png",
      import.meta.url,
    ).href,
  },
  cavalry: {
    idle: new URL(
      "../../../Art/Soldier Icons/Cavalry/StoneAge/Idle.png",
      import.meta.url,
    ).href,
    running: new URL(
      "../../../Art/Soldier Icons/Cavalry/StoneAge/Running.png",
      import.meta.url,
    ).href,
    attack: new URL(
      "../../../Art/Soldier Icons/Cavalry/StoneAge/Attack.png",
      import.meta.url,
    ).href,
  },
};

export interface ArtworkFrame {
  source: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
  pivotX: number;
  pivotY: number;
  // Includes transparent margins; bars and team discs use the visible size.
  extent: number;
}

export class UnitArtwork {
  private readonly fallback = new Map<SquadType, ArtworkFrame>();
  private readonly clips = new Map<
    SquadType,
    Map<AnimationClip, ArtworkFrame[]>
  >();

  constructor() {
    for (const [kind, url] of Object.entries(STONE_AGE)) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () =>
        this.fallback.set(kind as SquadType, {
          source: image,
          x: 0,
          y: 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
          pivotX: 0.5,
          pivotY: 0.5,
          extent: 1,
        });
      image.src = url;
    }
    for (const kind of Object.keys(SHEETS) as SquadType[]) {
      const clips = new Map<AnimationClip, ArtworkFrame[]>();
      this.clips.set(kind, clips);
      const metadata = UNIT_ANIMATIONS[kind];
      for (const clip of Object.keys(SHEETS[kind]) as AnimationClip[]) {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          if (
            image.naturalWidth !== metadata.sheetSize.width ||
            image.naturalHeight !== metadata.sheetSize.height
          ) {
            console.error(`Invalid ${kind} ${clip} sprite sheet dimensions`);
            return;
          }
          // One shared atlas per clip, prepared once at a useful screen size.
          // No per-squad canvases and no full-resolution resampling per draw.
          const atlas = document.createElement("canvas");
          atlas.width = metadata.grid.columns * ATLAS_FRAME_SIZE;
          atlas.height = metadata.grid.rows * ATLAS_FRAME_SIZE;
          const ctx = atlas.getContext("2d")!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          const frames = metadata.animations[clip].frames.map((frame) => {
            const x = (frame.index % metadata.grid.columns) * ATLAS_FRAME_SIZE;
            const y =
              Math.floor(frame.index / metadata.grid.columns) *
              ATLAS_FRAME_SIZE;
            ctx.drawImage(
              image,
              frame.x,
              frame.y,
              frame.width,
              frame.height,
              x,
              y,
              ATLAS_FRAME_SIZE,
              ATLAS_FRAME_SIZE,
            );
            return {
              source: atlas,
              x,
              y,
              width: ATLAS_FRAME_SIZE,
              height: ATLAS_FRAME_SIZE,
              pivotX: metadata.normalizedPivot.x,
              pivotY: metadata.normalizedPivot.y,
              extent: 1 / SPRITE_FOOTPRINT,
            };
          });
          clips.set(clip, frames);
        };
        image.src = SHEETS[kind][clip];
      }
    }
  }

  get(
    kind: SquadType,
    pose: AnimationPose = { clip: "idle", frame: 0 },
  ): ArtworkFrame | undefined {
    const clips = this.clips.get(kind);
    return (
      clips?.get(pose.clip)?.[pose.frame] ??
      clips?.get("idle")?.[0] ??
      this.fallback.get(kind)
    );
  }
}
