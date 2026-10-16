// Checkpoint purity property test (review 01 R4; roadmap Next #10, S4).
//
// A 20-faction AI match is driven through the lifecycle events the bus
// carries: tile owner flips, faction eliminations, army splits and controller
// handovers. Every CHECK ticks the checkpoint must restore into a fresh
// instance and checkpoint back to an equal value: everything the simulation
// carries is in the checkpoint, and restore drops nothing.
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { Skirmish } from "../../src/skirmish/Simulation";

const TICKS = 2000, CHECK = 50, ELIMINATE_EVERY = 200, W = 192, H = 128;
function mulberry32(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Internals = { changeOwner(tile: number, id: number): void };

describe("checkpoint purity under lifecycle churn", () => {
  // raids-v1 is the live server's diplomacy: its route revisions embed the
  // permission signature, which a restore must reproduce.
  it.each(["default", "raids-v1"])(`restores to an identical checkpoint every ${CHECK} ticks over ${TICKS} ticks (%s diplomacy)`, (diplomacy) => {
    const rnd = mulberry32(10), int = (n: number) => Math.floor(rnd() * n);
    const terrain = new Uint8Array(W * H).fill(133);
    const map = () => new GameMapImpl(W, H, terrain, terrain.length);
    const options = {
      ...DEFAULT_AI_POLICIES, seed: 10, humanNames: ["H1", "H2", "H3", "H4", "H5", "H6"], aiCount: 14,
      tribes: false, ruleset: "ages-v1", runAi: true, ...(diplomacy === "raids-v1" ? { diplomacyRules: "raids-v1" } : {}),
    } as ConstructorParameters<typeof Skirmish>[1];
    const game = new Skirmish(map(), options);
    expect(game.players).toHaveLength(20);
    const humans = game.players.filter((p) => !p.ai).map((p) => p.id);
    // Human seats can form armies from the first tick.
    for (const id of humans) game.expansion!.progression.states[id].completed = TECHNOLOGIES.map((t) => t.id);
    const eliminated: number[] = [];
    let checks = 0, flips = 0, splits = 0, handovers = 0;
    // checkpoint() clones live state once and reuses each sub-checkpoint's own
    // copy; a saved checkpoint must never change as the match continues.
    let previous: { saved: ReturnType<Skirmish["checkpoint"]>; frozen: ReturnType<Skirmish["checkpoint"]> } | undefined;
    for (let tick = 1; tick <= TICKS; tick++) {
      const alive = game.players.filter((p) => !p.eliminated);
      // Tile owner flip through the bus.
      const tile = int(W * H), owner = alive[int(alive.length)].id;
      if (game.map.isLand(tile) && game.owners[tile] !== owner) { (game as unknown as Internals).changeOwner(tile, owner); flips++; }
      // Controller handover of one human seat.
      const seat = humans[int(humans.length)];
      if (!game.player(seat)!.eliminated) { game.setAiController(seat, !game.player(seat)!.ai); handovers++; }
      // Split a stack: a human-controlled faction groups two squads, or disbands an army.
      const human = alive.filter((p) => !p.ai)[0];
      if (human) {
        const armies = game.expansion!.armies.armies.filter((a) => a.playerId === human.id);
        const free = game.squads.filter((s) => s.playerId === human.id && s.troops > 0 && !game.expansion!.armies.armyOf(s.id));
        if (armies.length && int(2)) {
          if (game.applyCommand({ type: "disband-army", playerId: human.id, armyId: armies[int(armies.length)].id }) === null) splits++;
        } else if (free.length >= 2 &&
          game.applyCommand({ type: "create-army", playerId: human.id, squadIds: free.slice(0, 2).map((s) => s.id) }) === null) splits++;
      }
      // Eliminate one AI faction: nothing left that counts for survival.
      if (tick % ELIMINATE_EVERY === 0) {
        const victim = alive.find((p) => p.ai && !humans.includes(p.id));
        if (victim) {
          for (const s of game.squads.filter((s) => s.playerId === victim.id)) game.removeSquad(s.id);
          for (const b of game.buildings.filter((b) => b.playerId === victim.id)) game.removeBuilding(b.id);
          eliminated.push(victim.id);
        }
      }
      game.step();
      if (tick % CHECK === 0) {
        const copy = game.checkpoint();
        if (previous) expect(previous.saved).toEqual(previous.frozen);
        previous = { saved: copy, frozen: structuredClone(copy) };
        const fresh = new Skirmish(map(), options);
        fresh.restore(copy);
        expect(fresh.checkpoint()).toEqual(copy);
        checks++;
        // L1: an eliminated faction's AI planning rows are released.
        for (const id of eliminated) {
          if (!game.player(id)!.eliminated) continue;
          const economy = copy.expansion!.economy;
          expect(economy.nextDecision.some(([player]) => player === id)).toBe(false);
          expect(economy.saving.some(([player]) => player === id)).toBe(false);
          expect(economy.demands.some(([player]) => player === id)).toBe(false);
          expect(copy.expansion!.operations.records.some(([player]) => player === id)).toBe(false);
        }
      }
      if (game.winner !== null) break;
    }
    expect(checks).toBeGreaterThanOrEqual(10);
    expect(eliminated.filter((id) => game.player(id)!.eliminated).length).toBeGreaterThan(0);
    expect(flips).toBeGreaterThan(100);
    expect(splits).toBeGreaterThan(10);
    expect(handovers).toBeGreaterThan(100);
  }, 600_000);

  // Rollback replays from a restored checkpoint (Next #10). A restored world
  // starts with cold route caches and fresh derived indexes; its future must
  // still equal the uninterrupted world's, tick for tick.
  it("a restored 20-faction world evolves exactly like the uninterrupted one", () => {
    const terrain = new Uint8Array(W * H).fill(133);
    const map = () => new GameMapImpl(W, H, terrain, terrain.length);
    const options = {
      ...DEFAULT_AI_POLICIES, seed: 11, humanNames: ["H1", "H2", "H3", "H4", "H5", "H6"], aiCount: 14, tribes: false, ruleset: "ages-v1",
      runAi: true, diplomacyRules: "raids-v1", deferredPlanning: true,
    } as ConstructorParameters<typeof Skirmish>[1];
    const game = new Skirmish(map(), options);
    for (let tick = 0; tick < 300; tick++) game.step();
    const saved = game.checkpoint();
    const restored = new Skirmish(map(), options);
    restored.restore(saved);
    for (let tick = 0; tick < 300; tick++) {
      game.step(); restored.step();
      if (tick % 60 === 59) expect(restored.checkpoint()).toEqual(game.checkpoint());
    }
    expect(game.squads.some((s) => s.order.type === "move")).toBe(true);
  }, 120_000);
});
