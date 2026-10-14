import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ENGAGEMENT } from "../../src/skirmish/content/TacticalRules";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNIT } from "../../src/skirmish/content/Units";
import { validateArmyRecords } from "../../src/skirmish/domain/ArmyState";
import { layoutArmyBattleLine } from "../../src/skirmish/domain/BattleLineLayout";
import { commandRejection } from "../../src/skirmish/domain/CommandPolicy";
import {
  controllerOf,
  mayNavigateArmy,
  mayWrite,
} from "../../src/skirmish/domain/CommandPrecedence";
import type { ArmySlotRecord } from "../../src/skirmish/domain/Definitions";
import { createFormation } from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { retainSquads } from "./UnitFixtures";
const unit = UNIT.get("bronzeage-infantry")!;
function fixture(count = 6, deferred = false) {
  const terrain = new Uint8Array(96 * 96).fill(133),
    map = new GameMapImpl(96, 96, terrain, terrain.length);
  const options = {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1" as const,
    deferredPlanning: deferred,
    aiEconomy: deferred,
  };
  const game = new Skirmish(map, options),
    e = game.expansion!,
    a = game.squads.find((s) => s.playerId === 1)!,
    b = game.squads.find((s) => s.playerId === 2)!;
  const bodies = [a, b].flatMap((template) =>
    Array.from({ length: count }, (_, i) => ({
      ...template,
      id: template.playerId * 100 + i,
      definitionId: unit.id,
      kind: unit.line,
      troops: 24,
      manpower: createManpower(unit),
      formation: createFormation(unit.id),
      x: ((template.playerId === 1 ? 35 : 39) + Math.floor(i / 18) * 3) * FIXED,
      y: (30 + (i % 18) * 3) * FIXED,
      order: { type: "hold" } as Squad["order"],
      path: [],
      queuedOrders: [],
    })),
  );
  retainSquads(game, bodies);
  for (const p of game.players) {
    e.progression.states[p.id].completed = TECHNOLOGIES.map((t) => t.id);
    e.progression.states[p.id].age = "BronzeAge";
    expect(
      game.applyCommand({
        type: "create-army",
        playerId: p.id,
        squadIds: bodies.filter((s) => s.playerId === p.id).map((s) => s.id),
      }),
    ).toBeNull();
  }
  return { game, e, map, options };
}
const step = (game: Skirmish, n: number) => {
  for (let i = 0; i < n; i++) game.step();
};
describe("phase 8 persistent battle lines", () => {
  it("packs mixed widths without overlap and separates role bands", () => {
    const roles: ArmySlotRecord["role"][] = [
      "frontline",
      "frontline",
      "ranged",
      "support",
      "reserve",
      "mounted-left",
      "mounted-right",
    ];
    const rows = layoutArmyBattleLine(
      roles.map((role, i) => ({
        squadId: i + 1,
        role,
        index: i,
        lateral: 0,
        depth: 0,
        widthRev: "test",
        width: ((i % 2) + 1) * FIXED,
        bodyDepth: FIXED,
      })),
    );
    expect(rows[1].lateral - rows[0].lateral).toBeGreaterThanOrEqual(
      (rows[0].width + rows[1].width) / 2 + FIXED / 2,
    );
    expect(rows[2].depth).toBeLessThan(rows[0].depth);
    expect(rows[3].depth).toBeLessThan(rows[2].depth);
    expect(rows[4].depth).toBeLessThan(rows[3].depth);
    expect(rows[5].lateral).toBeLessThan(rows[0].lateral);
    expect(rows[6].lateral).toBeGreaterThan(rows[1].lateral);
  });
  it("wraps fronts at forty tiles and keeps slot identity", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      squadId: i + 1,
      role: "frontline" as const,
      index: i,
      lateral: 0,
      depth: 0,
      widthRev: "test",
      width: 4 * FIXED,
      bodyDepth: FIXED,
    }));
    const rows = layoutArmyBattleLine(input);
    expect(new Set(rows.map((r) => r.depth)).size).toBeGreaterThan(1);
    for (const r of rows)
      expect(Math.abs(r.lateral) + r.width / 2).toBeLessThanOrEqual(20 * FIXED);
    expect(rows.map((r) => r.index)).toEqual(input.map((r) => r.index));
  });
  it("gates command ownership centrally, including persistent charge movement", () => {
    const { game, e } = fixture(),
      s = game.squad(100)!,
      world = {
        armyOf: (id: number) => e.armies.armyOf(id),
        directArmyAction: (id: number) => e.armies.directArmyAction(id),
      };
    expect(controllerOf(world, s)).toBe("army");
    expect(mayWrite(world, s, "stance")).toBe(false);
    expect(mayWrite(world, s, "player")).toBe(true);
    const afloat = { ...s, afloat: { hull: 100, maxHull: 100, vesselId: "stoneage-transport" } };
    expect(mayNavigateArmy(world, afloat)).toBe(true);
    expect(mayWrite(world, afloat, "army")).toBe(false);
    expect(mayWrite(world, afloat, "stance")).toBe(false);
    expect(mayNavigateArmy(world, { ...afloat, embarkedOn: 1 })).toBe(false);
    expect(mayNavigateArmy(world, { ...afloat, troops: 0 })).toBe(false);
    expect(mayNavigateArmy({ ...world, directArmyAction: () => true }, afloat)).toBe(false);
    expect(
      controllerOf(world, {
        ...s,
        cavalryEngagement: {
          phase: "penetrating",
          tick: 0,
          untilTick: 1,
          targetIds: [200],
          originX: 0,
          originY: 0,
          goalX: 1,
          goalY: 0,
        },
      }),
    ).toBe("domain");
  });
  it("preserves membership for internal formation changes but detaches direct player subsets", () => {
    const { game, e } = fixture();
    expect(
      game.applyArmyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [100],
        shape: "mass",
      }),
    ).toBeNull();
    expect(e.armies.armyOf(100)).toBeDefined();
    step(game, 60);
    expect(
      game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [100],
        shape: "shield-wall",
      }),
    ).toBeNull();
    expect(e.armies.armyOf(100)).toBeUndefined();
  });
  it("validates posture ownership and strict values", () => {
    const { game, e } = fixture(),
      army = e.armies.armies[0];
    expect(
      game.applyCommand({
        type: "army-posture",
        playerId: 1,
        armyId: army.id,
        posture: "defend",
      }),
    ).toBeNull();
    expect(army.posture).toBe("defend");
    expect(
      game.applyCommand({
        type: "army-posture",
        playerId: 2,
        armyId: army.id,
        posture: "line",
      }),
    ).toMatch(/own/);
    expect(
      commandRejection({
        type: "army-posture",
        playerId: 1,
        armyId: army.id,
        posture: "bad" as "line",
      }),
    ).toMatch(/posture/);
  });
  it("replaces a dead front slot with a reserve without moving unrelated slots", () => {
    const { game, e } = fixture(),
      army = e.armies.armies[0],
      dead = army.slots!.find((r) => r.role === "frontline")!,
      reserve = army.slots!.find((r) => r.role === "reserve")!;
    const old = army
      .slots!.filter(
        (r) => r.squadId !== dead.squadId && r.squadId !== reserve.squadId,
      )
      .map((r) => ({ ...r }));
    game.removeSquad(dead.squadId);
    e.armies.reconcile();
    e.armies.step();
    const replacement = army.slots!.find((r) => r.squadId === reserve.squadId)!;
    expect(replacement.role).toBe("frontline");
    expect(replacement.index).toBe(dead.index);
    expect(replacement.lateral).toBe(dead.lateral);
    expect(
      army.slots!.filter((r) => old.some((o) => o.squadId === r.squadId)),
    ).toEqual(old);
  });
  it("bounds planning work, distributes frontage and restores partially completed work", () => {
    const { game, e, map, options } = fixture(18);
    step(game, 1);
    for (const army of e.armies.armies) {
      army.facing = army.playerId === 1 ? 0 : Math.PI;
      army.x = (army.playerId === 1 ? 35 : 40) * FIXED;
      army.y = 48 * FIXED;
    }
    const used = e.engagements.step();
    expect(used).toBeLessThanOrEqual(80);
    expect(e.engagements.diagnostics.planned).toBeLessThanOrEqual(48);
    expect(e.engagements.engagements.size).toBeGreaterThan(0);
    const state = game.checkpoint(),
      copy = new Skirmish(map, options);
    copy.restore(state);
    expect(copy.expansion!.engagements.checkpoint()).toEqual(
      e.engagements.checkpoint(),
    );
    for (let i = 0; i < 18; i++) {
      game.tick++;
      copy.tick++;
      e.engagements.step();
      copy.expansion!.engagements.step();
    }
    expect(copy.expansion!.engagements.checkpoint()).toEqual(
      e.engagements.checkpoint(),
    );
    const plan = e.engagements.planFor(e.armies.armies[0].id)!;
    expect(plan).toBeDefined();
    const counts = new Map<number, number>();
    for (const a of plan.assignments)
      if (a.targetId !== null)
        counts.set(a.targetId, (counts.get(a.targetId) ?? 0) + 1);
    expect(counts.size).toBeGreaterThan(1);
    expect([...counts.values()].every((n) => n <= 2)).toBe(true);
  });
  it.each([1, ENGAGEMENT.maxArmies - 1])(
    "merges engagements with %i removed armies using only live membership",
    (removedCount) => {
      const { game, e, map, options } = fixture();
      game.step();
      const [own, enemy] = e.armies.armies;
      const saved = e.engagements.checkpoint();
      const record = (id: number, armyIds: number[]) => ({
        id,
        armyIds,
        looseSquadIds: [],
        axis: { x: 1, y: 0 },
        centre: { x: own.x, y: own.y },
        revision: 0,
        plannedRevision: 0,
        nextPlanTick: game.tick,
        createdTick: game.tick,
        lastContactTick: game.tick,
        soldiers: 0,
        slotSignature: "",
      });
      // Engagement records survive army removal until detection reconciles them.
      saved.engagements = [
        [1, record(1, [own.id])],
        [
          2,
          record(2, [
            enemy.id,
            ...Array.from({ length: removedCount }, (_, i) => 1000 + i),
          ]),
        ],
      ];
      saved.nextId = 3;
      e.engagements.restore(saved);
      const copy = new Skirmish(map, options);
      copy.restore(game.checkpoint());
      expect(() => e.engagements.step()).not.toThrow();
      expect(() => copy.expansion!.engagements.step()).not.toThrow();
      expect(
        [...e.engagements.engagements.values()].map((row) => row.armyIds),
      ).toEqual([[own.id, enemy.id].sort((a, b) => a - b)]);
      expect(copy.expansion!.engagements.checkpoint()).toEqual(
        e.engagements.checkpoint(),
      );
      expect(() => game.step()).not.toThrow();
      expect(() => copy.step()).not.toThrow();
      expect(copy.checkpoint()).toEqual(game.checkpoint());
    },
  );
  it("maps fire-retreat to a stable skirmish line without shot-triggered displacement", () => {
    const { game, e } = fixture();
    step(game, 1);
    const army = e.armies.armies[0];
    expect(
      game.applyCommand({
        type: "army-order",
        playerId: 1,
        armyId: army.id,
        order: { type: "fire-retreat", targetId: 200 },
      }),
    ).toBeNull();
    e.armies.step();
    expect(army.posture).toBe("skirmish");
    const slots = structuredClone(army.slots);
    for (const id of army.memberIds)
      game.updateSquad(id, { lastAttackTick: game.tick });
    game.tick++;
    e.armies.step();
    expect(army.slots).toEqual(slots);
  });
  it("rejects invalid slot state and carries slots through canonical snapshots", () => {
    const { game, e } = fixture(),
      army = e.armies.armies[0];
    expect(() => validateArmyRecords([army])).not.toThrow();
    expect(() =>
      validateArmyRecords([
        { ...army, slots: [army.slots![0], army.slots![0]] },
      ]),
    ).toThrow();
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(game.snapshot()),
    );
    expect(decoded.expansion!.armies[0].slots).toEqual(army.slots);
    expect(() =>
      game.restore({ ...game.checkpoint(), version: 8 } as never),
    ).toThrow(/Checkpoint/);
  });
  it("allows independent coastal missions up to the nation cap and releases each nation transactionally", () => {
    const { game, e, map } = fixture(42, true),
      ai = game.players[1],
      planner = e.economy.military.armyPlanner;
    for (const army of [...e.armies.armies])
      if (army.playerId === ai.id)
        game.applyCommand({
          type: "disband-army",
          playerId: ai.id,
          armyId: army.id,
        });
    expect(planner.missionCap(ai)).toBe(2);
    expect(planner.acquireCoast(ai, map.ref(50, 50))).toBe(true);
    expect(planner.acquireCoast(ai, map.ref(52, 50))).toBe(true);
    expect(planner.acquireCoast(ai, map.ref(54, 50))).toBe(false);
    for (let tick = 0; tick < 24; tick++) {
      game.tick++;
      expect(planner.step(24)).toBeLessThanOrEqual(24);
    }
    const plans = [...planner.missions.values()].filter(
      (p) => p.playerId === ai.id,
    );
    expect(plans).toHaveLength(2);
    expect(plans.every((p) => p.armyId !== undefined)).toBe(true);
    expect(new Set(plans.flatMap((p) => p.members)).size).toBe(
      plans.reduce((n, p) => n + p.members.length, 0),
    );
    const saved = planner.checkpoint();
    planner.restore(saved);
    expect(planner.byPlayer.get(ai.id)).toHaveLength(2);
    expect(planner.missions.size).toBe(2);
    planner.release(ai.id);
    expect(planner.missions.size).toBe(0);
    expect(planner.byPlayer.has(ai.id)).toBe(false);
  });
});
