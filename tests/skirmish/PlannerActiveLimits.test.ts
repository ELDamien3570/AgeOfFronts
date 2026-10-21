import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { LandPaths, WaterPaths } from "../../src/skirmish/Pathfinding";
import { RoutePlanner } from "../../src/skirmish/RoutePlanner";

/** Scheduling v6: background corridors (held by the shared per-tick
 * crossing-tree preparation allowance) and background exact searches (held
 * by arena work) have separate active limits, so cold corridors cannot starve
 * every exact background search (Mig 500: AI admissions behind trade). */
interface Context { corridor: boolean }
function fixture(version?: 5) {
  const W = 400, H = 60, map = new GameMapImpl(W, H, new Uint8Array(W * H).fill(133), W * H);
  const done = new Map<string, number>();
  let tick = 0;
  const planner = new RoutePlanner<Context>(new LandPaths(map, false), new WaterPaths(map, false), {
    priority: () => false, corridorReady: (r) => r.context.corridor,
    valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
    completed: (r, outcome) => { if (outcome === "complete") done.set(r.key, tick); },
  });
  if (version) planner.restore({ ...planner.checkpoint(), scheduling: { ...planner.checkpoint().scheduling, version } });
  const request = (key: string, corridor: boolean, y: number) => planner.request({
    key, start: map.ref(2, y), goal: map.ref(W - 3, (y * 7) % H), water: false, createdTick: 0, obstacleRevision: "0", context: { corridor },
  });
  const step = () => { planner.step(tick, 4096); tick++; };
  return { planner, request, step, done, now: () => tick };
}

/** Ticks at which the exact search and the first corridor completed. */
function race(version?: 5) {
  const f = fixture(version);
  for (let i = 0; i < 16; i++) expect(f.request(`corridor:${i}`, true, 2 + i * 3)).toBe(true);
  for (let i = 0; i < 3; i++) f.step();
  expect(f.request("exact", false, 30)).toBe(true);
  for (let i = 0; i < 400 && f.done.size < 17; i++) f.step();
  expect(f.done.size).toBe(17);
  return { exact: f.done.get("exact")!, firstCorridor: Math.min(...[...f.done].filter(([k]) => k !== "exact").map(([, t]) => t)) };
}

describe("planner active limits (scheduling v6)", () => {
  it("runs an exact background search while 16 cold corridors prepare", () => {
    const v6 = race();
    expect(v6.exact).toBeLessThan(v6.firstCorridor);
  });
  it("version 5 checkpoints keep one shared limit (the exact search waits for a corridor)", () => {
    const v5 = race(5);
    expect(v5.exact).toBeGreaterThanOrEqual(v5.firstCorridor);
  });
});

/** Paid traffic must not monopolize every active corridor forever. */
function continuouslyPaidRace(balanced: boolean) {
  const width = 400, height = 60, map = new GameMapImpl(width, height, new Uint8Array(width * height).fill(133), width * height);
  let tick = 0, paidComplete = 0, departureComplete = -1, nextId = 12;
  type Traffic = { paid: boolean };
  const requestPaid = (id: number) => planner.request({ key: `paid:${id}`, start: map.ref(2, id % 50 + 2), goal: map.ref(397, id * 7 % 50 + 2),
    water: false, createdTick: tick, obstacleRevision: "0", context: { paid: true } });
  const planner = new RoutePlanner<Traffic>(new LandPaths(map, false), new WaterPaths(map, false), {
    priority: () => false, balancedActiveAdmission: balanced, committed: request => request.context.paid,
    corridorReady: () => true, valid: () => true, obstacleRevision: () => "0", blocked: () => undefined,
    completed: (request, outcome) => {
      if (outcome !== "complete") return;
      if (request.context.paid) { paidComplete++; requestPaid(nextId++); }
      else departureComplete = tick;
    },
  });
  for (let id = 0; id < 12; id++) expect(requestPaid(id)).toBe(true);
  for (; tick < 3; tick++) planner.step(tick, 4096);
  expect(planner.request({ key: "departure", start: map.ref(2, 30), goal: map.ref(3, 30), water: false,
    createdTick: tick, obstacleRevision: "0", context: { paid: false } })).toBe(true);
  for (; tick < 500 && departureComplete < 0; tick++) planner.step(tick, 4096);
  for (let tail = 0; tail < 100; tail++, tick++) planner.step(tick, 4096);
  return { departureComplete, paidComplete, planner };
}
describe("balanced active admission (scheduling v7)", () => {
  it("keeps unpaid departures progressing during continuous paid corridor replenishment", () => {
    const fixed = continuouslyPaidRace(true);
    expect(fixed.paidComplete).toBeGreaterThan(0);
    expect(fixed.departureComplete).toBeGreaterThanOrEqual(0);
    expect(fixed.planner.checkpoint().scheduling.version).toBe(7);
  });
  it("retains the old active-slot behavior when restoring scheduling v6", () => {
    const old = continuouslyPaidRace(false);
    const fixed = continuouslyPaidRace(true);
    expect(old.departureComplete).toBeGreaterThan(fixed.departureComplete);
    expect(fixed.departureComplete).toBeLessThan(40);
    expect(old.planner.checkpoint().scheduling.version).toBe(6);
  });
});

