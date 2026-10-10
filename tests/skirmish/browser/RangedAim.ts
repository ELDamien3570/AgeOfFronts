export type AimPoint = { x: number; y: number };
export const AIM_REFERENCE_RANGE = 500;
export const AIM_TARGET_RADIUS = 12;
// Gaussian spread gives ~70% circle coverage at the reference range.
const referenceSigma = AIM_TARGET_RADIUS / Math.sqrt(-2 * Math.log(0.3));
function random(seed: number) {
  let x = (seed + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}
/** Uses observed position/velocity only. The returned endpoint stays fixed in flight. */
export function predictiveAim(
  origin: AimPoint,
  target: AimPoint,
  velocity: AimPoint,
  speed: number,
  seed: number,
) {
  const dx = target.x - origin.x,
    dy = target.y - origin.y;
  const a = velocity.x ** 2 + velocity.y ** 2 - speed ** 2;
  const b = 2 * (dx * velocity.x + dy * velocity.y),
    c = dx ** 2 + dy ** 2;
  const discriminant = b * b - 4 * a * c;
  let seconds = Math.sqrt(c) / speed;
  if (Math.abs(a) > 1e-8 && discriminant >= 0) {
    const roots = [
      (-b - Math.sqrt(discriminant)) / (2 * a),
      (-b + Math.sqrt(discriminant)) / (2 * a),
    ].filter((t) => t >= 0);
    if (roots.length) seconds = Math.min(...roots);
  } else if (Math.abs(b) > 1e-8 && Math.abs(a) <= 1e-8 && -c / b >= 0)
    seconds = -c / b;
  seconds = Math.min(seconds, 3);
  const predicted = {
    x: target.x + velocity.x * seconds,
    y: target.y + velocity.y * seconds,
  };
  const sigma = Math.max(
    2,
    (Math.hypot(predicted.x - origin.x, predicted.y - origin.y) /
      AIM_REFERENCE_RANGE) *
      referenceSigma,
  );
  const radius = Math.sqrt(-2 * Math.log(Math.max(1e-9, random(seed))));
  const angle = random(seed ^ 0x6d2b79f5) * Math.PI * 2;
  const point = {
    x: predicted.x + Math.cos(angle) * radius * sigma,
    y: predicted.y + Math.sin(angle) * radius * sigma,
  };
  return {
    point,
    seconds: Math.hypot(point.x - origin.x, point.y - origin.y) / speed,
  };
}
