import { FIXED, TICKS_PER_SECOND, type Snapshot } from "../Protocol";

export interface BoatPose {
  x: number;
  y: number;
  /** Up-facing vessel artwork convention. */
  angle: number;
  moving: boolean;
}

interface BoatState {
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  angle: number;
  fromAngle: number;
  turn: number;
  startedAt: number;
  endsAt: number;
  observedMoving: boolean;
  seen: number;
  pose: BoatPose;
}

const MAX_GAP_MS = 1_000;
const TELEPORT_DISTANCE = 8 * FIXED;
const clamp = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x));

/** Purely cosmetic. No predictions, simulation writes, or new network traffic.
 * Early packets retarget from the displayed pose instead of rewinding to the
 * previous authoritative position. Linear motion avoids easing every packet.
 */
export class BoatPresentation {
  private readonly ships = new Map<number, BoatState>();
  private readonly traders = new Map<number, BoatState>();
  private tick: number | undefined;
  private receivedAt = 0;
  private intervalMs = 200;
  private generation = 0;
  private frameAt = 0;
  private animationAt: number | undefined;
  private animationTick = 0;
  private paused = false;
  private speed = 1;
  private measuredInterval = false;

  reset(): void {
    this.ships.clear();
    this.traders.clear();
    this.tick = undefined;
    this.receivedAt = this.frameAt = 0;
    this.intervalMs = 200;
    this.generation = 0;
    this.animationAt = undefined;
    this.animationTick = 0;
    this.paused = false;
    this.speed = 1;
    this.measuredInterval = false;
  }

  update(snapshot: Snapshot, now: number): void {
    if (this.tick !== undefined && snapshot.tick < this.tick) this.reset();
    this.advanceAnimation(now, this.speed, this.paused);
    const first = this.tick === undefined;
    const advanced = first || snapshot.tick > this.tick!;
    const gap = now - this.receivedAt;
    const discontinuity = !first && advanced && gap >= MAX_GAP_MS;
    if (advanced) {
      if (!first && !discontinuity) {
        const measured = clamp(gap, 50, 400);
        // The first real interval identifies local 20 Hz versus online 5 Hz.
        this.intervalMs = !this.measuredInterval
          ? measured
          : this.intervalMs * 0.8 + measured * 0.2;
        this.measuredInterval = true;
      }
      this.tick = snapshot.tick;
      this.receivedAt = now;
    }
    if (first) {
      this.animationTick = snapshot.tick;
      this.animationAt = now;
      this.frameAt = now;
    }
    this.generation++;
    for (const ship of snapshot.ships)
      this.observe(
        this.ships,
        ship.id,
        ship.x,
        ship.y,
        now,
        advanced,
        discontinuity,
      );
    for (const trader of snapshot.expansion?.traders ?? [])
      if (trader.naval)
        this.observe(
          this.traders,
          trader.id,
          trader.x,
          trader.y,
          now,
          advanced,
          discontinuity,
        );
    for (const states of [this.ships, this.traders])
      for (const [id, state] of states)
        if (state.seen !== this.generation) states.delete(id);
  }

  /** Call once per rendered frame. The clock is for looping boat art only;
   * combat/projectile timing keeps using the existing simulation presentation.
   */
  frame(now: number, speed: number, paused: boolean): number {
    if (paused && !this.paused) {
      for (const states of [this.ships, this.traders])
        for (const state of states.values()) {
          state.fromX = state.x;
          state.fromY = state.y;
          state.fromAngle = state.angle;
          state.turn = 0;
          state.endsAt = now;
        }
    }
    this.advanceAnimation(now, speed, paused || this.paused);
    this.speed = speed;
    this.frameAt = now;
    this.paused = paused;
    return this.animationTick;
  }

  private advanceAnimation(now: number, speed: number, paused: boolean): void {
    const until = Math.min(
      now,
      this.receivedAt + Math.max(100, this.intervalMs * 1.5),
    );
    if (!paused && this.animationAt !== undefined)
      this.animationTick +=
        (Math.max(0, until - this.animationAt) * TICKS_PER_SECOND * speed) /
        1_000;
    this.animationAt = now;
  }

  /** Borrowed, reused result: callers must not retain or mutate it. */
  shipPose(id: number): Readonly<BoatPose> | undefined {
    const state = this.ships.get(id);
    return state && this.sample(state, this.frameAt);
  }

  /** Borrowed, reused result; IDs are namespaced from military ships. */
  traderPose(id: number): Readonly<BoatPose> | undefined {
    const state = this.traders.get(id);
    return state && this.sample(state, this.frameAt);
  }

  private sample(state: BoatState, now: number): BoatPose {
    const fraction =
      this.paused || state.endsAt <= state.startedAt
        ? 1
        : clamp(
            (now - state.startedAt) / (state.endsAt - state.startedAt),
            0,
            1,
          );
    const pose = state.pose;
    pose.x = state.fromX + (state.x - state.fromX) * fraction;
    pose.y = state.fromY + (state.y - state.fromY) * fraction;
    pose.angle = state.fromAngle + state.turn * fraction;
    pose.moving =
      state.observedMoving ||
      (fraction < 1 && (state.fromX !== state.x || state.fromY !== state.y));
    return pose;
  }

  private observe(
    states: Map<number, BoatState>,
    id: number,
    x: number,
    y: number,
    now: number,
    advanced: boolean,
    discontinuity: boolean,
  ): void {
    const old = states.get(id);
    if (!old) {
      states.set(id, {
        x,
        y,
        fromX: x,
        fromY: y,
        angle: 0,
        fromAngle: 0,
        turn: 0,
        startedAt: now,
        endsAt: now,
        observedMoving: false,
        seen: this.generation,
        pose: { x, y, angle: 0, moving: false },
      });
      return;
    }
    old.seen = this.generation;
    const dx = x - old.x,
      dy = y - old.y;
    if (!advanced && dx === 0 && dy === 0) return;
    const pose = this.sample(old, now);
    const moving = dx !== 0 || dy !== 0;
    const angle = moving ? Math.atan2(dy, dx) + Math.PI / 2 : old.angle;
    const snap =
      discontinuity ||
      !advanced ||
      this.paused ||
      dx * dx + dy * dy > TELEPORT_DISTANCE * TELEPORT_DISTANCE;
    old.fromX = snap ? x : pose.x;
    old.fromY = snap ? y : pose.y;
    old.fromAngle = snap ? angle : pose.angle;
    old.angle = angle;
    // Wrap at +/- pi, computed only on packets, never per draw.
    old.turn = Math.atan2(
      Math.sin(angle - old.fromAngle),
      Math.cos(angle - old.fromAngle),
    );
    old.x = x;
    old.y = y;
    old.startedAt = now;
    old.endsAt = snap ? now : now + this.intervalMs;
    old.observedMoving = moving;
  }
}
