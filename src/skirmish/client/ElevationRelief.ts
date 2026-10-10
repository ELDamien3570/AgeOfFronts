/** Normal-based relief at local and regional scales. The gain affects lighting
 * only; it is independent of the calibrated height and authoritative slope. */
export function elevationRelief(
  sample: (x: number, y: number) => number,
  x: number,
  y: number,
  gain: number,
): number {
  const axis = (dx: number, dy: number) =>
    (((sample(x + dx, y + dy) - sample(x - dx, y - dy)) * 0.65 +
      ((sample(x + dx * 5, y + dy * 5) - sample(x - dx * 5, y - dy * 5)) / 5) *
        0.35) *
      gain) /
    160;
  const dx = axis(1, 0),
    dy = axis(0, 1),
    light = (1 - dx * 0.65 - dy * 0.55) / Math.sqrt(1 + dx * dx + dy * dy);
  return Math.max(-42, Math.min(24, (light - 1) * 55));
}
