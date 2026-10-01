import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import {
  ADVANCES,
  TECHNOLOGIES,
  technologyAt,
} from "../../src/skirmish/content/Technology";
import {
  AGES,
  type TechnologySpeed,
} from "../../src/skirmish/domain/Definitions";
import { researchRejection } from "../../src/skirmish/domain/Progression";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function match(technologySpeed?: TechnologySpeed, runAi = false) {
  const terrain = new Uint8Array(48 * 48).fill(133);
  return new Skirmish(new GameMapImpl(48, 48, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi,
    ruleset: "ages-v1",
    technologySpeed,
  });
}
const viewModel = (m: Skirmish) =>
  new EmpireViewModel(m.snapshot(), {
    selected: new Set(),
    selectedShips: new Set(),
    selectedBuilding: null,
  });

describe("match technology speed", () => {
  it.each([1, 2, 3] as const)(
    "%i× quotes and charges every research node consistently for both factions",
    (speed) => {
      const m = match(speed),
        progression = m.expansion!.progression;
      const inventories = structuredClone(m.expansion!.supply.inventories);
      const reserves = m.players.map((p) => p.reserves);
      for (const node of TECHNOLOGIES) {
        const gold = Math.ceil(node.gold / speed),
          ticks = Math.ceil(node.ticks / speed);
        for (const player of m.players) {
          const state = progression.states[player.id];
          state.age = node.age;
          state.completed = [...node.prerequisites];
          state.research = {};
          player.gold = gold;
        }
        const quote = viewModel(m)
          .nodes(node.age)
          .find((t) => t.id === node.id)!;
        expect(quote.gold).toBe(gold);
        expect(quote.ticks).toBe(ticks);
        expect(quote.reason).toBeNull();
        // The two free starting grants remain free at every speed.
        if (!node.ticks) continue;
        for (const player of m.players) {
          const state = progression.states[player.id];
          player.gold = gold - 1;
          expect(
            m.applyCommand({
              type: "research",
              playerId: player.id,
              technologyId: node.id,
            }),
          ).toBe("Needs 1 more gold");
          expect(state.research[node.tree]).toBeUndefined();
          player.gold = gold;
          expect(
            m.applyCommand({
              type: "research",
              playerId: player.id,
              technologyId: node.id,
            }),
          ).toBeNull();
          expect(player.gold).toBe(0);
          expect(state.research[node.tree]).toMatchObject({
            totalTicks: ticks,
            remainingTicks: ticks,
          });
        }
        for (let i = 1; i < ticks; i++) progression.step(m.players);
        for (const player of m.players)
          expect(progression.states[player.id].completed).not.toContain(
            node.id,
          );
        progression.step(m.players);
        for (const player of m.players) {
          expect(progression.states[player.id].completed).toContain(node.id);
          expect(
            progression.states[player.id].research[node.tree],
          ).toBeUndefined();
        }
      }
      expect(m.players.map((p) => p.reserves)).toEqual(reserves);
      expect(m.expansion!.supply.inventories).toEqual(inventories);
    },
  );

  it.each([1, 2, 3] as const)(
    "%i× applies to every age advancement and preserves the two-tree requirement",
    (speed) => {
      const m = match(speed),
        progression = m.expansion!.progression;
      for (const [index, authored] of ADVANCES.entries()) {
        const age = AGES[index],
          gold = Math.ceil(authored.gold / speed),
          ticks = Math.ceil(authored.ticks / speed);
        for (const player of m.players) {
          const state = progression.states[player.id];
          state.age = age;
          state.completed = TECHNOLOGIES.filter(
            (t) => t.age === age && t.tree !== "naval",
          ).map((t) => t.id);
          player.gold = gold - 1;
        }
        expect(viewModel(m).advance.cost).toEqual({ gold, ticks });
        expect(viewModel(m).advance.reason).toBe("Needs 1 more gold");
        for (const player of m.players) {
          expect(
            m.applyCommand({ type: "advance-age", playerId: player.id }),
          ).toBe("Needs 1 more gold");
          player.gold = gold;
          expect(
            m.applyCommand({ type: "advance-age", playerId: player.id }),
          ).toBeNull();
          expect(player.gold).toBe(0);
          expect(progression.states[player.id].advancement).toMatchObject({
            totalTicks: ticks,
            remainingTicks: ticks,
          });
        }
        for (let i = 1; i < ticks; i++) progression.step(m.players);
        expect(progression.states[1].age).toBe(age);
        progression.step(m.players);
        for (const player of m.players)
          expect(progression.states[player.id].age).toBe(AGES[index + 1]);
      }
      expect(viewModel(m).advance.cost).toBeUndefined();
      expect(viewModel(m).advance.reason).toMatch(/final age/);
      const fresh = match(speed);
      fresh.players[0].gold = 1e6;
      expect(fresh.applyCommand({ type: "advance-age", playerId: 1 })).toMatch(
        /two current-age trees/,
      );
    },
  );

  it("keeps research prerequisites, age locks and parallel-tree limits at faster speeds", () => {
    const m = match(3),
      p = m.players[0],
      state = m.expansion!.progression.states[1];
    p.gold = 1e6;
    const request = (id: string) =>
      m.applyCommand({ type: "research", playerId: 1, technologyId: id });
    expect(request("stoneage-cargo-canoes")).toMatch(/prerequisites/);
    expect(request("bronzeage-armies")).toMatch(/age first/);
    expect(request("stoneage-shorecraft")).toBeNull();
    expect(request("stoneage-cargo-canoes")).toMatch(/already researching/);
    expect(request("stoneage-spear-throwing")).toBeNull();
    expect(Object.keys(state.research)).toHaveLength(2);
  });

  it("uses discounted AI affordability for research and age advancement", () => {
    const m = match(3, true),
      p = m.players[1],
      state = m.expansion!.progression.states[p.id];
    const node = technologyAt("StoneAge", "economic", 2);
    p.gold = Math.ceil(node.gold / 3);
    expect(researchRejection(state, p.gold, node.id)).toMatch(/gold/);
    m.tick = 6;
    m.expansion!.beforeStep();
    expect(state.research.economic?.technologyId).toBe(node.id);
    state.research = {};
    state.completed = TECHNOLOGIES.filter(
      (t) => t.age === "StoneAge" && t.tree !== "naval",
    ).map((t) => t.id);
    p.gold = Math.ceil(ADVANCES[0].gold / 3);
    m.tick = 66;
    m.expansion!.beforeStep();
    expect(state.advancement?.target).toBe("BronzeAge");
    expect(p.gold).toBe(0);
  });

  it("defaults to 1×, isolates matches and carries pacing through worker snapshots", () => {
    const authored = structuredClone(TECHNOLOGIES),
      advances = structuredClone(ADVANCES);
    const standard = match(),
      fast = match(3);
    expect(standard.expansion!.progression.technologySpeed).toBe(1);
    expect(fast.expansion!.progression.technologySpeed).toBe(3);
    for (const m of [standard, fast]) {
      const encoded = new SnapshotEncoder().encode(m.snapshot());
      const decoded = new SnapshotDecoder().decode(structuredClone(encoded));
      expect(decoded.expansion!.technologySpeed).toBe(
        m.expansion!.progression.technologySpeed,
      );
      expect(
        new EmpireViewModel(decoded, {
          selected: new Set(),
          selectedShips: new Set(),
          selectedBuilding: null,
        }).nodes("StoneAge")[0].gold,
      ).toBe(
        Math.ceil(
          TECHNOLOGIES[0].gold / m.expansion!.progression.technologySpeed,
        ),
      );
    }
    expect(TECHNOLOGIES).toEqual(authored);
    expect(ADVANCES).toEqual(advances);
  });

  it.each([0, 4, 1.5, NaN])(
    "rejects unsupported technology speed %s at the domain boundary",
    (value) => {
      expect(() => match(value as TechnologySpeed)).toThrow(/Technology speed/);
    },
  );
});
