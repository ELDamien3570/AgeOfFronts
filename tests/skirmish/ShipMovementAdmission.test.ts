import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, type Ship } from "../../src/skirmish/Protocol";
import { SHIP_RULES } from "../../src/skirmish/Rules";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const data = new Uint8Array(100 * 70).fill(133);
  for (let y = 20; y < 70; y++)
    for (let x = 0; x < 100; x++) if (x !== 90) data[y * 100 + x] = 0;
  const map = new GameMapImpl(100, 70, data, 2050),
    match = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      tribes: false,
      runAi: false,
      deferredPlanning: true,
    });
  const ships: Ship[] = ([5, 8].map((x) => ({
    id: match.allocateId(),
    playerId: 1,
    kind: "transport" as const,
    x: (x + 0.5) * FIXED,
    y: 30.5 * FIXED,
    health: SHIP_RULES.transport.health,
    destination: null,
    waypoints: [],
    path: [],
    nextPathIndex: 0,
    fighting: false,
    boarding: null,
  }))).map(record => match.addShip(record));

  return { map, match, ships, ids: ships.map((s) => s.id) };
}
function finish(match: Skirmish) {
  for (let i = 0; i < 400 && match.shipAdmission.pendingCount; i++)
    match.step();
  expect(match.shipAdmission.pendingCount).toBe(0);
}
describe("transactional sailing admission", () => {
  it("restores legacy committed retry policy without silently introducing pauses", () => {
    const { map, match, ships } = fixture(),
      ship = ships[0],
      goal = map.ref(70, 50);
    const saved = match.shipAdmission.checkpoint();
    const { pauseCommitted, ...legacy } = saved;
    expect(pauseCommitted).toBe(true);
    match.shipAdmission.restore(legacy);
    ship.destination = goal;
    match.shipAdmission.resume(ship, goal);
    const id = match.shipAdmission.checkpoint().pending[0][0];
    for (const tick of [10, 40, 100])
      match.shipAdmission.completed(id, ship.id, "limited", [], tick);
    expect(
      match.shipAdmission.checkpoint().pending[0][1].paused,
    ).toBeUndefined();
    expect(match.shipAdmission.checkpoint().pauseCommitted).toBe(false);
  });

  it("pauses a committed voyage after bounded capacity retries and retains later waypoints", () => {
    const { map, match, ships } = fixture(),
      ship = ships[0],
      goal = map.ref(70, 50);
    ship.destination = goal;
    ship.waypoints = [map.ref(75, 50)];
    match.shipAdmission.resume(ship, goal);
    const id = match.shipAdmission.checkpoint().pending[0][0];
    for (const tick of [10, 40, 100])
      match.shipAdmission.completed(id, ship.id, "limited", [], tick);
    expect(match.shipAdmission.checkpoint().pending[0][1]).toMatchObject({
      paused: true,
      execution: true,
    });
    expect(ship.waypoints).toEqual([map.ref(75, 50)]);
    const request = vi.spyOn(match.routePlanner, "request");
    match.shipAdmission.step(1000);
    expect(request).not.toHaveBeenCalled();
    const saved = match.checkpoint(),
      restored = new Skirmish(map, match.options);
    restored.restore(saved);
    expect(restored.shipAdmission.checkpoint()).toEqual(
      match.shipAdmission.checkpoint(),
    );
    const restoredRequest = vi.spyOn(restored.routePlanner, "request");
    restored.shipAdmission.step(2000);
    expect(restoredRequest).not.toHaveBeenCalled();
    expect(
      match.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: [ship.id],
        tile: map.ref(20, 30),
      }),
    ).toBeNull();
    expect(match.shipAdmission.pendingCount).toBe(2);
  });
  it("coalesces unchanged recovery intentions while retaining paused or unfinished progress", () => {
    const { map, match, ships } = fixture(),
      ship = ships[0],
      goal = map.ref(20, 30);
    ship.destination = goal;
    ship.repairState = "returning-to-dock";
    ship.repairPortId = 123;
    match.shipAdmission.recover(ship, goal, 1);
    const saved = match.shipAdmission.checkpoint();
    match.shipAdmission.recover(ship, goal, 2);
    expect(match.shipAdmission.checkpoint()).toEqual(saved);
  });
  it("terminates repeatedly limited replacements with an explicit capacity outcome and leaves voyages intact", () => {
    const { map, match, ships, ids } = fixture();
    const voyages = ships.map((s) => ({
      destination: s.destination,
      path: [...s.path],
    }));
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: ids,
      tile: map.ref(50, 40),
    });
    const id = match.shipAdmission.events.slice(-1)[0]!.id;
    for (const tick of [10, 40, 100])
      match.shipAdmission.completed(id, ids[0], "limited", [], tick);
    expect(match.shipAdmission.pendingCount).toBe(0);
    expect(match.shipAdmission.events.slice(-1)[0]).toMatchObject({
      status: "rejected",
      reason: expect.stringContaining("capacity"),
    });
    expect(
      ships.map((s) => ({ destination: s.destination, path: s.path })),
    ).toEqual(voyages);
  });
  it("plans later waypoints without synchronous searches and preserves committed legs on takeover", () => {
    const { map, match, ships, ids } = fixture(),
      first = map.ref(12, 30),
      second = map.ref(20, 35);
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: ids,
      tile: first,
    });
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: ids,
      tile: second,
      append: true,
    });
    finish(match);
    const sync = vi.spyOn(match.waterPaths, "find");
    for (let i = 0; i < 200 && !match.shipAdmission.executing(ids[0]); i++)
      match.step();
    expect(match.shipAdmission.executing(ids[0])).toBe(true);
    match.setAiController(1, true);
    for (let i = 0; i < 200 && ships.some((s) => s.destination !== null); i++)
      match.step();
    expect(
      ships.every((s) => s.destination === null && match.tileOf(s) === second),
    ).toBe(true);
    expect(sync).not.toHaveBeenCalled();
  });
  it("activates the whole selection only after its shared water searches complete", () => {
    const { map, match, ships, ids } = fixture(),
      tile = map.ref(70, 50);
    expect(
      match.applyCommand({ type: "sail", playerId: 1, shipIds: ids, tile }),
    ).toBeNull();
    expect(ships.every((s) => s.destination === null)).toBe(true);
    for (let i = 0; i < 400 && match.shipAdmission.pendingCount; i++) {
      const activated = ships.filter((s) => s.destination === tile).length;
      expect(activated === 0 || activated === ships.length).toBe(true);
      match.step();
    }
    expect(match.shipAdmission.pendingCount).toBe(0);
    expect(ships.every((s) => s.destination === tile)).toBe(true);
  });
  it("continues an old voyage while planning, and keeps subset Shift waypoints after replacement", () => {
    const { map, match, ships, ids } = fixture(),
      old = map.ref(50, 35),
      next = map.ref(70, 50),
      append = map.ref(75, 60);
    match.applyCommand({ type: "sail", playerId: 1, shipIds: ids, tile: old });
    finish(match);
    const positions = ships.map((s) => ({ x: s.x, y: s.y }));
    match.applyCommand({ type: "sail", playerId: 1, shipIds: ids, tile: next });
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: [ids[0]],
      tile: append,
      append: true,
    });
    match.step();
    expect(ships.every((s) => s.destination === old)).toBe(true);
    expect(
      ships.some((s, i) => s.x !== positions[i].x || s.y !== positions[i].y),
    ).toBe(true);
    finish(match);
    expect(ships.every((s) => s.destination === next)).toBe(true);
    expect(ships[0].waypoints).toEqual([append]);
    expect(ships[1].waypoints).toEqual([]);
  });
  it("preserves a valid pending voyage when its proposed replacement is disconnected", () => {
    const { map, match, ships, ids } = fixture(),
      tile = map.ref(70, 50);
    match.applyCommand({ type: "sail", playerId: 1, shipIds: ids, tile });
    expect(
      match.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: ids,
        tile: map.ref(95, 50),
      }),
    ).toBeTruthy();
    finish(match);
    expect(ships.every((s) => s.destination === tile)).toBe(true);
  });
  it("a stop supersedes the whole pending selection without activating any member", () => {
    const { map, match, ships, ids } = fixture();
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: ids,
      tile: map.ref(70, 50),
    });
    match.step();
    expect(
      match.applyCommand({
        type: "stop-ships",
        playerId: 1,
        shipIds: [ids[0]],
      }),
    ).toBeNull();
    for (let i = 0; i < 10; i++) match.step();
    expect(match.shipAdmission.pendingCount).toBe(0);
    expect(ships.every((s) => s.destination === null)).toBe(true);
    expect(match.routePlanner.diagnostics.pending).toBe(0);
  });
  it("restores unfinished water planning and later waypoints in the same schedule", () => {
    const { map, match, ids } = fixture();
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: ids,
      tile: map.ref(70, 50),
    });
    match.applyCommand({
      type: "sail",
      playerId: 1,
      shipIds: ids,
      tile: map.ref(75, 60),
      append: true,
    });
    match.step();
    const clone = new Skirmish(map, match.options);
    clone.restore(match.checkpoint());
    for (let i = 0; i < 400 && match.shipAdmission.pendingCount; i++) {
      match.step();
      clone.step();
    }
    expect(match.shipAdmission.pendingCount).toBe(0);
    expect(clone.checkpoint()).toEqual(match.checkpoint());
  });
  it("refuses AI movement that would overwrite a returning or repairing ship", () => {
    const { map, match, ships, ids } = fixture();
    match.setAiController(1, true);
    match.updateShip(ships[0].id, { repairState: "returning-to-dock" });
    match.updateShip(ships[0].id, { repairPortId: 99 });
    expect(
      match.applyCommand({
        type: "sail",
        playerId: 1,
        shipIds: ids,
        tile: map.ref(70, 50),
      }),
    ).toBeTruthy();
    expect(ships[0].repairState).toBe("returning-to-dock");
    expect(ships[0].repairPortId).toBe(99);
    expect(match.shipAdmission.pendingCount).toBe(0);
  });
});
