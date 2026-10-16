import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { UNIT } from "../../src/skirmish/content/Units";
import { formationApproach } from "../../src/skirmish/domain/FormationContact";
import {
  createFormation,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import {
  MeleeDamageBatch,
  meleeReceivers,
} from "../../src/skirmish/domain/MeleeDamage";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { cavalryImpactScene } from "./fixtures/CavalryImpact";

function body(id: number, count = 81): Squad {
  const unit = UNIT.get("bronzeage-infantry")!;
  return {
    id,
    playerId: id,
    kind: unit.line,
    definitionId: unit.id,
    troops: count,
    manpower: { ...createManpower(unit), capacity: count, hp: 100000 },
    formation: {
      ...createFormation(unit.id),
      shape: "mass",
      layoutTroops: count,
      facing: 0,
    },
    x: 24 * FIXED,
    y: 24 * FIXED,
    order: { type: "hold" },
    embarkedOn: null,
    xp: 0,
  } as Squad;
}

describe("simultaneous melee contact budgets", () => {
  it("discards lethal overkill and limits one attacker to one ordinary victim", () => {
    const batch = new MeleeDamageBatch<number>(),
      results: number[] = [];
    batch.add(body(2), [0, 1, 2, 3], 1, 10000, 0);
    batch.resolve((_, damage) => results.push(damage));
    expect(results).toEqual([100]);
    batch.resolve(() => {
      throw Error("Damage must not carry into the next step");
    });
  });
  it("shares overlapping victims proportionally and is independent of submission order", () => {
    const run = (reverse: boolean) => {
      const batch = new MeleeDamageBatch<string>(),
        results = new Map<string, number>();
      for (const id of reverse ? ["b", "a"] : ["a", "b"])
        batch.add(body(2), [0, 1], 2, id === "a" ? 600 : 200, id);
      batch.resolve((id, hit) => results.set(id, hit));
      return [results.get("a"), results.get("b")];
    };
    expect(run(false)).toEqual([150, 50]);
    expect(run(true)).toEqual(run(false));
  });
  it("allows another edge to expose additional victims but charges existing wounds once", () => {
    const original = body(2),
      target = {
        ...original,
        manpower: { ...original.manpower!, wounds: 50000 },
      };
    const batch = new MeleeDamageBatch<number>();
    let applied = 0;
    batch.add(target, [0, 1], 2, 10000, 0);
    batch.add(target, [1, 2], 2, 10000, 1);
    batch.resolve((_, hit) => (applied += hit));
    expect(applied).toBe(250);
  });
  it("does not turn a weak hit on one edge into damage on another edge", () => {
    const batch = new MeleeDamageBatch<number>();
    let applied = 0;
    batch.add(body(2), [0], 1, 10000, 0);
    batch.add(body(2), [1], 1, 10, 1);
    batch.resolve((_, hit) => (applied += hit));
    expect(applied).toBe(110);
  });
  it("preserves sublethal aggregate damage and refuses empty contact", () => {
    const batch = new MeleeDamageBatch<number>();
    let applied = 0;
    batch.add(body(2), [0, 1], 2, 25, 0);
    batch.add(body(2), [], 10, 10000, 1);
    batch.resolve((_, hit) => (applied += hit));
    expect(applied).toBe(25);
  });
});

describe("melee receiver geometry", () => {
  function contact() {
    const source = body(1),
      target = body(2);
    const b = {
      ...target,
      y: target.y + 5 * FIXED,
      formation: { ...target.formation!, facing: TURN / 2 },
    };
    const a = { ...source, ...formationApproach(source, b, 0, FIXED / 2) };
    return { a, b };
  }
  it("screens the rear even when the weapon could reach through several ranks", () => {
    const { a, b } = contact();
    const slots = meleeReceivers(a, b, 0, 4 * FIXED);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(12);
    expect(new Set(slots).size).toBe(slots.length);
  });
  it("exposes different defenders from the opposite edge", () => {
    const { a, b } = contact(),
      front = meleeReceivers(a, b, 0, 4 * FIXED);
    const other = { ...a, y: b.y + 5 * FIXED };
    const rear = meleeReceivers(
      { ...other, ...formationApproach(other, b, 0, FIXED / 2) },
      b,
      0,
      4 * FIXED,
    );
    expect(rear.length).toBeGreaterThan(0);
    expect(rear.some((id) => front.includes(id))).toBe(false);
  });
  it("admits additional charge depth without exposing the whole formation", () => {
    const { a, b } = contact(),
      ordinary = meleeReceivers(a, b, 0, FIXED / 2);
    const charged = meleeReceivers(a, b, 0, FIXED / 2, 64);
    expect(charged.length).toBeGreaterThan(ordinary.length);
    expect(charged.length).toBeLessThan(b.troops);
    expect(
      meleeReceivers(a, { ...b, y: b.y + 20 * FIXED }, 0, FIXED / 2),
    ).toEqual([]);
  });
});

describe("live battle melee overkill", () => {
  it.each([false, true])(
    "bounds a live cavalry charge against fragile defenders (braced: %s)",
    (braced) => {
      const { game, defender } = cavalryImpactScene(false, braced);
      const before = defender.troops;
      game.updateSquad(defender.id, {
        manpower: { ...defender.manpower!, hp: 1000 },
      });
      game.step();
      expect(defender.troops).toBeLessThan(before);
      expect(defender.troops).toBeGreaterThan(0);
    },
  );
  it("kills exposed soldiers, waits for another attack, then makes progress against new ranks", () => {
    const terrain = new Uint8Array(64 * 64).fill(133);
    const game = new Skirmish(
      new GameMapImpl(64, 64, terrain, terrain.length),
      {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      },
    );
    const ids = [
      game.squads.find((s) => s.playerId === 1)!.id,
      game.squads.find((s) => s.playerId === 2)!.id,
    ];
    for (const s of [...game.squads])
      if (!ids.includes(s.id)) game.removeSquad(s.id);
    for (let i = 0; i < 2; i++) {
      const original = body(ids[i], i ? 81 : 1);
      const s = {
        ...original,
        playerId: i + 1,
        y: original.y + (i ? 5 : 0) * FIXED,
        manpower: { ...original.manpower!, hp: i ? 1000 : 1000000 },
        formation: { ...original.formation!, facing: i ? TURN / 2 : 0 },
      };
      const { id, ...changes } = s;
      game.updateSquad(id, changes);
    }
    const strike = () => {
      const a = game.squad(ids[0])!,
        b = game.squad(ids[1])!;
      game.updateSquad(a.id, formationApproach(a, b, game.tick, FIXED / 2));
      game.expansion!.battle.fight([]);
    };
    strike();
    expect(game.squad(ids[1])!.troops).toBe(80);
    game.tick++;
    strike();
    expect(game.squad(ids[1])!.troops).toBe(80);
    for (let i = 0; i < 40; i++) {
      game.tick++;
      strike();
    }
    expect(game.squad(ids[1])!.troops).toBeLessThan(80);
    expect(game.squad(ids[1])!.troops).toBeGreaterThan(70);
  });
});
