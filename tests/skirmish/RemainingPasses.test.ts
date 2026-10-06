import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AttackApproaches } from "../../src/skirmish/AttackApproaches";
import {
  constructionRejection,
  MAX_BUILDING_STACK,
} from "../../src/skirmish/Construction";
import {
  stackCargoPercent,
  TRADE_RULES,
} from "../../src/skirmish/content/Economy";
import { conquestBuildings } from "../../src/skirmish/domain/AiConquestObjective";
import {
  extractionPriority,
  stoneExtractionAllowed,
} from "../../src/skirmish/domain/AiExtractionPolicy";
import { PlayerAttackContinuation } from "../../src/skirmish/domain/PlayerAttackContinuation";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { FIXED, type Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(river = false) {
  const data = new Uint8Array(96 * 64).fill(133);
  if (river) for (let y = 0; y < 61; y++) data[y * 96 + 30] = 0;
  const map = new GameMapImpl(96, 64, data, data.filter((n) => n & 128).length);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    aiWarPolicy: true,
    deferredPlanning: true,
    aiEconomy: true,
    aiNaval: true,
  });
  return { game, map, e: game.expansion! };
}
describe("remaining gameplay passes", () => {
  it.each([false, true])(
    "bounds last-core evacuation when the owned island is threatened=%s",
    (threatened) => {
      const options = fixture().game.options,
        data = new Uint8Array(96 * 64).fill(133);
      for (let y = 0; y < 64; y++) data[y * 96 + 30] = 0;
      const game = new Skirmish(
          new GameMapImpl(96, 64, data, data.filter((n) => n & 128).length),
          options,
        ),
        e = game.expansion!,
        ai = game.players[1];
      const change = (
        game as unknown as { changeOwner(tile: number, id: number): void }
      ).changeOwner.bind(game);
      for (let tile = 0; tile < data.length; tile++)
        change(tile, game.map.x(tile) > 30 ? ai.id : 1);
      ai.base = game.map.ref(20, 25);
      game.addBuilding({
        id: game.allocateId(),
        playerId: ai.id,
        type: "city",
        tile: ai.base,
        remainingTicks: 0,
      });
      for (const b of [...game.buildings])
        if (b.playerId === ai.id) game.removeBuilding(b.id);
      const own = game.squads.filter((s) => s.playerId === ai.id);
      own.forEach((s, i) =>
        game.updateSquad(s.id, {
          x: (20.5 + i) * FIXED,
          y: 25.5 * FIXED,
          order: { type: "hold" },
          fighting: false,
        }),
      );
      game.squads
        .filter((s) => s.playerId === 1)
        .forEach((s, i) =>
          game.updateSquad(s.id, {
            x: (threatened ? 34.5 : 90.5) * FIXED,
            y: (18.5 + 7 * i) * FIXED,
            troops: 100000,
          }),
        );
      e.progression.states[ai.id].completed.push("stoneage-cargo-canoes");
      game.restore(game.checkpoint());
      game.tick = 60;
      e.economy.recovery.step();
      expect(e.economy.recovery.diagnostics.evacuations).toBe(
        threatened ? 0 : 1,
      );
      const saved = e.economy.recovery.checkpoint();
      e.economy.recovery.restore(saved);
      game.tick = 300;
      e.economy.recovery.step();
      expect(e.economy.recovery.diagnostics.evacuations).toBe(
        threatened ? 0 : 1,
      );
    },
  );
  it("clears a permission-stalled AI move order within a bounded interval across restore", () => {
    const { game, e, map } = fixture(),
      squad = game.squads.find((s) => s.playerId === 2)!;
    game.updateSquad(squad.id, {
      order: { type: "move", tile: map.ref(30, 30) },
      movementStatus: { reason: "restricted", since: 0, blockerIds: [] },
    });
    game.tick = 60;
    e.economy.recovery.step();
    const saved = e.economy.recovery.checkpoint();
    e.economy.recovery.restore(saved);
    game.tick = 180;
    e.economy.recovery.step();
    expect(squad.order.type).toBe("hold");
    expect(e.economy.recovery.diagnostics.clearedRestricted).toBe(1);
  });
  it("bounded retargeting prefers an available enemy over an overloaded nearer one", () => {
    const { game } = fixture(),
      own = game.squads.find((s) => s.playerId === 1)!,
      template = game.squads.find((s) => s.playerId === 2)!;
    const near = { ...template, id: 900, x: own.x + 3 * FIXED, y: own.y };
    const available = { ...template, id: 901, x: own.x + 4 * FIXED, y: own.y };
    const pursuit = new PlayerAttackContinuation();
    const attacker = {
      ...own,
      order: { type: "attack" as const, targetId: near.id },
    };
    pursuit.observe(attacker, near);
    expect(
      pursuit.choose(
        attacker,
        0,
        () => [near, available],
        () => true,
        () => 1,
        false,
        (target) => (target.id === near.id ? 20 : 0),
      )?.id,
    ).toBe(available.id);
  });

  it("releases the physical AI army together with its objective", () => {
    const { game, e, map } = fixture(),
      ai = game.players[1];
    game.owners.fill(ai.id);
    e.progression.states[ai.id].completed.push("bronzeage-armies");
    const ids = game.squads
      .filter((s) => s.playerId === ai.id)
      .map((s) => s.id);
    const planner = e.economy.military.armyPlanner;
    expect(planner.acquireCoast(ai, map.ref(20, 20))).toBe(true);
    const plan = planner.objectives.get(ai.id)!;
    expect(
      e.economy.assets.acquire(
        ids.map((id) => ({
          asset: `squad:${id}` as const,
          playerId: ai.id,
          generation: plan.generation,
          controller: plan.id,
          priority: "operation" as const,
          createdTick: game.tick,
          expiresTick: plan.deadline,
        })),
      ),
    ).toBe(true);
    expect(
      game.applyCommand({ type: "create-army", playerId: ai.id, squadIds: ids }),
    ).toBeNull();
    plan.armyId = e.armies.armyOf(ids[0])!.id;
    expect(e.armies.armies.filter((a) => a.playerId === ai.id)).toHaveLength(1);
    e.economy.military.release(ai.id);
    expect(e.armies.armies.filter((a) => a.playerId === ai.id)).toHaveLength(0);
    expect(ids.every((id) => !e.economy.assets.held(`squad:${id}`))).toBe(true);
  });
  it("uses the bounded naval controller for coastal tribes without granting advancement", () => {
    const { game, e } = fixture(true),
      ai = game.players[1];
    ai.kind = "tribe";
    expect(e.economy.naval.enabled(ai)).toBe(true);
    expect(
      game.applyCommand({ type: "advance-age", playerId: ai.id }),
    ).toContain("75%");
  });
  it("allows stack 15 and rejects 16 without extending trade cargo", () => {
    const { game, map } = fixture(),
      player = game.players[0],
      tile = map.ref(20, 20);
    game.owners.fill(player.id);
    player.gold = 10000000;
    const stack = Array.from(
      { length: MAX_BUILDING_STACK - 1 },
      (_, i): Building => ({
        id: 1000 + i,
        tile,
        playerId: player.id,
        type: "city",
        remainingTicks: 0,
      }),
    );
    expect(
      constructionRejection(map, game.owners, stack, player, "city", tile),
    ).toBeNull();
    stack.push({ ...stack[0], id: 2000 });
    expect(
      constructionRejection(map, game.owners, stack, player, "city", tile),
    ).toContain("at most 15");
    expect(stackCargoPercent(15)).toBe(stackCargoPercent(10));
    expect(TRADE_RULES.valuePerGood).toBe(20);
  });
  it("charge intent falls back for unavailable charges across the entire selection", () => {
    const { game, map } = fixture();
    game.owners.fill(1);
    const own = game.squads.filter((s) => s.playerId === 1),
      tile = map.ref(45, 30);
    expect(
      game.applyCommand({
        type: "charge",
        playerId: 1,
        squadIds: own.map((s) => s.id),
        x: 45.5 * FIXED,
        y: 30.5 * FIXED,
        fallbackOrder: { type: "move", tile },
      }),
    ).toBeNull();
    for (let i = 0; i < 50; i++) game.step();
    expect(own.every((s) => !s.charge)).toBe(true);
    expect(own.some((s) => s.order.type === "move")).toBe(true);
    expect(
      commandSchema.safeParse({
        type: "order",
        playerId: 1,
        squadIds: Array.from({ length: 31 }, (_, i) => i + 1),
        order: { type: "move", tile },
      }).success,
    ).toBe(false);
  });
  it("stone requires a completed siege workshop and sorts after metals", () => {
    const { game } = fixture();
    expect(stoneExtractionAllowed(game.buildings)).toBe(false);
    const workshop: Building = {
      id: 1000,
      tile: 100,
      playerId: 2,
      type: "siege-workshop",
      remainingTicks: 10,
    };
    expect(stoneExtractionAllowed([workshop])).toBe(false);
    expect(
      stoneExtractionAllowed([{ ...workshop, remainingTicks: 0, health: 100 }]),
    ).toBe(true);
    expect(
      ["stone", "ironOre", "copper", "tin"].sort(
        (a, b) => extractionPriority(a) - extractionPriority(b),
      ),
    ).toEqual(["ironOre", "copper", "tin", "stone"]);
  });
  it("continues a nearly won war while conquest is progressing, then times out a stalled finish", () => {
    const { game, e, map } = fixture(),
      attacker = game.players[1],
      target = game.players[0];
    for (const s of [...game.squads])
      if (s.playerId === target.id) game.removeSquad(s.id);
    for (const b of [...game.buildings])
      if (b.playerId === target.id) game.removeBuilding(b.id);
    game.addBuilding({
      id: game.allocateId(),
      type: "city",
      tile: map.ref(60, 30),
      playerId: target.id,
      remainingTicks: 0,
    });
    e.operations.restore({
      records: [
        [
          attacker.id,
          {
            phase: "war",
            since: 0,
            nextThink: 0,
            target: target.id,
            threats: [],
            cursor: 0,
            score: 0,
          },
        ],
      ],
      revision: 1,
      territorialRevision: 0,
    });
    game.tick = 2400;
    e.operations.step(new Map([[attacker.id, 12]]));
    expect(e.operations.state(attacker.id)?.phase).toBe("war");
    expect(e.operations.finishing(attacker.id, target.id)).toBe(true);
    game.tick = 3601;
    e.operations.step(new Map([[attacker.id, 12]]));
    expect(e.operations.state(attacker.id)?.phase).toBe("recovery");
    expect(
      conquestBuildings(
        [{ id: 99, type: "tower", tile: 1, playerId: 2, remainingTicks: 0 }],
        true,
      ),
    ).toHaveLength(0);
  });
  it("owned river shores stay boardable without allowing neutral capture", () => {
    const { game, map, e } = fixture(true),
      ai = game.players[1];
    game.owners.fill(ai.id);
    for (let y = 0; y < 64; y++)
      for (let x = 31; x < 96; x++) game.owners[map.ref(x, y)] = 1;
    const own = game.squads.filter((s) => s.playerId === ai.id);
    own.forEach((s, i) =>
      game.updateSquad(s.id, {
        x: (26.5 + (i % 2)) * FIXED,
        y: (25.5 + Math.floor(i / 2)) * FIXED,
        order: { type: "hold" },
        path: [],
        fighting: false,
      }),
    );
    const internal = game as unknown as {
      aiFootprintAllowed(playerId: number, tile: number): boolean;
    };
    expect(internal.aiFootprintAllowed(ai.id, map.ref(29, 25))).toBe(true);
    expect(e.canCaptureTile(own[0], map.ref(31, 25))).toBe(false);
    e.progression.states[ai.id].completed.push("stoneage-cargo-canoes");
    expect(
      game.applyCommand({
        type: "order",
        playerId: ai.id,
        squadIds: own.map((s) => s.id),
        order: { type: "move", tile: map.ref(30, 25) },
      }),
    ).toBeNull();
    for (let i = 0; i < 400; i++) game.step();
    expect(own.some((s) => !!s.afloat)).toBe(true);
    expect(
      own.filter((s) => s.movementStatus?.reason === "restricted"),
    ).toHaveLength(0);
  });
  it("backs off captured sites across restore and rallies unleased stragglers", () => {
    const { game, e, map } = fixture(),
      ai = game.players[1];
    game.owners.fill(ai.id);
    const old = game.addBuilding({
      id: game.allocateId(),
      playerId: ai.id,
      type: "city",
      tile: map.ref(30, 30),
      remainingTicks: 0,
    });
    game.updateBuilding(old.id, { playerId: 1 });
    expect(e.economy.recovery.canBuild(ai.id, "city", old.tile)).toBe(false);
    const saved = e.economy.recovery.checkpoint();
    e.economy.recovery.restore(saved);
    expect(e.economy.recovery.canBuild(ai.id, "city", old.tile)).toBe(false);
    const straggler = game.squads.find((s) => s.playerId === ai.id)!;
    game.updateSquad(straggler.id, {
      x: 75.5 * FIXED,
      y: 40.5 * FIXED,
      order: { type: "hold" },
    });
    for (const s of game.squads.filter((s) => s.playerId === 1))
      game.updateSquad(s.id, { x: 90.5 * FIXED, y: 55.5 * FIXED });
    game.addBuilding({
      id: game.allocateId(),
      playerId: ai.id,
      type: "city",
      tile: map.ref(15, 15),
      remainingTicks: 0,
    });
    game.tick = 60;
    e.economy.recovery.step();
    expect(e.economy.recovery.diagnostics.rallied).toBeGreaterThan(0);
    game.tick = 1201;
    expect(e.economy.recovery.canBuild(ai.id, "city", old.tile)).toBe(true);
  });
  it("distributes melee approaches and leaves Hold out of slot planning", () => {
    const { game } = fixture(),
      target = game.squads.find((s) => s.playerId === 2)!;
    const template = game.squads.find((s) => s.playerId === 1)!;
    const own = Array.from({ length: 8 }, (_, i) => ({
      ...template,
      id: 1000 + i,
      x: target.x - 4 * FIXED,
      y: target.y,
      order: { type: "attack" as const, targetId: target.id },
      charge: null,
    }));
    const approaches = new AttackApproaches();
    approaches.rebuild([...own, target], () => true);
    expect(
      new Set(own.map((s) => JSON.stringify(approaches.point(s)))).size,
    ).toBe(8);
    expect(own.some((s) => approaches.point(s)!.x > target.x)).toBe(true);
    const held = { ...own[0], order: { type: "hold" as const } };
    approaches.rebuild([held, ...own.slice(1), target], () => true);
    expect(approaches.point(held)).toBeUndefined();
  });
});
