import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { soldierWeaponStats } from "../../src/skirmish/client/WeaponStats";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";
import {
  attackContributors,
  damageAmount,
  defenceOf,
} from "../../src/skirmish/domain/Combat";
import {
  createFormation,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import {
  createManpower,
  remainingHealth,
} from "../../src/skirmish/domain/Manpower";
import {
  commitWeaponShot,
  type WeaponState,
} from "../../src/skirmish/domain/WeaponTiming";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

const infantry = UNIT.get("earlymedieval-infantry")!;
const gun = UNIT.get("modern-infantry")!.rangedAttack!;
function match(sourceId = "modern-infantry") {
  const terrain = new Uint8Array(64 * 32).fill(133);
  const options = {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1" as const,
  };
  const game = new Skirmish(
    new GameMapImpl(64, 32, terrain, terrain.length),
    options,
  );
  const source = game.squads.find((s) => s.playerId === 1)!;
  const target = game.squads.find((s) => s.playerId === 2)!;
  for (const s of [...game.squads])
    if (s.id !== source.id && s.id !== target.id) game.removeSquad(s.id);
  for (const [s, id, x] of [
    [source, sourceId, 5],
    [target, "earlymedieval-infantry", 11],
  ] as const) {
    const u = UNIT.get(id)!;
    game.updateSquad(s.id, {
      definitionId: id,
      kind: u.line,
      troops: u.formationRecipe!.capacity,
      manpower: createManpower(u),
      formation: {
        ...createFormation(id),
        facing: s.id === source.id ? (TURN * 3) / 4 : TURN / 4,
        layoutTroops: u.formationRecipe!.capacity,
      },
      x: x * FIXED,
      y: 15 * FIXED,
      order: { type: "hold" },
      moved: false,
    });
  }
  return {
    game,
    source: game.squad(source.id)!,
    target: game.squad(target.id)!,
    battle: game.expansion!.battle,
    terrain,
    options,
  };
}
describe("per-soldier weapons and exact cycles", () => {
  it("applies fractional HP consistently when attacks are batched and awards only applied XP", () => {
    const f = match(),
      other = match();
    const initial = remainingHealth(f.target);
    for (let i = 0; i < 10; i++) {
      const ledger = new DamageLedger();
      ledger.add(f.target.id, 1, 8.8);
      f.game.resolveLandDamage(ledger);
    }
    const batch = new DamageLedger();
    batch.add(other.target.id, 1, 88);
    other.game.resolveLandDamage(batch);
    expect(remainingHealth(f.target)).toBe(initial - 88000);
    expect(remainingHealth(f.target)).toBe(remainingHealth(other.target));
    const xp = new DamageLedger();
    xp.add(f.target.id, 1, 0.333);
    f.battle.awardDamage(
      xp,
      new Map([[f.target.id, [{ id: `squad:${f.source.id}`, damage: 0.333 }]]]),
    );
    expect(f.game.squad(f.source.id)!.xp).toBe(0.333);
  });
  it("continues identical combat after checkpoint restore during a magazine", () => {
    const f = match();
    for (let tick = 0; tick < 10; tick++) {
      f.game.tick = tick;
      f.battle.fight([]);
      f.battle.advanceProjectiles();
    }
    const restored = new Skirmish(
      new GameMapImpl(64, 32, f.terrain, f.terrain.length),
      f.options,
    );
    restored.restore(f.game.checkpoint());
    for (let tick = 10; tick < 180; tick++)
      for (const game of [f.game, restored]) {
        game.tick = tick;
        game.expansion!.battle.fight([]);
        game.expansion!.battle.advanceProjectiles();
      }
    expect(restored.checkpoint()).toEqual(f.game.checkpoint());
  });
  it("resolves the pikeman example, ignores overlapping counters and leaves bonus outside armour", () => {
    const p = {
      ...infantry.meleeAttack!,
      damage: 2,
      bonuses: { mounted: 10, ranged: 99 },
    };
    const d = {
      tags: ["mounted", "ranged"] as const,
      armourKind: "points" as const,
      meleeArmour: 10,
      rangedArmour: 10,
      bonusResistance: { mounted: 100 },
    };
    expect(damageAmount(p, d, 1)).toBe(11);
    expect(damageAmount(p, d, 3)).toBe(33);
    expect(damageAmount(p, { ...d, cover: 2000 }, 1)).toBe(8.8);
    expect(damageAmount(p, d, 0)).toBe(0);
    expect(damageAmount({ ...p, damage: 0 }, d, 1)).toBe(0);
  });
  it("does not grant the soldier armour floor to hulls", () => {
    const p = { ...infantry.meleeAttack!, damage: 2, bonuses: {} };
    const tank =
      UNIT.get("modern-heavycavalry") ??
      UNITS.find((u) => u.formationRecipe?.model === "hull")!;
    expect(
      damageAmount(
        p,
        {
          ...defenceOf(tank),
          tags: ["vehicle"],
          meleeArmour: 100,
          armourKind: "points",
        },
        1,
      ),
    ).toBe(0);
  });
  it("maintains rational cadence over ten minutes rather than rounding each interval", () => {
    const p = { ...gun, rpm: 47, shotsPerReload: 1000, reloadMs: 0 };
    let state: WeaponState | undefined,
      shots = 0;
    for (let tick = 0; tick < 12000; tick++) {
      const next = commitWeaponShot(p, state, tick, false);
      if (next) {
        state = next;
        shots++;
      }
    }
    expect(shots).toBe(470);
  });
  it("matches analytical magazine counts at 600 RPM with five-second reloads", () => {
    const p = { ...gun, shotsPerReload: 47, reloadMs: 5000 };
    let state: WeaponState | undefined,
      shots = 0;
    for (let tick = 0; tick < 1920; tick++) {
      const next = commitWeaponShot(p, state, tick, false);
      if (next) {
        state = next;
        shots++;
      }
    }
    expect(shots).toBe(470);
  });
  it("preserves reload through melee and refuses simultaneous attacks or idle catch-up", () => {
    const ranged = { ...gun, shotsPerReload: 1, reloadMs: 5000 };
    const state = commitWeaponShot(ranged, undefined, 0, false)!;
    expect(
      commitWeaponShot(infantry.meleeAttack!, state, 0, false),
    ).toBeUndefined();
    const melee = commitWeaponShot(infantry.meleeAttack!, state, 2, false)!;
    expect(melee.ranged).toEqual(state.ranged);
    expect(commitWeaponShot(ranged, melee, 99, false)).toBeUndefined();
    const resumed = commitWeaponShot(ranged, melee, 1000, false)!;
    expect(resumed.ranged!.nextTick).toBe(1100);
  });
  it("scales ranged fire with living soldiers while bounding melee by frontage", () => {
    const unit = UNIT.get("napoleonic-infantry")!;
    const base = { troops: 48, manpower: createManpower(unit) };
    const larger = { troops: 72, manpower: createManpower(unit, "enlarged") };
    expect(attackContributors(larger, unit.rangedAttack!)).toBe(72);
    expect(attackContributors(larger, unit.meleeAttack!)).toBe(18);
    expect(attackContributors(base, unit.meleeAttack!)).toBe(14);
    expect(attackContributors({ ...base, troops: 1 }, unit.meleeAttack!)).toBe(
      1,
    );
  });
  it("commits firing-time soldier contribution to projectiles and restores it", () => {
    const f = match("stoneage-archer");
    f.battle.fight([]);
    const shot = f.battle.projectiles.find((p) => p.sourceId === f.source.id)!;
    expect(shot.perSoldier).toBe(true);
    expect(shot.attackScale).toBe(12);
    f.game.updateSquad(f.source.id, { troops: 1 });
    const restored = new Skirmish(
      new GameMapImpl(64, 32, f.terrain, f.terrain.length),
      f.options,
    );
    restored.restore(f.game.checkpoint());
    expect(restored.expansion!.battle.projectiles).toEqual(
      f.battle.projectiles,
    );
    expect(restored.squad(f.source.id)!.weaponState).toEqual(
      f.game.squad(f.source.id)!.weaponState,
    );
    expect(restored.expansion!.battle.projectiles[0].attackScale).toBe(12);
  });
  it("persists exact reload and rational phase through packed snapshots and rejects old checkpoints", () => {
    const f = match();
    f.battle.fight([]);
    const state = commitWeaponShot(
      { ...gun, rpm: 47, shotsPerReload: 1 },
      undefined,
      30,
      false,
    )!;
    f.game.updateSquad(f.source.id, { weaponState: state });
    const encoded = new SnapshotEncoder().encode(f.game.snapshot());
    expect(
      new SnapshotDecoder()
        .decode(encoded)
        .squads.find((s) => s.id === f.source.id)!.weaponState,
    ).toEqual(state);
    expect(() =>
      f.game.restore({ ...f.game.checkpoint(), version: 2 } as any),
    ).toThrow();
  });
  it("changes to close melee without refilling ranged ammunition", () => {
    const f = match();
    f.battle.fight([]);
    const ranged = f.game.squad(f.source.id)!.weaponState!.ranged!;
    f.game.updateSquad(f.source.id, {
      weaponState: { sharedReadyTick: 0, ranged },
    });
    f.game.updateSquad(f.target.id, { x: 6 * FIXED });
    f.battle.fight([]);
    expect(f.game.squad(f.source.id)!.weaponState!.melee).toBeDefined();
    expect(f.game.squad(f.source.id)!.weaponState!.ranged).toEqual(ranged);
  });
  it("publishes authored weapon facts for every soldier and retains separate hull profiles", () => {
    for (const unit of UNITS) {
      if (unit.formationRecipe!.model === "soldiers") {
        expect(unit.attack.perSoldier).toBe(true);
        expect(unit.healthPercent).toBeUndefined();
        expect(
          soldierWeaponStats(unit).find(
            ([label]) => label === "Ranged damage per attack",
          )?.[1],
        ).toBe(String(unit.rangedAttack?.damage ?? 0));
      } else expect(unit.attack.perSoldier).toBeUndefined();
    }
  });
});
