/** Bounded talus transport with simultaneous updates; preserves land volume. */
export function erodeTerrainSlopes(
  size: number,
  land: ArrayLike<number>,
  heights: Float32Array,
  recipe: { iterations: number; talus: number; rate: number },
): void {
  // Eight donors can feed one cell. This step bound prevents transport from
  // creating a new peak above its neighbours or oscillating across a talus slope.
  if (
    land.length !== size * size ||
    heights.length !== land.length ||
    !Number.isInteger(recipe.iterations) ||
    recipe.iterations < 0 ||
    !Number.isFinite(recipe.talus) ||
    recipe.talus < 0 ||
    !Number.isFinite(recipe.rate) ||
    recipe.rate <= 0 ||
    recipe.rate > 1 / 8
  )
    throw new Error("Invalid thermal erosion recipe");
  const delta = new Float32Array(heights.length),
    talus = (recipe.talus * 500) / size;
  for (let iteration = 0; iteration < recipe.iterations; iteration++) {
    delta.fill(0);
    for (let y = 1; y < size - 1; y++)
      for (let x = 1; x < size - 1; x++) {
        const tile = y * size + x;
        if (!land[tile]) continue;
        let target = -1,
          excess = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const next = tile + dy * size + dx;
            if (land[next] !== land[tile]) continue;
            const drop =
              heights[tile] - heights[next] - talus * Math.hypot(dx, dy);
            if (drop > excess) {
              excess = drop;
              target = next;
            }
          }
        if (target >= 0) {
          const material = excess * recipe.rate;
          delta[tile] -= material;
          delta[target] += material;
        }
      }
    for (let tile = 0; tile < heights.length; tile++)
      if (land[tile]) heights[tile] += delta[tile];
  }
}
