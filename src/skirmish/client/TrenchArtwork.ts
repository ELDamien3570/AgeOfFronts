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
    if (!rect) return;
    // Magnify the authored cross-section, preserving the full length of
    // straight runs. Corners/junctions use the shared central connection area
    // so every joining edge retains the same channel and shoulder width.
    const profile = metadata.earthShoulderWidth;
    const inset = (metadata.tileSize - profile) / 2;
    const horizontal = (mask & 10) !== 0;
    const vertical = (mask & 5) !== 0;
    const cropX = vertical;
    const cropY = horizontal;
    return {
      source: this.image,
      x: rect.x + (cropX ? inset : 0),
      y: rect.y + (cropY ? inset : 0),
      width: cropX ? profile : rect.width,
      height: cropY ? profile : rect.height,
    };
  }
}
