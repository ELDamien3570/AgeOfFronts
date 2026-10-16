import type { Squad } from "../Protocol";
import { CONTACT } from "../content/TacticalRules";
import { nearestContactPoint } from "./ContactFront";
import {
  convexHull,
  formationContact,
  formationFootprints,
} from "./FormationContact";
import {
  formationDoctrine,
  formationEnvelope,
  formationSlots,
} from "./FormationGeometry";
import { HEALTH_SCALE } from "./Manpower";
import { polygonSweepEntry } from "./ProjectileCollision";

/** Temporary contact addresses, never soldier entities or persistent health.
 * A rear body is screened by bodies ahead of it, even within weapon range.
 * Charge penetration admits only the additional depth of its physical impact.
 */
export function meleeReceivers(
  source: Squad,
  target: Squad,
  tick: number,
  reach: number,
  penetration = 0,
): number[] {
  const contact = formationContact(source, target, tick),
    n = contact.normal;
  const angle = formationEnvelope(target, tick).angle,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const doctrine = formationDoctrine(target.definitionId);
  const halfSide =
    (Math.abs(-n.y * c + n.x * s) * doctrine.bodyWidth +
      Math.abs(n.y * s + n.x * c) * doctrine.bodyDepth) /
    2;
  const bodies = formationFootprints(source, tick);
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => ({
      x: (x * doctrine.bodyWidth * c) / 2 - (y * doctrine.bodyDepth * s) / 2,
      y: (x * doctrine.bodyWidth * s) / 2 + (y * doctrine.bodyDepth * c) / 2,
    })),
  );
  const receivingBodies = bodies.map((body) =>
    convexHull(
      body.flatMap((p) => corners.map((q) => ({ x: p.x + q.x, y: p.y + q.y }))),
    ),
  );
  const slots = formationSlots(target, tick)
    .map((p, id) => {
      const x = target.x + p.x * c - p.y * s,
        y = target.y + p.x * s + p.y * c;
      return { id, x, y, depth: x * n.x + y * n.y, side: -x * n.y + y * n.x };
    })
    .sort((a, b) => a.depth - b.depth || a.id - b.id);
  const bySide = [...slots].sort((a, b) => a.side - b.side || a.id - b.id);
  const result: { id: number; distance: number }[] = [];
  for (const p of slots) {
    // Merge foreground silhouettes across this body's width. This also works
    // for oblique contacts, wedges, reforming bodies and bent travel columns.
    let edge = p.side - halfSide;
    const end = p.side + halfSide;
    for (const q of bySide) {
      if (
        q.depth >= p.depth - penetration - CONTACT.enter ||
        q.side + halfSide <= edge
      )
        continue;
      if (q.side - halfSide > edge + CONTACT.enter) break;
      edge = Math.max(edge, q.side + halfSide);
    }
    if (edge >= end - CONTACT.enter) continue;
    if (
      !receivingBodies.some(
        (body) =>
          polygonSweepEntry(
            p,
            p,
            body,
            reach + penetration + CONTACT.release,
          ) !== null,
      )
    )
      continue;
    let distance = Infinity;
    for (const body of bodies) {
      if (polygonSweepEntry(p, p, body) !== null) {
        distance = 0;
        break;
      }
      const nearest = nearestContactPoint(p, body);
      if (nearest)
        distance = Math.min(
          distance,
          Math.hypot(p.x - nearest.x, p.y - nearest.y),
        );
    }
    result.push({ id: p.id, distance });
  }
  return result
    .sort((a, b) => a.distance - b.distance || a.id - b.id)
    .map((p) => p.id);
}

interface Claim<T> {
  target: Squad;
  slots: readonly number[];
  damage: number;
  fact: T;
}

/** One simultaneous combat step. Overlapping strikes share each exposed body's
 * health budget; excess damage is discarded, never banked for a future rank.
 * Fractional wounds stay in the existing squad pool. Its one wounded body's
 * remaining health is charged once against the first addressed contact slot.
 */
export class MeleeDamageBatch<T> {
  private readonly claims: Claim<T>[] = [];
  add(
    target: Squad,
    slots: readonly number[],
    contributors: number,
    damage: number,
    fact: T,
  ): void {
    if (damage <= 0 || contributors <= 0) return;
    this.claims.push({
      target,
      slots: slots.slice(0, Math.ceil(contributors)),
      damage,
      fact,
    });
  }
  resolve(apply: (fact: T, damage: number) => void): void {
    const targets = new Map<
      number,
      { hp: number; wounds: number; first: number; totals: Map<number, number> }
    >();
    for (const claim of this.claims) {
      if (!claim.slots.length) continue;
      let target = targets.get(claim.target.id);
      if (!target) {
        target = {
          hp: claim.target.manpower!.hp / HEALTH_SCALE,
          wounds: claim.target.manpower!.wounds / HEALTH_SCALE,
          first: Infinity,
          totals: new Map(),
        };
        targets.set(claim.target.id, target);
      }
      for (const slot of claim.slots) {
        target.first = Math.min(target.first, slot);
        target.totals.set(
          slot,
          (target.totals.get(slot) ?? 0) + claim.damage / claim.slots.length,
        );
      }
    }
    for (const claim of this.claims) {
      const target = targets.get(claim.target.id);
      if (!target || !claim.slots.length) continue;
      let applied = 0;
      for (const slot of claim.slots) {
        const capacity =
          target.hp - (slot === target.first ? target.wounds : 0);
        applied +=
          (claim.damage / claim.slots.length) *
          Math.min(1, capacity / target.totals.get(slot)!);
      }
      if (applied > 0) apply(claim.fact, applied);
    }
    this.claims.length = 0;
  }
}
