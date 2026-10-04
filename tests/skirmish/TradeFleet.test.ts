import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  stackCargoPercent,
  TRADE_RULES,
} from "../../src/skirmish/content/Economy";
import { tradePayout } from "../../src/skirmish/domain/TradeQuote";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fleet(factories = 1, ports = 1, aiWarPolicy = false, deferredPlanning = false, tribe = false) {
  const terrain = new Uint8Array(120 * 80).fill(133);
  for (let y = 40; y < 50; y++) terrain.fill(0, y * 120, (y + 1) * 120);
  const game = new Skirmish(new GameMapImpl(120, 80, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: tribe,
    tribeCount: tribe ? 1 : undefined,
    runAi: false,
    ruleset: "ages-v1",
    aiWarPolicy,
    deferredPlanning,
  });
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  for (const s of game.squads)
    game.updateSquad(s.id, { x: 115 * FIXED, y: 70 * FIXED });
  game.owners.fill(1);
  const add = (
    type: "factory" | "city" | "port",
    x: number,
    y: number,
    playerId = 1,
  ) =>
    game.addBuilding({
      id: game.allocateId(),
      type,
      tile: game.map.ref(x, y),
      playerId,
      remainingTicks: 0,
      age: "StoneAge",
    });
  const sources = Array.from({ length: factories }, (_, i) =>
    add("factory", 10 + i, 10),
  );
  sources.push(
    ...Array.from({ length: ports }, (_, i) => add("port", 10 + i, 39)),
  );
  add("city", 70, 10);
  add("port", 100, 39, 2);
  add("city", 105, 15, 2);
  const expansion = game.expansion!,
    trade = expansion.trade;
  expansion.progression.states[1].completed.push(
    "stoneage-goods-handling",
    "stoneage-cargo-canoes",
    "stoneage-craft-workshops",
  );
  for (const source of sources) expansion.supply.goods.set(source.id, 1000);
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i++) {
      game.tick++;
      trade.step();
    }
  };
  return { game, expansion, trade, sources, step };
}

