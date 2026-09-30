import type { GameMap } from "../core/game/GameMap";
import { CoastIndex } from "./CoastIndex";
import type { LandPaths, WaterPaths } from "./Pathfinding";
import type { BoardingMeeting, Ship, Squad } from "./Protocol";
import { FIXED } from "./Protocol";

function tileOf(map: GameMap, unit: Pick<Squad, "x" | "y">): number {
  return map.ref(Math.floor(unit.x / FIXED), Math.floor(unit.y / FIXED));
}

export function boardingMeeting(
  map: GameMap,
  land: LandPaths,
  water: WaterPaths,
  owners: Uint8Array,
  ship: Ship,
  squads: Squad[],
  coast = new CoastIndex(map, land, water),
): BoardingMeeting | null {
  const squadTiles = squads.map((s) => tileOf(map, s));
  const shipTile = tileOf(map, ship);
  const component = land.component[squadTiles[0]];
  if (
    !squadTiles.length ||
    !component ||
    squadTiles.some((t) => land.component[t] !== component)
  )
    return null;
  // max Manhattan distance to a set equals the maximum of its four signed
  // coordinate extrema. Selection size no longer multiplies every coast edge.
  const extrema = [-Infinity, -Infinity, -Infinity, -Infinity];
  for (const tile of squadTiles) {
    const x = map.x(tile),
      y = map.y(tile);
    const values = [x + y, x - y, -x + y, -x - y];
    for (let i = 0; i < 4; i++) extrema[i] = Math.max(extrema[i], values[i]);
  }
  let best: BoardingMeeting | null = null,
    score = Infinity;
  for (const { landTile: shore, waterTile: sea } of coast.candidates(
    component,
    water.component[shipTile],
  )) {
    const x = map.x(shore),
      y = map.y(shore);
    // Prefer an already friendly coast; otherwise squads can occupy it first.
    const candidate =
      (owners[shore] === ship.playerId ? 0 : 100000) +
      Math.max(
        extrema[0] - x - y,
        extrema[1] - x + y,
        extrema[2] + x - y,
        extrema[3] + x + y,
      ) *
        70 +
      map.manhattanDist(shipTile, sea) * 56;
    if (candidate < score) {
      score = candidate;
      best = {
        landTile: shore,
        waterTile: sea,
        squadIds: squads.map((s) => s.id),
      };
    }
  }
  return best;
}

export function firingPosition(
  map: GameMap,
  paths: LandPaths,
  squad: Squad,
  target: Squad,
  range: number,
): number | null {
  const origin = tileOf(map, squad);
  const radius = Math.ceil(range / FIXED);
  const tx = Math.floor(target.x / FIXED),
    ty = Math.floor(target.y / FIXED);
  let best: number | null = null,
    score = Infinity;
  for (
    let y = Math.max(0, ty - radius);
    y <= Math.min(map.height() - 1, ty + radius);
    y++
  )
    for (
      let x = Math.max(0, tx - radius);
      x <= Math.min(map.width() - 1, tx + radius);
      x++
    ) {
      const tile = map.ref(x, y);
      if (!paths.connected(origin, tile)) continue;
      const dx = x * FIXED + FIXED / 2 - target.x,
        dy = y * FIXED + FIXED / 2 - target.y;
      const distance = dx * dx + dy * dy;
      if (distance > range * range) continue;
      const outerBand = distance >= (range - FIXED / 2) ** 2;
      const gap = range * range - distance;
      const approach = map.manhattanDist(origin, tile);
      const candidate = outerBand ? approach : 100000 + gap * 100 + approach;
      if (candidate < score) {
        best = tile;
        score = candidate;
      }
    }
  return best;
}
