import { formationMovementProfile } from "../FormationMovementProfile";
import type { SoldierSlot } from "./FormationSoldierMotion";

type Point = { x: number; y: number };
export interface EngagementOpponents {
  center: Point;
  soldiers: readonly (Point & { id: string })[];
}
export interface EngagementIntent {
  active: boolean;
  charging: boolean;
  mounted?: boolean;
  ranged: boolean;
  square: boolean;
  travelHeading: number;
  reformInPlace?: boolean;
  travelling?: boolean;
  footprint: number;
  layout?: string;
  target?: Point;
  threats?: readonly Point[];
  /** Visible opponent poses only; no individual combat or damage entities. */
  opponents?: readonly EngagementOpponents[];
}
interface Shift {
  from: Point;
  to: Point;
  start: number;
  duration: number;
  bend: number;
}
const delta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
const ease = (t: number) => t * t * (3 - 2 * t);
const zero = { x: 0, y: 0 };

/** Presentation only: stable footprint, independent attention and reusable reserve-step tracks. */
export class FormationEngagement {
  private heading?: number;
  private previous?: number;
  private sector?: number;
  private candidate?: { sector: number; since: number };
  private planKey = "";
  private readonly shifts = new Map<number, Shift>();
  private readonly attention = new Map<number, string>();
  constructor(private readonly variant = 0) {}

