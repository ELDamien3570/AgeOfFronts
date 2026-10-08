import { PseudoRandom } from "../core/PseudoRandom";
import { terrainNoise } from "./TerrainNoise";
import { BLACK_FOREST_THEME } from "./content/BlackForest";
export { BLACK_FOREST_THEME } from "./content/BlackForest";

export interface ForestClearing {
  id: number;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  phases: readonly number[];
}
export interface ForestPassage {
  from: number;
  to: number;
  points: readonly { x: number; y: number; halfWidth: number }[];
  halfWidth: number;
}
export interface BlackForestLayout {
  size: number;
  seed: number;
  clearings: readonly ForestClearing[];
  passages: readonly ForestPassage[];
  /** Positive inside open ground, negative inside woodland; measured in tiles. */
  clearance: Float32Array;
  /** Signed distance from fast routes, used to reserve dry passage shoulders. */
  passageClearance: Float32Array;
}

/** A connected clearing graph comes first; noise only shapes its boundaries. */
export function blackForestLayout(
  size: number,
  seed: number,
): BlackForestLayout {
  if (
    ![250, 500, 1000].includes(size) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0x7fffffff
  )
    throw new Error("Invalid Black Forest size or seed");
  const random = new PseudoRandom(seed),
    side = Math.max(4, Math.round(size / BLACK_FOREST_THEME.clearingSpacing)),
    spacing = size / side,
    clearings: ForestClearing[] = [];
  for (let row = 0; row < side; row++)
    for (let column = 0; column < side; column++) {
      const radius = Math.max(
        BLACK_FOREST_THEME.minimumClearingRadius,
        spacing * BLACK_FOREST_THEME.clearingRadiusRatio,
      );
      const extent = random.nextFloat(0.85, 1.28),
        stretch = random.nextFloat(0.8, 1.28),
        jitter = BLACK_FOREST_THEME.clearingPositionJitter;
      clearings.push({
        id: clearings.length,
        x: (column + 0.5 + random.nextFloat(-jitter, jitter)) * spacing,
        y: (row + 0.5 + random.nextFloat(-jitter, jitter)) * spacing,
        radiusX: radius * extent * stretch,
        radiusY: (radius * extent) / stretch,
        rotation: random.nextFloat(0, Math.PI * 2),
        phases: Array.from({ length: 3 }, () =>
          random.nextFloat(0, Math.PI * 2),
        ),
      });
    }
  const candidates: { from: number; to: number; distance: number }[] = [];
  for (let from = 0; from < clearings.length; from++)
    for (let to = from + 1; to < clearings.length; to++) {
      const a = clearings[from],
        b = clearings[to];
      candidates.push({ from, to, distance: Math.hypot(a.x - b.x, a.y - b.y) });
    }
  candidates.sort(
    (a, b) => a.distance - b.distance || a.from - b.from || a.to - b.to,
  );
  const parents = clearings.map((c) => c.id),
    root = (id: number): number => {
      while (parents[id] !== id) id = parents[id];
      return id;
    },
    selected = new Set<string>(),
    connections: typeof candidates = [];
  for (const edge of candidates) {
    const from = root(edge.from),
      to = root(edge.to);
    if (from === to) continue;
    parents[from] = to;
    selected.add(`${edge.from}:${edge.to}`);
    connections.push(edge);
  }
  // Short alternative links make defensible passes without forcing one route.
  const alternatives = random.shuffleArray(
    candidates.filter(
      (edge) =>
        !selected.has(`${edge.from}:${edge.to}`) &&
        edge.distance < spacing * 1.5,
    ),
  );
  connections.push(
    ...alternatives.slice(
      0,
      Math.round(clearings.length * BLACK_FOREST_THEME.extraConnectionRatio),
    ),
  );
  const passages: ForestPassage[] = connections.map((edge) => {
    const a = clearings[edge.from],
      b = clearings[edge.to],
      dx = b.x - a.x,
      dy = b.y - a.y,
      bend = random.nextFloat(-0.19, 0.19) * edge.distance,
      halfWidth =
        BLACK_FOREST_THEME.passageHalfWidth * random.nextFloat(1, 1.8),
      secondBend = random.nextFloat(-0.1, 0.1) * edge.distance,
      widthPhase = random.nextFloat(0, Math.PI * 2);
    const points = Array.from({ length: 17 }, (_, index) => {
      const t = index / 16,
        offset =
          Math.sin(Math.PI * t) * bend + Math.sin(Math.PI * 2 * t) * secondBend;
      return {
        x: a.x + dx * t - (dy / edge.distance) * offset,
        y: a.y + dy * t + (dx / edge.distance) * offset,
        halfWidth: Math.max(
          BLACK_FOREST_THEME.passageHalfWidth,
          halfWidth *
            (0.85 + 0.4 * Math.sin(t * Math.PI * 3 + widthPhase) ** 2),
        ),
      };
    });
    return { from: edge.from, to: edge.to, points, halfWidth };
  });
  const clearance = new Float32Array(size * size).fill(-size),
    passageClearance = new Float32Array(size * size).fill(-size);
  const stamp = (
    target: Float32Array,
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation = 0,
    phases?: readonly number[],
  ) => {
    const extent = Math.max(radiusX, radiusY) * (phases ? 1.6 : 1),
      cos = Math.cos(rotation),
      sin = Math.sin(rotation);
    const margin = 5,
      left = Math.max(0, Math.floor(x - extent - margin)),
      right = Math.min(size - 1, Math.ceil(x + extent + margin)),
      top = Math.max(0, Math.floor(y - extent - margin)),
      bottom = Math.min(size - 1, Math.ceil(y + extent + margin));
    for (let yy = top; yy <= bottom; yy++)
      for (let xx = left; xx <= right; xx++) {
        const dx = xx + 0.5 - x,
          dy = yy + 0.5 - y,
          u = (dx * cos + dy * sin) / radiusX,
          v = (-dx * sin + dy * cos) / radiusY,
          angle = Math.atan2(v, u),
          boundary = phases
            ? 1 +
              BLACK_FOREST_THEME.clearingShapeVariation *
                (Math.sin(angle * 3 + phases[0]) +
                  0.6 * Math.sin(angle * 5 + phases[1]) +
                  0.55 * Math.sin(angle * 2 + phases[2]))
            : 1,
          distance = (boundary - Math.hypot(u, v)) * Math.min(radiusX, radiusY);
        target[yy * size + xx] = Math.max(target[yy * size + xx], distance);
      }
  };
  for (const c of clearings)
    stamp(clearance, c.x, c.y, c.radiusX, c.radiusY, c.rotation, c.phases);
  for (const p of passages)
    for (let index = 1; index < p.points.length; index++) {
      const a = p.points[index - 1],
        b = p.points[index],
        steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
      for (let i = 0; i <= steps; i++) {
        const t = i / Math.max(1, steps);
        const radius = a.halfWidth + (b.halfWidth - a.halfWidth) * t;
        stamp(
          passageClearance,
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          radius,
          radius,
        );
      }
    }
  // Uneven side pockets interrupt the tube-like silhouette of a uniform road.
  for (const p of passages) {
    const index = random.nextInt(4, 13),
      a = p.points[index],
      b = p.points[index + 1],
      length = Math.hypot(b.x - a.x, b.y - a.y),
      side = random.next() < 0.5 ? -1 : 1,
      reach = random.nextFloat(5, 12),
      radius = random.nextFloat(4, 7);
    for (let t = 0; t <= 1; t += 0.2)
      stamp(
        passageClearance,
        a.x - ((b.y - a.y) / length) * reach * side * t,
        a.y + ((b.x - a.x) / length) * reach * side * t,
        radius * (1 - t * 0.25),
        radius * (1 - t * 0.25),
      );
  }
  const noiseX = random.nextInt(-10000, 10000),
    noiseY = random.nextInt(-10000, 10000);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const tile = y * size + x;
      clearance[tile] =
        Math.max(clearance[tile], passageClearance[tile]) +
        (terrainNoise(x + noiseX, y + noiseY, 9) - 0.5) * 3;
      if (
        Math.min(x, y, size - 1 - x, size - 1 - y) <
        BLACK_FOREST_THEME.boundaryWidth
      )
        clearance[tile] = -size;
    }
  return { size, seed, clearings, passages, clearance, passageClearance };
}
