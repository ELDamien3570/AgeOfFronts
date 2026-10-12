import { FIXED } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { distanceSquared } from "../SquadGeometry";
import {
  CONTACT_TOLERANCE,
  formationFootprints,
  polygonContact,
  type FormationBody,
} from "./FormationContact";
import type { Fortifications } from "./Fortifications";

// Both order planning and combat use the actual weapon range and target
// footprint. The target itself may block movement; other hostile cells block
// the shot. A wall span can be attacked at any exposed cell.
export function structureContact(from: WorldPoint | FormationBody, tile: number, width: number, tick = 0) {
  if (!("formation" in from) || !from.formation || ("afloat" in from && from.afloat)) return undefined;
  const x = (tile % width) * FIXED, y = Math.floor(tile / width) * FIXED;
  return formationFootprints(from as FormationBody, tick).map(part => polygonContact(part, [
    { x, y }, { x: x + FIXED, y }, { x: x + FIXED, y: y + FIXED }, { x, y: y + FIXED },
  ])).reduce((a, b) => b.gap < a.gap ? b : a);
}

export function structureAim(
  from: WorldPoint | FormationBody,
  tiles: readonly number[],
  range: number | ((target:WorldPoint)=>number),
  owner: number,
  width: number,
  forts: Fortifications,
  tick = 0,
): (WorldPoint & { source?: WorldPoint }) | undefined {
  const footprint = new Set(tiles);
  let best: (WorldPoint & { source?: WorldPoint }) | undefined,
    bestDistance = Infinity;
  for (const tile of tiles) {
    const point = {
        x: ((tile % width) + 0.5) * FIXED,
        y: (Math.floor(tile / width) + 0.5) * FIXED,
      },
      contact = structureContact(from, tile, width, tick);
    const distance = contact ? contact.gap ** 2 : distanceSquared(from, point),
      aim = contact ? contact.target : point;
    if (
      distance > ((typeof range==='number'?range:range(point)) + (contact ? CONTACT_TOLERANCE : 0)) ** 2 ||
      distance >= bestDistance
    )
      continue;
    if (
      forts
        .segmentTiles(from, aim)
        .some((t) => !footprint.has(t) && forts.blocked(t, owner))
    )
      continue;
    best = { ...aim, ...(contact ? { source: contact.source } : {}) };
    bestDistance = distance;
  }
  return best;
}
