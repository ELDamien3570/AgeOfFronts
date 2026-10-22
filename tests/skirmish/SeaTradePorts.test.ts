import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { WaterPaths } from "../../src/skirmish/Pathfinding";
import type { Building } from "../../src/skirmish/Protocol";
import { SeaTradePorts } from "../../src/skirmish/domain/SeaTradePorts";
function fixture(count = 1000) {
  const map = new GameMapImpl(256, 64, new Uint8Array(16384), 16384), water = new WaterPaths(map, false);
  const rows: Building[] = Array.from({ length: count }, (_, i) => ({ id: count - i, type: "port", tile: i + 256,
    playerId: i < 64 ? 1 : 2, remainingTicks: 0, age: "StoneAge" }));
  const facts = new Map(rows.map(row => [row.id, row]));
  const ports = new SeaTradePorts(map, water, id => facts.get(id), (owner, b) => owner !== b.playerId);
  const markets = new Map([[1, rows]]); ports.marketsChanged(markets);
  const view = ports.view(1, 1, 256, 1);
  return { ports, view, markets, rows, facts, map, water };
}
describe("bounded sea-port discovery", () => {
  it("keeps the last two successful source markets visible across view retirement and restore", () => {
    const f = fixture(100); f.ports.step(2048, f.markets);
    for (const row of f.rows.slice(90, 93)) f.ports.rememberSource(f.view, row.id);
    const expected = f.rows.slice(91, 93).map(row => row.id);
    f.ports.releaseActor(1);
    const restored = fixture(100); restored.ports.restore(f.ports.checkpoint());
    const view = restored.ports.view(2, 1, 256, 1);
    expect(restored.ports.candidates(view).map(row => row.receiverId)).toEqual(expected);
    for (let i = 0; i < 32; i++) {
      restored.ports.step(2048, restored.markets);
      const ids = restored.ports.candidates(view).map(row => row.receiverId);
      expect(ids.length).toBeLessThanOrEqual(8);
      for (const id of expected) expect(ids).toContain(id);
    }
    restored.facts.delete(expected[0]);
    expect(restored.ports.candidates(view).map(row => row.receiverId)).not.toContain(expected[0]);
    restored.ports.retainSources(new Set());
    expect(restored.ports.checkpoint().sourceHints).toEqual([]);
  });
  it.each([0, 1, 2])("eventually considers every receiver with %i retained exploration slots", hintCount => {
    const f = fixture(100), seen = new Set<number>();
    for (const row of f.rows.slice(100 - hintCount)) f.ports.rememberSource(f.view, row.id);
    for (let tick = 0; tick < 64; tick++) {
      f.ports.step(2048, f.markets);
      for (const row of f.ports.candidates(f.view)) seen.add(row.receiverId);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(f.rows.filter(row => row.playerId !== 1).map(row => row.id).sort((a, b) => a - b));
  });
  it.each([0, 1, 2])("preserves full exploration with a persistent pending target and %i source hints", hintCount => {
    const f = fixture(100), seen = new Set<number>();
    const pending = { ...f.rows[99], id: 1001, tile: 600 };
    f.facts.set(pending.id, pending);
    for (const row of f.rows.slice(100 - hintCount)) f.ports.rememberSource(f.view, row.id);
    for (let tick = 0; tick < 64; tick++) {
      f.ports.step(2048, f.markets);
      const candidates = f.ports.candidates(f.view, pending.id);
      expect(candidates.length).toBeLessThanOrEqual(8);
      expect(candidates.some(row => row.receiverId === pending.id)).toBe(true);
      for (const row of candidates) seen.add(row.receiverId);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...f.rows.filter(row => row.playerId !== 1).map(row => row.id), pending.id].sort((a, b) => a - b));
  });
  it("rejects malformed catalog versions, policy cursors, candidates and flags", () => {
    const f = fixture(100);
    for (let tick = 0; tick < 32; tick++) f.ports.step(2048, f.markets);
    const saved = f.ports.checkpoint();
    expect(saved.policies[0][1].nearest.length).toBeGreaterThan(0);
    const mutations: ((value: ReturnType<SeaTradePorts["checkpoint"]>) => void)[] = [
      value => { value.catalogs[0][1].version = NaN; },
      value => { value.policies[0][1].explorationStart = -1; },
      value => { (value.policies[0][1] as any).passComplete = "yes"; },
      value => { value.policies[0][1].nearest[0].distanceSquared = Infinity; },
      value => { value.actors[0][0] = 0; },
    ];
    for (const mutate of mutations) {
      const corrupt = structuredClone(saved); mutate(corrupt);
      expect(() => fixture(100).ports.restore(corrupt)).toThrow("sea port metadata");
    }
  });
  it("discovers a foreign receiver before a large basin finishes its initial build", () => {
    const f = fixture();
    let discovered = false;
    for (let tick = 0; tick < 20; tick++) {
      expect(f.ports.step(2048, f.markets)).toBeLessThanOrEqual(2048);
      if (f.ports.candidates(f.view).length) { discovered = true; break; }
    }
    expect(discovered).toBe(true);
    expect(f.ports.checkpoint().catalogs[0][1].build).toBeDefined();
  });
  it("restores partial gather, bootstrap and merge with the same next work", () => {
    const a = fixture(100), b = fixture(100); a.ports.step(96, a.markets);
    b.ports.restore(a.ports.checkpoint());
    for (let tick = 0; tick < 40; tick++) {
      expect(a.ports.step(64, a.markets)).toBe(b.ports.step(64, b.markets));
      expect(a.ports.checkpoint()).toEqual(b.ports.checkpoint());
    }
  });
  it("restores captured IDs after a port is removed and replaced during an unfinished gather", () => {
    const a = fixture(100), b = fixture(100); a.ports.step(32, a.markets);
    const removed = a.rows[90];
    const replacement = { ...removed, id: 1001 };
    for (const f of [a, b]) {
      f.facts.delete(removed.id); f.facts.set(replacement.id, replacement);
      f.markets.set(1, [...f.rows.filter(row => row.id !== removed.id), replacement]);
    }
    a.ports.marketsChanged(a.markets); b.ports.restore(a.ports.checkpoint());
    for (let tick = 0; tick < 80; tick++) {
      expect(a.ports.step(128, a.markets)).toBe(b.ports.step(128, b.markets));
      expect(a.ports.checkpoint()).toEqual(b.ports.checkpoint());
    }
    expect(a.ports.checkpoint().catalogs[0][1].receiverIds).toContain(replacement.id);
    expect(a.ports.checkpoint().catalogs[0][1].receiverIds).not.toContain(removed.id);
  });
  it("removes empty historical catalogs instead of retaining every former port basin", () => {
    const f = fixture(10); f.ports.step(2048, f.markets);
    f.markets.clear(); f.ports.marketsChanged(f.markets); f.ports.step(2048, f.markets);
    expect(f.ports.checkpoint().catalogs).toEqual([]);
  });
  it("finishes a captured build under continuous churn and eventually explores beyond nearest four", () => {
    const f = fixture(80); const seen = new Set<number>();
    for (let tick = 0; tick < 100; tick++) {
      f.ports.marketsChanged(f.markets); f.ports.step(2048, f.markets);
      for (const candidate of f.ports.candidates(f.view)) seen.add(candidate.receiverId);
    }
    expect(f.ports.checkpoint().catalogs[0][1].version).toBeGreaterThan(2);
    expect(seen.size).toBeGreaterThan(8);
    f.ports.releaseActor(1);
    expect(f.ports.checkpoint().policies).toEqual([]);
  });
});
