import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import {
  NAVAL_RECRUITMENT,
  recruitmentBatch,
} from "../../src/skirmish/client/Controls";
import { RecruitmentQueueViewModel } from "../../src/skirmish/client/RecruitmentQueueViewModel";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { Recruitment } from "../../src/skirmish/domain/Recruitment";
import type { Building } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function game() {
  const terrain = new Uint8Array(80 * 60).fill(133);
  terrain.fill(0, 0, 80 * 6);
  const m = new Skirmish(new GameMapImpl(80, 60, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  m.players[0].reserves = 100000;
  m.players[0].gold = 100000;
  m.addBuilding({
    id: 9000,
    playerId: 1,
    type: "barracks",
    tile: m.players[0].base,
    age: "StoneAge",
    remainingTicks: 0,
  });
  return m;
}
const train = (m: Skirmish) =>
  m.applyCommand({
    type: "recruit",
    playerId: 1,
    buildingId: 9000,
    definitionId: "stoneage-infantry",
  });

describe("authoritative recruitment queues", () => {
  it("reserves costs and trains sequentially without charging twice", () => {
    const m = game(),
      p = m.players[0];
    for (let i = 0; i < 5; i++) expect(train(m)).toBeNull();
    expect(p.gold).toBe(99500);
    expect(p.reserves).toBe(95000);
    const initial = m.squads.filter((s) => s.playerId === 1).length;
    for (let i = 0; i < 99; i++) m.step();
    expect(m.squads.filter((s) => s.playerId === 1)).toHaveLength(initial);
    expect(m.recruitment.jobs[0].remainingTicks).toBe(1);
    m.step();
    expect(m.squads.filter((s) => s.playerId === 1)).toHaveLength(initial + 1);
    expect(m.recruitment.jobs).toHaveLength(4);
    expect(m.recruitment.jobs[0].remainingTicks).toBe(100);
    expect(p.reserves).toBe(95060); // five seconds of normal Stone reserve income
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(m.snapshot()),
    );
    expect(decoded.expansion!.recruitment).toEqual(m.recruitment.jobs);
  });
  it("reserves squad slots so queued orders cannot exceed the Stone cap", () => {
    const m = game();
    for (let i = 0; i < 57; i++) expect(train(m)).toBeNull();
    const gold = m.players[0].gold;
    expect(train(m)).toMatch(/60-squad/);
    expect(m.players[0].gold).toBe(gold);
  });
  it.each(["capture", "destroy"])(
    "refunds the original faction on producer %s",
    (mode) => {
      const m = game();
      expect(train(m)).toBeNull();
      if (mode === "capture")
        m.updateBuilding((m.buildings.find((b) => b.id === 9000)!).id, { playerId: 2 });
      else
        m.removeBuilding(m.buildings[m.buildings.findIndex((b) => b.id === 9000)].id);
      m.step();
      expect(m.recruitment.jobs).toHaveLength(0);
      expect(m.players[0].gold).toBe(100000);
      expect(m.players[0].reserves).toBe(100000);
    },
  );
  it("trains parallel producers and holds completed jobs when deployment is blocked", () => {
    const queue = new Recruitment(),
      buildings: Building[] = [1, 2].map((id) => ({
        id,
        playerId: 1,
        type: "barracks",
        tile: id,
        remainingTicks: 0,
      }));
    const owners = new Uint8Array(3).fill(1);
    for (const buildingId of [1, 1, 2])
      queue.enqueue({
        playerId: 1,
        buildingId,
        category: "land",
        kind: "infantry",
        cost: {},
        totalTicks: 2,
      });
    const blocked = vi.fn(() => false),
      refund = vi.fn();
    queue.step(buildings, owners, blocked, refund);
    expect(queue.jobs.map((j) => j.remainingTicks)).toEqual([1, 2, 1]);
    queue.step(buildings, owners, blocked, refund);
    expect(queue.jobs.map((j) => j.remainingTicks)).toEqual([0, 2, 0]);
    expect(blocked).toHaveBeenCalledTimes(2);
    queue.step(buildings, owners, () => true, refund);
    expect(queue.jobs.map((j) => j.remainingTicks)).toEqual([2]);
    expect(refund).not.toHaveBeenCalled();
  });
  it("groups warships and aircraft with land jobs, showing the next active completion", () => {
    const m = game();
    for (const [buildingId, category, kind, definitionId, totalTicks] of [
      [1, "land", "infantry", "stoneage-infantry", 100],
      [2, "land", "infantry", "stoneage-infantry", 100],
      [3, "ship", "warship", "stoneage-warship", 400],
      [4, "aircraft", "fighter", "fighter", 600],
    ] as const)
      m.recruitment.enqueue({
        playerId: 1,
        buildingId,
        category,
        kind,
        definitionId,
        cost: {},
        totalTicks,
      });
    m.recruitment.jobs[0].remainingTicks = 80;
    m.recruitment.jobs[1].remainingTicks = 20;
    const vm = new RecruitmentQueueViewModel(m.snapshot());
    expect(vm.entries).toHaveLength(3);
    expect(vm.entries[0]).toMatchObject({
      count: 2,
      progress: 0.8,
      seconds: 1,
    });
    expect(vm.entries[1].kind).toBe("warship");
    expect(vm.entries[2].kind).toBe("fighter");
  });
  it("distributes automatic batches across eligible barracks while preserving explicit producer orders", () => {
    const m = game();
    m.addBuilding({ ...m.buildings.find((b) => b.id === 9000)!, id: 9001 });
    for (let i = 0; i < 5; i++)
      expect(
        m.applyCommand({
          type: "recruit",
          playerId: 1,
          buildingId: 9000,
          definitionId: "stoneage-infantry",
          autoRecruit: true,
        }),
      ).toBeNull();
    expect(m.recruitment.jobs.map((j) => j.buildingId)).toEqual([
      9000, 9001, 9000, 9001, 9000,
    ]);
    const before = m.squads.filter((s) => s.playerId === 1).length;
    for (let i = 0; i < 100; i++) m.step();
    expect(m.squads.filter((s) => s.playerId === 1)).toHaveLength(before + 2);
    expect(new RecruitmentQueueViewModel(m.snapshot()).entries[0].count).toBe(
      3,
    );
    expect(train(m)).toBeNull();
    expect(m.recruitment.jobs[m.recruitment.jobs.length - 1]?.buildingId).toBe(
      9000,
    );
  });
  it("distributes warships and aircraft across ports and airfields in the same feed", () => {
    const m = game(),
      expansion = m.expansion!;
    expansion.progression.states[1].age = "Modern";
    expansion.progression.states[1].completed = TECHNOLOGIES.map((t) => t.id);
    Object.assign(expansion.supply.inventories[1], {
      oil: 1000,
      "equipment:fighter": 10,
    });
    for (const [id, type, tile] of [
      [9010, "port", m.map.ref(10, 6)],
      [9011, "port", m.map.ref(20, 6)],
      [9020, "airstrip", m.players[0].base],
      [9021, "airstrip", m.players[0].base],
    ] as const) {
      m.owners[tile] = 1;
      m.addBuilding({
        id,
        type,
        tile,
        playerId: 1,
        age: "Modern",
        remainingTicks: 0,
      });
    }
    for (let i = 0; i < 4; i++) {
      expect(
        m.applyCommand({
          type: "recruit-ship",
          playerId: 1,
          buildingId: 9010,
          shipType: "warship",
          definitionId: "stoneage-warship",
          autoRecruit: true,
        }),
      ).toBeNull();
      expect(
        m.applyCommand({
          type: "recruit-aircraft",
          playerId: 1,
          buildingId: 9020,
          definitionId: "fighter",
          autoRecruit: true,
        }),
      ).toBeNull();
    }
    expect(m.recruitment.jobs.map((j) => j.buildingId)).toEqual([
      9010, 9020, 9011, 9021, 9010, 9020, 9011, 9021,
    ]);
    expect(
      new RecruitmentQueueViewModel(m.snapshot()).entries.map((e) => [
        e.kind,
        e.count,
      ]),
    ).toEqual([
      ["warship", 4],
      ["fighter", 4],
    ]);
    for (let i = 0; i < 600; i++) m.step();
    expect(m.ships.filter((s) => s.playerId === 1)).toHaveLength(2);
    expect(expansion.aircraft.filter((a) => a.playerId === 1)).toHaveLength(2);
    expect(
      new RecruitmentQueueViewModel(m.snapshot()).entries.map((e) => e.count),
    ).toEqual([2, 2]);
  });
  it("restores training progress and queue identity from authoritative checkpoints", () => {
    const original = game();
    expect(train(original)).toBeNull();
    for (let i = 0; i < 40; i++) original.step();
    const restored = game();
    restored.restore(original.checkpoint());
    expect(restored.recruitment.jobs).toEqual(original.recruitment.jobs);
    expect(train(restored)).toBeNull();
    expect(train(original)).toBeNull();
    expect(restored.recruitment.jobs).toEqual(original.recruitment.jobs);
    for (let i = 0; i < 60; i++) {
      restored.step();
      original.step();
    }
    expect(restored.snapshot()).toEqual(original.snapshot());
  });
  it("uses Shift for five recruits only outside WASD mode and removes transport recruitment", () => {
    expect(recruitmentBatch(true, false)).toBe(5);
    expect(recruitmentBatch(false, false)).toBe(1);
    expect(recruitmentBatch(true, true)).toBe(1);
    expect(NAVAL_RECRUITMENT).toEqual([{ kind: "warship", key: "B" }]);
  });
});
