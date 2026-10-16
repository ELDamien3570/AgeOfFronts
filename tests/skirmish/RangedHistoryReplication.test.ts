import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { SquadDetailCache } from "../../src/skirmish/SnapshotDetails";
import { COMBAT_PRESENTATION_DELAY_TICKS } from "../../src/skirmish/client/CombatPresentationTimeline";
import { UNIT } from "../../src/skirmish/content/Units";
import { createFormation, TURN } from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { RANGED_HISTORY_TICKS, replicatedWeaponState } from "../../src/skirmish/domain/RangedPreparation";
import type { WeaponState } from "../../src/skirmish/domain/WeaponTiming";

const released = (tick: number): WeaponState => ({
  sharedReadyTick: tick + 6,
  rangedSequence: 3,
  rangedAction: { sequence: 3, definitionId: "stoneage-archer", targetKind: "squad", targetId: 9,
    startTick: tick - 4, releaseTick: tick, lastEligibleTick: tick, phase: "released" },
});

function scene() {
  const terrain = new Uint8Array(64 * 32).fill(133);
  const map = new GameMapImpl(64, 32, terrain, terrain.length);
  const game = new Skirmish(map, { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" as const });
  const source = game.squads.find(s => s.playerId === 1)!;
  const target = game.squads.find(s => s.playerId === 2)!;
  for (const s of [...game.squads]) if (s.id !== source.id && s.id !== target.id) game.removeSquad(s.id);
  for (const [s, unitId, x] of [[source, "stoneage-archer", 5], [target, "earlymedieval-infantry", 8]] as const) {
    const u = UNIT.get(unitId)!;
    game.updateSquad(s.id, { definitionId: unitId, kind: u.line, troops: u.formationRecipe!.capacity,
      manpower: createManpower(u), formation: { ...createFormation(unitId), facing: s.id === source.id ? (TURN * 3) / 4 : TURN / 4 },
      x: x * FIXED, y: 15 * FIXED, order: { type: "hold" }, moved: false, weaponState: undefined });
  }
  return { game, sourceId: source.id };
}

describe("N10 released ranged history replication", () => {
  it("keeps the horizon above the client's presentation delay", () => {
    expect(RANGED_HISTORY_TICKS).toBe(2 * COMBAT_PRESENTATION_DELAY_TICKS);
  });

  it("omits a released action only after the horizon and memoises the pruned copy", () => {
    const state = released(100);
    expect(replicatedWeaponState(state, 100)).toBe(state);
    expect(replicatedWeaponState(state, 100 + RANGED_HISTORY_TICKS)).toBe(state);
    const pruned = replicatedWeaponState(state, 101 + RANGED_HISTORY_TICKS)!;
    expect(pruned).not.toBe(state);
    expect(pruned.rangedAction).toBeUndefined();
    expect(pruned).toEqual({ sharedReadyTick: 106, rangedSequence: 3 });
    expect(replicatedWeaponState(state, 500)).toBe(pruned);
    // The simulation's record is never mutated.
    expect(state.rangedAction?.phase).toBe("released");
    // Live aims and untimed encodes are never pruned.
    const preparing: WeaponState = { ...state, rangedAction: { ...state.rangedAction!, phase: "preparing" } };
    expect(replicatedWeaponState(preparing, 500)).toBe(preparing);
    expect(replicatedWeaponState(state, undefined)).toBe(state);
  });

  it("re-encodes a cached detail row when its history expires and never serves the stale row", () => {
    const { game, sourceId } = scene();
    const row = { ...game.snapshot().squads.find(s => s.id === sourceId)!, weaponState: released(100) };
    const cache = new SquadDetailCache();
    const before = cache.encode(row, 100)!;
    expect(JSON.parse(before).weaponState.rangedAction.phase).toBe("released");
    expect(cache.encode(row, 100 + RANGED_HISTORY_TICKS)).toBe(before);
    const after = cache.encode(row, 101 + RANGED_HISTORY_TICKS)!;
    expect(JSON.parse(after).weaponState.rangedAction).toBeUndefined();
    // The expired row costs exactly what a row without any ranged history costs.
    const { rangedAction: _gone, ...stripped } = row.weaponState;
    expect(after).toBe(new SquadDetailCache().encode({ ...row, weaponState: stripped }, 0));
    const hits = cache.diagnostics.hits;
    expect(cache.encode(row, 200)).toBe(after);
    expect(cache.diagnostics.hits).toBe(hits + 1);
  });

  it("decodes pruned rows after the horizon while the simulation keeps its record", () => {
    const { game, sourceId } = scene();
    const encoder = new SnapshotEncoder(), decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(game.snapshot()));
    let releaseTick: number | undefined;
    for (let t = 1; t <= 60; t++) {
      game.tick = t;
      game.expansion!.battle.fight([]);
      const action = game.squad(sourceId)!.weaponState?.rangedAction;
      if (action?.phase === "released" && releaseTick === undefined) releaseTick = t;
      if (releaseTick !== undefined && action?.phase === "released") {
        // Hold the released record unchanged: stop further aims by moving the target away.
        const view = decoder.decode(encoder.encode(game.snapshot()));
        const replicated = view.squads.find(s => s.id === sourceId)!.weaponState;
        const age = t - Math.max(action.releaseTick, action.lastEligibleTick);
        if (age <= RANGED_HISTORY_TICKS) expect(replicated?.rangedAction).toEqual(action);
        else expect(replicated?.rangedAction).toBeUndefined();
        expect(replicated?.rangedSequence).toBe(game.squad(sourceId)!.weaponState!.rangedSequence);
      } else decoder.decode(encoder.encode(game.snapshot()));
      if (releaseTick !== undefined && t === releaseTick) {
        const target = game.squads.find(s => s.id !== sourceId)!;
        game.updateSquad(target.id, { x: 60 * FIXED, y: 2 * FIXED });
      }
    }
    expect(releaseTick).toBeDefined();
    expect(game.squad(sourceId)!.weaponState?.rangedAction?.phase).toBe("released");
  });
});
