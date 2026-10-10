import { tintMaskedPixels } from "./FactionMaskTint";
import type { ActorFrame } from "./TroopFormationModel";

/** Shared bounded cache, independent of squad count. Only requested visible frames
 * are colored; camouflaged/unmasked artwork never enters this cache. */
export class FactionFrames {
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private bytes = 0;
  constructor(private readonly budget = 32 * 1024 * 1024) {}
  get(
    key: string,
    image: HTMLImageElement,
    mask: HTMLImageElement | undefined,
    frame: ActorFrame,
    color: string,
  ): { image: CanvasImageSource; frame: ActorFrame } {
    if (!mask) return { image, frame };
    const id = `${key}:${frame.x}:${frame.y}:${color}`;
    let canvas = this.cache.get(id);
    if (canvas) {
      this.cache.delete(id);
      this.cache.set(id, canvas);
    } else {
      canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(
        image,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      );
      const source = ctx.getImageData(0, 0, frame.width, frame.height);
      ctx.clearRect(0, 0, frame.width, frame.height);
      ctx.drawImage(
        mask,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        frame.width,
        frame.height,
      );
      const coverage = ctx.getImageData(0, 0, frame.width, frame.height);
      source.data.set(tintMaskedPixels(source.data, coverage.data, color));
      ctx.putImageData(source, 0, 0);
      this.cache.set(id, canvas);
      this.bytes += canvas.width * canvas.height * 4;
      while (this.bytes > this.budget && this.cache.size > 1) {
        const oldest = this.cache.keys().next().value!;
        const removed = this.cache.get(oldest)!;
        this.bytes -= removed.width * removed.height * 4;
        this.cache.delete(oldest);
      }
    }
    return { image: canvas, frame: { ...frame, x: 0, y: 0 } };
  }
  clear(): void {
    this.cache.clear();
    this.bytes = 0;
  }
}
