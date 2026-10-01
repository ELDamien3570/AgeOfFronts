import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { ArmyViewModel } from "../../src/skirmish/client/ArmyViewModel";
import { ARMY_CAPS, armyCapacity } from "../../src/skirmish/content/Armies";
import {
  TECHNOLOGIES,
  technologyAt,
} from "../../src/skirmish/content/Technology";
import {
  advanceRejection,
  researchRejection,
} from "../../src/skirmish/domain/Progression";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
const make = (
  count = 20,
  full = false,
  data = new Uint8Array(96 * 64).fill(133),
) => {
  const match = new Skirmish(
    new GameMapImpl(96, 64, data, data.filter((v) => v & 128).length),
    { seed: 47, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" },
  );
  const e = match.expansion!;
  const own = match.squads.find((s) => s.playerId === 1)!;
  match.squads.splice(
    0,
    match.squads.length,
    ...match.squads.filter((s) => s.playerId !== 1),
    ...Array.from({ length: count }, (_, i) => ({
      ...own,
      id: 100 + i,
      x: (12 + (i % 4)) * FIXED,
      y: (30 + Math.floor(i / 4)) * FIXED,
      order: { type: "hold" } as Squad["order"],
      path: [],
      queuedOrders: [],
    })),
  );
  for (const s of match.squads.filter((s) => s.playerId === 2)) {
    s.x = 85 * FIXED;
    s.y = (52 + (s.id % 3)) * FIXED;
  }
  e.progression.states[1].age = full ? "Modern" : "BronzeAge";
  e.progression.states[1].completed = full
    ? TECHNOLOGIES.map((t) => t.id)
    : ["bronzeage-armies"];
  return match;
};
const ids = (m: Skirmish) =>
  m.squads.filter((s) => s.playerId === 1).map((s) => s.id);
const create = (m: Skirmish) =>
  m.applyCommand({ type: "create-army", playerId: 1, squadIds: ids(m) });
const step = (m: Skirmish, n: number) => {
  for (let i = 0; i < n; i++) m.step();
};
describe("persistent armies and Bronze tree", () => {
  it("requires all five Bronze Warfare nodes, and retains catch-up when other trees unlock Classical", () => {
    const m = make(3),
      state = m.expansion!.progression.states[1];
    state.completed = TECHNOLOGIES.filter(
      (t) =>
        t.age === "BronzeAge" &&
        t.tree !== "naval" &&
        t.id !== "bronzeage-armies",
    ).map((t) => t.id);
    expect(advanceRejection(state, 1e8)).toMatch(/two/);
    state.completed.push("bronzeage-armies");
    expect(advanceRejection(state, 1e8)).toBeNull();
    state.age = "ClassicalAge";
    state.completed = state.completed.filter((id) => id !== "bronzeage-armies");
    expect(
      researchRejection(
        state,
        1e8,
        technologyAt("ClassicalAge", "warfare", 1).id,
      ),
    ).toMatch(/prerequisites/);
    state.completed.push("bronzeage-armies");
    expect(
      researchRejection(
        state,
        1e8,
        technologyAt("ClassicalAge", "warfare", 1).id,
      ),
    ).toBeNull();
  });
  it("gates capacity by researched named technologies, never empire age alone", () => {
    expect(armyCapacity([])).toBe(0);
    const completed: string[] = [];
    for (const rule of ARMY_CAPS) {
      completed.push(rule.technologyId);
      expect(armyCapacity(completed)).toBe(rule.capacity);
    }
    const m = make(3, true);
    m.expansion!.progression.states[1].completed = [];
    expect(create(m)).toMatch(/Research/);
  });
  it("creates exactly 20 without cost, atomically rejects 21, duplicate, foreign and stolen members", () => {
    const m = make(21),
      e = m.expansion!,
      p = m.players[0],
      before = [p.gold, p.reserves, m.squads.length];
    expect(create(m)).toMatch(/20/);
    expect(e.armies.armies).toHaveLength(0);
    const selected = ids(m).slice(0, 20);
    expect(
      m.applyCommand({
        type: "create-army",
        playerId: 1,
        squadIds: [selected[0], selected[0]],
      }),
    ).toMatch(/distinct/);
    expect(
      m.applyCommand({
        type: "create-army",
        playerId: 1,
        squadIds: [m.squads[0].id],
      }),
    ).toMatch(/faction/);
    expect(
      m.applyCommand({ type: "create-army", playerId: 1, squadIds: selected }),
    ).toBeNull();
    expect(
      m.applyCommand({
        type: "create-army",
        playerId: 1,
        squadIds: [selected[0]],
      }),
    ).toMatch(/Detach/);
    expect(
      m.applyCommand({
        type: "army-members",
        playerId: 1,
        armyId: 1,
        squadIds: [ids(m)[20]],
        action: "add",
      }),
    ).toMatch(/20/);
    expect(e.armies.armies[0].memberIds).toHaveLength(20);
    expect([p.gold, p.reserves, m.squads.length]).toEqual(before);
  });
  it("keeps whole-army orders, detaches subsets, and leaves membership unchanged on invalid orders", () => {
    const m = make(3);
    create(m);
    const all = ids(m),
      army = m.expansion!.armies.armies[0];
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: all,
        order: { type: "move", tile: m.map.ref(60, 30) },
      }),
    ).toBeNull();
    expect(army.memberIds).toEqual(all);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [all[0]],
        order: { type: "attack", targetId: 9999 },
      }),
    ).toMatch(/enemy/);
    expect(army.memberIds).toEqual(all);
    expect(
      m.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [all[0]],
        order: { type: "hold" },
      }),
    ).toBeNull();
    expect(army.memberIds).toEqual(all.slice(1));
    expect(
      m.applyCommand({
        type: "army-members",
        playerId: 1,
        armyId: army.id,
        squadIds: [all[0]],
        action: "add",
      }),
    ).toBeNull();
    expect(army.memberIds).toEqual(all);
  });
  it("retains embarked/refitting membership and removes losses once, including empty armies", () => {
    const m = make(3);
    create(m);
    const army = m.expansion!.armies.armies[0],
      members = m.squads.filter((s) => s.playerId === 1);
    members[0].embarkedOn = 999;
    members[1].refit = {
      targetId: "bronzeage-infantry",
      totalTicks: 1000,
      remainingTicks: 1000,
    };
    m.expansion!.armies.step();
    expect(army.memberIds).toHaveLength(3);
    const vm = new ArmyViewModel(m.snapshot(), new Set([members[2].id]));
    expect(vm.selectedArmy?.id).toBe(army.id);
    expect(vm.card(army).suspended).toBe(2);
    m.squads.splice(m.squads.indexOf(members[2]), 1);
    m.expansion!.armies.step();
    m.expansion!.armies.step();
    expect(army.memberIds).toHaveLength(2);
    m.squads.splice(0, m.squads.length);
    m.expansion!.armies.step();
    expect(m.expansion!.armies.armies).toHaveLength(0);
  });
  it("serializes independent army membership/order data in both snapshot packet modes", () => {
    const m = make(3);
    create(m);
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    let snapshot = m.snapshot();
    let decoded = decoder.decode(encoder.encode(snapshot));
    expect(decoded.expansion!.armies).toEqual(snapshot.expansion!.armies);
    m.applyCommand({
      type: "army-auto",
      playerId: 1,
      armyId: 1,
      enabled: true,
    });
    snapshot = m.snapshot();
    decoded = decoder.decode(encoder.encode(snapshot));
    expect(decoded.expansion!.armies[0].autoTactics).toBe(true);
    const copy = m.expansion!.armies.snapshot();
    copy[0].memberIds.pop();
    expect(m.expansion!.armies.armies[0].memberIds).toHaveLength(3);
  });
  it.each([20, 50])(
    "marches %i mixed-speed members cohesively, deploys on arrival, and adds no troops",
    (count) => {
      const m = make(count, count === 50);
      const own = m.squads.filter((s) => s.playerId === 1);
      for (let i = 0; i < own.length; i++)
        if (i % 3 === 1) {
          own[i].kind = "archer";
          own[i].definitionId = "stoneage-archer";
        } else if (i % 3 === 2) {
          own[i].kind = "cavalry";
          own[i].definitionId = "stoneage-cavalry";
        }
      create(m);
      m.applyCommand({
        type: "army-order",
        playerId: 1,
        armyId: 1,
        order: { type: "move", tile: m.map.ref(60, 30) },
      });
      step(m, 260);
      const army = m.expansion!.armies.armies[0];
      expect(army.state).not.toBe("blocked");
      expect(
        Math.max(...own.map((s) => s.x)) - Math.min(...own.map((s) => s.x)),
      ).toBeLessThan((count / 2 + 8) * FIXED);
      if (army.state === "marching")
        expect(m.movementSpeed(own[0])).toBe(
          Math.floor(1.1 * Math.min(...own.map((s) => m.ordinarySpeed(s)))),
        );
      step(m, 1600);
      expect(army.state).toBe("holding");
      expect(own.every((s) => Math.abs(s.x - 60.5 * FIXED) < 24 * FIXED)).toBe(
        true,
      );
      expect(own.reduce((n, s) => n + s.troops, 0)).toBe(count * 1000);
    },
  );
  it("keeps manual hold priority when auto tactics are enabled", () => {
    const m = make(3);
    create(m);
    const enemy = m.squads.find((s) => s.playerId === 2)!;
    enemy.x = 16 * FIXED;
    enemy.y = 33 * FIXED;
    m.applyCommand({
      type: "army-auto",
      playerId: 1,
      armyId: 1,
      enabled: true,
    });
    m.applyCommand({
      type: "army-order",
      playerId: 1,
      armyId: 1,
      order: { type: "hold" },
    });
    step(m, 25);
    expect(m.expansion!.armies.armies[0].order.type).toBe("hold");
  });
  it("maintains a ranged screen and retreats after actual volleys, without resetting cooldowns", () => {
    const m = make(3);
    for (const s of m.squads.filter((s) => s.playerId === 1)) {
      s.kind = "archer";
      s.definitionId = "stoneage-archer";
    }
    const enemy = m.squads.find((s) => s.playerId === 2)!;
    enemy.x = 32 * FIXED;
    enemy.y = 30 * FIXED;
    enemy.troops = 100000;
    create(m);
    expect(
      m.applyCommand({
        type: "army-order",
        playerId: 1,
        armyId: 1,
        order: { type: "fire-retreat", targetId: enemy.id },
      }),
    ).toBeNull();
    let shots = 0,
      withdrawals = 0;
    const seen = new Set<number>();
    for (let t = 0; t < 500; t++) {
      m.step();
      for (const volley of m.volleys)
        if (!seen.has(volley.tick)) {
          seen.add(volley.tick);
          shots++;
        }
      if (
        m.squads.some(
          (s) =>
            s.playerId === 1 &&
            (s.lastAttackTick ?? -1) >= 0 &&
            s.moved &&
            s.x < enemy.x - 6 * FIXED,
        )
      )
        withdrawals++;
    }
    expect(shots).toBeGreaterThan(1);
    expect(withdrawals).toBeGreaterThan(0);
    expect(m.expansion!.armies.armies[0].state).not.toBe("blocked");
  });
  it("routes a cohesive column around a water barrier through a narrow land crossing", () => {
    const data = new Uint8Array(96 * 64).fill(133);
    for (let y = 0; y < 64; y++)
      for (let x = 38; x < 43; x++) if (y < 39 || y > 41) data[y * 96 + x] = 0;
    const m = make(8, false, data);
    create(m);
    expect(
      m.applyCommand({
        type: "army-order",
        playerId: 1,
        armyId: 1,
        order: { type: "move", tile: m.map.ref(65, 30) },
      }),
    ).toBeNull();
    const own = m.squads.filter((s) => s.playerId === 1);
    for (let t = 0; t < 1800; t++) {
      m.step();
      expect(own.every((s) => m.map.isLand(m.tileOf(s)))).toBe(true);
    }
    expect(m.expansion!.armies.armies[0].state).toBe("holding");
    expect(own.every((s) => s.x > 50 * FIXED)).toBe(true);
  });
  it("budgets 50-member work fairly and cancels stale routes after new orders", () => {
    const m = make(50, true);
    create(m);
    const spy = vi.spyOn(m.paths, "find");
    m.applyCommand({
      type: "army-order",
      playerId: 1,
      armyId: 1,
      order: { type: "move", tile: m.map.ref(70, 30) },
    });
    let background = 0;
    m.queueArmyRoute("other-faction", () => {
      background++;
    });
    step(m, 3);
    expect(background).toBe(1);
    expect(spy.mock.calls.length).toBeGreaterThan(24);
    m.applyCommand({
      type: "army-order",
      playerId: 1,
      armyId: 1,
      order: { type: "hold" },
    });
    step(m, 4);
    expect(
      m.squads
        .filter((s) => s.playerId === 1)
        .every((s) => s.order.type === "hold"),
    ).toBe(true);
  });
  it("does not let automatic tactics interrupt manual marching or keep a treaty target", () => {
    const m = make(3);
    create(m);
    const army = m.expansion!.armies.armies[0];
    expect(army.autoTactics).toBe(false);
    m.applyCommand({
      type: "army-auto",
      playerId: 1,
      armyId: 1,
      enabled: true,
    });
    m.applyCommand({
      type: "army-order",
      playerId: 1,
      armyId: 1,
      order: { type: "move", tile: m.map.ref(40, 30) },
    });
    step(m, 20);
    expect(army.order.type).toBe("move");
    const enemy = m.squads.find((s) => s.playerId === 2)!;
    m.applyCommand({
      type: "army-order",
      playerId: 1,
      armyId: 1,
      order: { type: "attack", targetId: enemy.id },
    });
    m.expansion!.diplomacy.state.alliances.push({
      id: 999,
      a: 1,
      b: 2,
      expiresTick: 10000,
      renewal: [],
    });
    step(m, 1);
    expect(army.order.type).toBe("hold");
  });
});
