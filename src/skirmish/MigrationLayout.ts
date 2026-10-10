import { PseudoRandom } from "../core/PseudoRandom";
import { MIGRATION_THEME } from "./content/Migration";
import { createMigrationCoves, migrationCoastDistance } from "./MigrationCoast";
import { carveMigrationDrainage } from "./MigrationHydrology";
import { migrationTopography } from "./MigrationTopography";
import { migrationValleyRoute } from "./MigrationValleyRoute";
import type { Landform } from "./RegionalTopography";
import { erodeTerrainSlopes } from "./TerrainErosion";
import { terrainNoise } from "./TerrainNoise";
import { terrainShoreDistance } from "./TerrainShoreDistance";
import { formTerrain } from "./TerrainFormation";

export interface MigrationCove {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  cos: number;
  sin: number;
  phases: readonly number[];
  mouth: readonly { x: number; y: number; width: number }[];
  bounds: readonly [number, number, number, number];
}

export interface MigrationLandmass {
  id: number;
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  phases: readonly number[];
  coves: readonly MigrationCove[];
}
export interface MigrationRiver {
  kind: "river" | "channel";
  points: readonly { x: number; y: number; width: number }[];
}
export interface MigrationLayout {
  size: number;
  seed: number;
  mainland: MigrationLandmass;
  mainlands: readonly MigrationLandmass[];
  mainlandPattern: "single" | "split";
  islands: readonly MigrationLandmass[];
  rivers: readonly MigrationRiver[];
  regions: Uint8Array;
  landforms: readonly Landform[];
}

