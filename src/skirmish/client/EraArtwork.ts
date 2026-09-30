import { ARTWORK_CATALOG } from "./ArtworkCatalog";
import type { ArtworkFrame } from "./UnitArtwork";
const catalog = ARTWORK_CATALOG;
const urls = import.meta.glob<string>("../../../Art/Runtime/Ages/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const url = (file: string) => urls[`../../../Art/Runtime/Ages/${file}`];
export function eraPortrait(id: string): string | undefined {
  const asset = catalog[id];
  const file = asset?.poster ?? asset?.file;
  return file ? url(file) : undefined;
}
// Shared, lazy image storage. Tactical zoom never downloads full source sheets.
export class EraArtwork {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly requested = new Set<string>();
  private load(file: string): HTMLImageElement | undefined {
    if (!this.requested.has(file)) {
      this.requested.add(file);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => this.images.set(file, image);
      image.src = url(file);
    }
    return this.images.get(file);
  }
  get(id: string, clip = "idle", elapsedTicks = 0): ArtworkFrame | undefined {
    const asset = catalog[id];
    if (!asset) return;
    if (asset.file) {
      const image = this.load(asset.file);
      return image
        ? {
            source: image,
            x: 0,
            y: 0,
            width: 128,
            height: 128,
            pivotX: 0.5,
            pivotY: 0.5,
            extent: 1,
          }
        : undefined;
    }
    const actual =
      clip === "running"
        ? "running" in (asset.clips ?? {})
          ? "running"
          : "movement" in (asset.clips ?? {})
            ? "movement"
            : "sailing" in (asset.clips ?? {})
              ? "sailing"
              : "travel"
        : clip;
    const animation = asset.clips?.[actual] ?? asset.clips?.idle;
    if (!animation) return;
    const image = this.load(animation.file);
    if (!image) return;
    const phase = Math.max(0, Math.floor((elapsedTicks * animation.fps) / 20)),
      frame = animation.loop
        ? phase % animation.frames
        : Math.min(animation.frames - 1, phase);
    return {
      source: image,
      x: (frame % animation.columns) * 128,
      y: Math.floor(frame / animation.columns) * 128,
      width: 128,
      height: 128,
      pivotX: 0.5,
      pivotY: 0.5,
      extent: 4 / 3,
    };
  }
  facing(id: string): number {
    return catalog[id]?.facing === "screen-up" ? Math.PI : 0;
  }
}
