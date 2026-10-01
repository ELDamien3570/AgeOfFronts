// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { technologyTreeMarkup } from "../../src/skirmish/client/TechnologyTreeView";
import { TechnologyViewModel } from "../../src/skirmish/client/TechnologyViewModel";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
const fixture = () => {
  const data = new Uint8Array(48 * 48).fill(133);
  const m = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const vm = () =>
    new EmpireViewModel(m.snapshot(), {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
    });
  return { m, vm };
};
describe("battlefield research drawer", () => {
  it("labels startup grants by identity, exposes future preview without changing the match", () => {
    const { m, vm } = fixture(),
      before = m.snapshot();
    const stone = new TechnologyViewModel(vm(), "StoneAge");
    expect(
      stone.trees
        .flatMap((t) => t.nodes)
        .filter((n) => n.status === "Starting grant")
        .map((n) => n.id)
        .sort(),
    ).toEqual(["stoneage-flint-weapons", "stoneage-settlements"]);
    const future = new TechnologyViewModel(vm(), "Modern");
    expect(future.trees.flatMap((t) => t.nodes).every((n) => n.reason)).toBe(
      true,
    );
    expect(future.ages.find((a) => a.age === "Modern")?.state).toBe("future");
    expect(m.snapshot()).toEqual(before);
  });
  it("renders real Bronze prerequisite edges including the independent Armies branch", () => {
    const { m, vm } = fixture();
    m.expansion!.progression.states[1].age = "BronzeAge";
    const model = new TechnologyViewModel(vm(), "BronzeAge");
    document.body.innerHTML = technologyTreeMarkup(
      model,
      "bronzeage-armies",
      "warfare",
    );
    const expected = TECHNOLOGIES.filter((t) => t.age === "BronzeAge")
      .flatMap((t) =>
        t.prerequisites
          .filter(
            (id) => TECHNOLOGIES.find((p) => p.id === id)?.age === "BronzeAge",
          )
          .map((id) => `${id}:${t.id}`),
      )
      .sort();
    expect(
      [...document.querySelectorAll("[data-edge]")]
        .map((e) => (e as HTMLElement).dataset.edge)
        .sort(),
    ).toEqual(expected);
    expect(document.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(
      document
        .querySelector('[data-node="bronzeage-armies"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(model.tree("warfare").total).toBe(5);
    expect(
      document.querySelector(
        '[data-edge="bronzeage-bronze-equipment:bronzeage-armies"]',
      ),
    ).not.toBeNull();
    expect(
      document
        .querySelector('[data-research="bronzeage-armies"]')
        ?.getAttribute("disabled"),
    ).not.toBeNull();
  });
});