/** Geometry owns land/water topology; appearance and resources consume its fields. */
export function buildMigrationLayout(
  size: 250 | 500 | 1000,
  seed: number,
): {
  layout: MigrationLayout;
  shore: Float32Array;
  heights: Float32Array;
} {
  const random = new PseudoRandom(seed ^ 0x472bf319),
    regions = new Uint8Array(size * size),
    mainlandCount = random.nextInt(1, 4),
    islands: MigrationLandmass[] = [],
    rivers: MigrationRiver[] = [];
  const heights = new Float32Array(size * size).fill(-18),
    topography = migrationTopography(size, seed),
    heightAt = topography.heightAt;
  const landmass = (
    id: number,
    x: number,
    y: number,
    radius: number,
  ): MigrationLandmass => {
    const stretch = random.nextFloat(0.82, 1.2);
    const mass: MigrationLandmass = {
      id,
      x,
      y,
      radiusX: radius * stretch,
      radiusY: radius / stretch,
      rotation: random.nextFloat(0, Math.PI * 2),
      phases: MIGRATION_THEME.coastHarmonics.map(() =>
        random.nextFloat(0, Math.PI * 2),
      ),
      coves: [],
    };
    mass.coves = createMigrationCoves(mass, random);
    return mass;
  };
  const continent = landmass(
    1,
    size * (0.5 + random.nextFloat(-0.025, 0.025)),
    size * (0.5 + random.nextFloat(-0.025, 0.025)),
    size *
      (MIGRATION_THEME.mainlandRadiusRatio + (mainlandCount > 1 ? 0.025 : 0)),
  );
  const bounds = (mass: MigrationLandmass) => {
    const extent = Math.max(mass.radiusX, mass.radiusY) * 1.55 + 4;
    return [
      Math.max(0, Math.floor(mass.x - extent)),
      Math.max(0, Math.floor(mass.y - extent)),
      Math.min(size, Math.ceil(mass.x + extent)),
      Math.min(size, Math.ceil(mass.y + extent)),
    ];
  };
  const stamp = (mass: MigrationLandmass, reserveMainland: boolean) => {
    const [left, top, right, bottom] = bounds(mass);
    for (let y = top; y < bottom; y++)
      for (let x = left; x < right; x++) {
        const tile = y * size + x;
        if (
          regions[tile] ||
          migrationCoastDistance(mass, x + 0.5, y + 0.5) <= 0
        )
          continue;
        if (
          reserveMainland &&
          migrationCoastDistance(continent, x + 0.5, y + 0.5) >
            -size * MIGRATION_THEME.seaGapRatio
        )
          continue;
        // Keep a water passage between adjacent outer islands.
        if (
          reserveMainland &&
          islands.some(
            (other) =>
              other.id !== mass.id &&
              migrationCoastDistance(other, x + 0.5, y + 0.5) >
                -Math.max(3, size * 0.006),
          )
        )
          continue;
        regions[tile] = mass.id;
        heights[tile] = heightAt(
          x + 0.5,
          y + 0.5,
          migrationCoastDistance(mass, x + 0.5, y + 0.5),
        );
      }
  };
  stamp(continent, false);

  const visited = new Uint8Array(regions.length),
    queue = new Int32Array(regions.length),
    minimumMainlandArea =
      size * size * MIGRATION_THEME.minimumMainlandAreaRatio;
  let majorPieces = 1;
  const countMainlands = () => {
    visited.fill(0);
    let count = 0;
    for (let tile = 0; tile < regions.length; tile++) {
      if (regions[tile] !== 1 || visited[tile]) continue;
      let tail = 1;
      queue[0] = tile;
      visited[tile] = 1;
      const visit = (next: number) => {
        if (
          next < 0 ||
          next >= regions.length ||
          visited[next] ||
          regions[next] !== 1
        )
          return;
        visited[next] = 1;
        queue[tail++] = next;
      };
      for (let head = 0; head < tail; head++) {
        const current = queue[head],
          x = current % size;
        if (x > 0) visit(current - 1);
        if (x < size - 1) visit(current + 1);
        visit(current - size);
        visit(current + size);
      }
      if (tail >= minimumMainlandArea) count++;
    }
    return count;
  };
  const carve = (river: MigrationRiver) => {
    const changed: number[] = [];
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy,
        padding = Math.max(a.width, b.width) + 1;
      for (
        let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - padding));
        y < Math.min(size, Math.ceil(Math.max(a.y, b.y) + padding));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - padding));
          x < Math.min(size, Math.ceil(Math.max(a.x, b.x) + padding));
          x++
        ) {
          const t = Math.max(
              0,
              Math.min(
                1,
                ((x + 0.5 - a.x) * dx + (y + 0.5 - a.y) * dy) / length2,
              ),
            ),
            width = a.width + (b.width - a.width) * t;
          const tile = y * size + x;
          if (
            regions[tile] === 1 &&
            Math.hypot(x + 0.5 - a.x - dx * t, y + 0.5 - a.y - dy * t) <= width
          ) {
            regions[tile] = 0;
            changed.push(tile);
          }
        }
    }
    const count = countMainlands(),
      accepted =
        river.kind === "channel"
          ? count > majorPieces && count <= MIGRATION_THEME.maximumMainlands
          : count === majorPieces;
    if (!accepted) {
      for (const tile of changed) regions[tile] = 1;
      return false;
    }
    majorPieces = count;
    rivers.push(river);
    return true;
  };
  const channelAngle = random.nextFloat(0, Math.PI * 2);
  if (mainlandCount > 1) {
    for (let i = 0; i < mainlandCount - 1; i++) {
      if (majorPieces === MIGRATION_THEME.maximumMainlands) break;
      const across =
        mainlandCount === 2
          ? 0
          : (i === 0 ? -1 : 1) *
            Math.min(continent.radiusX, continent.radiusY) *
            0.32;
      for (
        let attempt = 0;
        attempt < MIGRATION_THEME.channelPlacementAttempts;
        attempt++
      ) {
        const route = migrationValleyRoute(
          size,
          regions,
          heights,
          continent,
          channelAngle + attempt * 0.21,
          across * (attempt === 0 ? 1 : 0.5),
          Math.max(3, size * random.nextFloat(0.009, 0.014)),
        );
        if (route && carve(route)) break;
      }
    }
    if (majorPieces < 2)
      throw new Error("Migration could not separate the mainland");
  }
  // Identify the large mainland pieces after carving, and discard tiny coastal
  // slivers. The remaining islands are generated around these real landforms.
  visited.fill(0);
  const pieces: number[][] = [];
  for (let tile = 0; tile < regions.length; tile++) {
    if (regions[tile] !== 1 || visited[tile]) continue;
    let tail = 1;
    queue[0] = tile;
    visited[tile] = 1;
    const visit = (next: number) => {
      if (
        next >= 0 &&
        next < regions.length &&
        regions[next] === 1 &&
        !visited[next]
      ) {
        visited[next] = 1;
        queue[tail++] = next;
      }
    };
    for (let head = 0; head < tail; head++) {
      const current = queue[head],
        x = current % size;
      if (x > 0) visit(current - 1);
      if (x < size - 1) visit(current + 1);
      visit(current - size);
      visit(current + size);
    }
    const tiles = Array.from(queue.subarray(0, tail));
    if (tail < minimumMainlandArea) for (const t of tiles) regions[t] = 0;
    else pieces.push(tiles);
  }
  pieces.sort((a, b) => b.length - a.length);
  const mainlands = pieces.map((tiles, index) => {
    let sx = 0,
      sy = 0,
      left: number = size,
      top: number = size,
      right = 0,
      bottom = 0;
    for (const tile of tiles) {
      const x = tile % size,
        y = Math.floor(tile / size);
      regions[tile] = index + 1;
      sx += x;
      sy += y;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    const cx = sx / tiles.length,
      cy = sy / tiles.length;
    let nearest = tiles[0],
      distance = Infinity;
    for (const tile of tiles) {
      const d = ((tile % size) - cx) ** 2 + (Math.floor(tile / size) - cy) ** 2;
      if (d < distance) {
        nearest = tile;
        distance = d;
      }
    }
    return {
      ...continent,
      id: index + 1,
      x: (nearest % size) + 0.5,
      y: Math.floor(nearest / size) + 0.5,
      radiusX: (right - left + 1) / 2,
      radiusY: (bottom - top + 1) / 2,
    };
  });
  if (!mainlands.length) throw new Error("Migration produced no mainland");
  const islandCounts = new PseudoRandom(seed ^ 0x367cab29),
    outerCount = islandCounts.nextInt(
      MIGRATION_THEME.minimumIslands,
      MIGRATION_THEME.maximumIslands + 1,
    ),
    phase = random.nextFloat(0, Math.PI * 2);
  for (let i = 0; i < outerCount; i++) {
    const angle =
        phase +
        ((i + random.nextFloat(-0.13, 0.13)) * Math.PI * 2) / outerCount,
      dx = Math.cos(angle),
      dy = Math.sin(angle),
      ring =
        (size * random.nextFloat(0.455, 0.48)) /
        Math.max(Math.abs(dx), Math.abs(dy)),
      island = landmass(
        mainlands.length + islands.length + 1,
        size / 2 + dx * ring,
        size / 2 + dy * ring,
        Math.max(
          MIGRATION_THEME.minimumIslandRadius,
          size * MIGRATION_THEME.islandRadiusRatio,
        ) * random.nextFloat(0.85, 1.18),
      );
    stamp(island, true);
    islands.push(island);
  }
  const [minimum, maximum] = MIGRATION_THEME.smallIslandCounts[size],
    smallCount = islandCounts.nextInt(minimum, maximum + 1),
    smallScale = Math.sqrt(size / 250);
  let placed = 0;
  for (
    let attempt = 0;
    attempt < MIGRATION_THEME.islandPlacementAttempts && placed < smallCount;
    attempt++
  ) {
    const radius =
        random.nextFloat(...MIGRATION_THEME.smallIslandRadius) * smallScale,
      margin = radius * 1.9 + 5,
      island = landmass(
        mainlands.length + islands.length + 1,
        random.nextFloat(margin, size - margin),
        random.nextFloat(margin, size - margin),
        radius,
      );
    if (
      migrationCoastDistance(continent, island.x, island.y) >
      -(radius * 1.7 + size * MIGRATION_THEME.seaGapRatio)
    )
      continue;
    const [left, top, right, bottom] = bounds(island);
    let clear = true;
    // Reserve the whole irregular footprint and a minimum sea passage.
    for (
      let y = Math.max(0, top - 4);
      y < Math.min(size, bottom + 4) && clear;
      y++
    )
      for (let x = Math.max(0, left - 4); x < Math.min(size, right + 4); x++)
        if (
          regions[y * size + x] &&
          migrationCoastDistance(island, x + 0.5, y + 0.5) > -4
        ) {
          clear = false;
          break;
        }
    if (!clear) continue;
    stamp(island, true);
    islands.push(island);
    placed++;
  }

  // Fold isolated corner pools into adjacent land. Every water tile must be
  // reachable from the open sea, including the river mouths and main channels.
  const seaRegions = new Int32Array(regions.length);
  let component = 0,
    largestSea = 0,
    largestSize = 0;
  for (let tile = 0; tile < regions.length; tile++) {
    if (regions[tile] || seaRegions[tile]) continue;
    component++;
    let tail = 1;
    queue[0] = tile;
    seaRegions[tile] = component;
    const visit = (next: number) => {
      if (
        next >= 0 &&
        next < regions.length &&
        !regions[next] &&
        !seaRegions[next]
      ) {
        seaRegions[next] = component;
        queue[tail++] = next;
      }
    };
    for (let head = 0; head < tail; head++) {
      const current = queue[head],
        x = current % size;
      if (x > 0) visit(current - 1);
      if (x < size - 1) visit(current + 1);
      visit(current - size);
      visit(current + size);
    }
    if (tail > largestSize) {
      largestSea = component;
      largestSize = tail;
    }
  }
  // Multi-source propagation assigns enclosed pools to an adjacent region,
  // rather than guessing by the distance to an island's centre.
  let tail = 0;
  for (let tile = 0; tile < regions.length; tile++)
    if (regions[tile]) queue[tail++] = tile;
  for (let head = 0; head < tail; head++) {
    const current = queue[head],
      x = current % size;
    const fill = (next: number) => {
      if (
        next < 0 ||
        next >= regions.length ||
        regions[next] ||
        seaRegions[next] === largestSea
      )
        return;
      regions[next] = regions[current];
      queue[tail++] = next;
    };
    if (x > 0) fill(current - 1);
    if (x < size - 1) fill(current + 1);
    fill(current - size);
    fill(current + size);
  }
  const shore = terrainShoreDistance(size, regions);
  for (let tile = 0; tile < regions.length; tile++)
    heights[tile] = regions[tile]
      ? heightAt(
          (tile % size) + 0.5,
          Math.floor(tile / size) + 0.5,
          shore[tile],
        )
      : -18;
  formTerrain(size, regions, heights, shore, topography.features, seed, MIGRATION_THEME.formation);
  erodeTerrainSlopes(size, regions, heights, MIGRATION_THEME.thermalErosion);
  const waterMask = Uint8Array.from(regions, (value) => Number(!value)),
    toLand = terrainShoreDistance(size, waterMask);
  for (let tile = 0; tile < regions.length; tile++)
    if (!regions[tile]) {
      const shelf =
          1 -
          Math.exp(
            -toLand[tile] / (size * MIGRATION_THEME.sea.shelfWidthRatio),
          ),
        rough =
          0.8 +
          0.2 *
            terrainNoise(
              (tile % size) + (seed % 7919),
              Math.floor(tile / size) + (seed % 104729),
              size * 0.12,
            );
      heights[tile] = -(
        4 +
        (MIGRATION_THEME.sea.maximumDepth - 4) * shelf * rough
      );
    }
  rivers.push(
    ...carveMigrationDrainage(size, regions, heights, mainlands.length),
  );
  return {
    layout: {
      size,
      seed,
      mainland: mainlands[0],
      mainlands,
      mainlandPattern: mainlandCount === 1 ? "single" : "split",
      islands,
      rivers,
      regions,
      landforms: topography.features,
    },
    shore,
    heights,
  };
}
