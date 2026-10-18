import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, secondsToTicks } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { VESSEL, VESSELS } from "../../src/skirmish/content/Units";
import { navalHullDemand } from "../../src/skirmish/domain/AiNavalDemand";
import type { TradeActor } from "../../src/skirmish/domain/Definitions";
import { vesselRefitCost } from "../../src/skirmish/domain/RefitQuote";

function fixture(ports = 1) {
  const width = 64,
    height = 64,
    data = new Uint8Array(width * height).fill(133);
  for (let y = 16; y < 48; y++) data.fill(0, y * width, (y + 1) * width);
  const game = new Skirmish(new GameMapImpl(width, height, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    ruleset: "ages-v1",
    runAi: false,
    aiEconomy: true,
    aiNaval: true,
    deferredPlanning: true,
    diplomacyRules: "raids-v1",
    armyTravel: "corridors-v1",
  });
  const saved = game.checkpoint();
  for (let tile = 0; tile < data.length; tile++)
    saved.owners[tile] = data[tile]
      ? Math.floor(tile / width) < 16
        ? 2
        : 1
      : 0;
  saved.players[0].base = game.map.ref(50, 54);
  saved.players[1].base = game.map.ref(6, 6);
  game.restore(saved);
  for (const b of [...game.buildings]) game.removeBuilding(b.id);
  const add = (owner: number, type: "city" | "port", x: number, y: number) =>
    game.addBuilding({
      id: game.allocateId(),
      playerId: owner,
      type,
      tile: game.map.ref(x, y),
      age: "StoneAge",
      remainingTicks: 0,
      health: 1000,
    });
  add(1, "city", 50, 54);
  add(2, "city", 6, 6);
  const ownPorts = Array.from({ length: ports }, (_, n) =>
      add(2, "port", 10 + n * 8, 14),
    ),
    foreign = add(1, "port", 50, 48);
  const expansion = game.expansion!,
    player = game.players[1];
  player.gold = 100000;
  player.personalityId = "balanced";
  for (const p of game.players)
    expansion.progression.states[p.id].completed = TECHNOLOGIES.filter(
      (t) => t.age === "StoneAge",
    ).map((t) => t.id);
  for (const squad of game.squads) {
    const base = game.players.find((p) => p.id === squad.playerId)!.base;
    game.updateSquad(squad.id, {
      x: (game.map.x(base) + 0.5) * FIXED,
      y: (game.map.y(base) + 0.5) * FIXED,
    });
  }
  const ship = (x: number, y = 18, owner = 2) =>
    game.addShip({
      id: game.allocateId(),
      playerId: owner,
      kind: "warship",
      definitionId: "stoneage-warship",
      x: (x + 0.5) * FIXED,
      y: (y + 0.5) * FIXED,
      health: VESSEL.get("stoneage-warship")!.health,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      repairState: "patrolling",
    });
  const cargo = () => {
    const path: number[] = [];
    for (let x = 25; x >= 10; x--) path.push(game.map.ref(x, 24));
    for (let y = 23; y >= 16; y--) path.push(game.map.ref(10, y));
    const actor: TradeActor = {
      id: game.allocateId(),
      playerId: 1,
      factoryId: foreign.id,
      originPortId: foreign.id,
      definitionId: "stoneage-trade",
      naval: true,
      x: 25.5 * FIXED,
      y: 24.5 * FIXED,
      cargo: 25,
      loaded: 25,
      delivered: 0,
      lost: 0,
      returned: 0,
      valuePerGood: 20,
      originTile: foreign.tile,
      capacity: 25,
      shipmentId: 1,
      stops: [],
      visited: [],
      destination: ownPorts[0].id,
      state: "outbound",
      path,
      nextPathIndex: 0,
      waitTicks: 0,
      quoteAllies: [],
    };
    expansion.trade.actors.push(actor);
    return actor;
  };
  const refresh = () => {
    game.restore(game.checkpoint());
    const facts = expansion.economy.navalFacts;
    const before = facts.diagnostics.passes;
    for (let n = 0; n < 100 && before === facts.diagnostics.passes; n++)
      facts.step(game.tick + 100, 64);
  };
  const assess = () => {
    for (let n = 0; n < 300; n++) {
      expect(expansion.economy.naval.step(8)).toBeLessThanOrEqual(8);
      const m = expansion.economy.naval.missions.get(2);
      if (m && !m.assessment) return m;
    }
    throw Error("Assessment did not complete");
  };
  return {
    game,
    expansion,
    get player() {
      return game.players[1];
    },
    ship,
    cargo,
    refresh,
    assess,
    ownPorts,
  };
}
function advance(game: Skirmish) {
  game.step();
  const e = game.expansion!.economy;
  e.navalFacts.step(game.tick, 64);
  e.naval.step(16);
}

