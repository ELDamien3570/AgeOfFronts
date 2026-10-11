// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireView, empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import { TechnologyViewModel } from "../../src/skirmish/client/TechnologyViewModel";
import { UNIT } from "../../src/skirmish/content/Units";
import { scaledRecipeCost } from "../../src/skirmish/domain/Manpower";

describe("paid formation enlargement controls", () => {
  it("offers Enlarge after optional research and wires cancellation to an exact refund", () => {
    const terrain = new Uint8Array(48 * 48).fill(133);
    const game = new Skirmish(
      new GameMapImpl(48, 48, terrain, terrain.length),
      { seed: 42, aiCount: 1, runAi: false, tribes: false, ruleset: "ages-v1" },
    );
    const squad = game.squads.find((s) => s.playerId === 1)!,
      unit = UNIT.get(squad.definitionId!)!;
    const player = game.players[0];
    player.gold = 100000;
    player.reserves = 1000;
    game.owners.fill(1);
    game.expansion!.supply.inventories[1] = {
      ...scaledRecipeCost(unit, "enlarged").items,
    };
    const root = document.createElement("div");
    root.id = "app";
    root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
    document.body.replaceChildren(root);
    const view = new EmpireView(root, {
      refresh: () => {},
      command: (c) => {
        expect(game.applyCommand(c)).toBeNull();
      },
      build: () => {},
      notify: () => {},
      focusedRef: () => `squad:${squad.id}`,
      target: () => {},
    });
    const render = () =>
      view.update(
        new EmpireViewModel(game.snapshot(), {
          selected: new Set([squad.id]),
          selectedShips: new Set(),
          selectedBuilding: null,
        }),
      );
    render();
    expect(root.querySelector("[data-enlarge]")).toBeNull();
    const research = new TechnologyViewModel(
      new EmpireViewModel(game.snapshot(), {
        selected: new Set(), selectedShips: new Set(), selectedBuilding: null,
      }), "StoneAge",
    ).trees.flatMap((tree) => tree.nodes);
    const capacityNode = research.find((node) => node.id === unit.formationRecipe!.technologyId)!;
    expect(capacityNode.row).toBeLessThan(10);
    expect(capacityNode.progressionEndpoint).toBe(false);
    game.expansion!.progression.states[1].completed.push(
      unit.formationRecipe!.technologyId!,
    );
    render();
    const button = root.querySelector<HTMLButtonElement>("[data-enlarge]")!;
    const barracks = game.addBuilding({
      id: game.allocateId(),
      playerId: 1,
      type: "barracks",
      tile: player.base,
      age: "StoneAge",
      remainingTicks: 0,
    });
    const card = new HudViewModel(
      new SkirmishViewModel(
        game.snapshot(),
        {
          selected: new Set(),
          selectedShips: new Set(),
          selectedBuilding: barracks.id,
        },
        { infantry: unit.id },
      ),
    ).actionCard("recruit-infantry")!;
    expect(card.stats.find((s) => s.label === "Recipe capacity")?.value).toBe(
      "24",
    );
    expect(
      card.compact!.stats.find((s) => s.label === "Cost")?.value,
    ).toContain("24 reserves");
    expect(button.disabled).toBe(false);
    expect(button.title).toContain("12 reserves");
    const reserves = player.reserves;
    button.click();
    expect(player.reserves).toBe(reserves - 12);
    render();
    root.querySelector<HTMLButtonElement>("[data-cancel-enlarge]")!.click();
    expect(player.reserves).toBe(reserves);
    expect(game.squad(squad.id)!.troops).toBe(12);
  });
});
