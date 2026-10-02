// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireView, empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { PRODUCTION_RECIPES } from "../../src/skirmish/domain/Supply";
import type { BuildingType, Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

function fixture(researched = true) {
  const data = new Uint8Array(48 * 48).fill(133),
    m = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
      seed: 42,
      aiCount: 1,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
  if (researched)
    m.expansion!.progression.states[1].completed = TECHNOLOGIES.map(
      (t) => t.id,
    );
  const add = (type: BuildingType = "factory") => {
    const building = {
      id: m.allocateId(),
      type,
      tile: m.map.ref(10, 10),
      playerId: 1,
      remainingTicks: 0,
      health: 2000,
    };
    m.buildings.push(building);
    return building;
  };
  const building = add(),
    root = document.createElement("div");
  root.id = "app";
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const command = vi.fn((value: Command) => m.applyCommand(value)),
    view = new EmpireView(root, {
      refresh: () => {},
      command,
      build: () => {},
      notify: () => {},
      focusedRef: () => null,
      target: () => {},
    }),
    encoder = new SnapshotEncoder(),
    decoder = new SnapshotDecoder(),
    render = () => {
      const vm = new EmpireViewModel(
        decoder.decode(encoder.encode(m.snapshot())),
        {
          selected: new Set(),
          selectedShips: new Set(),
          selectedBuilding: building.id,
        },
      );
      view.update(vm);
      view.close();
      view.toggle("supplies");
      return vm;
    },
    button = (recipe: string, type: BuildingType = "factory") =>
      root.querySelector<HTMLButtonElement>(
        `[data-production-type="${type}"][data-priority-recipe="${recipe}"]`,
      )!,
    group = (type: BuildingType = "factory") =>
      root.querySelector<HTMLElement>(
        `[data-production-type-group="${type}"]`,
      )!;
  render();
  return { m, root, building, add, render, command, button, group };
}

describe("grouped production priorities", () => {
  it("shows one control per owned building type with counts instead of individual cards", () => {
    const { root, add, render, group } = fixture();
    add();
    add().remainingTicks = 100;
    add().playerId = 2;
    add().health = 0;
    add("blacksmith");
    render();
    expect(root.querySelectorAll(".producer")).toHaveLength(2);
    expect(group().textContent).toContain("3 owned · 2 ready");
    expect(group("blacksmith").textContent).toContain("1 owned · 1 ready");
    expect(group().textContent).not.toMatch(/#\d/);
    expect(root.querySelector("#empire-content")!.textContent).toContain(
      "2 building types · 4 producers",
    );
  });
  it("highlights automatic age priorities and toggles an explicit set for the entire type", () => {
    const { button, command, render, group } = fixture();
    expect(button("refine-steel").getAttribute("aria-pressed")).toBe("true");
    expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("false");
    button("refine-bronze").click();
    expect(command).toHaveBeenLastCalledWith({
      type: "production-priority",
      playerId: 1,
      buildingType: "factory",
      recipeIds: ["refine-steel", "refine-bronze"],
    });
    render();
    expect(group().dataset.productionMode).toBe("manual");
    expect(button("refine-steel").getAttribute("aria-pressed")).toBe("true");
    expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("true");
    button("refine-steel").click();
    render();
    expect(button("refine-steel").getAttribute("aria-pressed")).toBe("false");
    button("refine-bronze").click();
    render();
    expect(group().dataset.productionMode).toBe("paused");
    expect(group().textContent).toContain("No patterns prioritized");
  });
  it("updates automatic research highlights but keeps manual priorities across ages and new buildings", () => {
    const { m, button, render, add, group } = fixture(false),
      progression = m.expansion!.progression.states[1],
      bronze = PRODUCTION_RECIPES.find((r) => r.id === "refine-bronze")!;
    progression.age = "BronzeAge";
    progression.completed = [bronze.technologyId];
    render();
    expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("true");
    progression.age = "Modern";
    progression.completed = TECHNOLOGIES.map((t) => t.id);
    render();
    expect(button("refine-steel").getAttribute("aria-pressed")).toBe("true");
    progression.age = "BronzeAge";
    progression.completed = [bronze.technologyId];
    render();
    button("refine-bronze").click();
    render();
    button("refine-bronze").click();
    render();
    progression.age = "Modern";
    progression.completed = TECHNOLOGIES.map((t) => t.id);
    add();
    render();
    expect(group().dataset.productionMode).toBe("manual");
    expect(group().textContent).toContain("2 owned");
    expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("true");
    expect(button("refine-steel").getAttribute("aria-pressed")).toBe("false");
  });
  it("restores automatic priorities per type and with the global manual-selection reset", () => {
    const { add, root, command, button, render, group } = fixture();
    add("blacksmith");
    render();
    button("refine-bronze").click();
    render();
    button("make-bronzeage-equipment", "blacksmith").click();
    render();
    group().querySelector<HTMLButtonElement>("[data-priority-reset]")!.click();
    expect(command).toHaveBeenLastCalledWith({
      type: "production-priority",
      playerId: 1,
      buildingType: "factory",
      recipeIds: null,
    });
    render();
    expect(group().dataset.productionMode).toBe("auto");
    expect(group("blacksmith").dataset.productionMode).toBe("manual");
    root.querySelector<HTMLButtonElement>("[data-reset-production]")!.click();
    expect(command).toHaveBeenLastCalledWith({
      type: "reset-production-priorities",
      playerId: 1,
    });
    render();
    expect(group("blacksmith").dataset.productionMode).toBe("auto");
    expect(
      root.querySelector<HTMLButtonElement>("[data-reset-production]")!
        .disabled,
    ).toBe(true);
  });
  it("aggregates paid running batches while future priorities change", () => {
    const { m, building, add, render, group, button } = fixture(),
      second = add();
    for (const b of [building, second])
      m.expansion!.supply.jobs[b.id] = {
        owner: 1,
        recipeId: "refine-bronze",
        totalTicks: 200,
        remainingTicks: 80,
      };
    render();
    expect(group().textContent).toContain("Running: 2 × Smelt bronze");
    button("refine-steel").click();
    render();
    expect(group().dataset.productionMode).toBe("paused");
    expect(group().textContent).toContain("Running: 2 × Smelt bronze");
    expect(m.expansion!.supply.jobs[building.id]?.remainingTicks).toBe(80);
  });
  it("shows locked research patterns and allows priorities to be set while construction finishes", () => {
    const { m, building, root, group, button, render, command } =
      fixture(false);
    expect(group().querySelectorAll("[data-priority-recipe]")).toHaveLength(3);
    expect(button("refine-steel").disabled).toBe(true);
    expect(button("refine-steel").textContent).toContain("Requires research:");
    button("refine-steel").click();
    expect(command).not.toHaveBeenCalled();
    building.remainingTicks = 100;
    m.expansion!.progression.states[1].completed = TECHNOLOGIES.map(
      (t) => t.id,
    );
    render();
    expect(group().textContent).toContain("1 owned · 0 ready");
    expect(button("refine-bronze").disabled).toBe(false);
    button("refine-bronze").click();
    expect(command).toHaveLastReturnedWith(null);
    building.health = 0;
    render();
    expect(root.querySelector(".producer")).toBeNull();
  });
});

it("accumulates rapid priority toggles before a new snapshot acknowledges them", () => {
  const { button, command, render, m } = fixture();
  button("refine-bronze").click();
  button("refine-iron").click();
  expect(command).toHaveBeenLastCalledWith({
    type: "production-priority",
    playerId: 1,
    buildingType: "factory",
    recipeIds: ["refine-steel", "refine-bronze", "refine-iron"],
  });
  for (const recipe of ["refine-steel", "refine-bronze", "refine-iron"])
    expect(button(recipe).getAttribute("aria-pressed")).toBe("true");
  button("refine-bronze").click();
  expect(command).toHaveBeenLastCalledWith({
    type: "production-priority",
    playerId: 1,
    buildingType: "factory",
    recipeIds: ["refine-steel", "refine-iron"],
  });
  m.tick++;
  render();
  expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("false");
  expect(button("refine-iron").getAttribute("aria-pressed")).toBe("true");
});

it("lets reset and a subsequent toggle compose before acknowledgement, then follows later authoritative changes", () => {
  const { button, root, command, m, render } = fixture();
  button("refine-bronze").click();
  root.querySelector<HTMLButtonElement>("[data-reset-production]")!.click();
  button("refine-iron").click();
  expect(command).toHaveBeenLastCalledWith({
    type: "production-priority",
    playerId: 1,
    buildingType: "factory",
    recipeIds: ["refine-steel", "refine-iron"],
  });
  m.tick++;
  render();
  expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("false");
  expect(button("refine-iron").getAttribute("aria-pressed")).toBe("true");
  m.applyCommand({
    type: "production-priority",
    playerId: 1,
    buildingType: "factory",
    recipeIds: ["refine-bronze"],
  });
  m.tick++;
  render();
  expect(button("refine-bronze").getAttribute("aria-pressed")).toBe("true");
  expect(button("refine-iron").getAttribute("aria-pressed")).toBe("false");
});
