import { FIXED, TICKS_PER_SECOND, type Snapshot } from "../Protocol";
import { flightSpeed } from "../content/FlightOperations";

type FlightPose = {
  x: number;
  y: number;
  angle: number;
  size: number;
  radius: number;
};
interface GroundState {
  fieldId: number;
  slot: number;
  x: number;
  y: number;
  ready: boolean;
  changedAt: number;
  departureAt?: number;
  arrivalX: number;
  arrivalY: number;
  arriving: boolean;
  reservesBerth: boolean;
  departureDuration: number;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

/** Cosmetic only. Stable berths and short runway motion never enter snapshots. */
export class AircraftGroundPresentation {
  private readonly states = new Map<number, GroundState>();
  private tick = 0;

  reset(): void {
    this.states.clear();
    this.tick = 0;
  }

  update(snapshot: Snapshot): void {
    this.tick = snapshot.tick;
    const aircraft = snapshot.expansion?.aircraft ?? [];
    const current = new Map(aircraft.map((a) => [a.id, a]));
    const live = new Set(aircraft.map((a) => a.id));
    for (const id of this.states.keys())
      if (!live.has(id)) this.states.delete(id);
    const fields = new Map(
      snapshot.buildings
        .filter((b) => b.type === "airstrip")
        .map((b) => [b.id, b]),
    );
    const occupied = new Map<number, Set<number>>();
    for (const [id, s] of this.states) {
      const a = current.get(id);
      if (
        !a ||
        !s.reservesBerth ||
        a.state === "transferring" ||
        a.airfieldId !== s.fieldId
      )
        continue;
      let slots = occupied.get(s.fieldId);
      if (!slots) occupied.set(s.fieldId, (slots = new Set()));
      slots.add(s.slot);
    }
    for (const a of aircraft) {
      if (a.definitionId === "drone") continue;
      const old = this.states.get(a.id);
      const field = fields.get(a.airfieldId);
      if (!field && !old) continue;
      const fieldId = field?.id ?? old!.fieldId;
      const same = old?.fieldId === fieldId;
      let used = occupied.get(fieldId);
      if (!used) occupied.set(fieldId, (used = new Set()));
      const keepsBerth = same && old!.reservesBerth;
      let slot = same ? old!.slot : 0;
      if (a.state !== "transferring") {
        if (!keepsBerth) {
          slot = 0;
          while (used.has(slot)) slot++;
        }
        used.add(slot);
      }
      const ready = a.state === "ready";
      const changedAt =
        old && old.ready !== ready
          ? snapshot.tick
          : same
            ? old.changedAt
            : -Infinity;
      const x = field ? ((field.tile % snapshot.width) + 0.5) * FIXED : old!.x;
      const y = field
        ? (Math.floor(field.tile / snapshot.width) + 0.5) * FIXED
        : old!.y;
      const arrival = a.transfer && fields.get(a.transfer.destinationId);
      this.states.set(a.id, {
        fieldId,
        slot,
        x,
        y,
        arrivalX: arrival ? ((arrival.tile % snapshot.width) + 0.5) * FIXED : x,
        arrivalY: arrival
          ? (Math.floor(arrival.tile / snapshot.width) + 0.5) * FIXED
          : y,
        arriving: a.state === "returning" || a.state === "transferring",
        reservesBerth: a.state !== "transferring",
        departureDuration:
          old?.ready && !ready && a.target
            ? Math.max(
                0.05,
                Math.min(
                  0.85,
                  (Math.hypot(a.target.x - a.x, a.target.y - a.y) /
                    flightSpeed(a.definitionId) /
                    TICKS_PER_SECOND) *
                    0.45,
                ),
              )
            : (old?.departureDuration ?? 0.85),
        ready,
        changedAt,
        departureAt:
          old?.ready && !ready
            ? snapshot.tick
            : ready
              ? undefined
              : old?.departureAt,
      });
    }
  }

  pose(
    id: number,
    flight: FlightPose,
    scale: number,
    blend: number,
  ): FlightPose & { elevation: number } {
    const state = this.states.get(id);
    if (!state) return { ...flight, elevation: 1 };
    // Six berths on the apron, west of the authored north/south runway.
    const parked = {
      x: state.x + (-0.06 + (state.slot % 3) * 0.36) * FIXED,
      y: state.y + (0.66 + Math.floor(state.slot / 3) * 0.38) * FIXED,
    };
    const threshold = { x: state.x + 1.12 * FIXED, y: state.y + 1.12 * FIXED };
    const runwayEnd = { x: threshold.x, y: state.y - 0.28 * FIXED };
    const groundSize = scale * 0.3;
    const age =
      (this.tick - 1 + Math.max(0, Math.min(1, blend)) - state.changedAt) /
      TICKS_PER_SECOND;
    let x: number,
      y: number,
      size: number,
      angle: number,
      elevation = 0;
    if (state.ready) {
      const t = smooth(age / 0.4);
      x = mix(threshold.x, parked.x, t);
      y = mix(threshold.y, parked.y, t);
      size = groundSize;
      angle = Math.PI / 2;
    } else if (
      state.departureAt !== undefined &&
      age < state.departureDuration
    ) {
      const progress = Math.max(0, age / state.departureDuration);
      if (progress < 0.3) {
        const t = smooth(progress / 0.3);
        x = mix(parked.x, threshold.x, t);
        y = mix(parked.y, threshold.y, t);
        angle =
          Math.atan2(threshold.y - parked.y, threshold.x - parked.x) +
          Math.PI / 2;
        size = groundSize;
      } else if (progress < 0.53) {
        const t = smooth((progress - 0.3) / 0.23);
        x = threshold.x;
        y = mix(threshold.y, runwayEnd.y, t);
        size = groundSize;
        angle = 0;
      } else {
        const t = smooth((progress - 0.53) / 0.47);
        x = mix(runwayEnd.x, flight.x, t);
        y = mix(runwayEnd.y, flight.y, t);
        size = mix(groundSize, flight.size, t);
        angle = Math.atan2(Math.sin(flight.angle), Math.cos(flight.angle)) * t;
        elevation = t;
      }
    } else {
      // Approach the destination runway during the last few simulation steps.
      const distance =
        Math.hypot(flight.x - state.arrivalX, flight.y - state.arrivalY) /
        FIXED;
      const approach = state.arriving ? 1 - smooth(distance / 3) : 0;
      x = mix(flight.x, state.arrivalX + 1.12 * FIXED, approach);
      y = mix(flight.y, state.arrivalY + 1.12 * FIXED, approach);
      size = mix(flight.size, groundSize, approach);
      angle = flight.angle;
      elevation = 1 - approach;
    }
    return { x, y, size, angle, elevation, radius: size * Math.SQRT1_2 + 2 };
  }
}