describe("bounded civilian trade", () => {
  it.each(["eliminated", "no foreign port"] as const)("does not dispatch a tribe merchant when %s", (reason) => {
    const { game, expansion, trade, sources, step } = fleet(0, 1, false, false, true);
    const tribe = game.players.find((p) => p.kind === "tribe")!;
    for (const source of sources) game.updateBuilding(source.id, { playerId: tribe.id });
    expansion.progression.states[tribe.id].completed.push("stoneage-cargo-canoes");
    if (reason === "eliminated") tribe.eliminated = true;
    else for (const port of game.buildings.filter((b) => b.type === "port"))
      game.updateBuilding(port.id, { playerId: tribe.id });
    step(40);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(0);
  });
  it("lets a researched tribe dispatch and deliver naval cargo with the ordinary site cooldown", () => {
    const { game, expansion, trade, sources, step } = fleet(0, 2, false, false, true);
    const tribe = game.players.find((p) => p.kind === "tribe")!;
    expect(tribe).toBeDefined();
    for (const source of sources) game.updateBuilding(source.id, { playerId: tribe.id, tile: sources[0].tile });
    const destination = game.buildings.find((b) => b.type === "port" && !sources.includes(b))!;
    game.updateBuilding(destination.id, { playerId: 1 });
    const research = expansion.progression.states[tribe.id].completed;
    research.splice(0, research.length);
    step(20);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(0);
    research.push("stoneage-cargo-canoes");
    step(20);
    const actors = trade.actors.filter((a) => a.playerId === tribe.id);
    // Two stacked ports share one physical spawn site, not two timers.
    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({ naval: true, definitionId: "stoneage-trade" });
    const origin = { x: actors[0].x, y: actors[0].y };
    step(TRADE_RULES.spawnCooldownTicks - 1);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(1);
    expect(Math.hypot(actors[0].x - origin.x, actors[0].y - origin.y)).toBeGreaterThan(FIXED);
    step();
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(2);
    step(1800);
    expect(trade.deliveredGold[tribe.id]).toBeGreaterThan(0);
  });
  it("includes tribes in the global fleet ceiling while retaining each faction's 48-actor limit", () => {
    const { game, expansion, trade, sources, step } = fleet(40, 20, false, false, true);
    step(20);
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(48);
    const tribe = game.players.find((p) => p.kind === "tribe")!;
    game.players.find((p) => p.id === 2)!.eliminated = true;
    for (const source of sources) game.updateBuilding(source.id, { playerId: tribe.id });
    const destination = game.buildings.find((b) => b.type === "port" && !sources.includes(b))!;
    game.updateBuilding(destination.id, { playerId: 1 });
    expansion.progression.states[tribe.id].completed.push("stoneage-goods-handling", "stoneage-cargo-canoes");
    step(20);
    expect(trade.actors.filter((a) => a.playerId === tribe.id && !a.naval)).toHaveLength(32);
    expect(trade.actors.filter((a) => a.playerId === tribe.id && a.naval)).toHaveLength(16);
    step(800);
    expect(trade.actors.filter((a) => a.playerId === tribe.id)).toHaveLength(TRADE_RULES.actorCap);
    expect(trade.actors.length).toBeLessThanOrEqual(2 * TRADE_RULES.actorCap);
  });
  it("retains failed-corridor backoff across admissions and restore without loading or losing cargo", () => {
    const {game,trade,step,sources,expansion}=fleet(1,0,false,true);
    const tasks:Parameters<NonNullable<typeof game.domainRoutes>["request"]>[0][]=[];
    const request=vi.spyOn(game.domainRoutes!,"request").mockImplementation(task=>{tasks.push(task);return true;});
    step(20);trade.stepPlanning(32);
    expect(tasks).toHaveLength(1);
    trade.completedRoute(tasks[0],"limited",[]);
    trade.stepPlanning(32);
    expect(trade.actors[0].cargo).toBe(0);
    expect(expansion.supply.goods.get(sources[0].id)).toBe(1000);
    expect(trade.checkpoint().routeFailures).toHaveLength(1);
    trade.restore(trade.checkpoint());
    step(300);trade.stepPlanning(32);
    expect(request).toHaveBeenCalledTimes(1);
    step(200);trade.stepPlanning(32);
    expect(request.mock.calls.length).toBeGreaterThan(1);
  });
  it("leaves an unrelated active fleet alone when pausing or blocking trade", () => {
    const { trade, step } = fleet(1, 1);
    step(100);
    const sea = trade.actors.find((a) => a.playerId === 1 && a.naval)!;
    const land = trade.actors.find((a) => a.playerId === 1 && !a.naval)!;
    expect(sea.state).toBe("outbound");
    expect(land.state).toBe("outbound");
    const voyage = structuredClone(sea);
    trade.setPaused(1, false, true);
    expect(sea).toEqual(voyage);
    expect(land.state).toBe("returning");
    const returning = structuredClone(land);
    trade.setBlocked(1, 2, true);
    expect(sea.state).toBe("returning");
    expect(land).toEqual(returning);
  });
  it("visits nearby neutral AI markets, with capture beginning only on active war or retaliation", () => {
    const { game, trade, expansion, step } = fleet(1, 0, true);
    const adjacency = vi.spyOn(game, "factionAdjacent").mockReturnValue(true);
    const market = game.addBuilding({
      id: game.allocateId(),
      type: "city",
      tile: game.map.ref(15, 10),
      playerId: 2,
      remainingTicks: 0,
      age: "StoneAge",
    });
    step(22);
    const actor = trade.actors.find((a) => a.playerId === 1)!;
    expect(actor.destination).toBe(market.id);
    const captor = game.squads.find((s) => s.playerId === 2)!;
    game.updateSquad(captor.id, { x: actor.x, y: actor.y });
    actor.waitTicks = 0;
    step();
    expect(actor.playerId).toBe(1);
    const operations = expansion.operations.checkpoint();
    operations.records = [
      [
        2,
        {
          phase: "war",
          target: 1,
          since: game.tick,
          nextThink: game.tick + 100,
          threats: [],
          cursor: 0,
          score: 0,
        },
      ],
    ];
    expansion.operations.restore(operations);
    game.updateSquad(captor.id, { x: actor.x, y: actor.y });
    actor.waitTicks = 0;
    step();
    expect(actor.playerId).toBe(2);
    expect(actor.state).toBe("prize");
    adjacency.mockRestore();
  });
  it("keeps non-allied human markets out of overland trade", () => {
    const { game, trade, step } = fleet(1, 0, true);
    game.setAiController(2, false);
    const adjacency = vi.spyOn(game, "factionAdjacent").mockReturnValue(true);
    const market = game.addBuilding({
      id: game.allocateId(),
      type: "city",
      tile: game.map.ref(15, 10),
      playerId: 2,
      remainingTicks: 0,
      age: "StoneAge",
    });
    step(22);
    expect(trade.actors.find((a) => a.playerId === 1)!.destination).not.toBe(
      market.id,
    );
    adjacency.mockRestore();
  });
  it("caps a sixty-level economy at 48 couriers in factory/port proportions", () => {
    const { trade, step } = fleet(40, 20);
    step(20);
    expect(
      trade.actors.filter((a) => a.playerId === 1 && !a.naval),
    ).toHaveLength(32);
    expect(
      trade.actors.filter((a) => a.playerId === 1 && a.naval),
    ).toHaveLength(16);
    step(800);
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(
      TRADE_RULES.actorCap,
    );
  });
  it("uses physical-site cooldowns across captures and checkpoint restoration", () => {
    const { game, trade, sources, expansion, step } = fleet(0, 1);
    step(20);
    game.updateBuilding(
      game.buildings.find((b) => b.type === "port" && b.playerId === 2)!.id,
      { tile: game.map.ref(25, 39) },
    );
    const actor = trade.actors[0];
    expect(actor.naval).toBe(true);
    // Capturing an outbound merchant leaves a vacancy but cannot bypass the
    // origin site's timer. A captured courier retires after its one delivery.
    actor.cargo = 20;
    actor.loaded = 20;
    actor.state = "prize";
    actor.playerId = 2;
    actor.destination = null;
    actor.path = [];
    actor.waitTicks = 0;
    const saved = game.checkpoint(),
      clone = new Skirmish(game.map, game.options);
    clone.restore(saved);
    step(399);
    for (let i = 0; i < 399; i++) {
      clone.tick++;
      clone.expansion!.trade.step();
    }
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(0);
    expect(clone.expansion!.trade.checkpoint()).toEqual(trade.checkpoint());
    expect(trade.actors).not.toContain(actor);
    expect(trade.deliveredGold[2]).toBe(200);
    step();
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(1);
    expect(expansion.supply.goods.get(sources[0].id)).toBeLessThanOrEqual(1000);
  });
  it("bounds stack cargo with diminishing returns and a level-ten ceiling", () => {
    const levels = Array.from({ length: 10 }, (_, i) =>
      stackCargoPercent(i + 1),
    );
    expect(levels[0]).toBe(100);
    expect(levels[9]).toBe(300);
    expect(stackCargoPercent(30)).toBe(300);
    expect(levels[1] - levels[0]).toBeGreaterThan(levels[9] - levels[8]);
    const { game, trade, sources, step } = fleet(0, 1);
    for (let i = 0; i < 9; i++)
      game.addBuilding({ ...sources[0], id: game.allocateId() });
    step(20);
    expect(trade.actors[0].capacity).toBe(75);
    expect(trade.actors.filter((a) => a.playerId === 1)).toHaveLength(1);
  });
  it("uses age-independent 1:2:4 land pricing and bounded map-relative sea pricing", () => {
    const base = {
      naval: false,
      quantity: 20,
      valuePerGood: 5,
      distance: 1,
      foreign: false,
      allied: false,
      mapWidth: 500,
    };
    expect(tradePayout(base)).toBe(100);
    expect(tradePayout({ ...base, distance: 300 })).toBe(100);
    expect(tradePayout({ ...base, foreign: true, allied: true })).toBe(200);
    expect(tradePayout({ ...base, foreign: true })).toBe(400);
    expect(tradePayout({ ...base, naval: true })).toBe(0);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 0 }),
    ).toBe(1);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 2.5 }),
    ).toBe(200);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 5 }),
    ).toBe(400);
    expect(
      tradePayout({ ...base, naval: true, foreign: true, distance: 500 }),
    ).toBe(1200);
  });
  it("returns paused cargo, blocks both directions, and replicates controls through deltas", () => {
    const { game, trade, step } = fleet(0, 1);
    step(22);
    const actor = trade.actors[0];
    expect(actor.cargo).toBeGreaterThan(0);
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(game.snapshot()));
    expect(
      game.applyCommand({
        type: "trade-pause",
        playerId: 1,
        naval: true,
        paused: true,
      }),
    ).toBeNull();
    step(300);
    expect(actor.cargo).toBe(0);
    expect(actor.returned).toBe(actor.loaded);
    expect(trade.deliveredGold[1] ?? 0).toBe(0);
    expect(
      game.applyCommand({
        type: "trade-block",
        playerId: 1,
        otherId: 2,
        blocked: true,
      }),
    ).toBeNull();
    expect(trade.permitted(1, 2)).toBe(false);
    expect(trade.permitted(2, 1)).toBe(false);
    const decoded = decoder.decode(encoder.encode(game.snapshot()));
    expect(decoded.expansion!.tradeControls![1]).toEqual({
      landPaused: false,
      seaPaused: true,
      blocked: [2],
    });
    expect(
      commandSchema.safeParse({
        type: "trade-pause",
        playerId: 1,
        naval: true,
        paused: "yes",
      }).success,
    ).toBe(false);
    const clone = new Skirmish(game.map, game.options);
    clone.restore(game.checkpoint());
    expect(clone.expansion!.trade.controls).toEqual(trade.controls);
  });
  it("reuses route corridors without consuming another factory's goods for sea trade", () => {
    const { trade, expansion, sources, step } = fleet(1, 1);
    trade.setPaused(1, false, true);
    step(2000);
    expect(expansion.supply.goods.get(sources[0].id)).toBe(1000);
    expect(trade.deliveredGold[1]).toBeGreaterThan(0);
    expect(trade.diagnostics.routeHits).toBeGreaterThan(0);
    expect(trade.diagnostics.routeRequests).toBeLessThan(10);
  });
});
