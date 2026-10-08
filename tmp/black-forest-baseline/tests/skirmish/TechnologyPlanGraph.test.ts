import { describe, expect, it } from "vitest";
import {
  layoutResearch,
  researchRelations,
} from "../../src/skirmish/planning/TechnologyPlanGraph";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";

describe("planning research graph", () => {
  it("reproduces the in-game root, split and join without using slots as edges", () => {
    const nodes = createInitialPlan().civilizations[0].technologies;
    const age = layoutResearch(nodes)[0];
    expect(age.placements.get("stoneage-flint-weapons")).toEqual({
      row: 0,
      column: 1,
      span: 2,
    });
    expect(age.placements.get("stoneage-spear-throwing")).toEqual({
      row: 1,
      column: 1,
      span: 1,
    });
    expect(age.placements.get("stoneage-horsemanship")).toEqual({
      row: 1,
      column: 2,
      span: 1,
    });
    expect(age.placements.get("stoneage-field-engineering")).toEqual({
      row: 2,
      column: 1,
      span: 2,
    });
    nodes.find((n) => n.id === "stoneage-field-engineering")!.order = 0;
    expect(
      layoutResearch(nodes)[0].placements.get("stoneage-field-engineering")!
        .row,
    ).toBe(2);
  });
  it("wraps arbitrary parallel nodes without overlap and aligns cross-branch parents", () => {
    const nodes = createInitialPlan().civilizations[0].technologies;
    const root = nodes.find((n) => n.id === "stoneage-flint-weapons")!;
    for (let i = 0; i < 5; i++)
      nodes.push({
        ...root,
        id: `extra-${i}`,
        prerequisites: [root.id],
        order: 10 + i,
      });
    const join = nodes.find((n) => n.id === "stoneage-field-engineering")!;
    join.prerequisites.push(
      ...nodes.filter((n) => n.id.startsWith("extra-")).map((n) => n.id),
    );
    const naval = nodes.find((n) => n.id === "stoneage-war-canoes")!;
    naval.prerequisites.push(join.id);
    const age = layoutResearch(nodes)[0];
    expect(age.placements.get(join.id)!.row).toBeGreaterThan(
      age.placements.get("extra-4")!.row,
    );
    expect(age.placements.get(naval.id)!.row).toBeGreaterThan(
      age.placements.get(join.id)!.row,
    );
    const occupied = new Set<string>();
    for (const n of nodes.filter((n) => n.age === "StoneAge")) {
      const p = age.placements.get(n.id)!;
      for (let c = p.column; c < p.column + p.span; c++) {
        const cell = `${n.tree}:${p.row}:${c}`;
        expect(occupied.has(cell)).toBe(false);
        occupied.add(cell);
      }
    }
  });
  it("traces transitive and cross-age prerequisites and downstream unlocks", () => {
    const nodes = createInitialPlan().civilizations[0].technologies;
    const { ancestors, descendants } = researchRelations(
      nodes,
      "bronzeage-bronze-equipment",
    );
    expect(ancestors.has("stoneage-flint-weapons")).toBe(true);
    expect(descendants.has("modern-modern-armaments")).toBe(true);
    expect(ancestors.has("bronzeage-bronze-equipment")).toBe(false);
    expect(descendants.has("stoneage-cargo-canoes")).toBe(false);
  });
});
