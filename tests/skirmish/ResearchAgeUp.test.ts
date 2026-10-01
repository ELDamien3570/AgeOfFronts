// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { AgeThemeView } from "../../src/skirmish/client/AgeThemeView";
import { AGE_UI_THEMES } from "../../src/skirmish/client/AgeUiTheme";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { ResearchOpportunitiesView } from "../../src/skirmish/client/ResearchOpportunitiesView";
import { ResearchOpportunitiesViewModel } from "../../src/skirmish/client/ResearchOpportunitiesViewModel";
import { ADVANCES, TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { AGES, type Age } from "../../src/skirmish/domain/Definitions";
import { TICKS_PER_SECOND, type Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(speed: 1 | 2 | 3 = 1) {
  const cells = new Uint8Array(48 * 48).fill(133);
  const match = new Skirmish(new GameMapImpl(48, 48, cells, cells.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    technologySpeed: speed,
  });
  const vm = (playerId = 1) => {
    const snapshot = match.snapshot();
    snapshot.localPlayerId = playerId;
    return new EmpireViewModel(snapshot, {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
    });
  };
  function ready(age: Age = "StoneAge", playerId = 1) {
    const state = match.expansion!.progression.states[playerId];
    state.age = age;
    state.advancement = null;
    state.completed = TECHNOLOGIES.filter(
      (t) => t.age === age && (t.tree === "naval" || t.tree === "warfare"),
    ).map((t) => t.id);
    match.players.find((p) => p.id === playerId)!.gold = 1000000;
  }
  const root = document.createElement("div");
  root.id = "app";
  root.innerHTML = '<main class="battlefield"></main>';
  document.body.append(root);
  return {
    match,
    vm,
    ready,
    root,
    cards: () => new ResearchOpportunitiesViewModel(vm()).cards,
  };
}

afterEach(() => document.body.replaceChildren());

describe("age-up research alert", () => {
  it.each(AGES.slice(0, -1))(
    "puts the eligible successor to %s ahead of all research",
    (age) => {
      const { ready, cards } = fixture();
      ready(age);
      const opportunities = cards();
      const first = opportunities[0];
      expect(first.kind).toBe("advance-age");
      if (first.kind !== "advance-age") throw new Error("Missing age-up alert");
      expect(first.targetAge).toBe(AGES[AGES.indexOf(age) + 1]);
      expect(opportunities.length).toBeGreaterThan(1);
      expect(
        opportunities.slice(1).every((card) => card.kind === "research"),
      ).toBe(true);
    },
  );

  it.each([1, 2, 3] as const)(
    "uses the domain's exact affordability threshold and timing at %s× research speed",
    (speed) => {
      const { match, ready, cards, vm } = fixture(speed);
      ready();
      const cost = vm().advance.cost!;
      expect(cost.gold).toBe(Math.ceil(ADVANCES[0].gold / speed));
      match.players[0].gold = cost.gold - 1;
      expect(cards().some((card) => card.kind === "advance-age")).toBe(false);
      match.players[0].gold = cost.gold;
      const first = cards()[0];
      expect(first.kind).toBe("advance-age");
      expect(first.gold).toBe(cost.gold);
      expect(first.seconds).toBe(Math.ceil(cost.ticks / TICKS_PER_SECOND));
    },
  );

  it("requires the two completed trees, hides while advancing, and has no successor in the final age", () => {
    const { match, ready, cards } = fixture();
    match.players[0].gold = 1000000;
    expect(cards().some((card) => card.kind === "advance-age")).toBe(false);
    ready();
    expect(match.applyCommand({ type: "advance-age", playerId: 1 })).toBeNull();
    expect(cards().some((card) => card.kind === "advance-age")).toBe(false);
    ready("Modern");
    expect(cards().some((card) => card.kind === "advance-age")).toBe(false);
    match.players[0].eliminated = true;
    expect(cards()).toEqual([]);
  });

  it("previews the next border on the first card while preserving the earned HUD theme", () => {
    const { root, ready, vm } = fixture();
    ready();
    const theme = new AgeThemeView(root);
    theme.update("StoneAge");
    const view = new ResearchOpportunitiesView(
      root.querySelector("main")!,
      () => {},
    );
    view.update(vm());
    const first = root.querySelector<HTMLElement>("article")!;
    expect(first.classList.contains("research-age-up")).toBe(true);
    expect(first.dataset.targetAge).toBe("BronzeAge");
    expect(first.querySelector(".branch-label")!.textContent).toBe("Age up");
    expect(first.style.getPropertyValue("--research-age-texture")).toContain(
      AGE_UI_THEMES.BronzeAge.texture,
    );
    expect(first.style.getPropertyValue("--research-age-light")).toBe(
      AGE_UI_THEMES.BronzeAge.palette.light,
    );
    expect(root.dataset.uiAge).toBe("StoneAge");
    expect(root.style.getPropertyValue("--age-texture")).toContain(
      AGE_UI_THEMES.StoneAge.texture,
    );
    expect(root.querySelectorAll(".research-age-up")).toHaveLength(1);
    ready("BronzeAge");
    view.update(vm());
    const successor = root.querySelector<HTMLElement>("article")!;
    expect(successor.dataset.targetAge).toBe("ClassicalAge");
    expect(
      successor.style.getPropertyValue("--research-age-texture"),
    ).toContain(AGE_UI_THEMES.ClassicalAge.texture);
    theme.reset();
  });

  it("dispatches the age command for the local player, charges the real cost and removes the busy card", () => {
    const { match, ready, vm, root } = fixture();
    ready("StoneAge", 2);
    const commands: Command[] = [];
    const model = vm(2);
    const gold = match.players[1].gold;
    const view = new ResearchOpportunitiesView(
      root.querySelector("main")!,
      (command) => {
        commands.push(command);
        expect(match.applyCommand(command)).toBeNull();
      },
    );
    view.update(model);
    const button = root.querySelector<HTMLButtonElement>(
      '[data-quick-research="advance-age"]',
    )!;
    button.click();
    button.click();
    expect(commands).toEqual([{ type: "advance-age", playerId: 2 }]);
    expect(match.players[1].gold).toBe(gold - model.advance.cost!.gold);
    expect(match.expansion!.progression.states[2].advancement?.target).toBe(
      "BronzeAge",
    );
    view.update(vm(2));
    expect(root.querySelector(".research-age-up")).toBeNull();
  });

  it("rechecks eligibility before a stale age-up click and preserves research alerts when funding is lost", () => {
    const { ready, vm, root } = fixture();
    ready();
    const commands: Command[] = [];
    const model = vm();
    const view = new ResearchOpportunitiesView(
      root.querySelector("main")!,
      (command) => commands.push(command),
    );
    view.update(model);
    const button = root.querySelector<HTMLButtonElement>(
      '[data-quick-research="advance-age"]',
    )!;
    model.player.gold = model.advance.cost!.gold - 1;
    button.click();
    expect(commands).toHaveLength(0);
    view.update(model);
    expect(root.querySelector(".research-age-up")).toBeNull();
    expect(root.querySelectorAll("article").length).toBeGreaterThan(0);
    view.reset();
    expect(root.querySelector<HTMLElement>("aside")!.hidden).toBe(true);
  });
});
