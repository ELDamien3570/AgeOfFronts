export function terrainHash(x: number, y: number): number {
  let n = Math.imul(x ^ 0x3d45, 0x45d9f3b) ^ Math.imul(y ^ 0x1567, 0x27d4eb2d);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n >>> 0) / 0xffffffff;
}

export function terrainNoise(x: number, y: number, size: number): number {
  const xx = Math.floor(x / size),
    yy = Math.floor(y / size),
    u = x / size - xx,
    v = y / size - yy,
    sx = u * u * (3 - 2 * u),
    sy = v * v * (3 - 2 * v);
  return (
    (terrainHash(xx, yy) * (1 - sx) + terrainHash(xx + 1, yy) * sx) * (1 - sy) +
    (terrainHash(xx, yy + 1) * (1 - sx) + terrainHash(xx + 1, yy + 1) * sx) * sy
  );
}
