export interface CollisionPoint {
  x: number;
  y: number;
}

/** Clip against a CCW convex body's half planes, expanded by projectile radius. */
export function polygonSweepEntry(
  from: CollisionPoint,
  to: CollisionPoint,
  polygon: readonly CollisionPoint[],
  radius = 0,
): number | null {
  let enter = 0,
    leave = 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      nx = -(b.y - a.y),
      ny = b.x - a.x;
    const start =
        nx * (from.x - a.x) + ny * (from.y - a.y) + radius * Math.hypot(nx, ny),
      delta = nx * (to.x - from.x) + ny * (to.y - from.y);
    if (Math.abs(delta) < 1e-10) {
      if (start < 0) return null;
      continue;
    }
    const t = -start / delta;
    if (delta > 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return null;
  }
  return enter <= 1 && leave >= 0 ? Math.max(0, enter) : null;
}

/** First contact, including start overlaps and a zero-length sweep. */
export function circleSweepEntry(
  from: CollisionPoint,
  to: CollisionPoint,
  target: CollisionPoint,
  radius: number,
): number | null {
  const x = from.x - target.x,
    y = from.y - target.y,
    dx = to.x - from.x,
    dy = to.y - from.y;
  const c = x * x + y * y - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (!a) return null;
  const b = 2 * (x * dx + y * dy),
    discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const entry = (-b - Math.sqrt(discriminant)) / (2 * a);
  return entry >= 0 && entry <= 1 ? entry : null;
}

function rectangleSweepEntry(
  from: CollisionPoint,
  to: CollisionPoint,
  low: CollisionPoint,
  width: number,
  height: number,
): number | null {
  let entry = 0,
    exit = 1;
  for (const [origin, delta, edge, size] of [
    [from.x, to.x - from.x, low.x, width],
    [from.y, to.y - from.y, low.y, height],
  ]) {
    if (!delta) {
      if (origin < edge || origin > edge + size) return null;
      continue;
    }
    const a = (edge - origin) / delta,
      b = (edge + size - origin) / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return null;
  }
  return entry;
}
/** Circular projectile against a square tile: strips plus rounded corners. */
export function boxSweepEntry(
  from: CollisionPoint,
  to: CollisionPoint,
  low: CollisionPoint,
  size: number,
  radius = 0,
): number | null {
  if (!radius) return rectangleSweepEntry(from, to, low, size, size);
  if (
    rectangleSweepEntry(
      from,
      to,
      { x: low.x - radius, y: low.y - radius },
      size + radius * 2,
      size + radius * 2,
    ) === null
  )
    return null;
  const contacts = [
    rectangleSweepEntry(
      from,
      to,
      { x: low.x - radius, y: low.y },
      size + radius * 2,
      size,
    ),
    rectangleSweepEntry(
      from,
      to,
      { x: low.x, y: low.y - radius },
      size,
      size + radius * 2,
    ),
    ...[low.x, low.x + size].flatMap((x) =>
      [low.y, low.y + size].map((y) =>
        circleSweepEntry(from, to, { x, y }, radius),
      ),
    ),
  ].filter((t): t is number => t !== null);
  return contacts.length ? Math.min(...contacts) : null;
}
