interface Point {
  x: number;
  y: number;
}
/** Minimum squared travel assignment (Hungarian), compiled on facing changes.
 * Identity order resolves equal-cost choices, including full 144-member units.
 * Result is the source index assigned to each destination. */
export function minimumTravelAssignment(
  source: readonly Point[],
  destinations: readonly Point[],
): number[] {
  const n = source.length;
  if (destinations.length !== n)
    throw new Error("Formation assignment needs equal counts");
  const u = new Float64Array(n + 1),
    v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1),
    way = new Int32Array(n + 1);
  const min = new Float64Array(n + 1), used = new Uint8Array(n + 1);
  // The augmenting search revisits pairs. Compute their unchanged squared
  // distances once; retain the original subtraction order for dual costs.
  const costs = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const dx = source[i].x - destinations[j].x, dy = source[i].y - destinations[j].y;
    costs[i * n + j] = dx * dx + dy * dy;
  }
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    min.fill(Infinity); used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cost = costs[(i0 - 1) * n + j - 1] - u[i0] - v[j];
        if (cost < min[j]) {
          min[j] = cost;
          way[j] = j0;
        }
        if (min[j] < delta) {
          delta = min[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else min[j] -= delta;
      }
      j0 = j1;
    } while (p[j0]);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  return Array.from(p.slice(1), (index) => index - 1);
}
