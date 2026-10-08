import manifest from "../../../Art/Building Markers/building-markers.json";
import type { BuildingType } from "../Protocol";
import type { Age } from "../domain/Definitions";
import { drawAgeMarkerRim } from "./AgeUiTheme";

interface MarkerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Exhaustive presentation mapping: adding a BuildingType requires its marker.
export const BUILDING_MARKER_FRAMES: Record<BuildingType, MarkerRect> =
  manifest.frames;
const ATLAS_URL = new URL(
  "../../../Art/Building Markers/Building_Markers_Atlas.png",
  import.meta.url,
).href;
const MAX_TINTED_ATLASES = 128;

// View-owned resources. Building identity, placement and age remain domain-owned.
export class BuildingMarkers {
  readonly ready: Promise<boolean>;
  private image?: HTMLImageElement;
  private readonly tinted = new Map<string, HTMLCanvasElement>();

  constructor() {
    this.ready = new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (
          image.naturalWidth !== manifest.atlasSize.width ||
          image.naturalHeight !== manifest.atlasSize.height
        ) {
          console.error("Invalid building marker atlas dimensions");
          resolve(false);
          return;
        }
        this.image = image;
        resolve(true);
      };
      image.onerror = () => {
        console.error("Could not load the building marker atlas");
        resolve(false);
      };
      image.src = ATLAS_URL;
    });
  }

  get(type: BuildingType, color: string, size: number, pixelRatio = 1, age?: Age) {
    if (!this.image) return undefined;
    const pixels = Math.max(
      8,
      Math.ceil(size * Math.max(1, Math.min(4, pixelRatio))),
    );
    const key = `${color}:${pixels}:${age ?? "plain"}`;
    let canvas = this.tinted.get(key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = manifest.grid.columns * pixels;
      canvas.height = manifest.grid.rows * pixels;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      for (const frame of Object.values(BUILDING_MARKER_FRAMES)) {
        ctx.drawImage(
          this.image,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          (frame.x / manifest.grid.cellSize) * pixels,
          (frame.y / manifest.grid.cellSize) * pixels,
          pixels,
          pixels,
        );
      }
      // White fields and counterspaces receive the faction color; black stays black.
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      // Material is applied after faction tint so its age remains identifiable.
      if (age)
        for (const frame of Object.values(BUILDING_MARKER_FRAMES))
          drawAgeMarkerRim(
            ctx,
            (frame.x / manifest.grid.cellSize) * pixels,
            (frame.y / manifest.grid.cellSize) * pixels,
            pixels,
            age,
          );
      this.tinted.set(key, canvas);
      if (this.tinted.size > MAX_TINTED_ATLASES)
        this.tinted.delete(this.tinted.keys().next().value!);
    }
    const frame = BUILDING_MARKER_FRAMES[type];
    return {
      source: canvas,
      x: (frame.x / manifest.grid.cellSize) * pixels,
      y: (frame.y / manifest.grid.cellSize) * pixels,
      width: pixels,
      height: pixels,
    };
  }
}
