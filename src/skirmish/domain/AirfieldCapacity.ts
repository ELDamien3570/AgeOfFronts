import type { Aircraft } from "./Definitions";
import { aircraftSlots } from '../content/DroneSwarms';

/** Incoming flights reserve a berth. Departing flights release their source. */
export function airfieldAircraftCount(
  aircraft: readonly Aircraft[],
  buildingId: number,
): number {
  return aircraftSlots(aircraft.filter(
    (a) =>
      a.health > 0 &&
      (a.transfer
        ? a.transfer.destinationId === buildingId
        : a.airfieldId === buildingId),
  ));
}
