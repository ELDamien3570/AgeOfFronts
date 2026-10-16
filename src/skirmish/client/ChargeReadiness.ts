import { UNIT } from "../content/Units";
import { TICKS_PER_SECOND, type Squad } from "../Protocol";
import { isCavalryTroopClass } from '../domain/Definitions';
import { recoveredChargeStrength } from '../domain/ChargeStrength';
import { assaultBonusStart } from '../domain/CavalryAssault';

type ChargeView = Pick<Squad, "definitionId" | "charge" | "chargeReadyTick" | "afloat" | "refit" | "x" | "y" | "cavalryEngagement">;

/** The squad's charge attack, or undefined for units that cannot charge. */
export function chargeProfile(squad: Pick<Squad, "definitionId">) {
  return UNIT.get(squad.definitionId ?? "")?.charge;
}

/** Impact stamina, independent of mounted rush command availability. */
export function chargeReadiness(squad: ChargeView, tick: number): number | undefined {
  const profile = chargeProfile(squad);
  if (!profile) return undefined;
  const a=squad.cavalryEngagement?.assault;
  const bonusStart=a?assaultBonusStart(a):undefined;
  if(a && bonusStart!==undefined && tick<a.bonusUntilTick && squad.cavalryEngagement?.phase!=='withdrawing')
    return Math.max(0,Math.min(1,(a.bonusUntilTick-tick)/Math.max(1,a.bonusUntilTick-bonusStart)));
  if (squad.charge) return 0;
  return recoveredChargeStrength(squad.chargeReadyTick,tick,profile.cooldownTicks);
}

export function chargeStatus(squad: Pick<Squad,'cavalryEngagement'>,tick:number):string|undefined {
  const e=squad.cavalryEngagement,a=e?.assault;
  if(e?.phase==='withdrawing')return 'Withdrawing';
  if(a)return `Assault · ${chargeBonusLabel(squad,tick)} · ${a.penetrates?'penetrating':'line holding'}`;
  return undefined;
}

/** Shared by the battlefield label, selected-unit HUD and preview. */
export function chargeBonusLabel(squad: Pick<Squad,'cavalryEngagement'>,tick:number):string|undefined {
  const a=squad.cavalryEngagement?.assault;
  if(!a)return undefined;
  return a.pendingBonusStrength!==undefined?'charge bonus armed':tick<a.bonusUntilTick?
    `${((a.bonusUntilTick-tick)/TICKS_PER_SECOND).toFixed(1)}s charge bonus`:'normal damage';
}

/** Whether this squad would be admitted to a charge at the given point now. */
export function canCharge(squad: ChargeView, tick: number, x: number, y: number): boolean {
  const profile = chargeProfile(squad);
  const mounted=isCavalryTroopClass(UNIT.get(squad.definitionId??'')?.troopClass);
  return !!profile && (mounted || chargeReadiness(squad, tick) === 1) && !squad.afloat && !squad.refit &&
    Math.hypot(squad.x - x, squad.y - y) <= profile.maximumDistance;
}
