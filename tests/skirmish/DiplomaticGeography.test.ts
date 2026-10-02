import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Diplomacy } from "../../src/skirmish/domain/Diplomacy";
import type { Player } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

const player = (id: number, ai = true) => ({ id, ai, kind: "regular", eliminated: false } as Player);
describe("bounded and local AI diplomacy", () => {
  it("limits AI offers per recipient across factions and restore without restricting human replies", () => {
    const d = new Diplomacy(), human = player(1, false), a = player(2), b = player(3), otherHuman = player(4, false);
    expect(d.action(a, human, "offer", 0)).toBeNull();
    expect(d.action(human, a, "reject", 1)).toBeNull();
    expect(d.action(b, human, "offer", 2)).toContain("recipient");
    const restored = new Diplomacy(); restored.restore(d.checkpoint());
    expect(restored.aiOfferAvailable(1, 1199)).toBe(false);
    expect(restored.action(otherHuman, human, "offer", 2)).toBeNull();
    expect(restored.action(human, a, "offer", 3)).toBeNull();
    expect(restored.action(a, human, "accept", 4)).toBeNull();
    restored.step(1300, [human, a, b, otherHuman]);
    expect(restored.aiOfferAvailable(1, 1300)).toBe(true);
  });
  it("allows nearby connected land and genuine borders but excludes distant unrelated continents", () => {
    const cells = new Uint8Array(240 * 100).fill(133), map = new GameMapImpl(240, 100, cells, cells.length);
    const m = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" });
    const [a, b] = m.players; a.base = map.ref(10, 20); b.base = map.ref(200, 20);
    expect(m.expansion!.geography.eligible(a, b)).toBe(false);
    b.base = map.ref(40, 20); expect(m.expansion!.geography.eligible(a, b)).toBe(true);
    b.base = map.ref(200, 20);
    const change = (tile: number, owner: number) => (m as unknown as { changeOwner(t: number, o: number): void }).changeOwner(tile, owner);
    change(map.ref(119, 80), a.id); change(map.ref(120, 80), b.id);
    expect(m.factionAdjacent(a.id, b.id)).toBe(true); expect(m.expansion!.geography.eligible(a, b)).toBe(true);
    const saved = m.checkpoint(); m.restore(saved); expect(m.factionAdjacent(a.id, b.id)).toBe(true);
  });
  it("requires usable nearby ports in the same sea and bounds shared coast discovery", () => {
    const width = 240, height = 100, cells = new Uint8Array(width * height).fill(133);
    for (let y = 40; y < 60; y++) for (let x = 0; x < width; x++) if (x !== 120) cells[y * width + x] = 0;
    const map = new GameMapImpl(width, height, cells, cells.length), m = new Skirmish(map, {
      seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
    });
    const [a, b] = m.players; a.base = map.ref(10, 20); b.base = map.ref(200, 80);
    const e = m.expansion!, change = (tile: number, owner: number) => (m as unknown as { changeOwner(t: number, o: number): void }).changeOwner(tile, owner);
    const ports = [map.ref(80, 39), map.ref(85, 60)].map((tile, i) => ({ id: m.allocateId(), tile, playerId: i + 1,
      type: "port" as const, remainingTicks: 0, health: 1200 }));
    for (const p of ports) { change(p.tile, p.playerId); m.buildings.push(p); }
    m.buildingFacts(); for (const p of ports) e.economy.navalFacts.observeBuilding(p);
    expect(e.geography.eligible(a, b)).toBe(true);
    for (let i = 0; i < 50; i++) e.geography.eligible(a, b);
    expect(e.geography.workUsed).toBeLessThanOrEqual(32);
    const state = e.geography.checkpoint(); e.geography.restore(state); expect(e.geography.checkpoint()).toEqual(state);
    ports[1].tile = map.ref(124, 60); change(ports[1].tile, b.id); e.economy.navalFacts.observeBuilding(ports[1]);
    expect(e.geography.eligible(a, b)).toBe(false);
    ports[1].tile = map.ref(85, 60); ports[1].remainingTicks = 1;
    expect(e.geography.eligible(a, b)).toBe(false);
  });
});
