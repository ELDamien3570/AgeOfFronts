import { describe, expect, it } from "vitest";
import { FIXED, type Snapshot } from "../../src/skirmish/Protocol";
import { COMBAT_PRESENTATION_DELAY_TICKS } from "../../src/skirmish/client/CombatPresentationTimeline";
import { PendingOrderPresentation } from "../../src/skirmish/client/PendingOrderPresentation";
import {
  composePresentedSquad,
  SplitPresentationTimeline,
} from "../../src/skirmish/client/PresentationComposition";
import { Renderer } from "../../src/skirmish/client/Renderer";

type Row = Snapshot["squads"][number];
const DELAY = COMBAT_PRESENTATION_DELAY_TICKS;

function squad(id: number, patch: Partial<Row> = {}): Row {
  return {
    id,
    playerId: 1,
    kind: "infantry",
    x: 10 * FIXED,
    y: 10 * FIXED,
    troops: 100,
    embarkedOn: null,
    afloat: null,
    order: { type: "hold" },
    queuedOrders: [],
    moved: false,
    fighting: false,
    combatTargetId: null,
    lastCombatTick: 0,
    firingCharge: 0,
    ...patch,
  } as Row;
}
/** Tick `tick`: every squad has advanced one tile per tick and lost one
 * soldier per tick; each tick carries one volley and one projectile. */
function snapshot(tick: number, squads: Row[]): Snapshot {
  return {
    tick,
    winner: null,
    squads,
    volleys: [{ id: tick, tick, squadId: 2, playerId: 1, targetId: 1, fromX: 0, fromY: 0, toX: 0, toY: 0 }],
    expansion: { projectiles: [{ id: tick, tick, sourceKind: "squad", sourceId: 2, impactTick: tick + 2 }] },
  } as unknown as Snapshot;
}
const moving = (tick: number, ids = [1, 2]) =>
  snapshot(
    tick,
    ids.map((id) =>
      squad(id, {
        x: (10 + tick) * FIXED,
        troops: 100 - tick,
        order: { type: "move", tile: tick * 10 },
        weaponState: { sharedReadyTick: tick } as Row["weaponState"],
      }),
    ),
  );

describe("composed presentation squads (C11)", () => {
  it("takes movement fields from the latest row and combat facts from the delayed row", () => {
    const formation = {} as NonNullable<Row["formation"]>,
      combat = squad(1, {
        troops: 90,
        weaponState: { sharedReadyTick: 1 } as Row["weaponState"],
        meleeStrike: { tick: 1 } as Row["meleeStrike"],
        fighting: true,
        afloat: { hull: 40, maxHull: 100, vesselId: "canoe" },
      }),
      movement = squad(1, {
        x: 20 * FIXED,
        y: 30 * FIXED,
        troops: 70,
        formation,
        locomotion: { heading: 1, targetHeading: 1, speed: 3 },
        order: { type: "move", tile: 5 },
        queuedOrders: [{ type: "hold" }],
        weaponState: { sharedReadyTick: 9 } as Row["weaponState"],
        fighting: false,
        afloat: { hull: 10, maxHull: 100, vesselId: "canoe" },
      });
    const drawn = composePresentedSquad(combat, movement);
    expect(drawn).toMatchObject({
      x: 20 * FIXED,
      y: 30 * FIXED,
      order: { type: "move", tile: 5 },
      queuedOrders: [{ type: "hold" }],
      locomotion: movement.locomotion,
      troops: 90,
      fighting: true,
      weaponState: combat.weaponState,
      meleeStrike: combat.meleeStrike,
    });
    expect(drawn.formation).toBe(formation);
    // The transport is where it is now; its hull damage is a combat fact.
    expect(drawn.afloat).toEqual({ hull: 40, maxHull: 100, vesselId: "canoe" });
  });
  it("keeps the delayed row's identity when movement is unchanged", () => {
    const combat = squad(1, { troops: 50 });
    expect(composePresentedSquad(combat, { ...combat, troops: 80 } as Row)).toBe(combat);
  });
});

