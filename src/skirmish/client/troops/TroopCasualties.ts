import {
  formationContact,
  formationFootprint,
  type FormationBody,
} from "../../domain/FormationContact";
import { FIXED } from "../../Protocol";

export interface MeleeCasualtyContact {
  x: number;
  y: number;
  nx: number;
  ny: number;
  frontage: number;
}

/** Carry the last drawn offsets to the current presentation endpoint before
 * freezing a death. This matters when stepping a whole tick while paused. */
export function carryCasualtyPoses(
  poses: Map<number, { x: number; y: number; angle: number }>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  turn = 0,
): void {
  if (from.x === to.x && from.y === to.y && !turn) return;
  const c = Math.cos(turn),
    s = Math.sin(turn);
  for (const [id, p] of poses) {
    const x = p.x - from.x,
      y = p.y - from.y;
    poses.set(id, {
      x: to.x + x * c - y * s,
      y: to.y + x * s + y * c,
      angle: p.angle + turn,
    });
  }
}

/** Closest-point contact anchors may be at a corner. Center the receiving
 * segment on the actual overlapping frontage, rather than on that corner. */
export function meleeCasualtyContact(
  source: FormationBody,
  target: FormationBody,
  tick: number,
  hit: { toX: number; toY: number; bearing?: number },
): MeleeCasualtyContact {
  const contact = formationContact(source, target, tick);
  const bearing = hit.bearing ?? Math.atan2(contact.normal.y, contact.normal.x),
    nx = Math.cos(bearing),
    ny = Math.sin(bearing);
  const a = formationFootprint(source, tick).map((p) => -p.x * ny + p.y * nx),
    b = formationFootprint(target, tick).map((p) => -p.x * ny + p.y * nx);
  const low = Math.max(Math.min(...a), Math.min(...b)),
    high = Math.min(Math.max(...a), Math.max(...b));
  const offset =
    high >= low ? (low + high) / 2 - (-hit.toX * ny + hit.toY * nx) : 0;
  return {
    x: (hit.toX - ny * offset) / FIXED,
    y: (hit.toY + nx * offset) / FIXED,
    nx,
    ny,
    frontage: Math.max(0, high - low) / FIXED,
  };
}

/** Distance to an attacked receiving edge, using final drawn world poses.
 * Frontage keeps a wide frontal strike from preferring a central rear soldier
 * over a front soldier beside it. Separate contacts naturally expose flanks.
 */
export function meleeCasualtyScores(
  soldiers: ReadonlyMap<number, { x: number; y: number }>,
  contacts: readonly MeleeCasualtyContact[],
): Map<number, number> | undefined {
  if (!contacts.length || !soldiers.size) return undefined;
  const result = new Map<number, number>();
  for (const [id, p] of soldiers) {
    let score = Infinity;
    for (const contact of contacts) {
      const dx = p.x - contact.x,
        dy = p.y - contact.y;
      const depth = Math.max(0, dx * contact.nx + dy * contact.ny);
      const side = Math.max(
        0,
        Math.abs(-dx * contact.ny + dy * contact.nx) - contact.frontage / 2,
      );
      score = Math.min(score, depth * depth + side * side);
    }
    result.set(id, score);
  }
  return result;
}
