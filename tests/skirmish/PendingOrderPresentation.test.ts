import { describe, expect, it } from "vitest";
import { FORMATION_MOVEMENT } from "../../src/skirmish/FormationMovementProfile";
import { FIXED, type Order } from "../../src/skirmish/Protocol";
import {
  PENDING_ORDER,
  PendingOrderPresentation,
  pendingTurnRate,
  stepAngle,
  turnPredictable,
  type PendingOrderSquad,
} from "../../src/skirmish/client/PendingOrderPresentation";

const WIDTH = 100;
const degrees = (value: number) => (value * Math.PI) / 180;
const squad = (patch: Partial<PendingOrderSquad> = {}): PendingOrderSquad => ({
  id: 1,
  kind: "infantry",
  x: 10 * FIXED,
  y: 10 * FIXED,
  order: { type: "hold" },
  queuedOrders: [],
  embarkedOn: null,
  afloat: null,
  refit: null,
  charge: null,
  fighting: false,
  locomotion: { heading: 0, targetHeading: 0, speed: 0 },
  ...patch,
});
// Artwork faces +y at zero; a point due east of the squad is heading -90°.
const EAST = { x: 20 * FIXED, y: 10 * FIXED };
const EAST_HEADING = -Math.PI / 2;
const moveTo = (point: { x: number; y: number }): Order => ({
  type: "move",
  tile: Math.floor(point.y / FIXED) * WIDTH + Math.floor(point.x / FIXED),
  x: point.x,
  y: point.y,
});

/** One presented squad whose authoritative facing the test controls. */
function harness(initial: PendingOrderSquad = squad()) {
  const pending = new PendingOrderPresentation();
  const state = { squad: initial as PendingOrderSquad | undefined, facing: 0, body: 0 };
  const frame = (now: number) =>
    pending.reconcile(
      now,
      WIDTH,
      (id) => (state.squad?.id === id ? state.squad : undefined),
      () => state.facing,
      () => state.body,
    );
  return { pending, state, frame };
}

describe("pending order angle stepping", () => {
  it("steps toward the target at the given rate and never overshoots", () => {
    expect(stepAngle(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1);
    expect(stepAngle(0, -Math.PI / 2, 0.1)).toBeCloseTo(-0.1);
    expect(stepAngle(0, Math.PI / 2, 10)).toBeCloseTo(Math.PI / 2);
    expect(stepAngle(0.3, 0.3, 1)).toBeCloseTo(0.3);
  });
  it("turns the short way across the ±180° seam", () => {
    const next = stepAngle(degrees(170), degrees(-170), degrees(5));
    expect(next).toBeCloseTo(degrees(175));
    const across = stepAngle(next, degrees(-170), degrees(10));
    expect(across).toBeCloseTo(degrees(-175));
    expect(stepAngle(across, degrees(-170), degrees(90))).toBeCloseTo(degrees(-170));
  });
  it("uses the simulation's in-place pivot rate: 360°/s on foot and 240°/s mounted", () => {
    expect(pendingTurnRate({ kind: "infantry" })).toBe(FORMATION_MOVEMENT.foot.reformTurnRate);
    expect(pendingTurnRate({ kind: "archer" })).toBe(FORMATION_MOVEMENT.foot.reformTurnRate);
    expect(pendingTurnRate({ kind: "cavalry" })).toBe(FORMATION_MOVEMENT.mounted.reformTurnRate);
    expect(FORMATION_MOVEMENT.foot.reformTurnRate).toBeCloseTo(degrees(360));
    expect(FORMATION_MOVEMENT.mounted.reformTurnRate).toBeCloseTo(degrees(240));
  });
  for (const [kind, rate] of [["infantry", 360], ["cavalry", 240]] as const) {
    it(`predicts a ${kind} turn toward the order at ${rate}°/s from the click`, () => {
      const { pending, state, frame } = harness(squad({ kind }));
      pending.issue(0, [state.squad!], { type: "move", point: EAST });
      frame(0);
      expect(pending.angle(1, 0, 0)).toBeCloseTo(0);
      frame(100);
      expect(pending.angle(1, 100, 0)).toBeCloseTo(-degrees(rate) * 0.1);
      frame(150);
      expect(pending.angle(1, 150, 0)).toBeCloseTo(-degrees(rate) * 0.15);
      frame(1000);
      expect(pending.angle(1, 1000, 0)).toBeCloseTo(EAST_HEADING);
    });
  }
  it("starts from the click even when the first drawn frame is late", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(50);
    expect(pending.angle(1, 50, 0)).toBeCloseTo(-degrees(360) * 0.05);
  });
});

