// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireHudView } from "../../src/skirmish/client/EmpireHudView";
import { empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup, HudView } from "../../src/skirmish/client/HudView";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { ResourceViewModel } from "../../src/skirmish/client/ResourceViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import {
  resourceTechnology,
  resourceVisibleAtAge,
} from "../../src/skirmish/content/Resources";
import {
  AGES,
  RESOURCES,
  type Age,
} from "../../src/skirmish/domain/Definitions";
import { Skirmish } from "../../src/skirmish/Simulation";

const firstAges = {
  horses: "StoneAge",
  stone: "StoneAge",
  copper: "BronzeAge",
  tin: "BronzeAge",
  bronze: "BronzeAge",
  ironOre: "ClassicalAge",
  iron: "ClassicalAge",
  carbon: "LateMedieval",
  steel: "LateMedieval",
  sulphur: "LateMedieval",
  nitrate: "LateMedieval",
  gunpowder: "LateMedieval",
  oil: "Modern",
} as const;

describe("age-based strategic resource discovery", () => {
  it("names the exact extraction node for every visible deposit and updates it after local research", () => {
    const terrain = new Uint8Array(96 * 64).fill(133);
    const match = new Skirmish(
      new GameMapImpl(96, 64, terrain, terrain.length),
      {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      },
    );
    const expansion = match.expansion!,
      selection = {
        selected: new Set<number>(),
        selectedShips: new Set<number>(),
        selectedBuilding: null,
        selectedDeposit: null as number | null,
      },
      local = expansion.progression.states[1];
    local.age = "Modern";
    local.completed = [];
    // Foreign research must not make local extraction appear unlocked.
    expansion.progression.states[2].completed = expansion.supply.deposits.map(
      (d) => resourceTechnology(d.resource).id,
    );
    const model = () =>
      new HudViewModel(new SkirmishViewModel(match.snapshot(), selection));
    for (const deposit of expansion.supply.deposits) {
      const technology = resourceTechnology(deposit.resource);
      selection.selectedDeposit = deposit.id;
      const hover = model().depositCard(deposit.id)!;
      expect(hover.status).toBe(`Requires research: ${technology.name}`);
      expect(
        hover.stats.find((s) => s.label === "Research node")?.value,
      ).toContain(technology.name);
      expect(
        hover.stats.find((s) => s.label === "Research node")?.value,
      ).toMatch(/Economic|Warfare/);
      const clicked = model().selectionCard(null);
      expect(clicked.mode).toBe("detail");
      if (clicked.mode === "detail") expect(clicked.card).toEqual(hover);
    }
    const stone = expansion.supply.deposits.find(
      (d) => d.resource === "stone",
    )!;
    local.completed.push(resourceTechnology("stone").id);
    expect(model().depositCard(stone.id)?.status).toBe(
      "Research complete: Stone Mining",
    );
    expect(
      model()
        .depositCard(stone.id)
        ?.stats.find((s) => s.label === "Extraction")?.value,
    ).toContain("build a mine");
    local.age = "StoneAge";
    const oil = expansion.supply.deposits.find((d) => d.resource === "oil")!;
    expect(model().depositCard(oil.id)).toBeUndefined();
  });

  it("shows matching research requirements in clicked and hovered cards without changing selection, then hides the popup on leave", () => {
    const terrain = new Uint8Array(96 * 64).fill(133);
    const match = new Skirmish(
      new GameMapImpl(96, 64, terrain, terrain.length),
      {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      },
    );
    const deposit = match.expansion!.supply.deposits.find(
        (d) => d.resource === "stone",
      )!,
      selection = {
        selected: new Set<number>(),
        selectedShips: new Set<number>(),
        selectedBuilding: null,
        selectedDeposit: deposit.id as number | null,
      },
      root = document.createElement("main");
    root.innerHTML = hudMarkup();
    document.body.replaceChildren(root);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
      },
    );
    try {
      const view = new HudView(root),
        update = () =>
          view.update(
            new HudViewModel(
              new SkirmishViewModel(match.snapshot(), selection),
            ),
          ),
        tooltip = root.querySelector<HTMLElement>("#deposit-tooltip")!;
      update();
      expect(root.querySelector("#selection-label")!.textContent).toBe(
        "RESOURCE DETAILS",
      );
      expect(root.querySelector("#selection-status")!.textContent).toBe(
        "Requires research: Stone Mining",
      );
      expect(root.querySelector("#selection-stats")!.textContent).toContain(
        "Stone Mining · Stone Age · Economic",
      );
      view.hoverDeposit(deposit.id, { x: 100, y: 100 });
      expect(tooltip.hidden).toBe(false);
      expect(tooltip.textContent).toContain("Requires research: Stone Mining");
      expect(selection.selectedDeposit).toBe(deposit.id);
      match.expansion!.progression.states[1].completed.push(
        resourceTechnology("stone").id,
      );
      update();
      expect(tooltip.textContent).toContain("Research complete: Stone Mining");
      expect(root.querySelector("#selection-status")!.textContent).toBe(
        "Research complete: Stone Mining",
      );
      view.hoverDeposit(null);
      expect(tooltip.hidden).toBe(true);
      view.hoverDeposit(deposit.id, { x: 100, y: 100 });
      view.reset();
      expect(tooltip.hidden).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gates deposit inspection and enemy producer details without revealing foreign stocks", () => {
    const terrain = new Uint8Array(96 * 64).fill(133);
    const match = new Skirmish(
      new GameMapImpl(96, 64, terrain, terrain.length),
      {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      },
    );
    const expansion = match.expansion!;
    const deposit = expansion.supply.deposits.find(
      (d) => d.resource === "oil",
    )!;
    expect(deposit).toBeDefined();
    deposit.owner = 2;
    expansion.progression.states[2].age = "Modern";
    expansion.supply.inventories[2].oil = 12345;
    const mine = {
      id: match.allocateId(),
      tile: deposit.tile,
      playerId: 2,
      type: "oil-well" as const,
      remainingTicks: 0,
      health: 2000,
      maxHealth: 2000,
      age: "Modern" as const,
    };
    match.buildings.push(mine);
    const selection = {
      selected: new Set<number>(),
      selectedShips: new Set<number>(),
      selectedBuilding: null as number | null,
      selectedDeposit: deposit.id as number | null,
    };
    const card = () =>
      new HudViewModel(
        new SkirmishViewModel(match.snapshot(), selection),
      ).selectionCard(null);
    expect(card().mode).toBe("empty");
    selection.selectedDeposit = null;
    selection.selectedBuilding = mine.id;
    const depositDetail = () => {
      const result = card();
      return result.mode === "detail" || result.mode === "group"
        ? result.card.stats.find((s) => s.label === "Deposit")?.value
        : undefined;
    };
    expect(depositDetail()).toBe("Unknown until a later age");
    expansion.progression.states[1].age = "Modern";
    expect(depositDetail()).toBe("oil");
    selection.selectedBuilding = null;
    selection.selectedDeposit = deposit.id;
    expect(JSON.stringify(card())).toContain("Foreign inventory hidden");
    expect(JSON.stringify(card())).not.toContain("12345");
    expect(expansion.supply.inventories[2].oil).toBe(12345);
  });
  it("reveals each raw/refined material in its age and retains it in later ages", () => {
    for (const age of AGES)
      for (const resource of RESOURCES) {
        const visible = AGES.indexOf(age) >= AGES.indexOf(firstAges[resource]);
        expect(resourceTechnology(resource).age).toBe(firstAges[resource]);
        expect(resourceVisibleAtAge(resource, age)).toBe(visible);
        const model = new ResourceViewModel(age, {});
        expect(model.depositVisible(resource)).toBe(visible);
        expect(
          Object.prototype.hasOwnProperty.call(model.stocks, resource),
        ).toBe(visible && resource !== "sulphur" && resource !== "nitrate");
        if (visible && resource !== "sulphur" && resource !== "nitrate") expect(model.stocks[resource]).toBe(0);
      }
  });

  it("hides stocked future materials, equipment and payloads without changing the ledger", () => {
    const ledger = {
      bronze: 20,
      oil: 999,
      "equipment:bronzeage-infantry": 3,
      "payload:icbm": 2,
    };
    const saved = { ...ledger };
    const stone = new ResourceViewModel("StoneAge", ledger);
    expect(stone.stocks.bronze).toBeUndefined();
    expect(stone.stocks.oil).toBeUndefined();
    expect(stone.stocks["equipment:bronzeage-infantry"]).toBeUndefined();
    expect(stone.stocks["payload:icbm"]).toBeUndefined();
    const bronze = new ResourceViewModel("BronzeAge", ledger);
    expect(bronze.stocks.bronze).toBe(20);
    expect(bronze.stocks["equipment:bronzeage-infantry"]).toBe(3);
    expect(bronze.stocks.oil).toBeUndefined();
    const modern = new ResourceViewModel("Modern", ledger);
    expect(modern.stocks.oil).toBe(999);
    expect(modern.stocks["payload:icbm"]).toBe(2);
    expect(modern.stocks.bronze).toBe(20);
    expect(ledger).toEqual(saved);
  });

  it("uses the local faction age, updates HUD categories at advancement, and keeps zero stock visible", () => {
    const terrain = new Uint8Array(96 * 64).fill(133);
    const match = new Skirmish(
      new GameMapImpl(96, 64, terrain, terrain.length),
      {
        seed: 47,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
      },
    );
    const root = document.createElement("div");
    root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
    document.body.replaceChildren(root);
    const view = new EmpireHudView(
      root,
      {
        refresh: vi.fn(),
        command: vi.fn(),
        build: vi.fn(),
        notify: vi.fn(),
        focusedRef: () => null,
        target: vi.fn(),
      },
      { autoTier: true, choices: {} },
      vi.fn(),
    );
    match.expansion!.progression.states[2].age = "Modern";
    match.expansion!.supply.inventories[1].oil = 777;
    const grants = [...match.expansion!.progression.states[1].completed];
    const update = (age: Age) => {
      match.expansion!.progression.states[1].age = age;
      const model = new EmpireViewModel(match.snapshot(), {
        selected: new Set(),
        selectedShips: new Set(),
        selectedBuilding: null,
      });
      view.update(model);
      return model;
    };
    const stocks = () => root.querySelector("#strategic-stocks")!;
    const groups = () =>
      [...stocks().querySelectorAll("details")].map(
        (e) => (e as HTMLElement).dataset.stockGroup,
      );
    expect(update("StoneAge").resources.depositVisible("oil")).toBe(false);
    expect(groups()).toEqual(["ores", "horses"]);
    expect(stocks().textContent).toContain("stone0");
    expect(stocks().textContent).not.toContain("777");
    expect(stocks().textContent).not.toContain("oil");
    update("BronzeAge");
    expect(groups()).toEqual(["ores", "metals", "horses", "equipment"]);
    expect(stocks().textContent).toContain("bronze0");
    update("LateMedieval");
    expect(groups()).toContain("energy");
    expect(stocks().textContent).not.toContain("oil");
    update("Modern");
    expect(groups()).toContain("payloads");
    expect(stocks().textContent).toContain("oil777");
    // Visibility alone never grants extraction, recipes, or research.
    expect(match.expansion!.progression.states[1].completed).toEqual(grants);
    expect(match.expansion!.supply.inventories[1].oil).toBe(777);
  });
});
