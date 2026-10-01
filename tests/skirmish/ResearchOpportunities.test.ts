// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { empireMarkup, EmpireView } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { ResearchOpportunitiesView } from "../../src/skirmish/client/ResearchOpportunitiesView";
import { ResearchOpportunitiesViewModel } from "../../src/skirmish/client/ResearchOpportunitiesViewModel";
import type { Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture(speed: 1 | 2 | 3 = 1) {
  const cells = new Uint8Array(48 * 48).fill(133);
  const m = new Skirmish(new GameMapImpl(48, 48, cells, cells.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
    technologySpeed: speed,
  });
  const vm = () =>
    new EmpireViewModel(m.snapshot(), {
      selected: new Set(),
      selectedShips: new Set(),
      selectedBuilding: null,
    });
  return { m, vm, cards: () => new ResearchOpportunitiesViewModel(vm()).cards };
}

describe("quick research opportunities", () => {
  it("shows unlocked branches but excludes completed, future, and missing-prerequisite nodes", () => {
    const { cards } = fixture();
    expect(cards().map((c) => c.id)).toEqual([
      "stoneage-cargo-canoes",
      "stoneage-spear-throwing",
      "stoneage-horsemanship",
      "stoneage-craft-workshops",
      "stoneage-stone-mining",
    ]);
  });
  it("shows nodes only with sufficient funds and uses the shared tech-speed quote", () => {
    const { m, cards } = fixture(3);
    m.players[0].gold = 99;
    expect(cards().some((c) => c.id === "stoneage-cargo-canoes")).toBe(false);
    m.players[0].gold = 100;
    const node = cards().find((c) => c.id === "stoneage-cargo-canoes")!;
    expect(node.gold).toBe(100);
    expect(node.seconds).toBe(12);
    expect(node.reason).toBeNull();
    m.players[0].gold = 0;
    expect(cards()).toEqual([]);
  });
  it("hides a busy branch and reveals successor nodes when research completes", () => {
    const { m, cards } = fixture();
    expect(
      m.applyCommand({
        type: "research",
        playerId: 1,
        technologyId: "stoneage-cargo-canoes",
      }),
    ).toBeNull();
    expect(cards().some((c) => c.tree === "naval")).toBe(false);
    const progression = m.expansion!.progression.states[1];
    progression.completed.push("stoneage-cargo-canoes");
    delete progression.research.naval;
    expect(
      cards()
        .filter((c) => c.tree === "naval")
        .map((c) => c.id),
    ).toEqual(["stoneage-shorecraft"]);
  });
  it("includes unfinished older-age research and uses the local player rather than player one", () => {
    const { m, vm } = fixture();
    m.expansion!.progression.states[2].age = "BronzeAge";
    m.expansion!.progression.states[2].completed.push("stoneage-cargo-canoes");
    const snapshot = m.snapshot();
    snapshot.localPlayerId = 2;
    const model = new ResearchOpportunitiesViewModel(
      new EmpireViewModel(snapshot, vm().selection),
    );
    expect(model.cards.some((c) => c.id === "stoneage-shorecraft")).toBe(
      true,
    );
    expect(model.cards.some((c) => c.id === "stoneage-cargo-canoes")).toBe(false);
    m.players[1].eliminated = true;
    snapshot.players[1].eliminated = true;
    expect(model.cards).toEqual([]);
  });
  it("starts research directly, removes busy cards, preserves others, and resets cleanly", () => {
    const { m, vm } = fixture();
    const main = document.createElement("main");
    document.body.replaceChildren(main);
    const commands: Command[] = [];
    const view = new ResearchOpportunitiesView(main, (c) => {
      commands.push(c);
      expect(m.applyCommand(c)).toBeNull();
    });
    view.update(vm());
    const button = main.querySelector<HTMLButtonElement>(
      '[data-quick-research="stoneage-cargo-canoes"]',
    )!;
    expect(button.disabled).toBe(false);
    button.click();
    view.update(vm());
    expect(commands).toEqual([
      { type: "research", playerId: 1, technologyId: "stoneage-cargo-canoes" },
    ]);
    expect(
      main.querySelector('[data-quick-research="stoneage-cargo-canoes"]'),
    ).toBeNull();
    expect(
      main.querySelector('[data-quick-research="stoneage-horsemanship"]'),
    ).not.toBeNull();
    // A stale rendered button cannot spend gold lost since the previous render.
    const stale = main.querySelector<HTMLButtonElement>(
      '[data-quick-research="stoneage-horsemanship"]',
    )!;
    const poor = vm();
    poor.player.gold = 0;
    view.update(poor);
    stale.click();
    expect(commands).toHaveLength(1);
    expect(main.querySelectorAll("article")).toHaveLength(0);
    view.reset();
    expect(main.querySelector<HTMLElement>("aside")!.hidden).toBe(true);
    expect(main.querySelectorAll("article")).toHaveLength(0);
  });
  it("retains opportunities through management panel open and close", () => {
    const { vm } = fixture(),
      root = document.createElement("div");
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
    view.update(vm());
    const cards = root.querySelector(".research-opportunities")!.innerHTML;
    for (const panel of ["technology", "supplies"] as const) {
      view.toggle(panel);
      expect(root.querySelector<HTMLElement>("#empire-panel")!.hidden).toBe(
        false,
      );
      view.close();
      expect(root.querySelector<HTMLElement>("#empire-panel")!.hidden).toBe(
        true,
      );
      expect(root.querySelector(".research-opportunities")!.innerHTML).toBe(
        cards,
      );
    }
    view.inspectPlayer(2);
    view.closeDiplomacy();
    expect(root.querySelector(".research-opportunities")!.innerHTML).toBe(
      cards,
    );
  });
  it("renders tree color classes and places research button in top right of header", () => {
    const { vm } = fixture();
    const main = document.createElement("main");
    document.body.replaceChildren(main);
    const commands: Command[] = [];
    const view = new ResearchOpportunitiesView(main, (c) => commands.push(c));
    view.update(vm());

    // Check tree classes and data attributes
    const navalArticle = main.querySelector('article[data-tree="naval"]');
    const warfareArticle = main.querySelector('article[data-tree="warfare"]');
    const economicArticle = main.querySelector('article[data-tree="economic"]');
    expect(navalArticle).not.toBeNull();
    expect(warfareArticle).not.toBeNull();
    expect(economicArticle).not.toBeNull();
    expect(navalArticle!.classList.contains("research-tree-naval")).toBe(true);
    expect(warfareArticle!.classList.contains("research-tree-warfare")).toBe(true);
    expect(economicArticle!.classList.contains("research-tree-economic")).toBe(true);

    // Verify button is inside header (top right layout) alongside the title group
    const header = navalArticle!.querySelector("header")!;
    const button = header.querySelector("button[data-quick-research]");
    const titleGroup = header.querySelector(".research-title-group");
    expect(button).not.toBeNull();
    expect(titleGroup).not.toBeNull();
    expect(titleGroup!.querySelector("small.branch-label")!.textContent).toBe("naval");
    expect(button!.querySelector("small.cost-label")).not.toBeNull();
  });
});
