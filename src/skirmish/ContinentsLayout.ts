import { PseudoRandom } from "../core/PseudoRandom";
import {
  CONTINENTS_THEME as THEME,
  type ContinentClimate,
} from "./content/Continents";
import { carveMigrationDrainage } from "./MigrationHydrology";
import type {
  MigrationLandmass,
  MigrationLayout,
  MigrationRiver,
} from "./MigrationLayout";
import {
  createRegionalTopography,
  type Landform,
  type LandformKind,
} from "./RegionalTopography";
import { buildTerrainDrainage } from "./TerrainDrainage";
import { erodeTerrainSlopes } from "./TerrainErosion";
import { formTerrain } from "./TerrainFormation";
import { terrainNoise } from "./TerrainNoise";
import { terrainShoreDistance } from "./TerrainShoreDistance";

/** One continent's personality: climate, forest density and how rugged it is. */
export interface ContinentProfile {
  id: number;
  climate: ContinentClimate;
  temperature: number;
  moisture: number;
  forest: number;
  /** 0 = rolling hills only; high values raise ranges with impassable ridges. */
  ruggedness: number;
  /** Normalised temperature (equator = 1) at the continent's centre. */
  equatorial: number;
}
export interface ContinentLake {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
}
export interface ContinentsLayout extends MigrationLayout {
  profiles: readonly ContinentProfile[];
  lakes: readonly ContinentLake[];
  /** Island and continent ids above this value belong to no continent profile. */
  continentCount: number;
}

interface Lobe {
  x: number;
  y: number;
  rx: number;
  ry: number;
  cos: number;
  sin: number;
  phases: readonly number[];
}
interface Body {
  id: number;
  x: number;
  y: number;
  radius: number;
  lobes: Lobe[];
}

const lerp = (range: readonly [number, number] | readonly number[], t: number) =>
  range[0] + (range[1] - range[0]) * t;

/** Continents first (spread over the map), then smaller islands in the gaps. */
function placeBodies(size: number, random: PseudoRandom, count: number) {
  const bodies: Body[] = [],
    weights = Array.from({ length: count }, () => random.nextFloat(0.78, 1.25)),
    areaEach = (size * size * THEME.landShare) / count,
    norm = Math.sqrt(
      (count * areaEach) /
        (1.8 * Math.PI * weights.reduce((s, w) => s + w * w, 0)),
    );
  const lobeSet = (
    x: number,
    y: number,
    radius: number,
    extra: number,
  ): Lobe[] => {
    const make = (lx: number, ly: number, r: number, stretch: number): Lobe => {
      const rotation = random.nextFloat(0, Math.PI * 2);
      return {
        x: lx,
        y: ly,
        rx: r * stretch,
        ry: r / stretch,
        cos: Math.cos(rotation),
        sin: Math.sin(rotation),
        phases: THEME.coastHarmonics.map(() => random.nextFloat(0, Math.PI * 2)),
      };
    };
    const lobes = [make(x, y, radius, random.nextFloat(1, 1.45))],
      start = random.nextFloat(0, Math.PI * 2);
    for (let i = 0; i < extra; i++) {
      const angle = start + (i * Math.PI * 2) / Math.max(1, extra) + random.nextFloat(-0.6, 0.6),
        distance = radius * random.nextFloat(0.5, 0.8);
      lobes.push(
        make(
          x + Math.cos(angle) * distance,
          y + Math.sin(angle) * distance,
          radius * random.nextFloat(0.5, 0.72),
          random.nextFloat(1, 1.5),
        ),
      );
    }
    return lobes;
  };
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (const { w } of order) {
    const radius = w * norm,
      margin = radius * 1.25;
    let best: { x: number; y: number } | undefined,
      score = -Infinity;
    for (let attempt = 0; attempt < 240; attempt++) {
      const x = random.nextFloat(margin, size - margin),
        y = random.nextFloat(margin, size - margin);
      let clearance = Infinity;
      for (const other of bodies)
        clearance = Math.min(
          clearance,
          Math.hypot(x - other.x, y - other.y) - (radius + other.radius) * 1.0,
        );
      clearance = Math.min(clearance, Math.min(x, y, size - x, size - y) - margin);
      if (clearance > score) {
        score = clearance;
        best = { x, y };
      }
    }
    bodies.push({
      id: bodies.length + 1,
      x: best!.x,
      y: best!.y,
      radius,
      lobes: lobeSet(best!.x, best!.y, radius, 2),
    });
  }
  const [low, high] = THEME.smallIslandCounts[size as 250 | 500 | 1000 | 2000],
    wanted = random.nextInt(low, high + 1),
    scale = Math.sqrt(size / 250);
  let placed = 0;
  for (
    let attempt = 0;
    attempt < THEME.islandPlacementAttempts && placed < wanted;
    attempt++
  ) {
    const radius = lerp(THEME.smallIslandRadius, random.next()) * scale,
      margin = radius * 1.9 + 4;
    let x = random.nextFloat(margin, size - margin),
      y = random.nextFloat(margin, size - margin);
    if (attempt % 2) {
      // Coastal islands sit just beyond a continent's strait.
      const near = bodies[random.nextInt(0, count)],
        angle = random.nextFloat(0, Math.PI * 2),
        distance = near.radius * random.nextFloat(1.55, 2.1);
      x = near.x + Math.cos(angle) * distance;
      y = near.y + Math.sin(angle) * distance;
      if (x < margin || y < margin || x > size - margin || y > size - margin)
        continue;
    }
    const ok = bodies.every((other) =>
      other.lobes.every(
        (lobe) =>
          Math.hypot(x - lobe.x, y - lobe.y) >
          Math.max(lobe.rx, lobe.ry) * 1.4 + radius * 1.5 + size * 0.006,
      ),
    );
    if (!ok) continue;
    bodies.push({
      id: bodies.length + 1,
      x,
      y,
      radius,
      lobes: lobeSet(x, y, radius, 0),
    });
    placed++;
  }
  return bodies;
}

