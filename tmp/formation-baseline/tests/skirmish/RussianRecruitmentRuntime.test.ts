import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import {
  TECHNOLOGIES,
  TECHNOLOGY,
} from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { AGES, RESOURCES } from "../../src/skirmish/domain/Definitions";
import { researchRejection } from "../../src/skirmish/domain/Progression";
const troops = UNITS.filter((u) => u.troopClass);
const make = () => {
  const data = new Uint8Array(80 * 60).fill(133);
  return new Skirmish(new GameMapImpl(80, 60, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
};
describe("all Russian troop recruitment in normal skirmish", () => {
  it("registers 42 classes across the eight distinct eras", () => {
    expect(troops).toHaveLength(42);
    expect(AGES).toHaveLength(8);
    expect(new Set(troops.map((u) => u.age)).size).toBe(8);
  });
  it.each(troops)(
    "$name ($age): enforces unlock, charges costs, trains and survives snapshot/restore",
    (u) => {
      const m = make(),
        p = m.players[0],
        e = m.expansion!,
        state = e.progression.states[p.id];
      state.age = u.age;
      state.completed = TECHNOLOGIES.filter((t) => t.id !== u.technologyId).map(
        (t) => t.id,
      );
      p.gold = 1000000;
      p.reserves = 100000;
      Object.assign(
        e.supply.inventories[p.id],
        Object.fromEntries(
          [...RESOURCES, ...Object.keys(u.cost.items ?? {})].map((id) => [
            id,
            100000,
          ]),
        ),
      );
      const b = m.addBuilding({
        id: m.allocateId(),
        type: u.building,
        tile: p.base,
        playerId: p.id,
        age: u.age,
        remainingTicks: 0,
      });
      const cmd = {
        type: "recruit" as const,
        playerId: p.id,
        buildingId: b.id,
        definitionId: u.id,
      };
      expect(m.applyCommand(cmd)).toMatch(/research/i);
      expect(p.gold).toBe(1000000);
      expect(m.recruitment.jobs).toHaveLength(0);
      state.completed.push(u.technologyId);
      const vm = new SkirmishViewModel(
        m.snapshot(),
        {
          selected: new Set(),
          selectedShips: new Set(),
          selectedBuilding: b.id,
        },
        { [u.line]: u.id },
      );
      expect(vm.recruitment(u.line).enabled).toBe(true);
      expect(m.applyCommand(cmd)).toBeNull();
      expect(p.gold).toBe(1000000 - u.cost.gold!);
      expect(p.reserves).toBe(99000);
      expect(m.recruitment.jobs[0]).toMatchObject({
        definitionId: u.id,
        totalTicks: u.trainingSeconds! * 20,
      });
      const save = m.checkpoint();
      m.restore(save);
      const decoded = new SnapshotDecoder().decode(
        new SnapshotEncoder().encode(m.snapshot()),
      );
      expect(decoded.expansion!.recruitment![0].definitionId).toBe(u.id);
      const count = m.squads.length;
      for (let tick = 0; tick < u.trainingSeconds! * 20; tick++) m.step();
      expect(m.recruitment.jobs).toHaveLength(0);
      expect(m.squads.length).toBe(count + 1);
      expect(
        m.squads.some((s) => s.playerId === p.id && s.definitionId === u.id),
      ).toBe(true);
    },
  );
  it("can legally research every registered prerequisite without dead ends", () => {
    const m = make(),
      p = m.players[0],
      state = m.expansion!.progression.states[p.id];
    p.gold = 100000000;
    for (const age of AGES) {
      state.age = age;
      while (
        TECHNOLOGIES.some(
          (t) => t.age === age && !state.completed.includes(t.id),
        )
      ) {
        const next = TECHNOLOGIES.find(
          (t) => t.age === age && !researchRejection(state, p.gold, t.id),
        );
        expect(next, `No legal research in ${age}`).toBeDefined();
        expect(
          m.applyCommand({
            type: "research",
            playerId: p.id,
            technologyId: next!.id,
          }),
        ).toBeNull();
        for (let i = 0; i <= TECHNOLOGY.get(next!.id)!.ticks; i++)
          m.expansion!.progression.step(m.players);
      }
    }
    expect(state.completed.length).toBe(TECHNOLOGIES.length);
  });
});
