// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireView, empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";

afterEach(() => vi.restoreAllMocks());
it("shows mutual long-term terms, the notice countdown, and immediate war's 120-second penalty", () => {
  const cells = new Uint8Array(48 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(48, 48, cells, cells.length), { seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", aiWarPolicy: true });
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const root = document.createElement("div");
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const command = vi.fn(c => expect(game.applyCommand(c)).toBeNull());
  const view = new EmpireView(root, { refresh: () => {}, command, build: () => {}, notify: () => {}, focusedRef: () => null, target: () => {} });
  const update = () => {
    now += 501;
    view.update(new EmpireViewModel(game.snapshot(), { selected: new Set(), selectedShips: new Set(), selectedBuilding: null }));
  };
  const button = (action: string) => root.querySelector<HTMLButtonElement>(`[data-diplomacy="${action}"]`);
  update(); view.inspectPlayer(2); update();
  expect(button("declare")!.textContent).toBe("Declare War");
  expect(button("end-long-term")).toBeNull();
  button("offer-long-term")!.click(); update();
  expect(game.expansion!.diplomacy.allied(1, 2)).toBe(false);
  expect(root.textContent).toContain("awaiting acceptance");
  expect(game.applyCommand({type: "alliance", playerId: 2, otherId: 1, action: "accept"})).toBeNull(); update();
  expect(root.textContent).toContain("renews automatically");
  expect(button("renew")).toBeNull();
  expect(button("break")!.textContent).toContain("60s");
  expect(button("declare")!.textContent).toContain("120s");
  expect(new EmpireViewModel(game.snapshot(), {selected: new Set(), selectedShips: new Set(), selectedBuilding: null}).allianceRenewals).toEqual([]);
  button("end-long-term")!.click(); update();
  expect(root.textContent).toContain("Alliance ends in 180s");
  expect(button("end-long-term")).toBeNull();
  button("declare")!.click(); update();
  expect(root.textContent).toContain("At war");
  expect(button("declare")).toBeNull();
  expect(game.expansion!.diplomacy.state.betrayal[1]).toBe(game.tick + 2400);
  expect(command).toHaveBeenLastCalledWith({type: "alliance", playerId: 1, otherId: 2, action: "declare"});
});