function chooseProfiles(
  size: number,
  random: PseudoRandom,
  bodies: readonly Body[],
): ContinentProfile[] {
  const used = new Map<ContinentClimate, number>(),
    profiles = bodies.map((body): ContinentProfile => {
      const polar = Math.abs((2 * body.y) / size - 1),
        entries = Object.entries(THEME.climates) as [
          ContinentClimate,
          (typeof THEME.climates)[ContinentClimate],
        ][],
        weights = entries.map(([name, climate]) => {
          let weight: number = climate.weight;
          const cold = name === "arctic" || name === "boreal",
            hot = name === "desert" || name === "jungle" || name === "savanna";
          if (polar > 0.6) weight *= cold ? 3 : hot ? 0.25 : 1;
          else if (polar < 0.3) weight *= cold ? 0.25 : hot ? 1.7 : 1;
          return weight * 0.4 ** (used.get(name) ?? 0);
        });
      let roll = random.nextFloat(0, weights.reduce((s, w) => s + w, 0)),
        pick = 0;
      for (; pick < weights.length - 1; pick++) {
        roll -= weights[pick];
        if (roll <= 0) break;
      }
      const [climate, spec] = entries[pick];
      used.set(climate, (used.get(climate) ?? 0) + 1);
      return {
        id: body.id,
        climate,
        temperature: lerp(spec.temperature, random.next()),
        moisture: lerp(spec.moisture, random.next()),
        forest: lerp(spec.forest, random.next()),
        ruggedness: random.next(),
        equatorial: 1 - polar,
      };
    });
  // Not every continent needs dramatic relief, but a large map has some.
  if (profiles.length >= 3 && Math.max(...profiles.map((p) => p.ruggedness)) < 0.6) {
    const biggest = profiles.reduce((a, b) => (a.ruggedness > b.ruggedness ? a : b));
    biggest.ruggedness = random.nextFloat(0.7, 0.95);
  }
  return profiles;
}