describe("pending order reconciliation", () => {
  it("keeps the marker until the presented order carries it", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    expect([...pending.markers()]).toEqual([{ squadId: 1, attack: false, point: EAST }]);
    // An unrelated move far away is not this order.
    state.squad = squad({ order: moveTo({ x: 80 * FIXED, y: 80 * FIXED }) });
    frame(100);
    expect([...pending.markers()]).toHaveLength(1);
    // The simulation assigns a formation slot near the click.
    state.squad = squad({ order: moveTo({ x: 21 * FIXED, y: 11 * FIXED }) });
    frame(200);
    expect([...pending.markers()]).toHaveLength(0);
  });
  it("matches attacks by target and follows the presented target position", () => {
    const pending = new PendingOrderPresentation();
    let own = squad();
    const enemy = { ...squad({ id: 9, x: 10 * FIXED, y: 30 * FIXED }) };
    const lookup = (id: number) => (id === 1 ? own : id === 9 ? enemy : undefined);
    pending.issue(0, [own], { type: "attack", targetId: 9 });
    pending.reconcile(0, WIDTH, lookup, () => 0);
    expect([...pending.markers()]).toEqual([{ squadId: 1, attack: true, point: { x: enemy.x, y: enemy.y } }]);
    enemy.x = 12 * FIXED;
    own = squad({ order: { type: "attack", targetId: 8 } });
    pending.reconcile(50, WIDTH, lookup, () => 0);
    expect([...pending.markers()][0].point.x).toBe(12 * FIXED);
    own = squad({ order: { type: "attack", targetId: 9 } });
    pending.reconcile(100, WIDTH, lookup, () => 0);
    expect([...pending.markers()]).toHaveLength(0);
  });
  it("confirms a queued order in the presented queue", () => {
    const { pending, state, frame } = harness(squad({ order: moveTo({ x: 50 * FIXED, y: 50 * FIXED }) }));
    pending.issue(0, [state.squad!], { type: "move", point: EAST }, true);
    frame(0);
    expect(pending.angle(1, 0, 0)).toBeUndefined();
    expect([...pending.markers()]).toHaveLength(1);
    state.squad = squad({ order: state.squad!.order, queuedOrders: [moveTo(EAST)] });
    frame(100);
    expect(pending.active).toBe(false);
  });
  it("uses each squad's line slot as its destination", () => {
    const { pending, state, frame } = harness();
    const slot = { x: 14 * FIXED, y: 20 * FIXED };
    pending.issue(0, [state.squad!], { type: "move", point: EAST, slots: new Map([[1, slot]]) });
    frame(0);
    expect([...pending.markers()][0].point).toEqual(slot);
    // Turning toward the slot (due south is heading 0 here, so -atan2 of the offset).
    frame(1000);
    expect(pending.angle(1, 1000, 0)).toBeCloseTo(Math.atan2(10, 4) - Math.PI / 2);
  });
  it("hands a confirmed turn over to the settled authoritative facing over 150 ms", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    frame(300);
    expect(pending.angle(1, 300, 0)).toBeCloseTo(EAST_HEADING);
    // Confirmed, but the route leaves a little south of east.
    const route = EAST_HEADING + 0.3;
    state.squad = squad({ order: moveTo(EAST) });
    state.facing = route;
    frame(400);
    // Still settling: the prediction is held rather than swung toward a moving facing.
    frame(500);
    expect(pending.angle(1, 500, route)).toBeCloseTo(EAST_HEADING);
    frame(600);
    expect(pending.angle(1, 600, route)).toBeCloseTo(EAST_HEADING);
    expect(pending.angle(1, 675, route)).toBeCloseTo(EAST_HEADING + 0.15);
    expect(pending.angle(1, 750, route)).toBeUndefined();
    frame(750);
    expect(pending.active).toBe(false);
  });
  it("hands over at once when the authoritative facing reaches the prediction", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    frame(300);
    state.squad = squad({ order: moveTo(EAST) });
    state.facing = EAST_HEADING;
    frame(350);
    expect(pending.angle(1, 350, EAST_HEADING)).toBeCloseTo(EAST_HEADING);
    expect(pending.angle(1, 500, EAST_HEADING)).toBeUndefined();
  });
  it("releases a confirmed order whose facing never changes", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    state.squad = squad({ order: moveTo(EAST) });
    frame(100);
    frame(100 + PENDING_ORDER.confirmedHoldMs - 1);
    expect(pending.angle(1, 100 + PENDING_ORDER.confirmedHoldMs - 1, 0)).toBeCloseTo(EAST_HEADING);
    frame(100 + PENDING_ORDER.confirmedHoldMs);
    expect(pending.angle(1, 100 + PENDING_ORDER.confirmedHoldMs + 75, 0)).toBeCloseTo(EAST_HEADING / 2);
  });
  it("clears the marker and blends back to the authoritative facing on rejection", () => {
    const { pending, state, frame } = harness();
    const token = pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    frame(100);
    const predicted = pending.angle(1, 100, 0)!;
    pending.reject(token, 100);
    expect([...pending.markers()]).toHaveLength(0);
    expect(pending.angle(1, 100, 0)).toBeCloseTo(predicted);
    expect(pending.angle(1, 175, 0)).toBeCloseTo(predicted / 2);
    expect(pending.angle(1, 250, 0)).toBeUndefined();
    frame(250);
    expect(pending.active).toBe(false);
  });
  it("ignores a rejection of an older, replaced order", () => {
    const { pending, state, frame } = harness();
    const old = pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    pending.issue(50, [state.squad!], { type: "move", point: { x: 10 * FIXED, y: 0 } });
    pending.reject(old, 60);
    expect([...pending.markers()]).toHaveLength(1);
  });
  it("times out an unconfirmed order and blends back", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    frame(PENDING_ORDER.timeoutMs - 1);
    expect([...pending.markers()]).toHaveLength(1);
    frame(PENDING_ORDER.timeoutMs);
    expect([...pending.markers()]).toHaveLength(0);
    expect(pending.angle(1, PENDING_ORDER.timeoutMs, 0)).toBeCloseTo(EAST_HEADING);
    expect(pending.angle(1, PENDING_ORDER.timeoutMs + 75, 0)).toBeCloseTo(EAST_HEADING / 2);
    frame(PENDING_ORDER.timeoutMs + PENDING_ORDER.blendMs);
    expect(pending.active).toBe(false);
  });
  it("forgets a squad that leaves the presented snapshot", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    state.squad = undefined;
    frame(16);
    expect(pending.active).toBe(false);
  });
  it("turns the drawn body by the predicted rotation from its own angle", () => {
    const { pending, state, frame } = harness();
    state.body = 1;
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    expect(pending.bodyAngle(1, 0, 1)).toBeCloseTo(1);
    frame(100);
    expect(pending.bodyAngle(1, 100, 1)).toBeCloseTo(1 - degrees(36));
    expect(pending.reorients(1)).toBe(true);
  });
  it("marks small turns as not rebuilding a deployed body", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: { x: 12 * FIXED, y: 20 * FIXED } });
    frame(0);
    expect(pending.reorients(1)).toBe(false);
  });
});

