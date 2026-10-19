import { LAND_TRADE_CAPACITIES, stackCargoPercent } from "../content/Economy";
import { VESSELS } from "../content/Units";
import { TICKS_PER_SECOND } from "../Protocol";
import { AGES } from "./Definitions";
import { cargoHandlingPercent, landTraderTier, portCargoPercent, vesselEffects, type Research } from "./ResearchEffects";

type TradeCargoEffects = Readonly<ReturnType<typeof computeTradeCargoEffects>>;
// Completed-research arrays are append-only or replaced wholesale, so identity
// and length determine their contents; the facts depend on nothing else.
const effectsByResearch = new WeakMap<Research, { count: number; value: TradeCargoEffects }>();
/** Shared research facts for shipment sizes and per-producer cargo storage. */
export function tradeCargoEffects(research: Research): TradeCargoEffects {
  const known = effectsByResearch.get(research);
  if (known && known.count === research.length) return known.value;
  const value = Object.freeze(computeTradeCargoEffects(research));
  effectsByResearch.set(research, { count: research.length, value });
  return value;
}
function computeTradeCargoEffects(research: Research) {
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
