import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { DamageLedger } from "../../src/skirmish/Conquest";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { UNIT } from "../../src/skirmish/content/Units";
import {
  createManpower,
  damageManpower,
  enlargementTerms,
  HEALTH_SCALE,
  remainingHealth,
  scaledRecipeCost,
} from "../../src/skirmish/domain/Manpower";
import { unitRefitCost } from "../../src/skirmish/domain/Refitting";

function fixture(id = "earlymedieval-infantry") {
  const terrain = new Uint8Array(64 * 64).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 64, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  game.owners.fill(1);
  const original = game.squads.find((s) => s.playerId === 1)!;
  const unit = UNIT.get(id)!;
  for (const s of [...game.squads])
    if (s.id !== original.id) game.removeSquad(s.id);
  game.updateSquad(original.id, {
    definitionId: id,
    kind: unit.line,
    troops: unit.formationRecipe!.capacity,
    manpower: createManpower(unit),
    order: { type: "hold" },
    moved: false,
    fighting: false,
    charge: null,
  });
  const player = game.players[0],
    expansion = game.expansion!;
  player.reserves = 1000;
  player.gold = 100000;
  expansion.progression.states[1].completed.push(
    unit.formationRecipe!.technologyId!,
  );
  expansion.supply.inventories[1] = {
    ...scaledRecipeCost(unit, "enlarged").items,
  };
  return { game, player, expansion, unit, id: original.id };
}
describe("literal formation manpower conservation", () => {
  it("pauses a paid refit while land is lost and completes only after ownership returns", () => {
    const f = fixture(),
      target = UNIT.get("modern-infantry")!;
    f.expansion.progression.states[1].completed.push(target.technologyId);
    f.expansion.supply.inventories[1] = { ...unitRefitCost(target).items };
    expect(
      f.game.applyCommand({
        type: "refit",
        playerId: 1,
        squadIds: [f.id],
        definitionId: target.id,
      }),
    ).toBeNull();
    const remaining = f.game.squad(f.id)!.refit!.remainingTicks,
      reserves = f.player.reserves;
    f.game.owners.fill(0);
    for (let i = 0; i < remaining; i++) f.expansion.beforeStep();
    expect(f.game.squad(f.id)!.refit!.remainingTicks).toBe(remaining);
    expect(f.player.reserves).toBe(reserves);
    f.game.owners.fill(1);
    for (let i = 0; i < remaining; i++) f.expansion.beforeStep();
    expect(f.game.squad(f.id)!.definitionId).toBe(target.id);
    expect(f.player.reserves).toBe(reserves + f.unit.formationRecipe!.capacity - target.formationRecipe!.capacity);
  });
  it("keeps an injured single gunner alive until its health is exhausted", () => {
    const f = fixture("earlymodern-archer");
    // Pick the authored one-member recipe regardless of its display identifier.
    expect(f.unit.formationRecipe!.capacity).toBe(1);
    const hp = f.game.squad(f.id)!.manpower!.hp;
    const damage = new DamageLedger();
    damage.add(f.id, 2, hp / HEALTH_SCALE - 1);
    f.game.resolveLandDamage(damage);
    expect(f.game.squad(f.id)!.troops).toBe(1);
    expect(remainingHealth(f.game.squad(f.id)!)).toBe(HEALTH_SCALE);
    const lethal = new DamageLedger();
    lethal.add(f.id, 2, 1);
    f.game.resolveLandDamage(lethal);
    expect(f.game.squad(f.id)).toBeUndefined();
  });
  it("adds only paid capacity to a damaged squad and preserves its wounds", () => {
    const f = fixture(),
      m = f.game.squad(f.id)!.manpower!;
    f.game.updateSquad(f.id, { troops: 28, manpower: { ...m, wounds: 25000 } });
    const before = remainingHealth(f.game.squad(f.id)!);
    const terms = enlargementTerms(f.unit),
      reserves = f.player.reserves;
    expect(
      f.game.applyCommand({
        type: "enlarge",
        playerId: 1,
        squadIds: [f.id],
        definitionId: f.unit.id,
      }),
    ).toBeNull();
    expect(f.player.reserves).toBe(reserves - terms.added);
    for (let i = 0; i < terms.ticks; i++) f.expansion.beforeStep();
    const enlarged = f.game.squad(f.id)!;
    expect(enlarged.troops).toBe(28 + terms.added);
    expect(enlarged.manpower!.capacity).toBe(f.unit.formationRecipe!.enlargedCapacity);
    expect(enlarged.manpower!.wounds).toBe(25000);
    expect(remainingHealth(enlarged) - before).toBe(terms.added * m.hp);
  });
  it("refunds exact escrow on cancellation without adding soldiers or health", () => {
    const f = fixture(),
      before = structuredClone({
        reserves: f.player.reserves,
        gold: f.player.gold,
        items: f.expansion.supply.inventories[1],
        squad: f.game.squad(f.id)!,
      });
    expect(
      f.game.applyCommand({
        type: "enlarge",
        playerId: 1,
        squadIds: [f.id],
        definitionId: f.unit.id,
      }),
    ).toBeNull();
    expect(
      f.game.applyCommand({
        type: "cancel-enlarge",
        playerId: 1,
        squadIds: [f.id],
      }),
    ).toBeNull();
    expect(f.player.reserves).toBe(before.reserves);
    expect(f.player.gold).toBe(before.gold);
    expect(f.expansion.supply.inventories[1]).toEqual(before.items);
    expect(f.game.squad(f.id)!.troops).toBe(before.squad.troops);
    expect(remainingHealth(f.game.squad(f.id)!)).toBe(
      remainingHealth(before.squad),
    );
  });
  it("restores a paid operation and rejects malformed health before installation", () => {
    const f = fixture();
    f.game.applyCommand({
      type: "enlarge",
      playerId: 1,
      squadIds: [f.id],
      definitionId: f.unit.id,
    });
    f.expansion.beforeStep();
    const saved = f.game.checkpoint(),
      restored = fixture().game;
    restored.restore(saved);
    expect(restored.checkpoint()).toEqual(saved);
    for (let i = 0; i < 30; i++) {
      f.game.step();
      restored.step();
    }
    expect(restored.checkpoint()).toEqual(f.game.checkpoint());
    const good = restored.checkpoint(),
      bad = structuredClone(good);
    bad.squads = bad.squads.map((s, i) =>
      i ? s : { ...s, manpower: { ...s.manpower!, wounds: s.manpower!.hp } },
    );
    expect(() => restored.restore(bad)).toThrow("manpower");
    expect(restored.checkpoint()).toEqual(good);
  });
  it("carries fractional damage across batches instead of rounding away injury", () => {
    const unit = UNIT.get("stoneage-infantry")!,
      m = createManpower(unit);
    let squad = { troops: 12, manpower: m };
    for (let i = 0; i < 100; i++) {
      const hit = damageManpower(squad, m.hp / 100);
      squad = { troops: hit.troops, manpower: hit.manpower };
    }
    expect(squad.troops).toBe(11);
    expect(squad.manpower.wounds).toBe(0);
  });
  it("captures the paid base recipe when capacity research finishes during recruitment", () => {
    const f = fixture("stoneage-infantry"),
      state = f.expansion.progression.states[1];
    state.completed = state.completed.filter(
      (id) => id !== f.unit.formationRecipe!.technologyId,
    );
    state.completed.push(f.unit.technologyId);
    const building = f.game.addBuilding({
      id: f.game.allocateId(),
      type: f.unit.building,
      tile: f.player.base,
      playerId: 1,
      age: f.unit.age,
      remainingTicks: 0,
    });
    expect(
      f.game.applyCommand({
        type: "recruit",
        playerId: 1,
        buildingId: building.id,
        definitionId: f.unit.id,
      }),
    ).toBeNull();
    const job = f.game.recruitment.jobs[0];
    expect(job.capacity).toBe(12);
    expect(job.cost.reserves).toBe(12);
    state.completed.push(f.unit.formationRecipe!.technologyId!);
    const originalId = f.id;
    for (let i = 0; i < job.totalTicks + 5; i++) f.game.step();
    const recruited = f.game.squads.find(
      (s) => s.playerId === 1 && s.id !== originalId,
    )!;
    expect(recruited.troops).toBe(12);
    expect(recruited.manpower!.variant).toBe("base");
  });
  it("round trips wounds and paid enlargement through packed snapshots", () => {
    const f = fixture(),
      m = f.game.squad(f.id)!.manpower!;
    f.game.updateSquad(f.id, { manpower: { ...m, wounds: 12345 } });
    f.game.applyCommand({
      type: "enlarge",
      playerId: 1,
      squadIds: [f.id],
      definitionId: f.unit.id,
    });
    const packet = new SnapshotEncoder().encode(f.game.snapshot());
    const decoded = new SnapshotDecoder().decode(packet);
    expect(decoded.squads.find((s) => s.id === f.id)!.manpower).toEqual(
      f.game.squad(f.id)!.manpower,
    );
    expect(() =>
      new SnapshotDecoder().decode({ ...packet, formationRulesVersion: 1 }),
    ).toThrow("formation rules");
  });
  it("consumes escrow on destruction rather than refunding a dead squad", () => {
    const f = fixture();
    f.game.applyCommand({
      type: "enlarge",
      playerId: 1,
      squadIds: [f.id],
      definitionId: f.unit.id,
    });
    const balance = f.player.reserves,
      hit = new DamageLedger();
    hit.add(f.id, 2, 100000);
    f.game.resolveLandDamage(hit);
    expect(f.game.squad(f.id)).toBeUndefined();
    expect(f.player.reserves).toBe(balance);
    expect(
      f.game.applyCommand({
        type: "cancel-enlarge",
        playerId: 1,
        squadIds: [f.id],
      }),
    ).toMatch(/No enlargement/);
  });
  it("returns refit overflow to reserves and retains the wounded member and weapon commitment", () => {
    const f = fixture(),
      target = UNIT.get("modern-infantry")!;
    f.game.updateSquad(f.id, {
      troops: 40,
      manpower: { ...f.game.squad(f.id)!.manpower!, wounds: 25000 },
      nextAttackTick: 10000,
    });
    f.expansion.progression.states[1].completed.push(target.technologyId);
    f.expansion.supply.inventories[1] = { ...unitRefitCost(target).items };
    const reserves = f.player.reserves;
    expect(
      f.game.applyCommand({
        type: "refit",
        playerId: 1,
        squadIds: [f.id],
        definitionId: target.id,
      }),
    ).toBeNull();
    const ticks = f.game.squad(f.id)!.refit!.remainingTicks;
    for (let i = 0; i < ticks; i++) f.expansion.beforeStep();
    const refitted = f.game.squad(f.id)!;
    expect(refitted.troops).toBe(8);
    expect(f.player.reserves).toBe(reserves + 32);
    expect(refitted.manpower!.wounds).toBe(25000);
    expect(refitted.nextAttackTick).toBe(10000);
  });
});
