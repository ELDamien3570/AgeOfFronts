import { FIXED, type Snapshot } from "../Protocol";

type Squad = Snapshot["squads"][number];
interface Heading {
  angle: number;
  desired: number;
  sampledAt: number;
  anchorX: number;
  anchorY: number;
  moveGoal?: string;
  travelAngle?: number;
}
const delta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Client-only facing follows intent, not the collision solver's per-tick corrections. */
export class FormationHeading {
  private readonly headings = new Map<number, Heading>();
  constructor(
    private readonly initialAngle: (squad: Squad) => number = () => 0,
    private readonly turnDegreesPerSecond = 180,
    private readonly reformInPlace = false,
  ) {}
  clear(): void {
    this.headings.clear();
  }
  private sample(state: Heading, now: number): number {
    if (this.reformInPlace) {
      // This is a layout frame, not a soldier's physical orientation. The actor
      // controller preserves world poses and remaps slots before applying it.
      // Tiny waypoint changes must not continuously recompile the slot plan.
      if (Math.abs(delta(state.angle, state.desired)) >= Math.PI / 45)
        state.angle = state.desired;
      state.sampledAt = Math.max(state.sampledAt, now);
      return state.angle;
    }
    // Bound the turn rate and avoid a snap after a background-tab pause.
    const limit =
      (Math.min(100, Math.max(0, now - state.sampledAt)) *
        this.turnDegreesPerSecond *
        Math.PI) /
      180000;
    state.angle += Math.max(
      -limit,
      Math.min(limit, delta(state.angle, state.desired)),
    );
    state.sampledAt = Math.max(state.sampledAt, now);
    return state.angle;
  }
  angle(id: number, now: number): number {
    const state = this.headings.get(id);
    return state ? this.sample(state, now) : 0;
  }
  update(snapshot: Snapshot, now: number): void {
    const live = new Set<number>();
    const squads = new Map(snapshot.squads.map((squad) => [squad.id, squad]));
    const buildings = new Map(
      snapshot.buildings.map((building) => [building.id, building]),
    );
    const point = (tile: number) => ({
      x: ((tile % snapshot.width) + 0.5) * FIXED,
      y: (Math.floor(tile / snapshot.width) + 0.5) * FIXED,
    });
    for (const squad of snapshot.squads) {
      live.add(squad.id);
      let state = this.headings.get(squad.id);
      if (!state) {
        const angle = squad.locomotion?.heading ?? this.initialAngle(squad);
        state = {
          angle,
          desired: angle,
          sampledAt: now,
          anchorX: squad.x,
          anchorY: squad.y,
        };
        this.headings.set(squad.id, state);
      }
      this.sample(state, now);
      if (squad.locomotion) {
        // Follow the server's shared facing, never derive a competing turn from
        // clicks or collision jitter. Sampling interpolates between fixed ticks.
        state.desired = this.reformInPlace
          ? squad.locomotion.targetHeading
          : squad.locomotion.heading;
        continue;
      }
      if (
        squad.order.type === "hold" &&
        squad.order.facing !== undefined &&
        !squad.fighting
      ) {
        state.desired = squad.order.facing;
        continue;
      }
      let goal: { x: number; y: number } | undefined;
      if (squad.charge && squad.charge.phase !== "recovery")
        goal = squad.charge;
      else if (squad.fighting) {
        goal = squads.get(squad.combatTargetId ?? -1);
        const building = buildings.get(squad.structureTarget?.buildingId ?? -1);
        if (!goal && building) goal = point(building.tile);
      }
      if (!goal && squad.order.type === "attack")
        goal = squads.get(squad.order.targetId);
      if (!goal && squad.order.type === "move") {
        goal = point(squad.order.tile);
        if (squad.order.x !== undefined && squad.order.y !== undefined)
          goal = { x: squad.order.x, y: squad.order.y };
        const key = `${squad.order.tile}:${squad.order.x}:${squad.order.y}`;
        if (state.moveGoal !== key) {
          state.moveGoal = key;
          state.travelAngle = undefined;
          state.anchorX = squad.x;
          state.anchorY = squad.y;
        }
        // Waypoints stay server-side. Accumulated half-cell progress captures
        // route bends without publishing routes or chasing single-tick jitter.
        if (
          squad.moved &&
          Math.hypot(squad.x - state.anchorX, squad.y - state.anchorY) >=
            FIXED / 2
        ) {
          state.travelAngle =
            Math.atan2(squad.y - state.anchorY, squad.x - state.anchorX) -
            Math.PI / 2;
          state.anchorX = squad.x;
          state.anchorY = squad.y;
        }
        if (Math.hypot(goal.x - squad.x, goal.y - squad.y) >= FIXED / 4)
          state.desired =
            state.travelAngle ??
            Math.atan2(goal.y - squad.y, goal.x - squad.x) - Math.PI / 2;
        continue;
      }
      state.moveGoal = undefined;
      state.travelAngle = undefined;
      if (goal) {
        // Retain facing on arrival; a point a few fixed units behind is noise.
        if (Math.hypot(goal.x - squad.x, goal.y - squad.y) >= FIXED / 4)
          state.desired =
            Math.atan2(goal.y - squad.y, goal.x - squad.x) - Math.PI / 2;
        state.anchorX = squad.x;
        state.anchorY = squad.y;
      } else if (
        squad.moved &&
        Math.hypot(squad.x - state.anchorX, squad.y - state.anchorY) >=
          FIXED / 2
      ) {
        state.desired =
          Math.atan2(squad.y - state.anchorY, squad.x - state.anchorX) -
          Math.PI / 2;
        state.anchorX = squad.x;
        state.anchorY = squad.y;
      }
    }
    for (const id of this.headings.keys())
      if (!live.has(id)) this.headings.delete(id);
  }
}