describe("pending order guards", () => {
  const guarded: [string, Partial<PendingOrderSquad>][] = [
    ["embarked", { embarkedOn: 4 }],
    ["afloat", { afloat: { hull: 1, maxHull: 1, vesselId: "canoe" } }],
    ["refitting", { refit: {} as NonNullable<PendingOrderSquad["refit"]> }],
    ["charging", { charge: {} as NonNullable<PendingOrderSquad["charge"]> }],
    ["fighting", { fighting: true }],
    ["travelling", { locomotion: { heading: 0, targetHeading: 0, speed: FIXED } }],
  ];
  for (const [name, patch] of guarded)
    it(`predicts no turn for a ${name} squad but still marks its order`, () => {
      const { pending, state, frame } = harness(squad(patch));
      expect(turnPredictable(state.squad!)).toBe(false);
      pending.issue(0, [state.squad!], { type: "move", point: EAST });
      frame(0);
      frame(100);
      expect(pending.angle(1, 100, 0)).toBeUndefined();
      expect(pending.bodyAngle(1, 100, 0)).toBeUndefined();
      expect([...pending.markers()]).toHaveLength(1);
    });
  it("predicts a turn for a squad at rest or braking within its stopping step", () => {
    expect(turnPredictable(squad())).toBe(true);
    expect(turnPredictable(squad({ locomotion: undefined }))).toBe(true);
  });
  it("releases a prediction when the presented squad enters a guarded state", () => {
    const { pending, state, frame } = harness();
    pending.issue(0, [state.squad!], { type: "move", point: EAST });
    frame(0);
    frame(100);
    state.squad = squad({ fighting: true });
    frame(116);
    expect(pending.angle(1, 116 + PENDING_ORDER.blendMs, 0)).toBeUndefined();
  });
});
