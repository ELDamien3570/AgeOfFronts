import metadata from "../../../Art/Terrain/Modern Defenses/Trenches/tiles.json";
import type { WallFrame } from "./WallArtwork";

const atlasPath = "../../../Art/Terrain/Modern Defenses/Trenches/Trench_Atlas_Padded.png";
const urls = import.meta.glob<string>(
  "../../../Art/Terrain/Modern Defenses/Trenches/Trench_Atlas_Padded.png",
  { eager: true, query: "?url", import: "default" },
);

/** Authored one-cell topology pieces; connectivity remains presentation-only. */
export class TrenchArtwork {
  private image?: HTMLImageElement;
  frame(mask: number): WallFrame | undefined {
    if (!this.image) {
      this.image = new Image();
      this.image.decoding = "async";
      this.image.src = urls[atlasPath];
    }
    if (!this.image.complete || !this.image.naturalWidth) return;
    const rect = metadata.tiles.find(tile => tile.mask === mask)?.paddedRect;
    return rect ? { source: this.image, ...rect } : undefined;
  }
}