/** Ranges, massifs, plateaus and lowlands per continent, scaled by its ruggedness. */
function authorLandforms(
  size: number,
  random: PseudoRandom,
  bodies: readonly Body[],
  profiles: readonly ContinentProfile[],
): Landform[] {
  const features: Landform[] = [];
  const add = (
    kind: LandformKind,
    points: { x: number; y: number }[],
    width: number,
    elevation: number,
  ) =>
    features.push({
      id: features.length,
      kind,
      points,
      width,
      aspect: random.nextFloat(0.6, 1.6),
      angle: random.nextFloat(0, Math.PI * 2),
      elevation,
      phase: random.nextFloat(0, Math.PI * 2),
    });
  for (const profile of profiles) {
    const body = bodies[profile.id - 1],
      cx = body.x / size,
      cy = body.y / size,
      radius = body.radius / size,
      r = profile.ruggedness,
      at = (angle: number, distance: number) => ({
        x: cx + Math.cos(angle) * distance * radius,
        y: cy + Math.sin(angle) * distance * radius,
      });
    const ranges = r < 0.22 ? 0 : r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    for (let i = 0; i < ranges; i++) {
      const coastal = random.next() < 0.5,
        angle = random.nextFloat(0, Math.PI * 2),
        length = radius * random.nextFloat(0.9, 1.7);
      let heading = coastal ? angle + Math.PI / 2 : angle,
        { x, y } = coastal
          ? at(angle, random.nextFloat(0.45, 0.75))
          : at(angle + Math.PI, random.nextFloat(0, 0.4)),
        points: { x: number; y: number }[] = [];
      for (let step = 0; step < 8; step++) {
        points.push({ x, y });
        heading += random.nextFloat(-0.38, 0.38) + (coastal ? 0.08 : 0);
        const px = x,
          py = y;
        x += (Math.cos(heading) * length) / 7;
        y += (Math.sin(heading) * length) / 7;
        // Keep ranges on their own continent, so calm neighbours stay calm.
        if (Math.hypot(x - cx, y - cy) > radius * 0.8) {
          heading = Math.atan2(cy - py, cx - px) + random.nextFloat(-0.5, 0.5);
          x = px + (Math.cos(heading) * length) / 7;
          y = py + (Math.sin(heading) * length) / 7;
        }
      }
      add(
        "range",
        points,
        radius * random.nextFloat(0.08, 0.16),
        700 + r * random.nextFloat(1900, 3400),
      );
    }
    const massifs = r < 0.3 ? 0 : r < 0.7 ? 1 : 2;
    for (let i = 0; i < massifs; i++)
      add(
        "massif",
        [at(random.nextFloat(0, Math.PI * 2), random.nextFloat(0, 0.6))],
        radius * random.nextFloat(0.25, 0.5),
        500 + r * random.nextFloat(1200, 2600),
      );
    if (r < 0.35)
      add(
        "massif",
        [at(random.nextFloat(0, Math.PI * 2), random.nextFloat(0, 0.5))],
        radius * random.nextFloat(0.35, 0.6),
        random.nextFloat(250, 600),
      );
    const dry = profile.climate === "desert" || profile.climate === "steppe",
      plateaus = random.nextInt(0, 2) + Number(dry);
    for (let i = 0; i < plateaus; i++)
      add(
        "plateau",
        [at(random.nextFloat(0, Math.PI * 2), random.nextFloat(0, 0.7))],
        radius * random.nextFloat(0.3, 0.6),
        random.nextFloat(300, 600 + r * 900),
      );
    for (let i = random.nextInt(1, 3); i > 0; i--)
      add(
        "basin",
        [at(random.nextFloat(0, Math.PI * 2), random.nextFloat(0, 0.7))],
        radius * random.nextFloat(0.25, 0.5),
        0,
      );
    for (let i = random.nextInt(1, 4); i > 0; i--)
      add(
        "plain",
        [at(random.nextFloat(0, Math.PI * 2), random.nextFloat(0.2, 0.9))],
        radius * random.nextFloat(0.25, 0.5),
        0,
      );
  }
  return features;
}

/** Label 4-connected cells matching `include`; label 0 means excluded. */
function components(size: number, include: (tile: number) => boolean) {
  const labels = new Int32Array(size * size),
    queue = new Int32Array(size * size),
    areas: number[] = [0];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] || !include(start)) continue;
    const label = areas.length;
    let tail = 1;
    queue[0] = start;
    labels[start] = label;
    for (let head = 0; head < tail; head++) {
      const tile = queue[head],
        x = tile % size;
      for (const next of [
        x > 0 ? tile - 1 : -1,
        x < size - 1 ? tile + 1 : -1,
        tile - size,
        tile + size,
      ])
        if (next >= 0 && next < labels.length && !labels[next] && include(next)) {
          labels[next] = label;
          queue[tail++] = next;
        }
    }
    areas.push(tail);
  }
  return { labels, areas };
}

