export interface CollisionPoint {
  x: number;
  y: number;
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
