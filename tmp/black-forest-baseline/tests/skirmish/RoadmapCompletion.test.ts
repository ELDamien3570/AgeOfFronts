import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FormationPlanning } from "../../src/skirmish/FormationPlanning";
import { Formations } from "../../src/skirmish/Formations";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { ranking, rankStep } from "../../src/skirmish/RankedWork";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { AI_DOCTRINES } from "../../src/skirmish/content/AiDoctrines";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { economicSnapshot } from "../../src/skirmish/domain/AiEconomicSnapshot";
import { forceReadiness } from "../../src/skirmish/domain/AiForceReadiness";
import { AiProductionDependencies } from "../../src/skirmish/domain/AiProductionDependencies";
import { CohortAdmission } from "../../src/skirmish/domain/CohortAdmission";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import type {
  DomainRoutePorts,
  DomainRouteTask,
} from "../../src/skirmish/domain/DomainRoutePorts";
import { retainSquads } from "./UnitFixtures";

function fixture(water = false, count = 6) {
  const width = 96,
    height = 64,
    data = new Uint8Array(width * height).fill(133);
  if (water)
    for (let y = 0; y < height; y++)
      for (let x = 40; x < 48; x++) data[y * width + x] = 0;
  const map = new GameMapImpl(
    width,
    height,
    data,
    data.filter((t) => t & 128).length,
  );
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    runAi: false,
    deferredPlanning: true,
    aiEconomy: true,
    aiNaval: true,
  });
  game.owners.fill(0);
  game.players[0].base = map.ref(80, 30);
  game.players[1].base = map.ref(15, 30);
  const template = game.squads.find((s) => s.playerId === 2)!;
  const own = retainSquads(game, [
    ...game.squads
      .filter((s) => s.playerId === 1)
      .map((s) => ({ ...s, x: 85.5 * FIXED, y: 55.5 * FIXED })),
    ...Array.from({ length: count }, (_, i) => ({
      ...structuredClone(template),
      id: game.allocateId(),
      x: (15.5 + (i % 4) * 2) * FIXED,
      y: (28.5 + Math.floor(i / 4) * 2) * FIXED,
      order: { type: "hold" } as Squad["order"],
      queuedOrders: [],
      path: [],
    })),
  ]).filter((s) => s.playerId === 2);
  return {
    game,
    map,
    own,
    expansion: game.expansion!,
    player: game.players[1],
  };
}
function ports(f: ReturnType<typeof fixture>) {
  let now = 0,
    revision = "stable",
    generation = 0;
  const tasks: {
      task: DomainRouteTask;
      start: number;
      goal: number;
      water: boolean;
    }[] = [],
    events: unknown[] = [];
  const api: DomainRoutePorts = {
    generation: () => generation,
    tick: () => now,
    orderRevision: () => 0,
    revision: () => revision,
    clear: () => true,
    destinationValid: () => true,
    event: (_, event) => events.push(event),
    request: (task, start, goal, water = false) => {
      tasks.push({ task, start, goal, water });
      return true;
    },
    cancel: () => {},
  };
  return {
    api,
    tasks,
    events,
    setTick: (tick: number) => (now = tick),
    setRevision: (value: string) => (revision = value),
    setGeneration: (value: number) => (generation = value),
  };
}
describe("remaining roadmap integration", () => {
  it("resumes stable ranking inside a one-record allowance and restores equal ties", () => {
    let state = ranking([
      { n: 4, id: 1 },
      { n: 1, id: 2 },
      { n: 4, id: 3 },
      { n: 2, id: 4 },
      { n: 1, id: 5 },
    ]);
    for (let i = 0; i < 100 && !state.done; i++) {
      expect(rankStep(state, (a, b) => a.n - b.n, 1)).toBeLessThanOrEqual(1);
      state = structuredClone(state);
    }
    expect(state.done).toBe(true);
    expect(state.rows.map((r) => r.id)).toEqual([2, 5, 4, 1, 3]);
  });
  it("formation setup and crowded member selection yield and retain reference ties", () => {
    const f = fixture(false, 20),
      members = f.own.map((squad) => ({ squad, origin: squad }));
    const reference = new Formations(f.map, f.game.paths).plan(
      f.map.ref(40, 30),
      members,
      f.game.squads,
    );
    let state = new FormationPlanning(
      f.map,
      f.game.paths,
      f.map.ref(40, 30),
      members,
      () => f.game.squads,
    ).state;
    expect(state.phase).toBe("setup");
    for (
      let i = 0;
      i < 30000 && state.phase !== "done" && state.phase !== "failed";
      i++
    ) {
      const planner = new FormationPlanning(
        f.map,
        f.game.paths,
        state.center,
        [],
        () => f.game.squads,
        Infinity,
        undefined,
        state,
      );
      expect(planner.step(3)).toBeLessThanOrEqual(3);
      if (i === 20) state = structuredClone(state);
    }
    expect(state.phase).toBe("done");
    expect(state.result).toEqual(reference);
  });
  it("publishes no partial cohort, persists in-flight paths, and rejects a changed domain commit", () => {
    const f = fixture(false, 3),
      p = ports(f),
      commits: unknown[] = [];
    const cohort = new CohortAdmission("army", {
      map: f.map,
      paths: f.game.paths,
      squad: (id) => f.game.squad(id),
      squads: () => f.game.squads,
      routes: p.api,
      blocked: () => () => false,
      valid: () => true,
      commit: (_plan, rows) => {
        commits.push(rows.map((r) => r.squad.id));
        return false;
      },
    });
    cohort.start(2, f.own, f.map.ref(28, 30));
    for (let i = 0; i < 12000 && cohort.pendingCount; i++) {
      expect(cohort.step(7)).toBeLessThanOrEqual(7);
      for (const request of p.tasks.splice(0))
        cohort.completedRoute(
          request.task,
          "complete",
          f.game.paths.find(request.start, request.goal)!,
        );
      if (i === 40) {
        const saved = cohort.checkpoint();
        cohort.restore(saved);
        expect(cohort.checkpoint()).toEqual(saved);
      }
    }
    expect(commits).toHaveLength(1);
    expect(cohort.pendingCount).toBe(0);
    expect(p.events[p.events.length - 1]).toMatchObject({ status: "rejected" });
    expect(f.own.every((s) => s.order.type === "hold")).toBe(true);
  });
  it("supersedes a cohort on permission changes before replacing any order", () => {
    const f = fixture(),
      p = ports(f),
      commit = vi.fn();
    const cohort = new CohortAdmission("army", {
      map: f.map,
      paths: f.game.paths,
      squad: (id) => f.game.squad(id),
      squads: () => f.game.squads,
      routes: p.api,
      blocked: () => () => false,
      valid: () => true,
      commit,
    });
    cohort.start(2, f.own, f.map.ref(30, 30));
    cohort.step(2);
    p.setRevision("captured-wall");
    cohort.step(2);
    expect(cohort.pendingCount).toBe(0);
    expect(commit).not.toHaveBeenCalled();
    expect(p.events[p.events.length - 1]).toMatchObject({
      status: "superseded",
    });
  });
  it("admit Army corridors without synchronous route search, then commits the complete selected cohort", () => {
    const f = fixture(false, 4);
    f.expansion.progression.states[2].completed.push("bronzeage-armies");
    expect(
      f.game.applyCommand({
        type: "create-army",
        playerId: 2,
        squadIds: f.own.map((s) => s.id),
      }),
    ).toBeNull();
    const army = f.expansion.armies.armies[0],
      before = f.own.map((s) => structuredClone(s.order)),
      find = vi.spyOn(f.game.paths, "find");
    expect(
      f.game.applyCommand({
        type: "army-order",
        playerId: 2,
        armyId: army.id,
        order: { type: "move", tile: f.map.ref(65, 30) },
      }),
    ).toBeNull();
    expect(f.own.map((s) => s.order)).toEqual(before);
    expect(find).not.toHaveBeenCalled();
    for (let i = 0; i < 800 && army.order.type !== "move"; i++) f.game.step();
    expect(army.order.type).toBe("move");
    expect(f.own.every((s) => s.order.type === "move")).toBe(true);
    expect(find).not.toHaveBeenCalled();
  });
  it("replicates changed metadata once while a new baseline and restored source remain complete", () => {
    const f = fixture(),
      encoder = new SnapshotEncoder(true),
      decoder = new SnapshotDecoder();
    const encode = () =>
      encoder.encode(
        f.game.replicationSource(),
        f.game.tileChanges,
        f.game.replicationFacts(),
      );
    decoder.decode(encode());
    const quiet = encode();
    expect(quiet.expansionMode).toBe("delta");
    expect(quiet.expansion!.progression).toBeUndefined();
    expect(quiet.expansion!.diplomacy).toBeUndefined();
    expect(quiet.expansion!.events).toBeUndefined();
    f.expansion.announce({
      actorId: 2,
      kind: "war",
      action: "declare",
      otherId: 1,
    });
    const event = encode();
    expect(event.expansion!.events).toHaveLength(1);
    expect(event.expansion!.progression).toBeUndefined();
    expect(decoder.decode(event).expansion!.events).toEqual(f.expansion.events);
    expect(encode().expansion!.events).toBeUndefined();
    f.game.restore(f.game.checkpoint());
    const restored = encode();
    expect(restored.expansionMode).toBe("full");
    expect(restored.expansion!.progression).toBeDefined();
    expect(
      new SnapshotEncoder(true).encode(
        f.game.replicationSource(),
        f.game.tileChanges,
        f.game.replicationFacts(),
      ).expansion!.diplomacy,
    ).toBeDefined();
  });
  it("completes a restored upstream quote in bounded steps and subtracts shared protected stock once", () => {
    const f = fixture(),
      snapshot = economicSnapshot({
        player: f.player,
        tick: 0,
        generation: 0,
        age: "Modern",
        research: TECHNOLOGIES.map((t) => t.id),
        inventory: { iron: 8, carbon: 20, ironOre: 200 },
        buildings: [],
        squads: [],
        ships: [],
        jobs: [],
        production: {},
        cap: 20,
        threatTroops: 0,
      });
    const dependencies = new AiProductionDependencies(
      snapshot,
      new Set(["ironOre", "carbon"]),
      { iron: 8 },
    );
    let quote = dependencies.beginMaterials({ steel: 20, iron: 10 });
    for (let i = 0; i < 256 && quote.phase !== "done"; i++) {
      expect(dependencies.stepMaterials(quote, 1)).toBeLessThanOrEqual(1);
      if (i === 4) quote = structuredClone(quote);
    }
    expect(quote.phase).toBe("done");
    expect(quote.status).toBe("available");
    expect(quote.materials.iron).toBe(16);
    expect(quote.materials.ironOre).toBe(30);
    expect(quote.ticks).toBe(1080);
    expect(quote.reasons.some((r) => r.reason === "workshop")).toBe(true);
    expect(quote.reasons.some((r) => r.reason === "protected")).toBe(true);
  });
  it("uses eleven authored contracts and never declares from a synthetic force count alone", () => {
    const f = fixture(false, 1);
    expect(Object.keys(AI_DOCTRINES)).toHaveLength(11);
    expect(
      new Set(Object.values(AI_DOCTRINES).map((d) => d.contract)).size,
    ).toBe(11);
    expect(AI_DOCTRINES.rider.preferredRoles[0]).toBe("mounted");
    expect(AI_DOCTRINES.skirmisher.engagement).toBe("fire-retreat");
    expect(forceReadiness(f.expansion, f.player, 6).reason).toBe("force");
    f.game.options.aiWarPolicy = true;
    f.game.tick = 5000;
    f.expansion.operations.step(new Map([[2, 20]]));
    expect(f.expansion.operations.state(2)?.phase).not.toBe("war");
  });
  it("bounds AI outgoing diplomacy independently of immediate human replies and restores pair cooldowns", () => {
    const f = fixture(),
      a = f.player,
      b = f.game.players[0],
      dip = new Diplomacy({
        maximumOutgoing: 1,
        proposerTicks: 2400,
        recipientTicks: 1200,
        declinedPairTicks: 3600,
        brokenPairTicks: 6000,
      });
    expect(dip.action(a, b, "offer", 0)).toBeNull();
    expect(dip.action(b, a, "reject", 1)).toBeNull();
    expect(dip.action(a, b, "offer", 3000)).toMatch(/cooldown|recent|contact/i);
    const saved = dip.checkpoint();
    dip.restore(saved);
    expect(dip.checkpoint()).toEqual(saved);
    dip.step(4000, [a, b]);
    expect(dip.action(a, b, "offer", 4000)).toBeNull();
  });
  it("keeps all staged planners deterministic across a mid-admission authoritative checkpoint", () => {
    const f = fixture(true, 4);
    f.expansion.progression.states[2].completed.push("stoneage-cargo-canoes");
    expect(
      f.game.applyCommand({
        type: "order",
        playerId: 2,
        squadIds: f.own.map((s) => s.id),
        order: { type: "move", tile: f.map.ref(70, 30) },
      }),
    ).toBeNull();
    for (let i = 0; i < 40; i++) f.game.step();
    const saved = f.game.checkpoint(),
      other = fixture(true, 4).game;
    other.restore(saved);
    for (let i = 0; i < 80; i++) {
      f.game.step();
      other.step();
    }
    expect(other.checkpoint()).toEqual(f.game.checkpoint());
  });
});