  private offset(id: number, now: number): Point {
    const track = this.shifts.get(id);
    if (!track) return zero;
    const t = Math.max(0, Math.min(1, (now - track.start) / track.duration));
    const u = ease(t);
    // The same left/right/straight lane templates work at every attack bearing.
    const arc = Math.sin(Math.PI * u) * track.bend;
    const dx = track.to.x - track.from.x,
      dy = track.to.y - track.from.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: track.from.x + dx * u - (dy / length) * arc,
      y: track.from.y + dy * u + (dx / length) * arc,
    };
  }

  sample(
    now: number,
    anchor: Point,
    slots: readonly SoldierSlot[],
    intent: EngagementIntent,
  ) {
    this.heading ??= intent.travelHeading;
    const dt =
      this.previous === undefined
        ? 0
        : Math.min(0.1, Math.max(0, now - this.previous) / 1000);
    this.previous = now;
    const engaged = intent.active && !intent.charging && !!intent.target;
    if (!engaged && intent.reformInPlace) this.heading = intent.travelHeading;
    else if (!engaged) {
      const turn =
        dt * formationMovementProfile(!!intent.mounted).squadTurnRate;
      this.heading += Math.max(
        -turn,
        Math.min(turn, delta(this.heading, intent.travelHeading)),
      );
    }
    const heading = this.heading;
    const cos = Math.cos(heading),
      sin = Math.sin(heading);
    const local = (point: Point): Point => {
      const x = point.x - anchor.x,
        y = point.y - anchor.y;
      return {
        x: (x * cos + y * sin) / intent.footprint,
        y: (-x * sin + y * cos) / intent.footprint,
      };
    };
    const targets = engaged
      ? (intent.square
          ? [intent.target!, ...(intent.threats ?? [])]
          : [intent.target!]
        ).map(local)
      : [];
    const primary = targets[0];
    if (primary) {
      const bearing = Math.atan2(primary.y, primary.x);
      const requested = Math.round(bearing / (Math.PI / 4));
      if (this.sector === undefined) this.sector = requested;
      // Ignore boundary noise. A genuine new fighting edge must persist 300ms.
      if (
        Math.abs(delta((this.sector * Math.PI) / 4, bearing)) >
        Math.PI / 8 + Math.PI / 15
      ) {
        if (this.candidate?.sector !== requested)
          this.candidate = { sector: requested, since: now };
        if (now - this.candidate.since >= 300) {
          this.sector = requested;
          this.candidate = undefined;
        }
      } else this.candidate = undefined;
    } else {
      this.sector = undefined;
      this.candidate = undefined;
    }
    const edges = targets.map((target, index) =>
      index === 0
        ? this.sector!
        : Math.round(Math.atan2(target.y, target.x) / (Math.PI / 4)),
    );
    const bounds = {
      left: Math.min(...slots.map((s) => s.x)),
      right: Math.max(...slots.map((s) => s.x)),
      rear: Math.min(...slots.map((s) => s.y)),
      forward: Math.max(...slots.map((s) => s.y)),
    };
    const onEdge = (slot: SoldierSlot, sector: number) => {
      const x = Math.cos((sector * Math.PI) / 4),
        y = Math.sin((sector * Math.PI) / 4);
      const maxX = x > 0 ? bounds.right : -bounds.left;
      const maxY = y > 0 ? bounds.forward : -bounds.rear;
      const band = slot.scale * 0.22;
      // Diagonal threats activate both adjoining edges, not only the corner man.
      return (
        (Math.abs(x) > 0.38 && maxX - slot.x * Math.sign(x) < band) ||
        (Math.abs(y) > 0.38 && maxY - slot.y * Math.sign(y) < band)
      );
    };
    const front = new Set(
      slots.filter((s) => edges.some((e) => onEdge(s, e))).map((s) => s.id),
    );
    const key = `${engaged}:${intent.ranged}:${intent.square}:${intent.layout ?? ""}:${this.sector}:${slots.map((s) => s.id).join(",")}`;
    if (key !== this.planKey) {
      this.planKey = key;
      const reserves =
        engaged && !intent.ranged && !intent.square
          ? slots
              .filter((s) => !front.has(s.id))
              .sort(
                (a, b) =>
                  Math.hypot(a.x - primary!.x, a.y - primary!.y) -
                    Math.hypot(b.x - primary!.x, b.y - primary!.y) ||
                  a.id - b.id,
              )
              .slice(0, 2)
          : [];
      const volunteers = new Set(reserves.map((s) => s.id));
      for (const slot of slots) {
        const step = volunteers.has(slot.id) ? slot.scale * 0.32 : 0;
        const direction = ((this.sector ?? 0) * Math.PI) / 4;
        this.shifts.set(slot.id, {
          from: this.offset(slot.id, now),
          to: { x: Math.cos(direction) * step, y: Math.sin(direction) * step },
          start: now + 180 + ((slot.id + this.variant) % 4) * 90,
          duration: 850 + ((slot.id * 7 + this.variant) % 3) * 120,
          bend: (((slot.id + this.variant) % 3) - 1) * slot.scale * 0.05,
        });
      }
    }
    const ids = new Set(slots.map((s) => s.id));
    for (const id of this.shifts.keys())
      if (!ids.has(id)) this.shifts.delete(id);
    for (const id of this.attention.keys())
      if (!ids.has(id)) this.attention.delete(id);
    const opponents = (intent.opponents ?? []).map((group) => ({
      center: local(group.center),
      soldiers: group.soldiers.map((soldier) => ({
        ...local(soldier),
        id: soldier.id,
      })),
    }));
    const presented = slots.map((slot) => {
      const shift = this.offset(slot.id, now);
      const x = slot.x + shift.x,
        y = slot.y + shift.y;
      let angle =
        intent.reformInPlace && intent.travelling && !engaged
          ? 0
          : (slot.angle ?? 0);
      if (engaged && (!intent.square || intent.ranged || front.has(slot.id))) {
        // Square defenders retain their own edge's attention, including rear attacks.
        let target =
          intent.square && !intent.ranged
            ? targets
                .filter((_, i) => onEdge(slot, edges[i]))
                .sort(
                  (a, b) =>
                    Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
                )[0]
            : primary;
        if (target && !intent.ranged) {
          const contact = opponents.find(
            (group) =>
              Math.hypot(
                group.center.x - target!.x,
                group.center.y - target!.y,
              ) < 0.001,
          );
          if (contact?.soldiers.length) {
            // Prefer opponents ahead of this slot on its fighting edge. This
            // spreads attention across the actual frontage instead of converging
            // every weapon on the squad center. Overlapping lines may have no
            // opponent ahead, in which case use the nearest visible opponent.
            const ahead = contact.soldiers.filter(
              (opponent) =>
                (opponent.x - x) * target!.x + (opponent.y - y) * target!.y > 0,
            );
            const candidates = ahead.length ? ahead : contact.soldiers;
            const distance = (point: Point) =>
              Math.hypot(point.x - x, point.y - y);
            const nearest = candidates.reduce((best, candidate) =>
              distance(candidate) < distance(best) ? candidate : best,
            );
            const previous = candidates.find(
              (candidate) => candidate.id === this.attention.get(slot.id),
            );
            // Keep a living opponent through small position noise. Replace it
            // when it leaves this edge, dies, or another is materially nearer.
            const chosen =
              previous && distance(nearest) >= distance(previous) * 0.85
                ? previous
                : nearest;
            this.attention.set(slot.id, chosen.id);
            target = chosen;
          } else this.attention.delete(slot.id);
        } else this.attention.delete(slot.id);
        if (target)
          angle = Math.atan2(target.y - y, target.x - x) - Math.PI / 2;
      }
      return {
        ...slot,
        x,
        y,
        angle,
        step: Math.hypot(shift.x, shift.y) > 0.001,
        front: engaged ? intent.ranged || front.has(slot.id) : slot.front,
      };
    });
    return {
      heading,
      slots: presented,
      engaged,
      front,
      // Square replacement follows each outward-facing slot rather than one shared bearing.
      casualtyAngle:
        engaged && !intent.square
          ? (this.sector! * Math.PI) / 4 - Math.PI / 2
          : undefined,
    };
  }
}