function mixedMediumRace(balanced: boolean) {
  const width = 400, height = 96, terrain = new Uint8Array(width * height).fill(133);
  for (let y = 64; y < height; y++) terrain.fill(0, y * width, (y + 1) * width);
  for (let y = 64; y < 92; y++) terrain[y * width + 200] = 133;
  const map = new GameMapImpl(width, height, terrain, terrain.length);
  const results = new Map<string, number>(); let tick = 0;
  const planner = new RoutePlanner<{ paid: boolean; human?: boolean }>(new LandPaths(map, false), new WaterPaths(map, false), {
    balancedActiveAdmission: balanced, lendIdlePreparation: true,
    priority: request => !!request.context.human, committed: request => request.context.paid,
    identity: request => ({ playerId: request.context.human ? 2 : 1, caller: request.context.human ? "admission" : "trade" }),
    corridorReady: () => true, valid: () => true, blocked: () => undefined, obstacleRevision: () => "0",
    allowExclusiveRetry: () => false,
    completed: (request, outcome) => { if (outcome === "complete") results.set(request.key, tick); },
  });
  for (let i = 0; i < 14; i++) planner.request({ key: `land:${i}`, start: map.ref(2, i * 4 + 2), goal: map.ref(397, (i * 7) % 60 + 2),
    water: false, createdTick: 0, obstacleRevision: "0", context: { paid: true } });
  for (; tick < 3; tick++) planner.step(tick, 10240);
  planner.request({ key: "sea", start: map.ref(2, 66), goal: map.ref(397, 66), water: true,
    createdTick: tick, obstacleRevision: "0", context: { paid: false } });
  planner.request({ key: "human", start: map.ref(350, 55), goal: map.ref(351, 55), water: false,
    createdTick: tick, obstacleRevision: "0", context: { paid: false, human: true } });
  for (; tick < 300 && results.size < 16; tick++) expect(planner.step(tick, 10240)).toBeLessThanOrEqual(10240);
  return { results, planner };
}
describe("shared land/water preparation", () => {
  it("completes cold water work alongside paid land traffic and preserves human latency", () => {
    const fixed = mixedMediumRace(true), legacy = mixedMediumRace(false);
    expect(fixed.results.size).toBe(16);
    expect(fixed.results.get("human")! - 3).toBeLessThan(8);
    expect(fixed.results.get("human")).toBeLessThanOrEqual(legacy.results.get("human")!);
    expect(fixed.results.get("sea")).toBeLessThan(legacy.results.get("sea")!);
    expect(fixed.planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(65536);
  });
});

describe("scheduler v7 paid-reserve occupancy", () => {
  function pool(balanced: boolean) {
    const map = new GameMapImpl(100, 60, new Uint8Array(6000).fill(133), 6000);
    const planner = new RoutePlanner<{ paid: boolean; human: boolean; player: number }>(new LandPaths(map, false), new WaterPaths(map, false), {
      balancedActiveAdmission: balanced, priority: request => request.context.human,
      committed: request => request.context.paid,
      identity: request => ({ playerId: request.context.player, caller: request.context.human ? "admission" : "trade" }),
      valid: () => true, blocked: () => undefined, obstacleRevision: () => "0", completed: () => {},
    });
    let id = 0;
    return { planner, request: (paid: boolean, human = false, player = 1) => planner.request({ key: `pool:${id++}`,
      start: 0, goal: 1, water: false, createdTick: 0, obstacleRevision: "0", context: { paid, human, player } }) };
  }
  it("counts already occupied paid slots toward the reserve instead of leaving them empty twice", () => {
    const fixed = pool(true), old = pool(false);
    for (const f of [fixed, old]) {
      for (let i = 0; i < 40; i++) expect(f.request(true)).toBe(true);
      for (let i = 0; i < 64; i++) expect(f.request(false)).toBe(true);
    }
    expect(old.request(false)).toBe(false);
    for (let i = 0; i < 16; i++) expect(fixed.request(false)).toBe(true);
    expect(fixed.request(false)).toBe(false);
    for (let i = 0; i < 8; i++) expect(fixed.request(false, true)).toBe(true);
    expect(fixed.planner.pendingCount).toBe(128);
  });
  it("still reserves sixteen paid slots when 64 interactive jobs occupy their share", () => {
    const f = pool(true);
    for (let player = 1; player <= 4; player++) for (let i = 0; i < 16; i++) expect(f.request(false, true, player)).toBe(true);
    for (let i = 0; i < 48; i++) expect(f.request(false)).toBe(true);
    expect(f.request(false)).toBe(false);
    for (let i = 0; i < 16; i++) expect(f.request(true)).toBe(true);
    expect(f.planner.pendingCount).toBe(128);
  });
});


describe("scheduler v7 admission fairness before active work", () => {
  function saturated(checkWater = true) {
    const terrain = new Uint8Array(6000).fill(133); terrain.fill(0, 3000);
    const map = new GameMapImpl(100, 60, terrain, terrain.length);
    const ports = { balancedActiveAdmission: true, priority: () => false, committed: (request: {context:{paid:boolean}}) => request.context.paid,
      valid: () => true, blocked: () => undefined, obstacleRevision: () => "0", completed: () => {} };
    const create = () => new RoutePlanner<{paid:boolean}>(new LandPaths(map, false), new WaterPaths(map, false), ports);
    const planner = create(); let id = 0;
    const request = (target: typeof planner, water: boolean, paid = true) => target.request({ key: `admission:${id++}`,
      start: water ? 3100 : 0, goal: water ? 3101 : 1, water, createdTick: 0, obstacleRevision: "0", context: { paid } });
    for (let i = 0; i < 120; i++) expect(request(planner, false)).toBe(true);
    if (checkWater) expect(request(planner, true)).toBe(false); // canonical water retry intent
    return { planner, request, create };
  }
  it("prevents a saturated land table refilling ahead of a waiting water request, including after restore", () => {
    const f = saturated(), cold = f.create(); cold.restore(f.planner.checkpoint());
    for (const planner of [f.planner, cold]) {
      planner.cancel("admission:0"); planner.step(0, 1);
      expect(planner.pendingCount).toBe(119);
      expect(f.request(planner, false)).toBe(false);
      expect(f.request(planner, true)).toBe(true);
      expect(planner.pendingCount).toBe(120);
    }
  });
  it("lends an abandoned medium's admission share after its finite demand lease expires", () => {
    const f = saturated(); f.planner.cancel("admission:0"); f.planner.step(17, 1);
    expect(f.planner.pendingCount).toBe(119);
    expect(f.request(f.planner, false)).toBe(true);
  });

  it("keeps a refused unpaid request from being locked outside a paid-only table", () => {
    const f = saturated(false);
    expect(f.request(f.planner, false, false)).toBe(false);
    const cold = f.create(); cold.restore(f.planner.checkpoint());
    for (const planner of [f.planner, cold]) {
      planner.cancel("admission:0"); planner.step(0, 1);
      expect(f.request(planner, false, true)).toBe(false);
      expect(f.request(planner, false, false)).toBe(true);
      expect(planner.pendingCount).toBe(120);
    }
  });

});


describe("human arena retry and cold civilian holders", () => {
  it("loans idle corridor preparation so a full-arena human retry can start", () => {
    const width = 400, height = 96, terrain = new Uint8Array(width * height).fill(133);
    terrain.fill(0, 64 * width);
    for (let y = 64; y < 92; y++) terrain[y * width + 200] = 133;
    const map = new GameMapImpl(width, height, terrain, terrain.length);
    let tick = 0, humanTick = -1, retried = false;
    const create = () => new RoutePlanner<{ human: boolean }>(new LandPaths(map, false), new WaterPaths(map, false), {
      balancedActiveAdmission: true, lendIdlePreparation: true,
      priority: request => request.context.human, committed: () => true,
      identity: request => ({ playerId: request.context.human ? 2 : 1, caller: request.context.human ? "admission" : "trade" }),
      // The human uses exact search (as an unwarmed amphibious route does).
      corridorReady: request => !request.context.human,
      valid: () => true, blocked: () => undefined, obstacleRevision: () => "0",
      completed: (request, outcome) => {
        if (request.key === "human") { expect(outcome).toBe("complete"); humanTick = tick; }
      },
    }, 128, 1024);
    const planner = create();
    let cold: ReturnType<typeof create> | undefined;
    for (let id = 0; id < 8; id++) expect(planner.request({ key: `water:${id}`, start: map.ref(2, 65 + id),
      goal: map.ref(397, 65 + id), water: true, createdTick: 0, obstacleRevision: "0", context: { human: false } })).toBe(true);
    planner.step(tick++, 10240);
    expect(planner.request({ key: "human", start: map.ref(10, 10), goal: map.ref(55, 35), water: false,
      createdTick: tick, obstacleRevision: "0", context: { human: true } })).toBe(true);
    for (; tick < 100 && humanTick < 0; tick++) {
      expect(planner.step(tick, 10240)).toBeLessThanOrEqual(10240);
      const checkpoint = planner.checkpoint();
      const waiting = checkpoint.jobs.some(job => job.context.human && !!job.waitingForWorkspace);
      retried ||= waiting;
      if (cold) {
        expect(cold.step(tick, 10240)).toBeLessThanOrEqual(10240);
        expect(cold.checkpoint()).toEqual(checkpoint);
      } else if (waiting) {
        cold = create(); cold.restore(checkpoint);
      }
    }
    expect(retried).toBe(true);
    expect(cold).toBeDefined();
    // Before the loan correction this exact fixture completed at tick 13.
    expect(humanTick).toBeGreaterThanOrEqual(0);
    expect(humanTick).toBeLessThanOrEqual(6);
    expect(planner.diagnostics.workspaceUsed).toBeLessThanOrEqual(1024);
  });
});
