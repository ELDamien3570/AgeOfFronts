import type { MigrationMap } from "../MigrationMap";
const HEIGHT_COLORS = [
  [0, 60, 124, 85],
  [300, 126, 153, 86],
  [1000, 183, 164, 105],
  [2200, 155, 142, 127],
  [4000, 200, 199, 186],
  [6000, 245, 245, 239],
];

/** Cached geographic inspection layer: elevation colour, relief and 250 m contours. */
export function migrationHeightView(loaded: MigrationMap): HTMLCanvasElement {
  const size = loaded.map.width(),
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!,
    pixels = ctx.createImageData(size, size),
    heights = loaded.elevation!.values;
  const height = (x: number, y: number) =>
    Math.max(
      0,
      heights[
        Math.max(0, Math.min(size - 1, y)) * size +
          Math.max(0, Math.min(size - 1, x))
      ],
    );
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      if (loaded.map.isWater(tile)) continue;
      const h = heights[tile],
        dx = ((height(x + 1, y) - height(x - 1, y)) * size) / 500 / 90,
        dy = ((height(x, y + 1) - height(x, y - 1)) * size) / 500 / 90,
        shade = (1 - dx * 0.65 - dy * 0.55) / Math.sqrt(1 + dx * dx + dy * dy),
        contour =
          Math.floor(h / 250) !== Math.floor(height(x - 1, y) / 250) ||
          Math.floor(h / 250) !== Math.floor(height(x, y - 1) / 250),
        light =
          Math.max(0.45, Math.min(1.25, 0.7 + shade * 0.35)) *
          (contour ? 0.85 : 1);
      const stops = HEIGHT_COLORS;
      let band = 0;
      while (band < stops.length - 2 && h > stops[band + 1][0]) band++;
      const a = stops[band],
        b = stops[band + 1],
        t = Math.min(1, Math.max(0, (h - a[0]) / (b[0] - a[0])));
      for (let channel = 0; channel < 3; channel++)
        pixels.data[tile * 4 + channel] = Math.min(
          255,
          Math.round((a[channel + 1] * (1 - t) + b[channel + 1] * t) * light),
        );
      pixels.data[tile * 4 + 3] = 255;
    }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
