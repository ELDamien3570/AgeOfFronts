import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { UNIT } from "../../src/skirmish/content/Units";
import {
  createFormation,
  formationSlots,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { MovementReadiness } from "../../src/skirmish/MovementReadiness";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { retainSquads } from "./UnitFixtures";

function fixture(count = 8, long = false) {
  const width = 200,
    height = 100,
    map = new GameMapImpl(
      width,
      height,
      new Uint8Array(width * height).fill(133),
      width * height,
    );
  const game = new Skirmish(map, {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    deferredPlanning: true,
    formationLocomotion: true,
    formationReorientation: true,
    formationFreeTravel: true,
  });
  const template = game.squads.find((s) => s.playerId === 1)!;
  const squads = retainSquads(
    game,
    Array.from({ length: count }, (_, i) => ({
      ...structuredClone(template),
      id: game.allocateId(),
      x: (10.5 + i * 0.7) * FIXED,
      y: 30.5 * FIXED,
      order: { type: "hold" as const },
      path: [],
      queuedOrders: [],
    })),
  );
  const requests: { a: number; s: number; start: number; goal: number }[] = [],
    ports = (game.movementAdmission as any).ports;
  ports.request = (
    a: number,
    _p: number,
    s: number,
    start: number,
    goal: number,
  ) => {
    requests.push({ a, s, start, goal });
    return true;
  };
  if (!long) {
    ports.connector = undefined;
    ports.preview = undefined;
  }
  const command = {
    type: "order" as const,
    playerId: 1,
    squadIds: squads.map((s) => s.id),
    order: { type: "move" as const, tile: map.ref(long ? 150 : 30, 30) },
  };
  const complete = (r: (typeof requests)[number]) =>
    game.movementAdmission.completed(
      r.a,
      r.s,
      "complete",
      [r.start, ...game.paths.findExact(r.start, r.goal)!],
      game.tick,
    );
  return { game, map, squads, requests, ports, command, complete };
}
function steps(game: Skirmish, n: number) {
  for (let i = 0; i < n; i++) game.step();
}

describe("independent player movement", () => {
  it("commits seven ready members while the eighth search remains outstanding", () => {
    const f = fixture();
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 10);
    expect(f.requests).toHaveLength(8);
    for (const r of f.requests.slice(0, 7)) f.complete(r);
    steps(f.game, 10);
    for (const s of f.squads.slice(0, 7)) {
      expect(f.game.movementAdmission.hasPending(s.id)).toBe(false);
      expect(f.game.squad(s.id)!.order.type).toBe("move");
    }
    expect(f.game.movementAdmission.hasPending(f.squads[7].id)).toBe(true);
    expect(f.game.commandApplications.diagnostics.pending).toBe(1);
    f.complete(f.requests[7]);
    steps(f.game, 3);
    expect(f.game.commandApplications.diagnostics.pending).toBe(0);
  });
  it("retains surviving intentions when a member dies before layout finishes", () => {
    const f = fixture();
    const outcomes: any[] = [];
    f.game.commandApplications.onOutcome = (o) => outcomes.push(o);
    f.game.commandApplications.apply("move", f.command);
    f.game.removeSquad(f.squads[0].id);
    steps(f.game, 10);
    expect(f.requests).toHaveLength(7);
    expect(f.game.commandApplications.diagnostics.pending).toBe(1);
    for (const r of f.requests) f.complete(r);
    steps(f.game, 10);
    for (const s of f.squads.slice(1))
      expect(f.game.squad(s.id)!.order.type).toBe("move");
    expect(outcomes[outcomes.length - 1].status).toBe("superseded");
    expect(f.game.commandApplications.diagnostics.pending).toBe(0);
  });
  it("redirects only the selected member and ignores its late route completion", () => {
    const f = fixture();
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 10);
    const victim = f.squads[0].id;
    f.game.commandApplications.apply("stop", {
      type: "order",
      playerId: 1,
      squadIds: [victim],
      order: { type: "hold" },
    });
    for (const s of f.squads.slice(1))
      expect(f.game.movementAdmission.hasPending(s.id)).toBe(true);
    for (const r of f.requests) f.complete(r);
    steps(f.game, 10);
    expect(f.game.squad(victim)!.order.type).toBe("hold");
    for (const s of f.squads.slice(1))
      expect(f.game.squad(s.id)!.order.type).toBe("move");
  });
  it("lets cheap members start while an incompatible distant family waits", () => {
    const f = fixture(8, true);
    for (const s of f.squads.slice(1))
      f.game.updateSquad(s.id, { x: 140 * FIXED });
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 12);
    expect(f.game.movementAdmission.hasPending(f.squads[0].id)).toBe(true);
    for (const s of f.squads.slice(1))
      expect(f.game.movementAdmission.hasPending(s.id)).toBe(false);
  });
  it("moves on a certified prefix, stops there and keeps Shift legs while discovery waits", () => {
    const f = fixture(1, true),
      s = f.squads[0],
      start = { x: s.x, y: s.y };
    const stages: string[] = [];
    f.game.movementAdmission.onMemberProgress = (_s, _t, stage) =>
      stages.push(stage);
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 8);
    f.game.commandApplications.apply("shift", {
      ...f.command,
      append: true,
      order: { type: "move", tile: f.map.ref(160, 30) },
    });
    steps(f.game, 100);
    const live = f.game.squad(s.id)!;
    expect(Math.hypot(live.x - start.x, live.y - start.y)).toBeGreaterThan(8);
    expect(Math.hypot(live.x - start.x, live.y - start.y)).toBeLessThan(
      3 * FIXED,
    );
    expect(stages).toContain("prefix");
    expect(f.game.movementAdmission.hasPending(s.id)).toBe(true);
    expect(live.order.type).toBe("move");
    expect(f.game.movementAdmission.queued([s.id])).toBe(1);
    const stopped = { x: live.x, y: live.y };
    steps(f.game, 40);
    expect({ x: live.x, y: live.y }).toEqual(stopped);
    f.game.movementAdmission.completed(
      f.requests[0].a,
      s.id,
      "unreachable",
      [],
      f.game.tick,
    );
    expect(live.order.type).toBe("hold");
    expect(live.queuedOrders).toHaveLength(1);
  });
  it("uses the first forward prefix point instead of turning toward its own tile center", () => {
    const f = fixture(1, true),
      id = f.squads[0].id;
    f.game.updateSquad(id, {
      locomotion: { heading: 0, targetHeading: 0, speed: 0 },
    });
    const start = { x: f.game.squad(id)!.x, y: f.game.squad(id)!.y };
    f.game.commandApplications.apply("south", {
      ...f.command,
      order: { type: "move", tile: f.map.ref(10, 85) },
    });
    f.game.step();
    expect(f.game.squad(id)!.y).toBeGreaterThan(start.y);
    expect(f.game.squad(id)!.x).toBe(start.x);
    expect(f.game.squad(id)!.locomotion!.heading).toBe(0);
  });
  it("joins a completed forward route without retracing an already travelled prefix", () => {
    const f = fixture(1, true),
      id = f.squads[0].id;
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 80);
    const at = f.game.squad(id)!.x;
    expect(at).toBeGreaterThan(11 * FIXED);
    f.complete(f.requests[0]);
    let minimum = at;
    for (let tick = 0; tick < 24; tick++) {
      f.game.step();
      minimum = Math.min(minimum, f.game.squad(id)!.x);
    }
    expect(f.game.movementAdmission.hasPending(id)).toBe(false);
    expect(minimum).toBeGreaterThanOrEqual(at);
    expect(f.game.squad(id)!.x).toBeGreaterThan(at);
  });
  it("restores partially executed prefix movement and queued intentions identically", () => {
    const f = fixture(2, true);
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 7);
    f.game.commandApplications.apply("shift", {
      ...f.command,
      append: true,
      order: { type: "move", tile: f.map.ref(160, 30) },
    });
    steps(f.game, 3);
    const saved = f.game.checkpoint(),
      copy = fixture(2, true).game;
    copy.restore(saved);
    steps(f.game, 30);
    steps(copy, 30);
    expect(copy.checkpoint()).toEqual(f.game.checkpoint());
  });
  it("stops an invalidated prefix without launching a competing navigation search", () => {
    const f = fixture(1, true),
      id = f.squads[0].id,
      start = { x: f.squads[0].x, y: f.squads[0].y };
    f.game.commandApplications.apply("move", f.command);
    f.game.step();
    expect(f.game.movementAdmission.previewEndpoint(id)).toBeDefined();
    const endpoints = f.game.buildings.filter((b) => b.playerId === 1);
    f.game.expansion!.fortifications.addBarrier({
      id: f.game.allocateId(),
      playerId: 1,
      age: "StoneAge",
      a: endpoints[0].id,
      b: endpoints[endpoints.length - 1].id,
      tiles: [28, 29, 30, 31, 32, 33].map((y) => f.map.ref(11, y)),
      health: 1000,
      maxHealth: 1000,
      remainingTicks: 0,
    });
    steps(f.game, 60);
    expect(f.game.routePlanner.has(`navigation:${id}`)).toBe(false);
    expect(f.game.movementAdmission.hasPending(id)).toBe(true);
    expect(f.game.squad(id)!.x).toBeLessThan(11 * FIXED);
    expect(
      Math.hypot(f.game.squad(id)!.x - start.x, f.game.squad(id)!.y - start.y),
    ).toBeLessThan(FIXED / 2);
    const stopped = { x: f.game.squad(id)!.x, y: f.game.squad(id)!.y };
    steps(f.game, 16);
    expect({ x: f.game.squad(id)!.x, y: f.game.squad(id)!.y }).toEqual(stopped);
  });
  it("finishes all two hundred independent intentions while preserving shared discoveries", () => {
    const f = fixture(200),
      committed = new Set<number>();
    f.game.movementAdmission.onMemberProgress = (id, _tick, stage) => {
      if (stage === "commit") committed.add(id);
    };
    f.game.commandApplications.apply("mass", f.command);
    let cursor = 0;
    for (let tick = 0; tick < 120 && committed.size < 200; tick++) {
      f.game.step();
      while (cursor < f.requests.length) f.complete(f.requests[cursor++]);
    }
    expect(committed.size).toBe(200);
    expect(f.game.commandApplications.diagnostics.pending).toBe(0);
  });
  it("retargets automatic deployment continuously and moves before the old deployment ends", () => {
    const f = fixture(1, true),
      id = f.squads[0].id,
      u = UNIT.get("napoleonic-infantry")!,
      manpower = createManpower(u, "base");
    f.game.updateSquad(id, {
      definitionId: u.id,
      kind: u.line,
      troops: manpower.capacity,
      manpower,
      x: 64.5 * FIXED,
      y: 40.5 * FIXED,
      locomotion: {
        heading: -Math.PI / 2,
        targetHeading: -Math.PI / 2,
        speed: 0,
      },
      formation: {
        ...createFormation(u.id),
        shape: "column",
        mode: "travel",
        automatic: true,
        deployedShape: "line",
        facing: (3 * TURN) / 4,
        layoutTroops: manpower.capacity,
      },
    });
    const s = f.game.squad(id)!;
    for (let n = 0; n < 16 && !s.formation?.transition; n++) f.game.step();
    expect(s.formation!.transition!.automaticTravel).toBe(true);
    const oldEnd =
      s.formation!.transition!.startTick + s.formation!.transition!.duration;
    const source = formationSlots(s, f.game.tick + 1),
      start = { x: s.x, y: s.y };
    // Keep the real short connector; the asynchronous fake is not used here.
    f.game.commandApplications.apply("interrupt", {
      type: "order",
      playerId: 1,
      squadIds: [id],
      order: { type: "move", tile: f.map.ref(80, 40) },
    });
    f.game.step();
    expect(s.formation!.shape).toBe("column");
    expect(s.formation!.frontage).toBeUndefined();
    expect(s.formation!.transition!.fromSlots).toEqual(source);
    expect(() => f.game.restore(f.game.checkpoint())).not.toThrow();
    while (
      f.game.tick < oldEnd &&
      Math.hypot(
        f.game.squad(id)!.x - start.x,
        f.game.squad(id)!.y - start.y,
      ) <= 8
    )
      f.game.step();
    expect(
      Math.hypot(f.game.squad(id)!.x - start.x, f.game.squad(id)!.y - start.y),
    ).toBeGreaterThan(8);
    expect(f.game.tick).toBeLessThan(oldEnd);
  });
  it("retains historical movement behavior when restoring an unversioned policy", () => {
    const f = fixture(),
      saved = f.game.movementAdmission.checkpoint();
    delete saved.policyVersion;
    delete saved.families;
    f.game.movementAdmission.restore(saved);
    expect(f.game.movementAdmission.responsive).toBe(false);
    f.game.commandApplications.apply("move", f.command);
    steps(f.game, 5);
    expect(
      f.game.movementAdmission
        .checkpoint()
        .pending.some(([, a]) => a.members.length === 8),
    ).toBe(true);
  });
});

