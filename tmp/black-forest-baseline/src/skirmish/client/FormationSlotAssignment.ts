interface Point {
  x: number;
  y: number;
}
/** Minimum squared travel assignment (Hungarian), compiled on facing changes.
 * Soldier counts are tiny (6/12). Identity order resolves equal-cost choices.
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
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const min = new Float64Array(n + 1).fill(Infinity),
      used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity,
        j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const dx = source[i0 - 1].x - destinations[j - 1].x;
        const dy = source[i0 - 1].y - destinations[j - 1].y;
        const cost = dx * dx + dy * dy - u[i0] - v[j];
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
