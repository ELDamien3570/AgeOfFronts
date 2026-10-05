// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { empireMarkup, EmpireView } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";

function fixture() {
  const terrain = new Uint8Array(48 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(48, 48, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const root = document.createElement("div");
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const command = vi.fn((c) => expect(game.applyCommand(c)).toBeNull());
  const view = new EmpireView(root, {
    refresh: () => {},
    command,
    build: () => {},
    notify: () => {},
    focusedRef: () => null,
    target: () => {},
  });
  const update = () => {
    now += 501;
    view.update(
      new EmpireViewModel(game.snapshot(), {
        selected: new Set(),
        selectedShips: new Set(),
        selectedBuilding: null,
      }),
    );
  };
  update();
  const button = (selector: string) =>
    root.querySelector<HTMLButtonElement>(selector)!;
  return { game, view, command, button, update };
}
afterEach(() => vi.restoreAllMocks());
describe("trade controls presentation", () => {
  it("stops and resumes each fleet independently from the production menu", () => {
    const { game, view, command, button, update } = fixture();
    view.toggle("supplies");
    for (const mode of ["land", "sea"]) {
      button(`[data-trade-mode="${mode}"]`).click();
      update();
      expect(button(`[data-trade-mode="${mode}"]`).textContent).toContain(
        "Resume",
      );
      expect(
        button(`[data-trade-mode="${mode}"]`).getAttribute("aria-pressed"),
      ).toBe("true");
      expect(command).toHaveBeenLastCalledWith({
        type: "trade-pause",
        playerId: 1,
        naval: mode === "sea",
        paused: true,
      });
    }
    button('[data-trade-mode="land"]').click();
    update();
    expect(game.expansion!.trade.controls[1]).toMatchObject({
      landPaused: false,
      seaPaused: true,
    });
    expect(button('[data-trade-mode="land"]').textContent).toContain("Stop");
  });
  it("blocks a specific nation from diplomacy and removes that control for self inspection", () => {
    const { game, view, command, button, update } = fixture();
    view.inspectPlayer(2);
    button('[data-trade-faction="2"]').click();
    update();
    expect(command).toHaveBeenLastCalledWith({
      type: "trade-block",
      playerId: 1,
      otherId: 2,
      blocked: true,
      naval: false,
    });
    expect(game.expansion!.trade.controls[1].landBlocked).toEqual([2]);
    expect(game.expansion!.trade.controls[1].seaBlocked).toEqual([]);
    expect(button('[data-trade-faction="2"]').textContent).toContain("Resume");
    button('[data-trade-faction="2"]').click();
    update();
    expect(game.expansion!.trade.controls[1].landBlocked).toEqual([]);
    view.inspectPlayer(1);
    expect(button("[data-trade-faction]")).toBeNull();
  });
  it("keeps land and sea preferences separate and disables both during war", () => {
    const {game,view,button,update}=fixture();view.inspectPlayer(2);
    button('[data-trade-partner-mode="sea"]').click();update();
    expect(game.expansion!.trade.controls[1].seaBlocked).toEqual([2]);
    expect(game.expansion!.trade.controls[1].landBlocked).toEqual([]);
    expect(game.applyCommand({type:"alliance",playerId:1,otherId:2,action:"declare"})).toBeNull();update();
    expect(button('[data-trade-partner-mode="sea"]').disabled).toBe(true);
    expect(button('[data-trade-partner-mode="land"]').disabled).toBe(true);
    expect(button('[data-trade-partner-mode="land"]').textContent).toContain("Unavailable during war");
    expect(game.expansion!.trade.controls[1].seaBlocked).toEqual([2]);
    expect(game.expansion!.trade.permitted(1,2,false)).toBe(false);
  });
});
