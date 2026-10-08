/** Exact Euclidean distance to water, measured from tile edges, in O(n). */
export function terrainShoreDistance(
  size: number,
  land: ArrayLike<number>,
): Float32Array {
  if (land.length !== size * size) throw new Error("Invalid shore grid");
  const squared = new Float64Array(land.length),
    result = new Float32Array(land.length),
    input = new Float64Array(size),
    output = new Float64Array(size),
    sites = new Int32Array(size),
    edges = new Float64Array(size + 1),
    far = size * size * 4;
  const transform = () => {
    let k = 0;
    sites[0] = 0;
    edges[0] = -Infinity;
    edges[1] = Infinity;
    for (let q = 1; q < size; q++) {
      let boundary: number;
      do {
        const p = sites[k];
        boundary = (input[q] + q * q - (input[p] + p * p)) / (2 * (q - p));
        if (boundary > edges[k]) break;
        k--;
      } while (k >= 0);
      k++;
      sites[k] = q;
      edges[k] = boundary!;
      edges[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < size; q++) {
      while (edges[k + 1] < q) k++;
      output[q] = (q - sites[k]) ** 2 + input[sites[k]];
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) input[x] = land[y * size + x] ? far : 0;
    transform();
    for (let x = 0; x < size; x++) squared[y * size + x] = output[x];
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) input[y] = squared[y * size + x];
    transform();
    for (let y = 0; y < size; y++)
      result[y * size + x] = Math.max(0, Math.sqrt(output[y]) - 0.5);
  }
  return result;
}
