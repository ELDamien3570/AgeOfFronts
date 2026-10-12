import { readyFraction, remainingHealth, HEALTH_SCALE } from './Manpower';
import type { Squad } from "../Protocol";
import {
  attackContributors,
  promotionLevel,
  XP_THRESHOLDS,
} from "./Combat";
import type { UnitDefinition } from "./Definitions";
import type { Expansion } from "./Expansion";
import { formationEnvelope,layoutGrid,formationDoctrine,type FormationShape } from './FormationGeometry';
import { engagementEstimate } from './TacticalEstimate';

export interface Cohort {
  shape:FormationShape;
  deployed:boolean;
  count:number;
  width:number;
  unit: UnitDefinition;
  strength: number;
  xp: number;
  contributors: number;
  health: number;
}
/** Advisory comparisons use the combat resolver, never a second damage rule.
 * Aggregate by authored definition so evaluation scales with army composition. */
export function combatCohorts(
  expansion: Expansion,
  squads: readonly Squad[],
): Cohort[] {
  const rows = new Map<string, Cohort>();
  for (const squad of squads) {
    if (squad.troops <= 0 || squad.embarkedOn !== null || squad.refit) continue;
    const unit = expansion.unit(squad),
      level = promotionLevel(squad.xp ?? 0),
      shape=squad.formation?formationEnvelope(squad,expansion.world.tick).shape:'mass',
      deployed=!!squad.formation&&!squad.formation.transition&&shape!=='column',
      key = `${unit.id}:${level}:${shape}:${deployed}`;
    const cohort = rows.get(key) ?? {
      unit,
      strength: 0,
      xp: XP_THRESHOLDS[level - 1],
      contributors: 0,
      health: 0,
      shape,deployed,count:0,width:0,
    };
    cohort.strength += readyFraction(squad);
    cohort.count++;
    cohort.width+=layoutGrid(squad.troops,shape,formationDoctrine(squad.definitionId),squad.formation?.frontage).columns;
    cohort.contributors += attackContributors(squad,unit.attack);
    cohort.health += squad.manpower ? remainingHealth(squad)/HEALTH_SCALE : squad.troops;
    rows.set(key, cohort);
  }
  return [...rows.values()];
}
export function combatAdvantage(
  own: readonly Cohort[],
  enemy: readonly Cohort[],
): number {
  if (!own.length) return 0;
  if (!enemy.length) return 8;
  return engagementEstimate(own,enemy).advantage;
}
