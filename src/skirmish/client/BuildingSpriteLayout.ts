export interface SpriteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** View-only bounds, cached once per loaded image/frame, never per render tick. */
export class BuildingSpriteLayout {
  private readonly bounds = new WeakMap<object, Map<string, SpriteRect>>();

  visibleBounds(source: CanvasImageSource, frame: SpriteRect): SpriteRect {
    let frames = this.bounds.get(source);
    if (!frames) {
      frames = new Map();
      this.bounds.set(source, frames);
    }
    const key = `${frame.x}:${frame.y}:${frame.width}:${frame.height}`;
    const cached = frames.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(
      source,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      0,
      0,
      frame.width,
      frame.height,
    );
    const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
    let left = frame.width,
      top = frame.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < frame.height; y++)
      for (let x = 0; x < frame.width; x++) {
        if (!pixels[(y * frame.width + x) * 4 + 3]) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    const rect =
      right < left
        ? frame
        : {
            x: frame.x + left,
            y: frame.y + top,
            width: right - left + 1,
            height: bottom - top + 1,
          };
    frames.set(key, rect);
    return rect;
  }
}

/** Contain the visible artwork within the footprint without distorting it. */
export function fittedBuildingSprite(
  bounds: SpriteRect,
  x: number,
  y: number,
  size: number,
): SpriteRect {
  const ratio = size / Math.max(bounds.width, bounds.height);
  const width = bounds.width * ratio,
    height = bounds.height * ratio;
  return { x: x - width / 2, y: y - height / 2, width, height };
}
