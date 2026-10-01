// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { empireMarkup, EmpireView } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
function fixture() {
  const data = new Uint8Array(48 * 48).fill(133);
  const m = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const root = document.createElement("div");
  root.id = "app";
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const view = new EmpireView(root, {
    refresh: () => {},
    command: () => {},
    build: () => {},
    notify: () => {},
    focusedRef: () => null,
    target: () => {},
  });
  const vm = () =>
    new EmpireViewModel(m.snapshot(), {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
    });
  view.update(vm());
  return { m, root, view, vm };
}
describe("HUD building categories and visibility", () => {
  it("orders the new categories and preserves factories and warship controls", () => {
    const { root } = fixture();
    expect(
      [
        ...root.querySelectorAll(
          ".command-category > h3, .troops-heading > h3",
        ),
      ].map((e) => e.textContent),
    ).toEqual([
      "Economy",
      "Production Buildings",
      "Military buildings",
      "Defense Buildings",
      "Troops",
      "Air & Strategic",
      "Orders",
    ]);
    expect(
      root.querySelector("#build-factory")!.closest(".economy"),
    ).not.toBeNull();
    const aviation = root.querySelector(".aviation .category-actions")!;
    expect(
      aviation.firstElementChild!.querySelector("#warship"),
    ).not.toBeNull();
    expect(root.querySelectorAll("#warship")).toHaveLength(1);
  });
  it("shows current-age locked buildings but hides future-age buildings", () => {
    const { root, vm } = fixture();
    expect(vm().buildingVisible("factory")).toBe(true);
    expect(
      root
        .querySelector("#build-factory")!
        .closest<HTMLElement>(".action-slot")!.hidden,
    ).toBe(false);
    expect(root.querySelector('[data-value="tower"]')).not.toBeNull();
    for (const type of [
      "blacksmith",
      "arms-factory",
      "trench",
      "oil-well",
      "airstrip",
    ] as const) {
      expect(vm().buildingVisible(type)).toBe(false);
      expect(root.querySelector(`[data-value="${type}"]`)).toBeNull();
    }
  });
  it("separates production and defenses as ages advance and keeps older unlocked buildings", () => {
    const { m, root, view, vm } = fixture();
    const state = m.expansion!.progression.states[1];
    state.age = "BronzeAge";
    view.update(vm());
    expect(
      root.querySelector('.production [data-value="blacksmith"]'),
    ).not.toBeNull();
    state.age = "Modern";
    state.completed = TECHNOLOGIES.map((t) => t.id);
    view.update(vm());
    for (const type of ["blacksmith", "armory", "arms-factory"])
      expect(
        root.querySelector(`.production [data-value="${type}"]`),
      ).not.toBeNull();
    for (const type of ["tower", "trench", "gun-nest", "missile-defence"])
      expect(
        root.querySelector(`.defense [data-value="${type}"]`),
      ).not.toBeNull();
    expect(
      root.querySelector('.military [data-value="airstrip"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('.economy [data-value="oil-well"]'),
    ).not.toBeNull();
    expect(
      root
        .querySelector("#build-stables")!
        .closest<HTMLElement>(".action-slot")!.hidden,
    ).toBe(false);
  });
});
