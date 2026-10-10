/** Match the mask author's review: replace hue/saturation, retain source shading
 * and alpha. White-mask alpha is coverage; zero coverage preserves material. */
export function tintMaskedPixels(
  source: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  hex: string,
) {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const max = Math.max(...channels),
    min = Math.min(...channels),
    delta = max - min;
  const hue = !delta
    ? 0
    : max === channels[0]
      ? ((channels[1] - channels[2]) / delta + 6) % 6
      : max === channels[1]
        ? (channels[2] - channels[0]) / delta + 2
        : (channels[0] - channels[1]) / delta + 4;
  const saturation = max ? delta / max : 0;
  const result = new Uint8ClampedArray(source);
  for (let i = 0; i < source.length; i += 4) {
    const weight = mask[i + 3] / 255;
    if (!weight || !source[i + 3]) continue;
    const value = Math.max(source[i], source[i + 1], source[i + 2]) / 255;
    const c = value * saturation,
      x = c * (1 - Math.abs((hue % 2) - 1)),
      m = value - c;
    const rgb =
      hue < 1
        ? [c, x, 0]
        : hue < 2
          ? [x, c, 0]
          : hue < 3
            ? [0, c, x]
            : hue < 4
              ? [0, x, c]
              : hue < 5
                ? [x, 0, c]
                : [c, 0, x];
    for (let k = 0; k < 3; k++)
      result[i + k] = Math.round(
        source[i + k] * (1 - weight) + (rgb[k] + m) * 255 * weight,
      );
  }
  return result;
}
