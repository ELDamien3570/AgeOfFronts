import { retainSquads } from "./UnitFixtures";
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";

function fixture() {
  const cells = new Uint8Array(128 * 96).fill(133),
    map = new GameMapImpl(128, 96, cells, cells.length);
  const game = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    startingAge: "Modern",
    aiEconomy: true,
    aiDefenses: true,
  });
  const economy = game.expansion!.economy,
    player = game.players[1];
  for (let tile = 0; tile < cells.length; tile++)
    game.owners[tile] = map.x(tile) < 64 ? 2 : 1;
  player.base = map.ref(20, 30);
  player.gold = 500000;
  player.land = 64 * 96;
  { for (const building of game.buildings) game.removeBuilding(building.id);  }
  game.expansion!.supply.replaceDeposits([]);
  game.expansion!.supply.resourceSites.update([]);
  game.expansion!.progression.states[2].completed = TECHNOLOGIES.map(
    (t) => t.id,
  );
  Object.assign(game.expansion!.supply.inventories[2], {
    steel: 1000,
    iron: 1000,
    coal: 1000,
  });
  const original = game.squads.find((s) => s.playerId === 2)!;
  retainSquads(game, [...Array.from({ length: 9 }, (_, i) => ({
      ...structuredClone(original),
      id: game.allocateId(),
      playerId: i < 8 ? 2 : 1,
      kind: i === 2 ? ("archer" as const) : ("infantry" as const),
      definitionId: i === 2 ? "modern-archer" : "modern-infantry",
      x: (i < 8 ? 40.5 + (i % 4) * 2 : 110.5) * FIXED,
      y: (35.5 + Math.floor(i / 4) * 3) * FIXED,
      troops: 1000,
    }))]);
  game.restore(game.checkpoint());
  economy.boundaries!.resetForRebuild();
  while (!economy.boundaries!.ready) economy.boundaries!.step(0, 512);
  game.tick = 200;
  for (let i = 0; i < 500; i++) economy.fronts.step(16);
  game.tick = 400;
  return {
    game,
    map,
    economy,
    player: game.players[1],
    controller: economy.modernFronts,
  };
}

