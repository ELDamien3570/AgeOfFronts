import type { ShipType, SquadType } from "../Protocol";
import { UNIT } from "../content/Units";
import meleeSymbol from "../../../Art/Formation Icons/svg/melee.svg?raw";
import rangedSymbol from "../../../Art/Formation Icons/svg/ranged.svg?raw";
import cavalrySymbol from "../../../Art/Formation Icons/svg/cavalry.svg?raw";
import siegeSymbol from "../../../Art/Formation Icons/svg/siege-catapult.svg?raw";

/** "transport" draws a squad afloat; fleet vessels are warships. */
export type FormationType = SquadType | ShipType | "transport" | "siege";

export function squadFormationType(squad: {
  kind: SquadType;
  definitionId?: string;
}): FormationType {
  return UNIT.get(squad.definitionId ?? "")?.role === "siege"
    ? "siege"
    : squad.kind;
}
const FRAME_SIZE = 128;
const SYMBOLS = { infantry: meleeSymbol, archer: rangedSymbol, cavalry: cavalrySymbol, siege: siegeSymbol };
const FILES: Record<FormationType, string> = {
  infantry: new URL(
    "../../../Art/Formation Icons/png/melee.png",
    import.meta.url,
  ).href,
  archer: new URL(
    "../../../Art/Formation Icons/png/ranged.png",
    import.meta.url,
  ).href,
  cavalry: new URL(
    "../../../Art/Formation Icons/png/cavalry.png",
    import.meta.url,
  ).href,
  siege: new URL(
    "../../../Art/Formation Icons/png/siege-catapult.png",
    import.meta.url,
  ).href,
  transport: new URL(
    "../../../Art/Formation Icons/png/transport-ship.png",
    import.meta.url,
  ).href,
  warship: new URL(
    "../../../Art/Formation Icons/png/warship.png",
    import.meta.url,
  ).href,
};

// These authored bounds include the facing triangle. The shared pivot is at
// (256, 256); it must survive cropping, especially for the asymmetric ships.
const LAND_BOUNDS = { x: 32, y: 128, width: 448, height: 240 };
const SHIP_BOUNDS = { x: 144, y: 16, width: 224, height: 464 };
const SIEGE_BOUNDS = { x: 32, y: 32, width: 448, height: 448 };

export function tintFormationPixels(
  pixels: Uint8ClampedArray,
  color: string,
): void {
  const rgb = [1, 3, 5].map((offset) =>
    parseInt(color.slice(offset, offset + 2), 16),
  );
  for (let index = 0; index < pixels.length; index += 4)
    for (let channel = 0; channel < 3; channel++)
      pixels[index + channel] = Math.round(
        (pixels[index + channel] * rgb[channel]) / 255,
      );
}

export class FormationArtwork {
  private readonly pixels = new Map<FormationType, ImageData>();
  private readonly tinted = new Map<string, HTMLCanvasElement>();
  private readonly headings = new Map<string, HTMLCanvasElement>();
  private readonly symbols = new Map<FormationType, { source: HTMLCanvasElement; x: number; y: number; width: number; height: number; pivotX: number; pivotY: number }>();
  private readonly symbolTints = new Map<string, HTMLCanvasElement>();
  readonly symbolsReady: Promise<void>;

  constructor() {
    this.symbolsReady = Promise.all(Object.entries(SYMBOLS).map(([kind, source]) => new Promise<void>((resolve) => {
      // Reuse the editable vector master, without its faction field or arrow.
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      const group = doc.getElementById("unit-symbol");
      if (!group) { resolve(); return; }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${new XMLSerializer().serializeToString(group)}</svg>`;
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = FRAME_SIZE;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, FRAME_SIZE, FRAME_SIZE);
        const pixels = ctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE);
        let left = FRAME_SIZE, top = FRAME_SIZE, right = -1, bottom = -1;
        for (let i = 0; i < pixels.data.length; i += 4) {
          // Authored white separators become holes, preserving the sword crossing.
          pixels.data[i + 3] = Math.round(pixels.data[i + 3] * (1 - pixels.data[i] / 255));
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
          if (pixels.data[i + 3] > 0) {
            const pixel = i / 4, x = pixel % FRAME_SIZE, y = Math.floor(pixel / FRAME_SIZE);
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
          }
        }
        ctx.putImageData(pixels, 0, 0);
        if (right >= left) this.symbols.set(kind as FormationType, {
          source: canvas, x: left, y: top, width: right - left + 1, height: bottom - top + 1, pivotX: 0.5, pivotY: 0.5,
        });
        resolve();
      };
      image.onerror = () => { console.warn(`Unable to load ${kind} formation symbol`); resolve(); };
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }))).then(() => undefined);
    for (const [kind, url] of Object.entries(FILES)) {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (image.naturalWidth !== 512 || image.naturalHeight !== 512) {
          console.error(`Invalid ${kind} formation icon dimensions`);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = FRAME_SIZE;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, FRAME_SIZE, FRAME_SIZE);
        this.pixels.set(
          kind as FormationType,
          ctx.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE),
        );
      };
      image.src = url;
    }
  }

  getSymbol(kind: FormationType, light = true) {
    const frame = this.symbols.get(kind);
    if (!frame || light) return frame;
    let canvas = this.symbolTints.get(kind);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = FRAME_SIZE;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(frame.source, 0, 0);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      this.symbolTints.set(kind, canvas);
    }
    return { ...frame, source: canvas };
  }

  get(kind: FormationType, color: string) {
    const original = this.pixels.get(kind);
    if (!original) return undefined;
    const key = `${kind}:${color}`;
    let canvas = this.tinted.get(key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = FRAME_SIZE;
      const pixels = new Uint8ClampedArray(original.data);
      tintFormationPixels(pixels, color);
      canvas
        .getContext("2d")!
        .putImageData(new ImageData(pixels, FRAME_SIZE, FRAME_SIZE), 0, 0);
      this.tinted.set(key, canvas);
    }
    const bounds =
      kind === "transport" || kind === "warship"
        ? SHIP_BOUNDS
        : kind === "siege"
          ? SIEGE_BOUNDS
          : LAND_BOUNDS;
    return {
      source: canvas,
      x: bounds.x / 4,
      y: bounds.y / 4,
      width: bounds.width / 4,
      height: bounds.height / 4,
      pivotX: (256 - bounds.x) / bounds.width,
      pivotY: (256 - bounds.y) / bounds.height,
    };
  }

  // At strategic zoom, reuse small pre-rotated markers instead of changing the
  // canvas transform thousands of times per frame. Tactical sprites stay smooth.
  heading(
    kind: FormationType,
    color: string,
    angle: number,
    width: number,
    pixelRatio: number,
  ) {
    const frame = this.get(kind, color);
    if (!frame) return undefined;
    const direction =
      ((Math.round((angle / (Math.PI * 2)) * 16) % 16) + 16) % 16;
    const pixels = Math.max(
      8,
      Math.ceil((width * (192 / frame.width) * pixelRatio) / 2) * 2,
    );
    const key = `${kind}:${color}:${direction}:${pixels}`;
    let canvas = this.headings.get(key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = pixels;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(pixels / 2, pixels / 2);
      ctx.rotate((direction / 16) * Math.PI * 2);
      ctx.scale(pixels / 192, pixels / 192);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(frame.source, -FRAME_SIZE / 2, -FRAME_SIZE / 2);
      this.headings.set(key, canvas);
      if (this.headings.size > 1600)
        this.headings.delete(this.headings.keys().next().value!);
    }
    return { source: canvas, extent: pixels / pixelRatio };
  }
}
