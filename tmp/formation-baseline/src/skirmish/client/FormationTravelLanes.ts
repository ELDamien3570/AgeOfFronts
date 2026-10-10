import type { SoldierSlot } from "./FormationSoldierMotion";
type Point = { x: number; y: number };
interface Knot extends Point {
  distance: number;
  heading: number;
}

/** Cosmetic, distance-based lane followers. Member identities never depend on
 * waypoint headings. Rear members follow the same bends after the front passes.
 * History is spatially sampled and bounded independently of frame rate. */
export class FormationTravelLanes {
  private readonly trail: Knot[] = [];
  private basis?: number;
  private distance = 0;
  private previous?: Point;
  private heading = 0;
  get historySize() {
    return this.trail.length;
  }
  reset() {
    this.trail.length = 0;
    this.previous = undefined;
    this.basis = undefined;
    this.distance = 0;
  }
  sample(
    anchor: Point,
    slots: readonly SoldierSlot[],
    frame: number,
    footprint: number,
  ): Map<number, Point> {
    const dx = this.previous ? anchor.x - this.previous.x : 0;
    const dy = this.previous ? anchor.y - this.previous.y : 0;
    const travel = Math.hypot(dx, dy);
    if (this.basis === undefined && travel > 0.001) {
      this.heading = Math.atan2(dy, dx) - Math.PI / 2;
      this.basis = this.heading;
      const ux = -Math.sin(this.heading),
        uy = Math.cos(this.heading);
      this.trail.push({
        x: anchor.x - ux * 4,
        y: anchor.y - uy * 4,
        distance: -4,
        heading: this.heading,
      });
    }
    this.previous = { ...anchor };
    if (this.basis === undefined)
      return new Map(
        slots.map((s) => [
          s.id,
          {
            x:
              anchor.x +
              (s.x * Math.cos(frame) - s.y * Math.sin(frame)) * footprint,
            y:
              anchor.y +
              (s.x * Math.sin(frame) + s.y * Math.cos(frame)) * footprint,
          },
        ]),
      );
    if (travel > 0.001) {
      const requested = Math.atan2(dy, dx) - Math.PI / 2;
      const error = Math.atan2(
        Math.sin(requested - this.heading),
        Math.cos(requested - this.heading),
      );
      const radius = Math.max(
        0.4,
        ...slots.map((slot) => Math.hypot(slot.x, slot.y) * footprint),
      );
      // A wide crowd cannot swivel its offsets around a tighter corner than its
      // own radius. Ease the lane frame by distance, without changing membership.
      const turn = travel / radius;
      this.heading += Math.max(-turn, Math.min(turn, error));
      this.distance += travel;
      const knot = {
        ...anchor,
        distance: this.distance,
        heading: this.heading,
      };
      const last = this.trail[this.trail.length - 1];
      if (!last || this.distance - last.distance >= 0.025)
        this.trail.push(knot);
      // Keep sharp turns, but do not allocate one knot per rendered frame.
      else if (
        Math.abs(
          Math.atan2(
            Math.sin(this.heading - last.heading),
            Math.cos(this.heading - last.heading),
          ),
        ) > 0.12
      )
        this.trail.push(knot);
    }
    const relative = frame - this.basis;
    const c = Math.cos(relative),
      s = Math.sin(relative);
    let rear = 0;
    const result = new Map<number, Point>();
    for (const slot of slots) {
      const lateral = (slot.x * c - slot.y * s) * footprint;
      const depth = (slot.x * s + slot.y * c) * footprint;
      rear = Math.max(rear, -depth);
      const along = this.distance + depth;
      let point: Point = anchor,
        heading = this.heading;
      if (depth >= 0)
        point = {
          x: anchor.x - Math.sin(heading) * depth,
          y: anchor.y + Math.cos(heading) * depth,
        };
      else {
        for (let i = this.trail.length - 1; i >= 0; i--) {
          const a = this.trail[i];
          if (a.distance > along && i > 0) continue;
          const b = this.trail[i + 1] ?? {
            ...anchor,
            distance: this.distance,
            heading: this.heading,
          };
          const t = Math.max(
            0,
            Math.min(
              1,
              (along - a.distance) / Math.max(0.00001, b.distance - a.distance),
            ),
          );
          point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const delta = Math.atan2(
            Math.sin(b.heading - a.heading),
            Math.cos(b.heading - a.heading),
          );
          heading = a.heading + delta * t;
          break;
        }
      }
      result.set(slot.id, {
        x: point.x + Math.cos(heading) * lateral,
        y: point.y + Math.sin(heading) * lateral,
      });
    }
    while (
      this.trail.length > 2 &&
      this.trail[1].distance < this.distance - rear - 0.5
    )
      this.trail.shift();
    while (this.trail.length > 256) this.trail.shift();
    return result;
  }
}
