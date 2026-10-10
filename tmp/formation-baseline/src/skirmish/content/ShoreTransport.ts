import { AGES, type VesselDefinition } from "../domain/Definitions";
import { TRANSPORT_CAPACITIES, VESSELS } from "./Units";

export const SHORE_TRANSPORT_CAPACITIES = TRANSPORT_CAPACITIES;

// A completed hull technology grants shore embarkation without purchasing a
// permanent vessel. Vessel combat/speed stay shared with the naval catalogue.
export function shoreTransportDefinition(completed: readonly string[]): VesselDefinition | undefined {
  return VESSELS.filter(
    (v) => v.kind === "transport" && completed.includes(v.technologyId),
  ).slice(-1)[0];
}

export function shoreTransportCapacity(completed: readonly string[]): number {
  const vessel = shoreTransportDefinition(completed);
  return vessel ? SHORE_TRANSPORT_CAPACITIES[AGES.indexOf(vessel.age)] : 0;
}