describe("formation readiness service", () => {
  const squad = (id: number, playerId = 1) =>
    ({ id, playerId, embarkedOn: null }) as Squad;
  it("serves fresh movement without a whole-world sweep and leaves periodic progress", () => {
    const land = Array.from({ length: 1528 }, (_, i) => squad(i)),
      q = new MovementReadiness();
    for (const s of land.slice(-60)) q.request(s, 1);
    const seen = new Set<number>();
    for (let tick = 0; tick < 5; tick++) {
      const selected = q.select(land, () => 1, 16);
      expect(selected).toHaveLength(16);
      for (const s of selected) seen.add(s.id);
    }
    for (const s of land.slice(-60)) expect(seen.has(s.id)).toBe(true);
    expect(seen.has(0)).toBe(true);
  });
  it("serves a fresh input ahead of recurring blocked-formation work", () => {
    const land = Array.from({ length: 100 }, (_, i) => squad(i)),
      q = new MovementReadiness();
    for (const s of land.slice(0, 60)) q.request(s, 1, "blocked");
    q.request(land[99], 1);
    expect(q.select(land, () => 1, 16)[0].id).toBe(99);
  });
  it("round-robins seats, ignores obsolete revisions and survives restore", () => {
    const land = [squad(1), squad(2), squad(3, 2)],
      q = new MovementReadiness();
    for (const s of land) q.request(s, 1);
    const saved = q.checkpoint(),
      copy = new MovementReadiness();
    copy.restore(saved);
    expect(
      copy.select(land, (id) => (id === 2 ? 2 : 1), 6).map((s) => s.id),
    ).toEqual(q.select(land, (id) => (id === 2 ? 2 : 1), 6).map((s) => s.id));
    expect(copy.checkpoint()).toEqual(q.checkpoint());
  });
});
