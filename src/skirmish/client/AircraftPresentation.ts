import type { Aircraft } from "../domain/Definitions";
import { FIXED, type Snapshot } from "../Protocol";

interface AircraftState {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  baseX: number;
  baseY: number;
  ascentDistance: number;
  angle: number;
  tick: number;
}

const PARKED_SIZE = 28;
// At the current flight speed, ascent/descent spans about three seconds.
// This is cosmetic height derived from the route, never simulation altitude.
const ASCENT_DISTANCE = 42 * FIXED;

export class AircraftPresentation {
  private readonly aircraft = new Map<number, AircraftState>();

  reset(): void {
    this.aircraft.clear();
  }

  update(snapshot: Snapshot): void {
    const bases = new Map(snapshot.buildings.map((b) => [b.id, b]));
    const live = new Set<number>();
    for (const aircraft of snapshot.expansion?.aircraft ?? []) {
      live.add(aircraft.id);
      const old = this.aircraft.get(aircraft.id);
      const base = bases.get(aircraft.airfieldId);
      const baseX = base
        ? ((base.tile % snapshot.width) + 0.5) * FIXED
        : (old?.baseX ?? aircraft.x);
      const baseY = base
        ? (Math.floor(base.tile / snapshot.width) + 0.5) * FIXED
        : (old?.baseY ?? aircraft.y);
      const moved = old && (old.x !== aircraft.x || old.y !== aircraft.y);
      const goal = flightGoal(aircraft, baseX, baseY);
      // Short sorties still reach cruising size, with a level portion before
      // turning around. Preserve this distance through the final landing step.
      const ascentDistance = aircraft.target
        ? Math.max(
            FIXED,
            Math.min(
              ASCENT_DISTANCE,
              Math.hypot(aircraft.target.x - baseX, aircraft.target.y - baseY) *
                0.4,
            ),
          )
        : (old?.ascentDistance ?? ASCENT_DISTANCE);
      // Aircraft artwork faces up. Observe actual movement, including the last
      // step into the airfield; the sortie target stays stale during return.
      const angle = moved
        ? Math.atan2(aircraft.y - old.y, aircraft.x - old.x) + Math.PI / 2
        : goal && (goal.x !== aircraft.x || goal.y !== aircraft.y)
          ? Math.atan2(goal.y - aircraft.y, goal.x - aircraft.x) + Math.PI / 2
          : (old?.angle ?? 0);
      const duplicate = old?.tick === snapshot.tick && !moved;
      this.aircraft.set(aircraft.id, {
        x: aircraft.x,
        y: aircraft.y,
        previousX: duplicate ? old.previousX : (old?.x ?? aircraft.x),
        previousY: duplicate ? old.previousY : (old?.y ?? aircraft.y),
        baseX,
        baseY,
        ascentDistance,
        angle,
        tick: snapshot.tick,
      });
    }
    for (const id of this.aircraft.keys())
      if (!live.has(id)) this.aircraft.delete(id);
  }

  pose(id: number, blend = 1) {
    const aircraft = this.aircraft.get(id);
    if (!aircraft) return undefined;
    const fraction = Math.max(0, Math.min(1, blend));
    const x = aircraft.previousX + (aircraft.x - aircraft.previousX) * fraction;
    const y = aircraft.previousY + (aircraft.y - aircraft.previousY) * fraction;
    const height = Math.min(
      1,
      Math.hypot(x - aircraft.baseX, y - aircraft.baseY) /
        aircraft.ascentDistance,
    );
    const ascent = height * height * (3 - 2 * height);
    const size = PARKED_SIZE * (1 + ascent);
    // Include rotated sprite corners in culling and click selection.
    const radius = size * Math.SQRT1_2 + 2;
    return { x, y, angle: aircraft.angle, size, radius };
  }
}

function flightGoal(aircraft: Aircraft, baseX: number, baseY: number) {
  return aircraft.state === "returning"
    ? { x: baseX, y: baseY }
    : aircraft.state === "outbound"
      ? aircraft.target
      : null;
}
