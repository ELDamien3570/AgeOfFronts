import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED, TICK_MS } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import {
  COMBAT_PRESENTATION_DELAY_TICKS,
  CombatPresentationTimeline,
} from "../../src/skirmish/client/CombatPresentationTimeline";
import { RangedAttackPresentation } from "../../src/skirmish/client/troops/RangedAttackPresentation";
import type { ActorClip } from "../../src/skirmish/client/troops/TroopFormationModel";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";
import type { Aircraft } from "../../src/skirmish/domain/Definitions";
import {
  createFormation,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import {
  createManpower,
  remainingHealth,
} from "../../src/skirmish/domain/Manpower";
import {
  cancelRangedPreparation,
  prepareRangedShot,
  releaseRangedShot,
} from "../../src/skirmish/domain/RangedPreparation";
import {
  commitWeaponShot,
  validateWeaponState,
  type WeaponState,
} from "../../src/skirmish/domain/WeaponTiming";

function scene(id = "earlymodern-rangedcavalry") {
  const terrain = new Uint8Array(64 * 32).fill(133);
  const map = new GameMapImpl(64, 32, terrain, terrain.length);
  const options = {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1" as const,
  };
  const game = new Skirmish(map, options);
  const source = game.squads.find((s) => s.playerId === 1)!;
  const target = game.squads.find((s) => s.playerId === 2)!;
  for (const s of [...game.squads])
    if (s.id !== source.id && s.id !== target.id) game.removeSquad(s.id);
  for (const [s, unitId, x] of [
    [source, id, 5],
    [target, "earlymedieval-infantry", 8],
  ] as const) {
    const u = UNIT.get(unitId)!;
    game.updateSquad(s.id, {
      definitionId: unitId,
      kind: u.line,
      troops: u.formationRecipe!.capacity,
      manpower: createManpower(u),
      formation: {
        ...createFormation(unitId),
        facing: s.id === source.id ? (TURN * 3) / 4 : TURN / 4,
      },
      x: x * FIXED,
      y: 15 * FIXED,
      order: { type: "hold" },
      moved: false,
      weaponState: undefined,
    });
  }
  const battle = game.expansion!.battle;
  const at = (tick: number) => {
    game.tick = tick;
    battle.fight([]);
  };
  const shots = () =>
    game.volleys.filter((v) => v.squadId === source.id && !v.melee && !v.impact)
      .length +
    battle.projectiles.filter((p) => p.sourceId === source.id).length;
  return {
    game,
    source: game.squad(source.id)!,
    target: game.squad(target.id)!,
    battle,
    at,
    shots,
    map,
    options,
  };
}

describe("authoritative ranged preparation", () => {
  it("authors preparation for every ranged land weapon without coupling to client assets", () => {
    for (const u of UNITS.filter((u) => u.attack.channel === "ranged")) {
      expect(u.attack.preparation!.ticks * TICK_MS).toBeGreaterThanOrEqual(500);
      expect(Number.isSafeInteger(u.attack.preparation!.ticks)).toBe(true);
      if (u.rangedAttack)
        expect(u.rangedAttack.preparation).toEqual(u.attack.preparation);
    }
  });
  it.each([
    "stoneage-archer",
    "classicalage-rangedcavalry",
    "earlymodern-rangedcavalry",
    "modern-archer",
  ])(
    "%s consumes no ammunition, projectile or damage before its committed release",
    (id) => {
      const f = scene(id),
        hp = remainingHealth(f.target);
      f.at(0);
      const action = f.game.squad(f.source.id)!.weaponState!.rangedAction!;
      expect(action.startTick).toBe(0);
      expect(action.releaseTick).toBe(UNIT.get(id)!.attack.preparation!.ticks);
      for (let t = 1; t < action.releaseTick; t++) f.at(t);
      expect(f.shots()).toBe(0);
      expect(remainingHealth(f.game.squad(f.target.id)!)).toBe(hp);
      expect(f.game.squad(f.source.id)!.weaponState!.ranged).toBeUndefined();
      f.at(action.releaseTick);
      expect(f.shots()).toBeGreaterThan(0);
      expect(f.game.squad(f.source.id)!.lastAttackTick).toBe(
        action.releaseTick,
      );
    },
  );
  it("preserves the normal shot-to-shot interval and a moving rider's preparation", () => {
    const f = scene();
    f.game.updateSquad(f.source.id, { moved: true });
    f.at(0);
    const first = f.source.weaponState!.rangedAction!.releaseTick;
    let next = 0;
    for (let t = 1; t <= first + 100; t++) {
      f.at(t);
      if (t === first) next = f.source.weaponState!.ranged!.nextTick;
      if (t === next && t > first) break;
    }
    expect(f.source.lastAttackTick).toBe(next);
    expect(f.source.weaponState!.rangedAction!.releaseTick).toBe(next);
  });
  it("requires preparation before aircraft fire and revalidates airborne targets at release", () => {
    const f = scene("modern-anti-air");
    const plane: Aircraft = {
      id: f.game.allocateId(),
      playerId: 2,
      definitionId: "fighter",
      age: "EarlyModern",
      airfieldId: 0,
      x: f.source.x + 2 * FIXED,
      y: f.source.y,
      health: 10000,
      state: "outbound",
      target: null,
      reloadTick: 0,
      fuelTicks: 100,
    };
    f.battle.fight([plane]);
    const release = f.source.weaponState!.rangedAction!.releaseTick;
    expect(f.source.weaponState!.rangedAction!.targetKind).toBe("aircraft");
    expect(plane.health).toBe(10000);
    for (let tick = 1; tick < release; tick++) {
      f.game.tick = tick;
      f.battle.fight([plane]);
      expect(plane.health).toBe(10000);
    }
    f.game.tick = release;
    f.battle.fight([plane]);
    expect(plane.health).toBeLessThan(10000);
    const g = scene("modern-anti-air");
    const other = {
      ...plane,
      id: g.game.allocateId(),
      x: g.source.x + FIXED,
      health: 10000,
    };
    g.battle.fight([other]);
    other.state = "ready";
    g.game.tick = 1;
    g.battle.fight([other]);
    expect(g.source.weaponState!.rangedAction).toBeUndefined();
    expect(other.health).toBe(10000);
  });
  it("requires preparation before damaging a structure", () => {
    const f = scene("modern-infantry");
    const building = f.game.addBuilding({
      id: f.game.allocateId(),
      playerId: 2,
      type: "city",
      age: "StoneAge",
      tile: 15 * 64 + 8,
      health: 100000,
      maxHealth: 100000,
      remainingTicks: 0,
    });
    f.game.updateSquad(f.source.id, {
      structureTarget: { buildingId: building.id },
    });
    f.at(0);
    const release = f.source.weaponState!.rangedAction!.releaseTick;
    expect(f.source.weaponState!.rangedAction!.targetKind).toBe("building");
    for (let tick = 1; tick < release; tick++) f.at(tick);
    expect(f.game.building(building.id)!.health).toBe(100000);
    f.at(release);
    expect(f.game.building(building.id)!.health).toBeLessThan(100000);
  });
  it("requires fresh preparation after target loss, retargeting and explicit cancellation", () => {
    const f = scene();
    f.at(0);
    const original = f.source.weaponState!.rangedAction!;
    f.at(1);
    f.game.updateSquad(f.target.id, { x: 50 * FIXED });
    f.at(2);
    expect(f.source.weaponState!.rangedAction).toBeUndefined();
    f.game.updateSquad(f.target.id, { x: 8 * FIXED });
    f.at(3);
    expect(f.source.weaponState!.rangedAction!.releaseTick).toBe(
      3 + original.releaseTick,
    );
    const third = f.game.addSquad({
      ...structuredClone(f.target),
      id: f.game.allocateId(),
      x: 9 * FIXED,
    });
    f.game.updateSquad(f.source.id, {
      order: { type: "attack", targetId: third.id },
    });
    f.at(4);
    expect(f.source.weaponState!.rangedAction).toMatchObject({
      startTick: 4,
      targetId: third.id,
      releaseTick: 4 + original.releaseTick,
    });
    expect(
      f.game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [f.source.id],
        order: { type: "hold" },
      }),
    ).toBeNull();
    expect(f.source.weaponState!.rangedAction).toBeUndefined();
    f.at(5);
    expect(f.source.weaponState!.rangedAction!.startTick).toBe(5);
    expect(f.shots()).toBe(0);
  });
  it("preserves automatic cadence after one preparation and starts a new aim after magazine reload", () => {
    const profile = {
      ...UNIT.get("modern-archer")!.attack,
      shotsPerReload: 3,
      reloadMs: 1000,
    };
    let state: WeaponState | undefined;
    const target = { targetKind: "squad" as const, targetId: 2 };
    let first = -1,
      last = -1,
      sequence = 0,
      previousNext = 0;
    for (let tick = 0; tick < 40; tick++) {
      const prepared = prepareRangedShot(
        state,
        profile,
        "modern-archer",
        target,
        tick,
        state?.ranged?.nextTick ?? 0,
      );
      state = prepared.state;
      if (!prepared.ready) continue;
      const shot = commitWeaponShot(profile, state, tick, false);
      if (!shot) continue;
      state = releaseRangedShot(shot, profile, tick);
      if (first < 0) {
        first = tick;
        sequence = state.rangedSequence!;
      }
      if (state.ranged!.shots === 0) {
        expect(state.rangedAction!.phase).toBe("released");
        previousNext = state.ranged!.nextTick;
      } else if (previousNext) {
        expect(tick).toBe(previousNext);
        expect(state.rangedSequence).toBeGreaterThan(sequence);
        break;
      } else expect(state.rangedSequence).toBe(sequence);
      last = tick;
    }
    expect(first).toBe(profile.preparation!.ticks);
    expect(last - first).toBeLessThan(profile.preparation!.ticks);
  });
  it("replicates and restores an unfinished aim with identical future releases", () => {
    const f = scene();
    f.at(0);
    f.at(1);
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    decoder.decode(encoder.encode(f.game.snapshot()));
    f.at(2);
    expect(
      decoder
        .decode(encoder.encode(f.game.snapshot()))
        .squads.find((s) => s.id === f.source.id)!.weaponState,
    ).toEqual(f.source.weaponState);
    const restored = new Skirmish(f.map, f.options);
    restored.restore(f.game.checkpoint());
    expect(restored.squad(f.source.id)!.weaponState).toEqual(
      f.source.weaponState,
    );
    for (let tick = 3; tick < 28; tick++) {
      f.at(tick);
      restored.tick = tick;
      restored.expansion!.battle.fight([]);
      expect(restored.squad(f.source.id)!.weaponState).toEqual(
        f.source.weaponState,
      );
      expect(restored.volleys).toEqual(f.game.volleys);
    }
  });
  it("rejects malformed preparation records", () => {
    const f = scene();
    f.at(0);
    const state = structuredClone(f.source.weaponState!);
    expect(() => validateWeaponState(state)).not.toThrow();
    expect(() =>
      validateWeaponState(
        {
          ...state,
          rangedAction: {
            ...state.rangedAction!,
            startTick: 1,
            lastEligibleTick: 1,
          },
        },
        0,
      ),
    ).toThrow("preparation");
    for (const patch of [
      { releaseTick: 0 },
      { sequence: 999 },
      { targetKind: "ship" },
      { targetId: NaN },
      { lastEligibleTick: -1 },
      { phase: "shoot" },
    ])
      expect(() =>
        validateWeaponState({
          ...state,
          rangedAction: { ...state.rangedAction!, ...patch } as any,
        }),
      ).toThrow("preparation");
    expect(cancelRangedPreparation(state)!.rangedAction).toBeUndefined();
    expect(cancelRangedPreparation(state)!.rangedSequence).toBe(
      state.rangedSequence,
    );
  });
  it("resynchronizes late artwork or stalled playback at the next complete wind-up", () => {
    const f = scene("stoneage-archer");
    f.at(0);
    const clip = JSON.parse(
      readFileSync(
        "Art/Runtime/Russians/Troops/StoneAge-Javelinist/animations.json",
        "utf8",
      ),
    ).animations.find((c: ActorClip) => c.id === "attack") as ActorClip;
    const playback = new RangedAttackPresentation(),
      preparation = UNIT.get("stoneage-archer")!.attack.preparation;
    expect(
      playback.sample(f.source, 3, clip, 4000, preparation),
    ).toBeUndefined();
    for (let tick = 1; tick <= 5; tick++) f.at(tick);
    expect(
      playback.sample(f.source, 5, clip, 4000, preparation),
    ).toBeUndefined();
    expect(playback.permitsRelease(f.source.id)).toBe(false);
    f.game.updateSquad(f.source.id, { order: { type: "hold" } });
    f.at(6);
    for (let tick = 7; tick <= 32; tick++) f.at(tick);
    expect(f.source.weaponState!.rangedAction!.startTick).toBe(32);
    expect(playback.sample(f.source, 32, clip, 4000, preparation)).toBe(0);
    expect(playback.permitsRelease(f.source.id)).toBe(true);
  });
  it("shows complete preparation and releases projectiles on their own ticks through sparse snapshots", () => {
    const f = scene("stoneage-archer");
    const timeline = new CombatPresentationTimeline(
      COMBAT_PRESENTATION_DELAY_TICKS,
    );
    const snapshots = [structuredClone(f.game.snapshot())];
    for (let t = 1; t <= 12; t++) {
      f.at(t);
      if (t % 4 === 0) snapshots.push(structuredClone(f.game.snapshot()));
    }
    const clip = JSON.parse(
      readFileSync(
        "Art/Runtime/Russians/Troops/StoneAge-Javelinist/animations.json",
        "utf8",
      ),
    ).animations.find((c: ActorClip) => c.id === "attack") as ActorClip;
    const playback = new RangedAttackPresentation();
    const frames = [];
    for (let wall = 0; wall <= 16; wall++) {
      if (wall % 4 === 0 && wall <= 12) timeline.update(snapshots[wall / 4]);
      frames.push(timeline.sample(wall * TICK_MS, 1, false)!);
    }
    const start = frames.find((f) => f.tick === 1)!;
    expect(start).toBeDefined();
    const s = start.snapshot.squads.find((s) => s.id === f.source.id)!;
    // Actual preparation began at tick 1, before the first sparse publication.
    expect(
      playback.sample(
        s,
        start.tick,
        clip,
        4000,
        UNIT.get("stoneage-archer")!.attack.preparation,
      ),
    ).toBe(0);
    expect(start.snapshot.expansion!.projectiles).toHaveLength(0);
    const release = frames.find((f) => f.tick === 6)!;
    expect(release.tick).toBe(6);
    expect(
      release.snapshot.expansion!.projectiles.some(
        (p) => p.sourceId === f.source.id && p.tick === 6,
      ),
    ).toBe(true);
    expect(
      playback.sample(
        release.snapshot.squads.find((s) => s.id === f.source.id)!,
        6,
        clip,
        4000,
        UNIT.get("stoneage-archer")!.attack.preparation,
      ),
    ).toBe(580);
    const frozen = timeline.sample(100 * TICK_MS, 1, true)!;
    expect(frozen.tick).toBe(frames[frames.length - 1].tick);
  });
});

