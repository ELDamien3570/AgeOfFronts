import { MISSILE_DEFENSE_SPEED } from "../content/MissileDefense";
import type { Projectile } from "./Definitions";

// The interval where a quadratic is nonpositive. All inputs are canonical
// fixed-point coordinates; no sampling, random accuracy, or path search.
function interval(a: number, b: number, c: number): [number, number] | null {
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return c <= 0 ? [-Infinity, Infinity] : null;
    return b > 0 ? [-Infinity, -c / b] : [-c / b, Infinity];
  }
  const d = b * b - 4 * a * c;
  if (d < 0) return a < 0 ? [-Infinity, Infinity] : null;
  const roots = [
    (-b - Math.sqrt(d)) / (2 * a),
    (-b + Math.sqrt(d)) / (2 * a),
  ].sort((x, y) => x - y);
  // Rocket speed exceeds strategic flight speed. Negative a has one positive
  // reachability root: its second nonpositive interval is the useful one.
  return a > 0 ? [roots[0], roots[1]] : [roots[1], Infinity];
}
export function interceptionPoint(
  p: Projectile,
  tick: number,
  fromX: number,
  fromY: number,
  radius: number,
) {
  const duration = p.impactTick - p.tick;
  if (duration <= 0 || tick >= p.impactTick - 1) return null;
  const vx = (p.toX - p.fromX) / duration,
    vy = (p.toY - p.fromY) / duration;
  const x = p.fromX + vx * (tick - p.tick),
    y = p.fromY + vy * (tick - p.tick);
  const qx = x - fromX,
    qy = y - fromY;
  const vv = vx * vx + vy * vy,
    b = 2 * (qx * vx + qy * vy),
    qq = qx * qx + qy * qy;
  // Radar must detect the warhead itself before assigning a shot. Otherwise a
  // long approach grants several reload cycles against one simultaneous salvo.
  if (qq > radius * radius) return null;
  const coverage = interval(vv, b, qq - radius * radius);
  if (!coverage) return null;
  const reach = interval(vv - MISSILE_DEFENSE_SPEED ** 2, b, qq);
  if (!reach) return null;
  const delay = Math.ceil(Math.max(1, coverage[0], reach[0]));
  if (delay > Math.min(coverage[1], reach[1], p.impactTick - tick - 1))
    return null;
  return {
    impactTick: tick + delay,
    toX: Math.round(x + vx * delay),
    toY: Math.round(y + vy * delay),
  };
}
