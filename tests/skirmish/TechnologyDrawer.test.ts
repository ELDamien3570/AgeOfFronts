// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { empireMarkup, EmpireView } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
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
    ).toEqual(["stoneage-cargo-canoes", "stoneage-flint-weapons", "stoneage-settlements"]);
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

  it("researches the inspected node from the pinned details without losing the tree position", () => {
    const { m, vm } = fixture();
    const root = document.createElement("div");
    root.id = "app";
    root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
    document.body.replaceChildren(root);
    const view = new EmpireView(root, {
      refresh: () => {},
      build: () => {},
      notify: () => {},
      focusedRef: () => null,
      target: () => {},
      command: (command) => {
        expect(m.applyCommand(command)).toBeNull();
      },
    });
    view.update(vm());
    view.toggle("technology");
    root.querySelector<HTMLElement>(".technology-tree-scroll")!.scrollTop = 200;
    root
      .querySelector<HTMLButtonElement>('[data-node="stoneage-shorecraft"]')!
      .click();
    const details = root.querySelector<HTMLElement>(".technology-detail")!;
    expect(details.closest(".technology-tree-scroll")).toBeNull();
    expect(
      root.querySelector<HTMLElement>(".technology-tree-scroll")!.scrollTop,
    ).toBe(200);
    const research = details.querySelector<HTMLButtonElement>(
      "header [data-research]",
    )!;
    expect(research.disabled).toBe(false);
    research.click();
    expect(
      m.expansion!.progression.states[1].research.naval?.technologyId,
    ).toBe("stoneage-shorecraft");
    view.update(vm());
    view.toggle("technology");
    view.toggle("technology");
    expect(
      root.querySelector<HTMLElement>(".technology-tree-scroll")!.scrollTop,
    ).toBe(200);
    const running = root.querySelector<HTMLButtonElement>(
      ".technology-detail-header [data-research]",
    )!;
    expect(running.textContent).toBe("Researching");
    expect(running.disabled).toBe(true);
    view.toggle("supplies");
    expect(root.querySelector(".technology-detail")).toBeNull();
    expect(
      root
        .querySelector("#empire-panel")!
        .classList.contains("technology-drawer"),
    ).toBe(false);
  });
});
