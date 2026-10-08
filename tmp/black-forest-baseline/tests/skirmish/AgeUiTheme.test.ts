// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AgeThemeView } from "../../src/skirmish/client/AgeThemeView";
import {
  AGE_UI_THEMES,
  ownerUiAge,
} from "../../src/skirmish/client/AgeUiTheme";
import { EmpireView, empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { AGES } from "../../src/skirmish/domain/Definitions";
import { Skirmish } from "../../src/skirmish/Simulation";

const make = () => {
  const data = new Uint8Array(96 * 64).fill(133);
  return new Skirmish(new GameMapImpl(96, 64, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
};
const root = () => document.body.appendChild(document.createElement("div"));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("age-dependent presentation", () => {
  it("covers every authoritative age with a distinct material", () => {
    expect(Object.keys(AGE_UI_THEMES)).toEqual([...AGES]);
    expect(
      new Set(Object.values(AGE_UI_THEMES).map((theme) => theme.texture)).size,
    ).toBe(7);
    expect(Object.values(AGE_UI_THEMES).map((theme) => theme.material)).toEqual(
      [
        "Stone",
        "Bronze",
        "Iron",
        "Shimmering steel",
        "Gold",
        "Gunmetal",
        "Army green",
      ],
    );
  });
  it("announces an earned increase once while repeated snapshots preserve the timer", () => {
    vi.useFakeTimers();
    const element = root(),
      view = new AgeThemeView(element);
    view.update("StoneAge");
    expect(element.querySelector<HTMLElement>("[role=status]")!.hidden).toBe(
      true,
    );
    view.update("BronzeAge");
    expect(element.dataset.uiAge).toBe("BronzeAge");
    expect(element.querySelector("[role=status]")!.textContent).toContain(
      "Bronze Age",
    );
    vi.advanceTimersByTime(1600);
    view.update("BronzeAge");
    vi.advanceTimersByTime(600);
    expect(element.querySelector<HTMLElement>("[role=status]")!.hidden).toBe(
      true,
    );
    expect(element.classList.contains("ui-age-arrival")).toBe(false);
  });
  it("resets a new match without treating its first snapshot as an advancement", () => {
    vi.useFakeTimers();
    const element = root(),
      view = new AgeThemeView(element);
    view.update("StoneAge");
    view.update("LateMedieval");
    view.reset();
    expect(element.dataset.uiAge).toBe("StoneAge");
    view.update("Modern");
    expect(element.dataset.uiAge).toBe("Modern");
    expect(element.querySelector<HTMLElement>("[role=status]")!.hidden).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors reduced motion while retaining the accessible age announcement", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const element = root(),
      view = new AgeThemeView(element);
    view.update("StoneAge");
    view.update("EarlyMedieval");
    expect(element.classList.contains("ui-age-arrival")).toBe(false);
    expect(element.querySelector<HTMLElement>("[role=status]")!.hidden).toBe(
      false,
    );
  });
  it("uses each owner's progression and leaves unknown owners unthemed", () => {
    const simulation = make();
    simulation.expansion!.progression.states[2].age = "Modern";
    const snapshot = simulation.snapshot();
    expect(ownerUiAge(snapshot, 1)).toBe("StoneAge");
    expect(ownerUiAge(snapshot, 2)).toBe("Modern");
    expect(ownerUiAge(snapshot, 99)).toBeUndefined();
  });
  it("changes the HUD only after the real domain advancement completes", () => {
    vi.useFakeTimers();
    const simulation = make(),
      state = simulation.expansion!.progression.states[1];
    state.completed = TECHNOLOGIES.filter(
      (technology) => technology.age === "StoneAge",
    ).map((technology) => technology.id);
    simulation.players[0].gold = 100000;
    const element = root(),
      view = new AgeThemeView(element);
    view.update(simulation.snapshot().expansion!.progression[1].age);
    expect(
      simulation.applyCommand({ type: "advance-age", playerId: 1 }),
    ).toBeNull();
    view.update(simulation.snapshot().expansion!.progression[1].age);
    expect(element.dataset.uiAge).toBe("StoneAge");
    while (state.advancement)
      simulation.expansion!.progression.step(simulation.players);
    view.update(simulation.snapshot().expansion!.progression[1].age);
    expect(element.dataset.uiAge).toBe("BronzeAge");
    expect(element.querySelector<HTMLElement>("[role=status]")!.hidden).toBe(
      false,
    );
    expect(ownerUiAge(simulation.snapshot(), 2)).toBe("StoneAge");
  });
  it("keeps browsing a future technology age separate from the earned HUD age", () => {
    const simulation = make(),
      element = root();
    element.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
    const view = new EmpireView(element, {
      refresh() {},
      command() {},
      build() {},
      notify() {},
      focusedRef: () => null,
      target() {},
    });
    view.update(
      new EmpireViewModel(simulation.snapshot(), {
        selected: new Set(),
        selectedShips: new Set(),
        selectedBuilding: null,
      }),
    );
    view.toggle("technology");
    element.querySelector<HTMLButtonElement>('[data-age="Modern"]')!.click();
    expect(
      element
        .querySelector('[data-age="Modern"]')!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(element.dataset.uiAge).toBe("StoneAge");
    expect(element.querySelector("#empire-age")!.textContent).toBe("Stone Age");
  });
});
