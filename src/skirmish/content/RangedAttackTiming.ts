import { TICK_MS } from "../Protocol";
import type { UnitDefinition } from "../domain/Definitions";
import timings from "./ranged-attack-timing.json";

/** Gameplay-owned values. Art stretches its wind-up to the committed interval. */
export function applyRangedAttackTiming(unit: UnitDefinition): void {
  if (unit.attack.channel !== "ranged") return;
  const timing = (
    timings as Record<string, { prepareMs: number; automatic: boolean }>
  )[unit.id];
  if (!timing || !Number.isFinite(timing.prepareMs) || timing.prepareMs < 500)
    throw new Error(`Missing ranged preparation timing: ${unit.id}`);
  const preparation = {
    ticks: Math.ceil(timing.prepareMs / TICK_MS),
    automatic: timing.automatic,
  };
  unit.attack.preparation = preparation;
  if (unit.rangedAttack) unit.rangedAttack.preparation = preparation;
}