describe("stable staffed Modern fronts", () => {
  it("maintains bounded geographic front facts against an independent edge scan and restores mid-scan", () => {
    const { game, map, economy } = fixture(),
      boundaries = economy.boundaries!;
    expect(economy.fronts.forPlayer(2).length).toBeGreaterThan(0);
    for (const front of economy.fronts.forPlayer(2)) {
      let count = 0;
      const chunk = boundaries.chunk(front.id)!;
      for (let y = chunk.y * 16; y < Math.min(96, chunk.y * 16 + 16); y++)
        for (let x = chunk.x * 16; x < Math.min(128, chunk.x * 16 + 16); x++) {
          const t = map.ref(x, y),
            next = map.ref(x + 1, y);
          if (game.owners[t] === 2 && game.owners[next] === 1) count++;
        }
      expect(front.edges).toBe(count);
      expect(front.direction).toBe(0);
      expect(economy.fronts.valid(front)).toBe(true);
    }
    expect(economy.fronts.step(7)).toBeLessThanOrEqual(7);
    const saved = economy.fronts.checkpoint();
    economy.fronts.restore(saved);
    expect(economy.fronts.checkpoint()).toEqual(saved);
    const first = boundaries.readChunk(2);
    expect(first.value).toBeDefined();
    const before = boundaries.checkpoint();
    boundaries.restore(before);
    expect(boundaries.readChunk(2)).toEqual(first);
    game.expansion!.diplomacy.state.alliances.push({
      id: 1,
      a: 1,
      b: 2,
      expiresTick: 9000,
      renewal: [],
    });
    expect(
      economy.fronts.forPlayer(2).every((f) => !economy.fronts.valid(f)),
    ).toBe(true);
  });
  it("retains the same bounded front shortlist when more equal sectors exist", () => {
    const cells = new Uint8Array(96 * 192).fill(133),
      map = new GameMapImpl(96, 192, cells, cells.length);
    const game = new Skirmish(map, {
      seed: 47,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
      aiEconomy: true,
      aiDefenses: true,
    });
    for (let tile = 0; tile < cells.length; tile++)
      game.owners[tile] = map.x(tile) < 48 ? 2 : 1;
    game.restore(game.checkpoint());
    const economy = game.expansion!.economy;
    economy.boundaries!.resetForRebuild();
    while (!economy.boundaries!.ready) economy.boundaries!.step(0, 512);
    game.tick = 200;
    for (let i = 0; i < 1000; i++) economy.fronts.step(16);
    const ids = economy.fronts.forPlayer(2).map((f) => f.id);
    expect(ids).toHaveLength(8);
    const stable = economy.fronts.forPlayer(2).map((f) => f.stableSince);
    for (let i = 0; i < 1000; i++) {
      game.tick++;
      economy.fronts.step(16);
    }
    expect(economy.fronts.forPlayer(2).map((f) => f.id)).toEqual(ids);
    expect(economy.fronts.forPlayer(2).map((f) => f.stableSince)).toEqual(
      stable,
    );
  });
  it("funds real structures, staffs trenches/support/reserve, and preserves paid work on takeover", () => {
    const f = fixture();
    let paidGold = 0,
      paidSteel = 0;
    const apply = f.game.applyCommand.bind(f.game);
    vi.spyOn(f.game, "applyCommand").mockImplementation((command) => {
      const before = f.game.players[1].gold,
        steel = f.game.expansion!.supply.inventories[2].steel ?? 0;
      const result = apply(command);
      if (command.type === "build" && command.playerId === 2 && !result) {
        paidGold += before - f.game.players[1].gold;
        paidSteel +=
          steel - (f.game.expansion!.supply.inventories[2].steel ?? 0);
      }
      return result;
    });
    let restored = false;
    for (let i = 0; i < 5000; i++) {
      f.controller.step(16);
      expect(f.controller.diagnostics.work).toBeLessThanOrEqual(16);
      const section = f.controller.sections.get(2);
      if (section?.phase === "building" && !restored) {
        const checkpoint = f.game.checkpoint();
        f.game.restore(checkpoint);
        expect(f.game.checkpoint()).toEqual(checkpoint);
        restored = true;
      }
      if (section?.phase === "holding") break;
      f.game.step();
      if (i % 16 === 0) f.economy.fronts.step(64);
    }
    const section = f.controller.sections.get(2)!;
    expect(restored).toBe(true);
    expect(section.phase).toBe("holding");
    expect(section.paid).toHaveLength(3);
    expect(section.members).toHaveLength(4);
    expect(paidGold).toBe(57195 + 3 * 175);
    expect(f.game.expansion!.fortifications.barriers.filter(b => b.kind === "trench")).toHaveLength(1);
    expect(paidSteel).toBe(40);
    expect(f.game.buildings.filter((b) => b.type === "trench")).toHaveLength(2);
    expect(f.game.buildings.filter((b) => b.type === "gun-nest")).toHaveLength(
      1,
    );
    expect(f.economy.assets.leases.size).toBe(4);
    expect(f.economy.ledger.reservations.size).toBe(0);
    expect(
      f.game.squads.filter(
        (s) => s.playerId === 2 && !section.members.includes(s.id),
      ),
    ).toHaveLength(4);
    for (let i = 0; i < 2; i++)
      expect(
        f.game.map.euclideanDistSquared(
          f.game.tileOf(f.game.squad(section.members[i])!),
          section.sites[i].tile,
        ),
      ).toBeLessThanOrEqual(1);
    const buildings = structuredClone(f.game.buildings),
      money = f.game.players[1].gold;
    f.game.setAiController(2, false);
    expect(f.controller.sections.size).toBe(0);
    expect(f.economy.assets.leases.size).toBe(0);
    expect(f.game.buildings).toEqual(buildings);
    expect(f.game.players[1].gold).toBe(money);
  });
  it("withdraws from lost fronts and reuses paid sections without duplicate purchases", () => {
    const f = fixture();
    for (let i = 0; i < 5000; i++) {
      f.controller.step(32);
      if (f.controller.sections.get(2)?.phase === "holding") break;
      f.game.step();
      if (i % 16 === 0) f.economy.fronts.step(64);
    }
    const section = f.controller.sections.get(2)!;
    expect(section.phase).toBe("holding");
    const paid = [...section.paid],
      alliance = { id: 55, a: 1, b: 2, expiresTick: 20000, renewal: [] };
    f.game.expansion!.diplomacy.state.alliances.push(alliance);
    f.game.tick = section.nextDecision;
    f.controller.step(32);
    expect(section.phase).toBe("withdrawn");
    expect(f.economy.assets.leases.size).toBe(0);
    expect(f.game.buildings.map((b) => b.id)).toEqual(paid);
    f.game.expansion!.diplomacy.state.alliances.splice(0);
    for (let i = 0; i < 1800; i++) {
      f.controller.step(32);
      f.game.step();
      if (i % 16 === 0) f.economy.fronts.step(64);
      if (f.controller.sections.get(2)?.phase === "holding") break;
    }
    expect(f.controller.sections.get(2)!.phase).toBe("holding");
    expect(f.game.buildings.map((b) => b.id)).toEqual(paid);
    expect(f.controller.diagnostics.reused).toBe(3);
  });
  it("does not spend without reserves, support or a safe construction window", () => {
    const f = fixture();
    for (const record of f.game.squads.slice(4)) f.game.removeSquad(record.id);
    const gold = f.player.gold;
    for (let i = 0; i < 100; i++) {
      f.controller.step(8);
      f.game.tick++;
    }
    expect(f.game.buildings).toHaveLength(0);
    expect(f.player.gold).toBe(gold);
    expect(f.economy.ledger.reservations.size).toBe(0);
    const support = fixture();
    support.game.squads.forEach((s) => {
      support.game.updateSquad(s.id, { kind: "infantry", definitionId: "modern-infantry" });
    });
    for (let i = 0; i < 100; i++) {
      support.controller.step(8);
      support.game.tick++;
    }
    expect(support.game.buildings).toHaveLength(0);
    const contact = fixture(),
      enemy = contact.game.squads.find((s) => s.playerId === 1)!;
    contact.game.updateSquad(enemy.id, { x: 70.5 * FIXED });
    contact.game.updateSquad(enemy.id, { y: 16.5 * FIXED });
    for (let i = 0; i < 100; i++) {
      contact.controller.step(16);
      contact.game.tick++;
    }
    expect(contact.game.buildings).toHaveLength(0);
    expect(contact.controller.sections.get(2)?.reason).toBe(
      "No safe construction window",
    );
    expect(contact.economy.ledger.reservations.size).toBe(0);
  });
  it("withdraws a depleted garrison instead of spending more on an unstaffed front", () => {
    const f = fixture();
    for (let i = 0; i < 5000; i++) {
      f.controller.step(32);
      if (f.controller.sections.get(2)?.phase === "holding") break;
      f.game.step();
      if (i % 16 === 0) f.economy.fronts.step(64);
    }
    const section = f.controller.sections.get(2)!;
    expect(section.phase).toBe("holding");
    f.game.updateSquad(f.game.squad(section.members[0])!.id, { troops: 100 });
    f.game.updateSquad(f.game.squad(section.members[1])!.id, { troops: 100 });
    f.game.tick = section.nextDecision;
    f.controller.step(32);
    expect(section.phase).toBe("withdrawn");
    expect(f.economy.assets.leases.size).toBe(0);
    expect(f.economy.ledger.reservations.size).toBe(0);
    expect(f.game.buildings).toHaveLength(3);
  });
});