/** Grow land ids into `tiles` so isolated water pools disappear. */
function absorb(size: number, regions: Uint8Array, tiles: number[]) {
  let pending = tiles;
  while (pending.length) {
    const resolved: number[] = [],
      next: number[] = [];
    for (const tile of pending) {
      const x = tile % size,
        y = Math.floor(tile / size);
      let id = 0;
      for (let dy = -1; dy <= 1 && !id; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const value = regions[ny * size + nx];
          if (value) {
            id = value;
            break;
          }
        }
      if (id) resolved.push(tile, id);
      else next.push(tile);
    }
    if (!resolved.length) {
      for (const tile of next) regions[tile] = 1;
      return;
    }
    for (let i = 0; i < resolved.length; i += 2) regions[resolved[i]] = resolved[i + 1];
    pending = next;
  }
}

function carveLakes(
  size: number,
  random: PseudoRandom,
  regions: Uint8Array,
  heights: Float32Array,
  shore: Float32Array,
  continentCount: number,
): ContinentLake[] {
  const before = heights.slice(),
    drainage = buildTerrainDrainage(size, regions.slice(), heights),
    [low, high] = THEME.lakeCounts[size as 250 | 500 | 1000 | 2000],
    wanted = random.nextInt(low, high + 1),
    inland = Math.max(6, size * THEME.lakeMinimumInlandRatio),
    perContinent = Math.ceil(wanted / continentCount) + 1,
    candidates: { tile: number; score: number }[] = [];
  for (let tile = 0; tile < regions.length; tile++) {
    const id = regions[tile];
    if (!id || id > continentCount || shore[tile] < inland) continue;
    if (drainage.accumulation[tile] < 18 || before[tile] > 1400) continue;
    const x = tile % size;
    if (x < 1 || x >= size - 1) continue;
    const slope =
      Math.abs(before[tile + 1] - before[tile - 1]) +
      Math.abs(before[tile + size] - before[tile - size]);
    candidates.push({
      tile,
      score:
        Math.log2(1 + drainage.accumulation[tile]) *
        (0.6 + random.next() * 0.8) /
        (1 + slope / 40),
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.tile - b.tile);
  const chosen: { tile: number; id: number }[] = [],
    counts = new Map<number, number>(),
    separation = size * 0.13;
  for (const { tile } of candidates) {
    if (chosen.length >= wanted) break;
    const id = regions[tile],
      x = tile % size,
      y = Math.floor(tile / size);
    if ((counts.get(id) ?? 0) >= perContinent) continue;
    if (
      chosen.some(
        (c) => Math.hypot((c.tile % size) - x, Math.floor(c.tile / size) - y) < separation,
      )
    )
      continue;
    chosen.push({ tile, id });
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const lakes: ContinentLake[] = [],
    channel = 1.3 * Math.max(1, Math.sqrt(size / 500));
  for (const { tile, id } of chosen) {
    const cx = (tile % size) + 0.5,
      cy = Math.floor(tile / size) + 0.5,
      base = size * lerp(THEME.lakeRadiusRatio, random.next()),
      stretch = random.nextFloat(1, 1.7),
      rotation = random.nextFloat(0, Math.PI * 2),
      cos = Math.cos(rotation),
      sin = Math.sin(rotation),
      phases = [0, 1, 2].map(() => random.nextFloat(0, Math.PI * 2)),
      extent = Math.ceil(base * stretch * 1.5) + 2,
      footprint: number[] = [];
    let level = Infinity;
    for (let y = Math.max(0, Math.floor(cy - extent)); y < Math.min(size, cy + extent); y++)
      for (let x = Math.max(0, Math.floor(cx - extent)); x < Math.min(size, cx + extent); x++) {
        const t = y * size + x;
        if (regions[t] !== id) continue;
        const u = ((x + 0.5 - cx) * cos + (y + 0.5 - cy) * sin) / (base * stretch),
          v = (-(x + 0.5 - cx) * sin + (y + 0.5 - cy) * cos) / (base / stretch),
          angle = Math.atan2(v, u),
          edge =
            1 +
            0.22 * Math.sin(angle * 3 + phases[0]) +
            0.14 * Math.sin(angle * 5 + phases[1]) +
            0.08 * Math.sin(angle * 8 + phases[2]);
        if (Math.hypot(u, v) <= edge) {
          footprint.push(t);
          level = Math.min(level, before[t]);
        }
      }
    if (footprint.length < 8) continue;
    level = Math.max(0.6, level);
    for (const t of footprint) {
      regions[t] = 0;
      heights[t] = level;
    }
    // Follow the drainage downhill to open water, so the lake spills to the sea.
    const path: number[] = [];
    for (
      let t = drainage.downstream[tile];
      t >= 0 && path.length < size * 2;
      t = drainage.downstream[t]
    ) {
      if (!regions[t]) break;
      path.push(t);
    }
    path.forEach((t, i) => {
      const px = (t % size) + 0.5,
        py = Math.floor(t / size) + 0.5,
        depth = Math.max(0.1, level * (1 - (i + 1) / (path.length + 1)));
      for (let y = Math.max(0, Math.floor(py - channel - 1)); y < Math.min(size, py + channel + 1); y++)
        for (let x = Math.max(0, Math.floor(px - channel - 1)); x < Math.min(size, px + channel + 1); x++) {
          const n = y * size + x;
          if (!regions[n] || Math.hypot(x + 0.5 - px, y + 0.5 - py) > channel) continue;
          regions[n] = 0;
          heights[n] = Math.min(before[n], depth);
        }
    });
    lakes.push({ x: cx, y: cy, radiusX: base * stretch, radiusY: base / stretch });
  }
  // Water that cannot reach the open sea is not a connected lake: fold it into land.
  const water = components(size, (tile) => !regions[tile]),
    ocean = water.areas.reduce((best, area, label) => (area > water.areas[best] ? label : best), 1),
    stranded: number[] = [];
  for (let tile = 0; tile < regions.length; tile++)
    if (water.labels[tile] && water.labels[tile] !== ocean) stranded.push(tile);
  if (stranded.length) {
    absorb(size, regions, stranded);
    for (const tile of stranded) heights[tile] = Math.max(1, before[tile]);
  }
  return lakes.filter((lake) => !regions[Math.floor(lake.y) * size + Math.floor(lake.x)]);
}

export function buildContinentsLayout(
  size: 250 | 500 | 1000 | 2000,
  seed: number,
): { layout: ContinentsLayout; shore: Float32Array; heights: Float32Array } {
  const random = new PseudoRandom(seed ^ 0x5a3c91e7),
    [lowCount, highCount] = THEME.continentCounts[size],
    continentCount = random.nextInt(lowCount, highCount + 1),
    bodies = placeBodies(size, random, continentCount),
    profiles = chooseProfiles(size, random, bodies.slice(0, continentCount)),
    count = size * size,
    regions = new Uint8Array(count),
    best = new Float32Array(count).fill(-Infinity),
    second = new Float32Array(count).fill(-Infinity),
    owner = new Uint8Array(count),
    nx = random.nextInt(-10000, 10000),
    ny = random.nextInt(-10000, 10000),
    warp = size * 0.03;
  // Coast value: domain-warped lobe fields, roughened at several scales.
  const roughness = new Float32Array(count);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      roughness[y * size + x] =
        (terrainNoise(x + nx, y + ny, size * 0.1) - 0.5) * 0.34 +
        (terrainNoise(x + nx + 991, y + ny - 413, size * 0.035) - 0.5) * 0.2 +
        (terrainNoise(x + nx - 307, y + ny + 777, size * 0.012) - 0.5) * 0.09;
  const lobeValue = (lobe: Lobe, wx: number, wy: number) => {
    const dx = wx - lobe.x,
      dy = wy - lobe.y,
      u = (dx * lobe.cos + dy * lobe.sin) / lobe.rx,
      v = (-dx * lobe.sin + dy * lobe.cos) / lobe.ry,
      d = Math.hypot(u, v);
    if (d > 2.3) return -Infinity;
    const angle = Math.atan2(v, u);
    let r = 1;
    for (let i = 0; i < THEME.coastHarmonics.length; i++)
      r += THEME.coastHarmonics[i][1] * Math.sin(angle * THEME.coastHarmonics[i][0] + lobe.phases[i]);
    return 1 - d / Math.max(0.45, r);
  };
  for (const body of bodies) {
    let left: number = size,
      top: number = size,
      right = 0,
      bottom = 0;
    for (const lobe of body.lobes) {
      const extent = Math.max(lobe.rx, lobe.ry) * 2.4 + warp;
      left = Math.min(left, lobe.x - extent);
      right = Math.max(right, lobe.x + extent);
      top = Math.min(top, lobe.y - extent);
      bottom = Math.max(bottom, lobe.y + extent);
    }
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(size, Math.ceil(bottom)); y++)
      for (let x = Math.max(0, Math.floor(left)); x < Math.min(size, Math.ceil(right)); x++) {
        const tile = y * size + x,
          wx = x + 0.5 + (terrainNoise(x + nx + 53, y + ny + 17, size * 0.08) - 0.5) * warp,
          wy = y + 0.5 + (terrainNoise(x + nx - 211, y + ny + 619, size * 0.08) - 0.5) * warp;
        let value = -Infinity;
        for (const lobe of body.lobes) value = Math.max(value, lobeValue(lobe, wx, wy));
        if (value > best[tile]) {
          second[tile] = best[tile];
          best[tile] = value;
          owner[tile] = body.id;
        } else if (value > second[tile]) second[tile] = value;
      }
  }
  const border = Math.max(4, Math.round(size * 0.014));
  for (let tile = 0; tile < count; tile++)
    if (
      owner[tile] &&
      Math.min(tile % size, Math.floor(tile / size), size - 1 - (tile % size), size - 1 - Math.floor(tile / size)) >= border &&
      best[tile] + roughness[tile] > 0 &&
      best[tile] - Math.max(second[tile], -1) > THEME.strait
    )
      regions[tile] = owner[tile];

  // Drop specks, then fold enclosed pools (not yet lakes) back into land.
  const specks = Math.max(12, size * size * 0.00012),
    land = components(size, (tile) => regions[tile] !== 0);
  for (let tile = 0; tile < count; tile++)
    if (regions[tile] && land.areas[land.labels[tile]] < specks) regions[tile] = 0;
  const sea = components(size, (tile) => regions[tile] === 0),
    ocean = sea.areas.reduce((a, area, label) => (area > sea.areas[a] ? label : a), 1),
    pools: number[] = [];
  for (let tile = 0; tile < count; tile++)
    if (sea.labels[tile] && sea.labels[tile] !== ocean) pools.push(tile);
  absorb(size, regions, pools);

  const features = authorLandforms(size, random, bodies, profiles),
    topography = createRegionalTopography(size, seed, THEME.topography, features),
    shore = terrainShoreDistance(size, regions),
    heights = new Float32Array(count);
  for (let tile = 0; tile < count; tile++)
    heights[tile] = regions[tile]
      ? topography.heightAt((tile % size) + 0.5, Math.floor(tile / size) + 0.5, shore[tile])
      : -18;
  formTerrain(size, regions, heights, shore, features, seed, THEME.formation);
  erodeTerrainSlopes(size, regions, heights, THEME.thermalErosion);
  const waterMask = Uint8Array.from(regions, (value) => Number(!value)),
    toLand = terrainShoreDistance(size, waterMask);
  for (let tile = 0; tile < count; tile++)
    if (!regions[tile]) {
      const shelf = 1 - Math.exp(-toLand[tile] / (size * THEME.sea.shelfWidthRatio)),
        rough =
          0.8 +
          0.2 *
            terrainNoise(
              (tile % size) + (seed % 7919),
              Math.floor(tile / size) + (seed % 104729),
              size * 0.12,
            );
      heights[tile] = -(4 + (THEME.sea.maximumDepth - 4) * shelf * rough);
    }
  const rivers: MigrationRiver[] = carveMigrationDrainage(size, regions, heights, continentCount),
    lakes = carveLakes(size, random, regions, heights, shore, continentCount);

  const landmass = (body: Body): MigrationLandmass => ({
      id: body.id,
      x: body.x,
      y: body.y,
      radiusX: body.radius,
      radiusY: body.radius,
      rotation: 0,
      phases: [],
      coves: [],
    }),
    mainlands = bodies.slice(0, continentCount).map(landmass);
  return {
    layout: {
      size,
      seed,
      mainland: mainlands[0],
      mainlands,
      mainlandPattern: "split",
      islands: bodies.slice(continentCount).map(landmass),
      rivers,
      regions,
      landforms: features,
      profiles,
      lakes,
      continentCount,
    },
    shore,
    heights,
  };
}
