import { ARTWORK_CATALOG, type ArtworkAsset } from "./ArtworkCatalog";
import type { ArtworkFrame } from "./UnitArtwork";
const catalog = ARTWORK_CATALOG;
const urls = import.meta.glob<string>("../../../Art/Runtime/Ages/*.png", {
  eager: true,
  query: "?url",
  import: "default",
});
const russianUrls = import.meta.glob<string>(
  "../../../Art/Runtime/Russians/*.png",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);
const url = (file: string, root?: ArtworkAsset["runtimeRoot"]) =>
  root === "Ages" ? urls[`../../../Art/Runtime/Ages/${file}`] :
  root === "Russians" ? russianUrls[`../../../Art/Runtime/Russians/${file}`] :
  russianUrls[`../../../Art/Runtime/Russians/${file}`] ??
  urls[`../../../Art/Runtime/Ages/${file}`];
export function eraPortrait(id: string): string | undefined {
  const asset = catalog[id];
  const file = asset?.poster ?? asset?.file;
  return file ? url(file, asset.runtimeRoot) : undefined;
}
// Shared, lazy image storage. Tactical zoom never downloads full source sheets.
export class EraArtwork {
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly requested = new Set<string>();
  private load(file: string, root?: ArtworkAsset["runtimeRoot"]): HTMLImageElement | undefined {
    const key = `${root ?? "auto"}:${file}`;
    if (!this.requested.has(key)) {
      this.requested.add(key);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => this.images.set(key, image);
      const source = url(file, root);
      if (source) image.src = source;
    }
    return this.images.get(key);
  }
  preload(id: string, clip: string): void {
    const asset = catalog[id];
    const animation = asset?.clips?.[clip];
    if (animation) this.load(animation.file, asset.runtimeRoot);
    if (asset?.poster) this.load(asset.poster, asset.runtimeRoot);
  }

  get(id: string, clip = "idle", elapsedTicks = 0): ArtworkFrame | undefined {
    const asset = catalog[id];
    if (!asset) return;
    if (asset.file) {
      const image = this.load(asset.file, asset.runtimeRoot);
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
            groundBounds: asset.groundBounds,
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
    const image = this.load(animation.file, asset.runtimeRoot);
    if (!image) {
      // A failed or loading animation must not permanently force formation-only
      // rendering when the same unit has a valid authored portrait.
      const poster = asset.poster && this.load(asset.poster, asset.runtimeRoot);
      return poster
        ? {
            source: poster,
            x: 0,
            y: 0,
            width: 128,
            height: 128,
            pivotX: 0.5,
            pivotY: 0.5,
            extent: 4 / 3,
            groundBounds: asset.groundBounds,
          }
        : undefined;
    }
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
      groundBounds: animation.groundBounds,
      visibleBounds: animation.bounds
        ? {
            x: (frame % animation.columns) * 128 + animation.bounds.x,
            y: Math.floor(frame / animation.columns) * 128 + animation.bounds.y,
            width: animation.bounds.width,
            height: animation.bounds.height,
          }
        : undefined,
    };
  }
  facing(id: string): number {
    return catalog[id]?.facing === "screen-up" ? Math.PI : 0;
  }
}
