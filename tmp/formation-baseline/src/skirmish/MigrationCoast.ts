import type { PseudoRandom } from "../core/PseudoRandom";
import { MIGRATION_THEME } from "./content/Migration";
import type { MigrationCove, MigrationLandmass } from "./MigrationLayout";
import { terrainNoise } from "./TerrainNoise";

function coastRadius(mass: MigrationLandmass, angle: number): number {
  return MIGRATION_THEME.coastHarmonics.reduce(
    (value, [frequency, amplitude], index) =>
      value + amplitude * Math.sin(angle * frequency + mass.phases[index]),
    1,
  );
}

/** Bays have a sheltered interior and a curved, narrower entrance to the sea. */
export function createMigrationCoves(
  mass: MigrationLandmass,
  random: PseudoRandom,
): MigrationCove[] {
  const radius = Math.min(mass.radiusX, mass.radiusY);
  if (radius < MIGRATION_THEME.minimumCoveLandmassRadius) return [];
  const count = Math.max(
      3,
      Math.round((Math.PI * 2 * radius) / MIGRATION_THEME.coveSpacing),
    ),
    phase = random.nextFloat(0, Math.PI * 2),
    rotationCos = Math.cos(mass.rotation),
    rotationSin = Math.sin(mass.rotation),
    world = (u: number, v: number) => ({
      x:
        mass.x +
        u * mass.radiusX * rotationCos -
        v * mass.radiusY * rotationSin,
      y:
        mass.y +
        u * mass.radiusX * rotationSin +
        v * mass.radiusY * rotationCos,
    });
  return Array.from({ length: count }, (_, i) => {
    const angle =
        phase + ((i + random.nextFloat(-0.22, 0.22)) * Math.PI * 2) / count,
      boundary = coastRadius(mass, angle),
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      depth = random.nextFloat(0.77, 0.94) * boundary,
      centre = world(cos * depth, sin * depth),
      pocket =
        radius *
        boundary *
        random.nextFloat(...MIGRATION_THEME.coveRadiusRatio),
      mouthWidth = Math.max(
        1.3,
        pocket * random.nextFloat(...MIGRATION_THEME.coveMouthRatio),
      ),
      hook =
        random.nextFloat(0.08, 0.16) *
        boundary *
        (random.next() < 0.5 ? -1 : 1),
      throatAngle = angle + hook,
      outerAngle = angle + hook * 1.6,
      throat = world(
        Math.cos(throatAngle) * boundary * 1.01,
        Math.sin(throatAngle) * boundary * 1.01,
      ),
      // Go beyond the maximum radial outline, even when a headland lies beside the mouth.
      outside = world(Math.cos(outerAngle) * 1.65, Math.sin(outerAngle) * 1.65),
      mouth = Array.from({ length: 7 }, (_, i) => {
        const t = i / 6,
          s = 1 - t;
        return {
          x: s * s * centre.x + 2 * s * t * throat.x + t * t * outside.x,
          y: s * s * centre.y + 2 * s * t * throat.y + t * t * outside.y,
          width: mouthWidth * (0.95 + 0.45 * t),
        };
      }),
      rotation = mass.rotation + angle + random.nextFloat(-0.5, 0.5),
      radiusX = Math.max(2, pocket * random.nextFloat(0.9, 1.35)),
      radiusY = Math.max(2, pocket * random.nextFloat(0.7, 1.05)),
      padding = Math.max(radiusX * 1.36, radiusY * 1.36, mouthWidth * 1.4) + 2;
    return {
      ...centre,
      radiusX,
      radiusY,
      cos: Math.cos(rotation),
      sin: Math.sin(rotation),
      phases: Array.from({ length: 3 }, () => random.nextFloat(0, Math.PI * 2)),
      mouth,
      bounds: [
        Math.min(...mouth.map((p) => p.x)) - padding,
        Math.min(...mouth.map((p) => p.y)) - padding,
        Math.max(...mouth.map((p) => p.x)) + padding,
        Math.max(...mouth.map((p) => p.y)) + padding,
      ] as const,
    };
  });
}

/** Signed coastal field in cells: positive inland, negative in the sea. */
export function migrationCoastDistance(
  mass: MigrationLandmass,
  x: number,
  y: number,
): number {
  const dx = x - mass.x,
    dy = y - mass.y,
    cos = Math.cos(mass.rotation),
    sin = Math.sin(mass.rotation),
    u = (dx * cos + dy * sin) / mass.radiusX,
    v = (-dx * sin + dy * cos) / mass.radiusY,
    angle = Math.atan2(v, u),
    radius = Math.min(mass.radiusX, mass.radiusY),
    boundary = coastRadius(mass, angle),
    grain =
      (terrainNoise(
        x + mass.phases[0] * 173,
        y + mass.phases[1] * 179,
        Math.max(3, radius / 7),
      ) -
        0.5) *
      Math.min(4, radius * 0.09);
  let distance = (boundary - Math.hypot(u, v)) * radius + grain;
  for (const cove of mass.coves) {
    const [left, top, right, bottom] = cove.bounds;
    if (x < left || x > right || y < top || y > bottom) continue;
    const dx = x - cove.x,
      dy = y - cove.y,
      u = (dx * cove.cos + dy * cove.sin) / cove.radiusX,
      v = (-dx * cove.sin + dy * cove.cos) / cove.radiusY;
    const angle = Math.atan2(v, u),
      boundary =
        1 +
        0.18 * Math.sin(angle * 3 + cove.phases[0]) +
        0.12 * Math.sin(angle * 5 + cove.phases[1]) +
        0.06 * Math.sin(angle * 9 + cove.phases[2]);
    distance = Math.min(
      distance,
      (Math.hypot(u, v) - boundary) * Math.min(cove.radiusX, cove.radiusY) +
        grain * 0.3,
    );
    for (let i = 1; i < cove.mouth.length; i++) {
      const a = cove.mouth[i - 1],
        b = cove.mouth[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)),
        ),
        width = a.width + (b.width - a.width) * t;
      distance = Math.min(
        distance,
        Math.hypot(x - a.x - dx * t, y - a.y - dy * t) - width,
      );
    }
  }
  return distance;
}
