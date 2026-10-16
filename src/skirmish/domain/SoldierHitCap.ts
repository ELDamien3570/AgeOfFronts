import type { Squad } from '../Protocol';
import { HEALTH_SCALE } from './Manpower';

/**
 * C3: a single hit that is not resolved per soldier (a machine-gun burst, a
 * hull gun, a shell) can kill at most the soldier bodies it reaches. Without
 * this, a legacy-scale hull weapon erased a whole soldier squad in one hit.
 * Per-soldier weapons already resolve body by body and are never capped here.
 *
 * Owner decision OD3 ("bodies in reach"):
 * - a direct hit reaches one frontage of the target: ceil(sqrt(capacity))
 *   bodies, the same frontage proxy attackContributors uses for a target;
 * - a blast reaches the target bodies whose slots lie inside its radius.
 */
export function directHitBodies(target: Pick<Squad, 'troops' | 'manpower'>): number {
  return Math.ceil(Math.sqrt(target.manpower?.capacity ?? target.troops));
}

/** Largest HP one non-per-soldier hit may deal to `target`, or Infinity when
 * the target is not a soldier formation on land. */
export function soldierHitCap(target: Pick<Squad, 'troops' | 'manpower' | 'afloat'>, bodies: number): number {
  const m = target.manpower;
  if (!m || m.model !== 'soldiers' || target.afloat) return Infinity;
  return Math.max(1, Math.min(target.troops, bodies)) * (m.hp / HEALTH_SCALE);
}
