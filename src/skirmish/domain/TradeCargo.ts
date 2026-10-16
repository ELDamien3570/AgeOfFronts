import { LAND_TRADE_CAPACITIES, stackCargoPercent } from "../content/Economy";
import { VESSELS } from "../content/Units";
import { TICKS_PER_SECOND } from "../Protocol";
import { AGES } from "./Definitions";
import { cargoHandlingPercent, landTraderTier, portCargoPercent, vesselEffects, type Research } from "./ResearchEffects";

/** Shared research facts for shipment sizes and per-port cargo storage. */
export function tradeCargoEffects(research: Research) {
  const tier = landTraderTier(research);
  const vessel = VESSELS.filter(v => v.kind === "trade" && research.includes(v.technologyId)).slice(-1)[0];
  return {
    landCapacity: LAND_TRADE_CAPACITIES[tier],
    landDefinition: `${AGES[tier].toLowerCase()}-trader`,
    seaCapacity: vessel ? vesselEffects(vessel, research).capacity! : LAND_TRADE_CAPACITIES[tier],
    seaDefinition: vessel?.id ?? `${AGES[tier].toLowerCase()}-trader`,
    seaSpeed: vessel?.speed ?? 1400 / TICKS_PER_SECOND,
    handling: cargoHandlingPercent(research) * portCargoPercent(research),
  };
}

export function tradeCargoCapacity(effects: {landCapacity: number; seaCapacity: number; handling: number}, naval: boolean, stack = 1): number {
  return Math.floor(((naval ? effects.seaCapacity : effects.landCapacity) * effects.handling * stackCargoPercent(stack)) / 1000000);
}
