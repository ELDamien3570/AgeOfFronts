import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { FactionViewModel } from "../../src/skirmish/client/FactionViewModel";
import { AI_PERSONALITY } from "../../src/skirmish/content/AiPersonalities";
import {
  FACTIONS,
  FACTION_REFERENCES,
} from "../../src/skirmish/content/Factions";
import { FactionRoster } from "../../src/skirmish/domain/FactionRoster";

describe("researched faction identities", () => {
  it("has unique readable identities and resolves every profile and reference", () => {
    expect(FACTIONS.length).toBeGreaterThan(400);
    expect(new Set(FACTIONS.map((f) => f.id)).size).toBe(FACTIONS.length);
    expect(new Set(FACTIONS.map((f) => f.name)).size).toBe(FACTIONS.length);
    for (const f of FACTIONS) {
      expect(f.name.length).toBeGreaterThanOrEqual(2);
      expect(f.name).not.toMatch(/[<>]/);
      expect([...f.name].every((c) => c.charCodeAt(0) >= 32)).toBe(true);
      expect(f.personalities.length).toBeGreaterThan(0);
      expect(f.references.length).toBeGreaterThan(0);
      for (const id of f.personalities)
        expect(AI_PERSONALITY.has(id)).toBe(true);
      for (const id of f.references)
        expect(
          FACTION_REFERENCES[id as keyof typeof FACTION_REFERENCES],
        ).toBeDefined();
    }
  });
  it("mixes all three settings without duplicate names in a sixty-faction match", () => {
    for (const seed of [0, 1, 42, -1, 2147483647]) {
      const roster = new FactionRoster(seed, FACTIONS);
      const regular = Array.from({ length: 19 }, () => roster.take("regular"));
      const tribes = Array.from({ length: 40 }, () => roster.take("tribe"));
      const all = [...regular, ...tribes];
      expect(new Set(all.map((f) => f.identity.name)).size).toBe(59);
      for (const pool of [regular, tribes])
        expect(new Set(pool.map((f) => f.identity.origin)).size).toBe(3);
      for (const f of all)
        expect(f.identity.personalities).toContain(f.personalityId);
    }
  });
  it("keeps regular identities stable when tribes or opponent counts change", () => {
    const data = new Uint8Array(240 * 160).fill(133);
    const match = (tribes: boolean, aiCount = 3) =>
      new Skirmish(new GameMapImpl(240, 160, data, data.length), {
        seed: 42,
        aiCount,
        tribes,
        runAi: false,
      });
    const a = match(false),
      b = match(true),
      c = match(true, 1);
    expect(b.players.slice(0, 4)).toEqual(a.players);
    expect(
      c.players.slice(0, 2).map((p) => [p.name, p.factionId, p.personalityId]),
    ).toEqual(
      a.players.slice(0, 2).map((p) => [p.name, p.factionId, p.personalityId]),
    );
    expect(a.players[0].name).toBe("You");
    expect(a.players[0].factionId).toBeUndefined();
    const packet = new SnapshotEncoder().encode(b.snapshot());
    expect(
      new SnapshotDecoder().decode(structuredClone(packet)).players,
    ).toEqual(b.players);
  });
  it("replays a seed exactly but varies other seeds", () => {
    const deal = (seed: number) => {
      const roster = new FactionRoster(seed, FACTIONS);
      return Array.from({ length: 19 }, () => roster.take("regular"));
    };
    expect(deal(42)).toEqual(deal(42));
    expect(deal(42)).not.toEqual(deal(43));
  });
  it("shows factual provenance separately from gameplay archetypes", () => {
    const data = new Uint8Array(96 * 64).fill(133),
      game = new Skirmish(new GameMapImpl(96, 64, data, data.length), {
        seed: 42,
        aiCount: 1,
        runAi: false,
      });
    const enemy = game.players[1],
      vm = new FactionViewModel(enemy);
    expect(vm.originName).not.toBe("");
    expect(vm.personalityName).not.toBe("");
    expect(vm.description).not.toBe("");
    enemy.kind = "tribe";
    expect(vm.description).toContain("ten infantry squads");
    expect(vm.description).toContain("never negotiates or researches");
    expect(new FactionViewModel(game.players[0]).personalityName).toBe("");
  });
});
