import manifest from "../../../Art/Terrain/Wall Kit/Wall_Kit_Manifest.json";
import { AGES, type Age } from "../domain/Definitions";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface WallMetadata {
  tileSize: number;
  tiles: { mask: number; paddedRect: Rect }[];
}
const metadata = import.meta.glob<WallMetadata>(
  "../../../Art/Terrain/Wall Kit/*/tiles.json",
  { eager: true, import: "default" },
);
const urls = import.meta.glob<string>(
  [
    "../../../Art/Terrain/Wall Kit/*/Wall_Atlas_Padded.png",
    "../../../Art/Terrain/Wall Kit/*/Tower.png",
  ],
  { eager: true, query: "?url", import: "default" },
);
export function wallTier(age: Age): string {
  return [...manifest.tiers]
    .reverse()
    .find((tier) => AGES.indexOf(tier.unlockAge as Age) <= AGES.indexOf(age))!
    .id;
}
export interface WallFrame extends Rect {
  source: CanvasImageSource;
}

// Original atlases retain their shared pivot and transparent cell footprint.
export class WallArtwork {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly gates = new Map<string, HTMLCanvasElement>();
  private image(path: string): HTMLImageElement | undefined {
    let image = this.images.get(path);
    if (!image) {
      const url = urls[path];
      if (!url) return;
      image = new Image();
      image.decoding = "async";
      image.src = url;
      this.images.set(path, image);
    }
    return image.complete && image.naturalWidth ? image : undefined;
  }
  frame(age: Age, mask: number, gate = false): WallFrame | undefined {
    const tier = wallTier(age),
      base = `../../../Art/Terrain/Wall Kit/${tier}`;
    const image = this.image(`${base}/Wall_Atlas_Padded.png`),
      data = metadata[`${base}/tiles.json`],
      rect = data.tiles.find((t) => t.mask === mask)?.paddedRect;
    if (!image || !rect) return;
    if (!gate || (mask !== 5 && mask !== 10)) return { source: image, ...rect };
    const key = `${tier}:${mask}`;
    let canvas = this.gates.get(key);
    if (!canvas) {
      const size = data.tileSize,
        cap = data.tiles.find((t) => t.mask === 0)!.paddedRect;
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(
        image,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        size,
        size,
      );
      // Cosmetic openings use the kit's own end posts. Edge connectors stay
      // untouched; no gate state or movement permission lives in the artwork.
      ctx.globalCompositeOperation = "destination-out";
      if (mask === 10) ctx.fillRect(size / 4, 0, size / 2, size);
      else ctx.fillRect(0, size / 4, size, size / 2);
      ctx.globalCompositeOperation = "source-over";
      for (const offset of [-size / 4, size / 4])
        ctx.drawImage(
          image,
          cap.x,
          cap.y,
          cap.width,
          cap.height,
          mask === 10 ? offset : 0,
          mask === 5 ? offset : 0,
          size,
          size,
        );
      this.gates.set(key, canvas);
    }
    return {
      source: canvas,
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
    };
  }
  tower(age: Age): WallFrame | undefined {
    const image = this.image(
      `../../../Art/Terrain/Wall Kit/${wallTier(age)}/Tower.png`,
    );
    return image
      ? {
          source: image,
          x: 0,
          y: 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
        }
      : undefined;
  }
}