// Review C9 / A5 / C10 (R3-ranged-delta): order churn and target churn must
// not restart a ranged aim that is still valid, or the squad never fires.
describe("ranged preparation survives order and target churn", () => {
  const attack = (f: ReturnType<typeof scene>) =>
    f.game.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [f.source.id],
      order: { type: "attack", targetId: f.target.id },
    });
  /** Firing ticks over `ticks` ticks, re-issuing the same attack every `every` ticks (0 = never). */
  function reissued(id: string, every: number, ticks = 120) {
    const f = scene(id);
    let firing = 0;
    for (let t = 0; t < ticks; t++) {
      f.game.tick = t;
      // Napoleonic volleys destroy the target inside the window (C3 lethality).
      if (every && t % every === 0 && f.game.squad(f.target.id))
        expect(attack(f)).toBeNull();
      const before = f.game.squad(f.source.id)!.lastAttackTick;
      f.battle.fight([]);
      if (f.game.squad(f.source.id)!.lastAttackTick !== before) firing++;
    }
    return firing;
  }
  it.each(["modern-infantry", "napoleonic-infantry", "earlymodern-rangedcavalry"])(
    "%s fires as often when the same attack is re-issued every tick or every 6 ticks",
    (id) => {
      const never = reissued(id, 0);
      expect(never).toBeGreaterThan(0);
      expect(reissued(id, 1)).toBe(never);
      expect(reissued(id, 6)).toBe(never);
    },
  );
  it("keeps the aim's start tick while the same attack is re-issued during the wind-up", () => {
    const f = scene("modern-infantry");
    expect(attack(f)).toBeNull();
    f.at(0);
    const first = f.game.squad(f.source.id)!.weaponState!.rangedAction!;
    expect(first.startTick).toBe(0);
    for (let t = 1; t < first.releaseTick; t++) {
      f.game.tick = t;
      expect(attack(f)).toBeNull();
      expect(f.game.squad(f.source.id)!.weaponState!.rangedAction!.startTick).toBe(0);
      f.battle.fight([]);
      expect(f.game.squad(f.source.id)!.weaponState!.rangedAction!.startTick).toBe(0);
    }
    f.game.tick = first.releaseTick;
    expect(attack(f)).toBeNull();
    f.battle.fight([]);
    expect(f.game.squad(f.source.id)!.lastAttackTick).toBe(first.releaseTick);
  });
  it("still restarts the aim when a different order replaces the attack", () => {
    const f = scene("modern-infantry");
    expect(attack(f)).toBeNull();
    f.at(0);
    expect(f.game.squad(f.source.id)!.weaponState!.rangedAction).toBeDefined();
    f.game.tick = 1;
    expect(
      f.game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [f.source.id],
        order: { type: "move", tile: 15 * 64 + 3 },
      }),
    ).toBeNull();
    expect(f.game.squad(f.source.id)!.weaponState?.rangedAction).toBeUndefined();
  });
});