describe("paid naval trade protection and neutral raids", () => {
  it("sizes coverage from actual assets with doctrine diversity and a shared cap", () => {
    const input = {
      ports: 6,
      coastSectors: 2,
      protectedCargoValue: 0,
      hullGold: 700,
      raidOpportunity: false,
      navalWeight: 100,
      cap: 32,
    };
    expect(navalHullDemand(input)).toBe(3);
    expect(navalHullDemand({ ...input, navalWeight: 150 })).toBe(5);
    expect(
      navalHullDemand({ ...input, ports: 1000, protectedCargoValue: 1000000 }),
    ).toBe(32);
    expect(
      navalHullDemand({
        ...input,
        ports: 1,
        coastSectors: 1,
        raidOpportunity: true,
      }),
    ).toBe(2);
  });
  it("pays for multiple real quiet-sea defenders instead of stopping at one hull", () => {
    const f = fixture(6),
      accepted: { before: number; after: number; price: number }[] = [];
    const apply = f.game.applyCommand.bind(f.game);
    f.game.applyCommand = (c) => {
      const before = f.player.gold,
        result = apply(c);
      if (c.type === "recruit-ship" && c.playerId === 2 && result === null)
        accepted.push({
          before,
          after: f.player.gold,
          price: VESSEL.get(c.definitionId!)!.cost.gold!,
        });
      return result;
    };
    for (
      let tick = 0;
      tick < secondsToTicks(60) && f.game.shipFacts().byOwner(2).length < 3;
      tick++
    )
      advance(f.game);
    expect(accepted.length).toBeGreaterThanOrEqual(3);
    expect(accepted.every((p) => p.before - p.after === p.price)).toBe(true);
    expect(f.game.shipFacts().byOwner(2).length).toBeGreaterThanOrEqual(3);
    expect(f.expansion.diplomacy.declaredWar(1, 2)).toBe(false);
  });
  it("opens a bounded AI raid on a moving neutral convoy, retains a guard, and captures cargo without declaring war", () => {
    const f = fixture(),
      guard = f.ship(10),
      raider = f.ship(12),
      cargo = f.cargo();
    f.refresh();
    const commands = vi.spyOn(f.game, "applyCommand"),
      mission = f.assess();
    expect(mission.objective).toBe("raid-trade");
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(true);
    expect(f.expansion.diplomacy.declaredWar(2, 1)).toBe(false);
    expect(
      commands.mock.calls.some(
        ([c]) => c.type === "alliance" && c.action === "declare",
      ),
    ).toBe(false);
    const raids = commands.mock.calls
      .map(([c]) => c)
      .filter((c) => c.type === "sail" && c.shipIds.includes(raider.id));
    expect(
      raids.some((c) => c.type === "sail" && !c.shipIds.includes(guard.id)),
    ).toBe(true);
    for (
      let tick = 0;
      tick < secondsToTicks(20) && !f.expansion.trade.capturedValue[2];
      tick++
    )
      advance(f.game);
    expect(f.expansion.trade.capturedValue[2]).toBe(500);
    expect(f.expansion.trade.lostValue[1]).toBe(500);
    expect(
      f.expansion.trade.actors.find((a) => a.id === cargo.id)?.playerId,
    ).toBe(2);
    expect(f.expansion.diplomacy.canCapture(2, 1)).toBe(false);
  });
  it.each(["peace", "alliance", "exemption"] as const)(
    "respects %s when evaluating neutral piracy",
    (kind) => {
      const f = fixture();
      f.ship(10);
      f.ship(12);
      f.cargo();
      const d = f.expansion.diplomacy;
      if (kind === "peace")
        d.state.peaceProtection = [
          { a: 1, b: 2, untilTick: secondsToTicks(100) },
        ];
      if (kind === "alliance")
        d.state.alliances.push({
          id: 9000,
          a: 1,
          b: 2,
          expiresTick: secondsToTicks(100),
          renewal: [],
        });
      if (kind === "exemption")
        d.state.dontEmbargo = [{ playerId: 2, otherId: 1 }];
      f.refresh();
      const mission = f.assess();
      expect(mission.objective).not.toBe("raid-trade");
      expect(d.embargo(2, 1)).toBe(false);
      expect(d.declaredWar(2, 1)).toBe(false);
    },
  );
  it("does not initiate piracy while the only available healthy hull is needed at home", () => {
    const f = fixture();
    f.ship(10);
    f.cargo();
    f.refresh();
    f.assess();
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(false);
  });
  it("does not count a distant raider as escort strength at an early interception", () => {
    const f = fixture();
    f.ship(10);
    f.ship(12);
    f.ship(62, 46);
    f.ship(26, 24, 1);
    f.cargo();
    f.refresh();
    f.assess();
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(false);
  });
  it("raids an unescorted convoy with a reachable hull while distant surplus keeps patrolling", () => {
    const f = fixture(),
      guard = f.ship(10),
      near = f.ship(12),
      far = f.ship(62, 46);
    f.cargo();
    f.refresh();
    const commands = vi.spyOn(f.game, "applyCommand"),
      mission = f.assess();
    expect(mission.objective).toBe("raid-trade");
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(true);
    const raids = commands.mock.calls
      .map(([c]) => c)
      .filter((c) => c.type === "sail" && c.shipIds.includes(near.id));
    expect(raids.length).toBeGreaterThan(0);
    expect(
      raids.every(
        (c) =>
          c.type === "sail" &&
          !c.shipIds.includes(far.id) &&
          !c.shipIds.includes(guard.id),
      ),
    ).toBe(true);
    expect(mission.patrolGroups?.some((g) => g.members.includes(far.id))).toBe(
      true,
    );
  });
  it("keeps a ready sentinel in each existing patrol sector during piracy", () => {
    const f = fixture(3);
    for (let n = 0; n < 9; n++) f.ship(10 + n);
    f.refresh();
    const initial = f.assess();
    expect(initial.patrolGroups).toHaveLength(2);
    const sentinels = initial.patrolGroups!.map((g) => g.members[0]);
    f.cargo();
    f.refresh();
    f.expansion.economy.naval.missions.get(2)!.nextAssessment = 0;
    const commands = vi.spyOn(f.game, "applyCommand");
    const mission = f.assess();
    expect(mission.objective).toBe("raid-trade");
    const sails = commands.mock.calls
      .map(([c]) => c)
      .filter((c) => c.type === "sail");
    const patrolIds = new Set(
      sails
        .filter(
          (c) =>
            c.type === "sail" && c.shipIds.some((id) => sentinels.includes(id)),
        )
        .flatMap((c) => (c.type === "sail" ? c.shipIds : [])),
    );
    expect(sentinels.every((id) => patrolIds.has(id))).toBe(true);
    expect(
      sails.some(
        (c) =>
          c.type === "sail" && c.shipIds.every((id) => !sentinels.includes(id)),
      ),
    ).toBe(true);
    expect(mission.patrolGroups!.map((g) => g.members[0])).toEqual(sentinels);
  });
  it("raids away from the victim's home defenders instead of counting its whole coastal navy as an escort", () => {
    const f = fixture();
    f.ship(10);
    f.ship(12);
    f.ship(50, 45, 1);
    f.cargo();
    f.refresh();
    expect(f.assess().objective).toBe("raid-trade");
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(true);
  });
  it("pays for a small two-hull raiding detachment when one real local escort protects a valuable convoy", () => {
    const f = fixture();
    f.ship(10);
    f.ship(12);
    f.ship(26, 24, 1);
    f.cargo();
    f.refresh();
    const gold = f.player.gold,
      mission = f.assess();
    expect(mission.protectionHulls).toBe(1);
    expect(mission.desiredHulls).toBe(3);
    expect(f.player.gold).toBe(
      gold - VESSEL.get("stoneage-warship")!.cost.gold!,
    );
    expect(
      f.game.recruitment.byOwner(2).filter((j) => j.category === "ship"),
    ).toHaveLength(1);
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(false);
  });
  it("continues a paid fleet goal deterministically after checkpoint restoration", () => {
    const f = fixture(6);
    for (let n = 0; n < secondsToTicks(5); n++) advance(f.game);
    const saved = f.game.checkpoint(),
      clone = new Skirmish(f.game.map, f.game.options);
    clone.restore(saved);
    expect(clone.checkpoint()).toEqual(saved);
    for (let n = 0; n < 30; n++) {
      advance(f.game);
      advance(clone);
    }
    expect(clone.checkpoint()).toEqual(f.game.checkpoint());
  });
  it("modernizes a full old fleet through paid sequential refits and preserves checkpoint continuation", () => {
    const f = fixture(6);
    f.player.personalityId = "admiral";
    f.expansion.progression.states[2].age = "Modern";
    f.expansion.progression.states[2].completed = TECHNOLOGIES.map((t) => t.id);
    for (const port of f.ownPorts)
      f.game.updateBuilding(port.id, { age: "Modern" });
    for (const definition of VESSELS)
      for (const [item, count] of Object.entries(definition.cost.items ?? {}))
        f.expansion.supply.inventories[2][item] = count * 100;
    for (let n = 0; n < 32; n++)
      f.ship(10 + (n % 16), 18 + Math.floor(n / 16) * 2);
    f.refresh();
    const before = f.player.gold;
    f.assess();
    const active = f.game
      .shipFacts()
      .byOwner(2)
      .filter((s) => s.refit);
    expect(active).toHaveLength(1);
    const target = VESSEL.get(active[0].refit!.targetId)!;
    expect(f.player.gold).toBe(
      before - vesselRefitCost(target, VESSEL.get("stoneage-warship")!).gold!,
    );
    expect(f.game.shipFacts().byOwner(2)).toHaveLength(32);
    const saved = f.game.checkpoint(),
      clone = new Skirmish(f.game.map, f.game.options);
    clone.restore(saved);
    for (let n = 0; n < secondsToTicks(11); n++) {
      advance(f.game);
      advance(clone);
    }
    expect(clone.checkpoint()).toEqual(f.game.checkpoint());
    expect(f.game.ship(active[0].id)?.definitionId).toBe(target.id);
    expect(f.game.shipFacts().byOwner(2)).toHaveLength(32);
  });
  it("keeps opportunity discovery read-only and declines a convoy protected by stronger neutral escorts", () => {
    const f = fixture();
    f.ship(10);
    f.ship(12);
    f.cargo();
    const before = f.expansion.diplomacy.checkpoint(),
      opportunities: TradeActor[] = [];
    f.expansion.trade.raidOpportunities(
      12.5 * FIXED,
      18.5 * FIXED,
      48 * FIXED,
      2,
      opportunities,
    );
    expect(opportunities).toHaveLength(1);
    expect(f.expansion.diplomacy.checkpoint()).toEqual(before);
    for (let n = 0; n < 4; n++) f.ship(25 + n, 23, 1);
    f.refresh();
    f.assess();
    expect(f.expansion.diplomacy.embargo(2, 1)).toBe(false);
    expect(f.expansion.diplomacy.declaredWar(2, 1)).toBe(false);
  });
});
