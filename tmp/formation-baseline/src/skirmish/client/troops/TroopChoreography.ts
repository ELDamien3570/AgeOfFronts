import { minimumTravelAssignment } from "../FormationSlotAssignment";
import type { FormationSlot } from "./TroopFormationModel";

interface Track {
  from: FormationSlot;
  via: FormationSlot;
  to: FormationSlot;
  start: number;
  duration: number;
  faceDestination?: boolean;
}
interface Member {
  id: number;
  slot: number;
  track?: Track;
}
export interface PresentedSoldier extends FormationSlot {
  id: number;
  moving: boolean;
  front: boolean;
}
export interface PresentedCorpse extends FormationSlot {
  id: number;
  age: number;
}
const ease = (t: number) => t * t * (3 - 2 * t);

/** Cosmetic tracks are compiled on layout/casualty events, then sampled each frame. */
export class TroopChoreography {
  private members: Member[];
  private corpses: (FormationSlot & { id: number; started: number })[] = [];
  private nextDeath: number;
  private sequence = 0;
  constructor(
    private slots: FormationSlot[],
    readonly variant: number,
    now: number,
    initialCount = slots.length,
  ) {
    const active = new Set(
      slots
        .map((slot, index) => ({ slot, index }))
        .sort(
          (a, b) =>
            b.slot.row - a.slot.row ||
            b.slot.y - a.slot.y ||
            a.slot.x - b.slot.x,
        )
        .slice(0, Math.max(0, Math.min(slots.length, initialCount)))
        .map((s) => s.index),
    );
    this.members = slots
      .map((_, id) => ({ id, slot: id }))
      .filter((m) => active.has(m.slot));
    this.nextDeath = now + (variant % 5) * 120;
  }
  get count(): number {
    return this.members.length;
  }
  private pose(member: Member, now: number): FormationSlot {
    const track = member.track;
    if (!track) return this.slots[member.slot];
    const t = Math.max(0, Math.min(1, (now - track.start) / track.duration));
    if (t >= 1) {
      member.track = undefined;
      return track.to;
    }
    if (t <= 0) return track.from;
    const u = ease(t),
      v = 1 - u;
    const dx =
      v * (track.via.x - track.from.x) + u * (track.to.x - track.via.x);
    const dy =
      v * (track.via.y - track.from.y) + u * (track.to.y - track.via.y);
    const heading =
      Math.hypot(dx, dy) < 0.00001
        ? (track.to.angle ?? 0)
        : Math.atan2(-dx, dy);
    const initialAngle = track.from.angle ?? 0;
    const turn = ease(Math.min(1, t / 0.18));
    const walkingAngle =
      initialAngle +
      Math.atan2(
        Math.sin(heading - initialAngle),
        Math.cos(heading - initialAngle),
      ) *
        turn;
    const settle = ease(Math.max(0, (t - 0.8) / 0.2));
    const finalAngle = track.to.angle ?? 0;
    return {
      ...track.to,
      x: v * v * track.from.x + 2 * v * u * track.via.x + u * u * track.to.x,
      y: v * v * track.from.y + 2 * v * u * track.via.y + u * u * track.to.y,
      angle: track.faceDestination
        ? finalAngle
        : walkingAngle +
          Math.atan2(
            Math.sin(finalAngle - walkingAngle),
            Math.cos(finalAngle - walkingAngle),
          ) *
            settle,
    };
  }
  private track(
    member: Member,
    from: FormationSlot,
    to: FormationSlot,
    now: number,
    delay: number,
    filling: boolean,
  ): void {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (
      distance < 0.001 &&
      Math.abs((from.angle ?? 0) - (to.angle ?? 0)) < 0.01
    ) {
      member.track = undefined;
      return;
    }
    // Three reusable lane patterns: left detour, right detour, and column-following.
    const pattern =
      (this.variant + Math.floor(this.variant / 3) + member.id) % 3;
    const bend =
      pattern === 2 || distance < 0.001
        ? 0
        : (pattern === 0 ? -1 : 1) * from.scale * (filling ? 0.2 : 0.5);
    member.track = {
      from,
      to,
      via: { ...to, x: (from.x + to.x) / 2 + bend, y: (from.y + to.y) / 2 },
      start: now + delay,
      duration: filling ? 650 + distance * 300 : 900 + distance * 600,
    };
  }
  /** Re-express current world poses in a new facing frame, then assign the
   * nearest available ranks. Symmetric half-turns need no cross-formation walk. */
  reorient(frameDelta: number, now: number): void {
    const cos = Math.cos(frameDelta),
      sin = Math.sin(frameDelta);
    const rotate = (pose: FormationSlot): FormationSlot => ({
      ...pose,
      x: pose.x * cos - pose.y * sin,
      y: pose.x * sin + pose.y * cos,
      angle: (pose.angle ?? 0) + frameDelta,
    });
    const poses = this.members
      .map((member) => ({ member, pose: rotate(this.pose(member, now)) }))
      .sort((a, b) => a.member.id - b.member.id);
    const destinations = this.slots
      .map((slot, index) => ({ slot, index }))
      .sort(
        (a, b) =>
          b.slot.row - a.slot.row || b.slot.y - a.slot.y || a.slot.x - b.slot.x,
      )
      .slice(0, poses.length);
    const assignment = minimumTravelAssignment(
      poses.map((p) => p.pose),
      destinations.map((d) => d.slot),
    );
    for (let i = 0; i < destinations.length; i++) {
      const { member, pose } = poses[assignment[i]],
        { slot, index } = destinations[i];
      member.slot = index;
      const distance = Math.hypot(pose.x - slot.x, pose.y - slot.y);
      // No track is needed for a purely local pivot; walkers preserve facing.
      member.track =
        distance < 0.001
          ? undefined
          : {
              from: pose,
              via: {
                ...slot,
                x: (pose.x + slot.x) / 2,
                y: (pose.y + slot.y) / 2,
              },
              to: slot,
              start: now,
              duration: 180 + distance * 450,
              faceDestination: true,
            };
    }
    this.corpses = this.corpses.map((c) => ({ ...c, ...rotate(c) }));
  }
  reshape(slots: FormationSlot[], now: number): void {
    if (
      slots.length === this.slots.length &&
      slots.every((slot, i) => {
        const old = this.slots[i];
        return (
          slot.x === old.x &&
          slot.y === old.y &&
          slot.row === old.row &&
          slot.scale === old.scale &&
          (slot.angle ?? 0) === (old.angle ?? 0)
        );
      })
    )
      return;
    const poses = this.members.map((member) => ({
      member,
      pose: this.pose(member, now),
    }));
    // Keep complete forward ranks even after casualties; vacancies accumulate at the rear.
    const destinations = slots
      .map((slot, index) => ({ slot, index }))
      .sort(
        (a, b) =>
          b.slot.row - a.slot.row || b.slot.y - a.slot.y || a.slot.x - b.slot.x,
      )
      .slice(0, this.members.length);
    this.slots = slots;
    for (const destination of destinations) {
      let nearest = 0;
      for (let i = 1; i < poses.length; i++)
        if (
          Math.hypot(
            poses[i].pose.x - destination.slot.x,
            poses[i].pose.y - destination.slot.y,
          ) <
          Math.hypot(
            poses[nearest].pose.x - destination.slot.x,
            poses[nearest].pose.y - destination.slot.y,
          )
        )
          nearest = i;
      const { member, pose } = poses.splice(nearest, 1)[0];
      member.slot = destination.index;
      this.track(
        member,
        pose,
        destination.slot,
        now,
        (member.id % 4) * 95 + (this.variant % 3) * 70,
        false,
      );
    }
    this.nextDeath = Math.max(this.nextDeath, now + 2100);
  }
  advance(
    now: number,
    desired: number,
    contact?: { angle?: number; front: ReadonlySet<number> },
  ): void {
    this.corpses = this.corpses.filter((corpse) => now - corpse.started < 2600);
    for (const member of this.members) this.pose(member, now);
    if (
      this.members.length <= desired ||
      now < this.nextDeath ||
      this.members.some((m) => m.track)
    )
      return;
    const maxRow = Math.max(...this.members.map((m) => this.slots[m.slot].row));
    const front = this.members
      .filter((m) =>
        contact?.front.size
          ? contact.front.has(m.id)
          : this.slots[m.slot].row === maxRow,
      )
      .sort((a, b) => this.slots[a.slot].x - this.slots[b.slot].x);
    const pattern =
      (this.variant + Math.floor(this.variant / 3) + this.sequence++) % 3;
    const victim =
      front[
        pattern === 0
          ? 0
          : pattern === 1
            ? front.length - 1
            : Math.floor(front.length / 2)
      ];
    let vacancy = victim.slot;
    this.corpses.push({ ...this.slots[vacancy], id: victim.id, started: now });
    this.members = this.members.filter((m) => m !== victim);
    let depth = 0;
    const moved = new Set<number>();
    while (true) {
      const hole = this.slots[vacancy];
      const angle = contact?.angle ?? hole.angle ?? 0;
      const forwardX = -Math.sin(angle),
        forwardY = Math.cos(angle);
      const candidates = this.members.filter(
        (m) =>
          !moved.has(m.id) &&
          (this.slots[m.slot].x - hole.x) * forwardX +
            (this.slots[m.slot].y - hole.y) * forwardY <
            -0.001,
      );
      if (!candidates.length) break;
      candidates.sort((a, b) => {
        const score = (m: Member) => {
          const dx = this.slots[m.slot].x - hole.x,
            dy = this.slots[m.slot].y - hole.y;
          return (
            Math.abs(dx * forwardY - dy * forwardX) * 3 +
            Math.abs(dx * forwardX + dy * forwardY)
          );
        };
        return score(a) - score(b) || a.id - b.id;
      });
      const replacement = candidates[0],
        oldSlot = replacement.slot;
      replacement.slot = vacancy;
      moved.add(replacement.id);
      this.track(
        replacement,
        this.slots[oldSlot],
        hole,
        now,
        280 + pattern * 100 + depth++ * 160,
        true,
      );
      vacancy = oldSlot;
    }
    // A last remaining rank closes sideways when there is nobody behind it.
    if (!depth && this.members.length) {
      const nearest = [...this.members].sort(
        (a, b) =>
          Math.hypot(
            this.slots[a.slot].x - this.slots[vacancy].x,
            this.slots[a.slot].y - this.slots[vacancy].y,
          ) -
          Math.hypot(
            this.slots[b.slot].x - this.slots[vacancy].x,
            this.slots[b.slot].y - this.slots[vacancy].y,
          ),
      )[0];
      const old = nearest.slot;
      nearest.slot = vacancy;
      this.track(
        nearest,
        this.slots[old],
        this.slots[vacancy],
        now,
        350 + pattern * 100,
        true,
      );
    }
    this.nextDeath = now + 1250 + (this.variant % 4) * 130;
  }
  soldiers(now: number): PresentedSoldier[] {
    const frontRow = Math.max(
      ...this.members.map((m) => this.slots[m.slot].row),
    );
    return this.members.map((m) => {
      const pose = this.pose(m, now);
      return {
        ...pose,
        id: m.id,
        moving: !!m.track && now >= m.track.start,
        front: this.slots[m.slot].row === frontRow,
      };
    });
  }
  dead(now: number): PresentedCorpse[] {
    return this.corpses.map((c) => ({ ...c, age: now - c.started }));
  }
}