describe("split presentation timeline (C11)", () => {
  function played(last: number, build = moving) {
    const timeline = new SplitPresentationTimeline(DELAY);
    timeline.update(build(0));
    timeline.sample(0, 1, false);
    for (let tick = 1; tick <= last; tick++) timeline.update(build(tick));
    return timeline;
  }
  it("draws movement at the latest endpoint and combat facts on the delayed playhead", () => {
    const timeline = played(6),
      frame = timeline.sample(10_000, 1, false)!;
    expect(frame.tick).toBe(6 - DELAY);
    expect(frame.movementTick).toBe(6);
    expect(frame.movementSource.tick).toBe(6);
    const drawn = frame.snapshot.squads.find((s) => s.id === 1)!;
    expect(drawn.x).toBe(16 * FIXED);
    expect(drawn.order).toEqual({ type: "move", tile: 60 });
    expect(drawn.troops).toBe(100 - (6 - DELAY));
    expect(drawn.weaponState).toEqual({ sharedReadyTick: 6 - DELAY });
    expect(frame.snapshot.volleys.map((v) => v.id)).toEqual([6 - DELAY]);
    expect(frame.snapshot.expansion!.projectiles.map((p) => p.id)).toEqual([6 - DELAY]);
    expect(frame.snapshot.tick).toBe(6 - DELAY);
    // Cached for the renderer and the troop actors in one frame.
    expect(timeline.sample(10_000, 1, false)).toBe(frame);
  });
  it("interpolates movement between the latest endpoints", () => {
    const timeline = new SplitPresentationTimeline(DELAY);
    timeline.update(moving(0));
    timeline.sample(0, 1, false);
    timeline.update(moving(1));
    const half = timeline.sample(62.5, 1, false)!;
    expect(half.movementTick).toBe(0.5);
    expect(half.snapshot.squads[0].x).toBe(10.5 * FIXED);
  });
  it("holds a squad gone from the latest snapshot where it was last drawn until its delayed facts retire it", () => {
    const withoutVictimFrom = (gone: number) => (tick: number) =>
      moving(tick, tick >= gone ? [2] : [1, 2]);
    const build = withoutVictimFrom(5);
    const timeline = played(4, build);
    const before = timeline.sample(10_000, 1, false)!;
    expect(before.snapshot.squads.find((s) => s.id === 1)!.x).toBe(14 * FIXED);
    for (let tick = 5; tick <= 6; tick++) timeline.update(build(tick));
    const held = timeline.sample(20_000, 1, false)!;
    expect(held.movementTick).toBe(6);
    const victim = held.snapshot.squads.find((s) => s.id === 1)!;
    // Last drawn movement position, with the delayed headcount.
    expect(victim.x).toBe(14 * FIXED);
    expect(victim.troops).toBe(100 - (6 - DELAY));
    for (let tick = 7; tick <= 4 + DELAY + 1; tick++) timeline.update(build(tick));
    const retired = timeline.sample(30_000, 1, false)!;
    expect(retired.tick).toBeGreaterThanOrEqual(5);
    expect(retired.snapshot.squads.map((s) => s.id)).toEqual([2]);
  });
  it("uses the delayed position for a removed squad that was never drawn on the movement playhead", () => {
    const build = (tick: number) => moving(tick, tick >= 2 ? [2] : [1, 2]);
    const timeline = played(6, build),
      frame = timeline.sample(10_000, 1, false)!;
    expect(frame.tick).toBe(6 - DELAY);
    expect(frame.snapshot.squads.some((s) => s.id === 1)).toBe(false);
    const early = new SplitPresentationTimeline(DELAY);
    early.update(build(0));
    early.sample(0, 1, false);
    for (let tick = 1; tick <= 3; tick++) early.update(build(tick));
    const drawn = early.sample(10_000, 1, false)!.snapshot.squads.find((s) => s.id === 1)!;
    // Movement never sampled it after tick 0; it stays at its delayed row.
    expect(drawn.x).toBe(10 * FIXED);
  });
  it("draws a squad new in the latest snapshot at once", () => {
    const build = (tick: number) => moving(tick, tick >= 6 ? [1, 2, 3] : [1, 2]);
    const frame = played(6, build).sample(10_000, 1, false)!;
    expect(frame.tick).toBe(6 - DELAY);
    const recruit = frame.snapshot.squads.find((s) => s.id === 3)!;
    expect(recruit.x).toBe(16 * FIXED);
    expect(recruit.troops).toBe(94);
  });
  it("keeps the combat playhead while paused and seeks both playheads for review steps", () => {
    const timeline = played(6);
    const paused = timeline.sample(0, 1, true)!;
    expect(paused.tick).toBe(0);
    expect(paused.movementTick).toBe(6);
    timeline.seekLatest();
    const stepped = timeline.sample(1, 1, true)!;
    expect(stepped.tick).toBe(6);
    expect(stepped.movementTick).toBe(6);
    expect(stepped.snapshot.squads[0]).toEqual(moving(6).squads[0]);
  });
  it("drains the combat playhead to the end when finished", () => {
    const timeline = played(6);
    timeline.finish();
    expect(timeline.sample(10_000, 1, false)!.tick).toBe(6);
    timeline.clear();
    expect(timeline.sample(0, 1, false)).toBeUndefined();
  });
  it("confirms a pending order against the latest order, not the delayed one", () => {
    const timeline = played(6),
      frame = timeline.sample(10_000, 1, false)!,
      pending = new PendingOrderPresentation(),
      drawn = new Map(frame.snapshot.squads.map((s) => [s.id, s]));
    const target = { x: 60.5 * FIXED, y: 0.5 * FIXED };
    // The delayed rows still carry the previous order.
    const delayed = new Map(frame.source.squads.map((s) => [s.id, s]));
    pending.issue(0, [drawn.get(1)!], { type: "move", point: target });
    pending.reconcile(10, 100, (id) => delayed.get(id), () => 0);
    expect([...pending.markers()]).toHaveLength(1);
    pending.reconcile(20, 100, (id) => drawn.get(id), () => 0);
    expect([...pending.markers()]).toHaveLength(0);
  });
});

describe("renderer picking on the movement playhead (C11)", () => {
  it("picks squads at their latest drawn position while combat facts are still delayed", () => {
    const renderer = Object.create(Renderer.prototype) as Renderer;
    Object.assign(renderer, {
      scale: 12,
      offsetX: 0,
      offsetY: 0,
      snapshot: undefined,
      eraArtwork: new Map(),
      combatTimeline: new SplitPresentationTimeline(DELAY),
    });
    Object.defineProperty(renderer, "artwork", { value: new Map() });
    const build = (tick: number) =>
      snapshot(tick, [squad(1, { x: (10 + 4 * tick) * FIXED, troops: 1000 - tick })]);
    const timeline = (renderer as unknown as { combatTimeline: SplitPresentationTimeline }).combatTimeline;
    timeline.update(build(0));
    renderer.combatFrame(0, 1, false);
    for (let tick = 1; tick <= 6; tick++) timeline.update(build(tick));
    const frame = renderer.combatFrame(10_000, 1, false)!;
    expect(frame.tick).toBe(6 - DELAY);
    const latest = renderer.screen(34, 10),
      delayed = renderer.screen(10 + 4 * (6 - DELAY), 10);
    expect(renderer.squadAt(latest.x, latest.y)?.id).toBe(1);
    expect(renderer.squadAt(delayed.x, delayed.y)).toBeUndefined();
  });
});
