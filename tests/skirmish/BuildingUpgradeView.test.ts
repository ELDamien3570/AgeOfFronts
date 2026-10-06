// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { empireMarkup, EmpireView } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { buildingUpgradeCost } from "../../src/skirmish/content/Buildings";
import { Skirmish } from "../../src/skirmish/Simulation";

it("building card and U action dispatch the shared paid selection quote, and refresh on damage", () => {
  const data = new Uint8Array(48 * 48).fill(133);
  const m = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1",
  });
  m.players[0].gold = 10000;
  m.expansion!.progression.states[1].age = "BronzeAge";
  m.expansion!.progression.states[1].completed = TECHNOLOGIES.map(t => t.id);
  const b = m.addBuilding({ id: 999, playerId: 1, type: "city" as const, age: "StoneAge" as const,
    tile: m.players[0].base, remainingTicks: 0, health: 1200, maxHealth: 1200 });

  const root = document.createElement("div"); root.id = "app";
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const command = vi.fn();
  const view = new EmpireView(root, { refresh() {}, build() {}, notify() {}, focusedRef: () => null, target() {}, command });
  const model = () => new EmpireViewModel(m.snapshot(), { selected: new Set(), selectedShips: new Set(), selectedBuilding: b.id, selectedBuildings: new Set([b.id]) });
  view.update(model());
  const button = root.querySelector<HTMLButtonElement>("#refit-actions button")!;
  expect(button.textContent).toContain("Bronze Age"); expect(button.disabled).toBe(false);
  button.click();
  expect(command).toHaveBeenCalledExactlyOnceWith({ type: "upgrade-building", playerId: 1, buildingIds: [b.id] });
  view.upgrade(); expect(command).toHaveBeenCalledTimes(2);
  m.updateBuilding((b).id, { health: 1000 }); view.update(model());
  expect(root.querySelector<HTMLButtonElement>("#refit-actions button")!.disabled).toBe(true);
  expect(root.querySelector("#refit-actions")!.textContent).toContain("repair");
  view.upgrade(); expect(command).toHaveBeenCalledTimes(2);
});

it("updates affordable fleet and building counts and dispatches the same subset from button and U", () => {
  const data = new Uint8Array(48 * 48).fill(133);
  const m = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed:42, aiCount:1, tribes:false, runAi:false, ruleset:"ages-v1",
  });
  m.expansion!.progression.states[1].age = "BronzeAge";
  m.expansion!.progression.states[1].completed = TECHNOLOGIES.map(t => t.id);
  const ships = Array.from({length:3}, () => m.addShip({id:m.allocateId(), playerId:1,
    kind:"warship", definitionId:"stoneage-warship", health:1000, x:128, y:128,
    destination:null, waypoints:[], path:[], nextPathIndex:0, fighting:false}));
  const root = document.createElement("div");
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const command = vi.fn();
  const view = new EmpireView(root, {refresh() {}, build() {}, notify() {}, focusedRef:()=>null, target() {}, command});
  const fleetModel = () => new EmpireViewModel(m.snapshot(), {selected:new Set(), selectedShips:new Set(ships.map(s=>s.id)), selectedBuilding:null});
  const button = () => root.querySelector<HTMLButtonElement>("#refit-actions button")!;
  m.players[0].gold = 800;
  view.update(fleetModel());
  expect(button().textContent).toContain("Upgrade 1/3");
  button().click();
  expect(command.mock.lastCall![0].shipIds).toEqual([ships[0].id]);
  m.players[0].gold = 1600;
  view.update(fleetModel());
  expect(button().textContent).toContain("Upgrade 2/3");
  view.upgrade();
  expect(command.mock.lastCall![0].shipIds).toEqual(ships.slice(0,2).map(s=>s.id));
  for (const b of [...m.buildings]) m.removeBuilding(b.id);
  const buildings = Array.from({length:3}, () => m.addBuilding({id:m.allocateId(), playerId:1, type:"city", age:"StoneAge", tile:m.players[0].base, remainingTicks:0}));
  const model = () => new EmpireViewModel(m.snapshot(), {selected:new Set(), selectedShips:new Set(), selectedBuilding:buildings[0].id, selectedBuildings:new Set(buildings.map(b=>b.id))});
  const price = buildingUpgradeCost("city", "BronzeAge", 3).gold!;
  m.players[0].gold = price;
  view.update(model());
  expect(button().textContent).toContain("Upgrade 1/3");
  button().click();
  expect(command.mock.lastCall![0].buildingIds).toEqual([buildings[0].id]);
  m.players[0].gold = price*2;
  view.update(model());
  expect(button().textContent).toContain("Upgrade 2/3");
  view.upgrade();
  expect(command.mock.lastCall![0].buildingIds).toEqual(buildings.slice(0,2).map(b=>b.id));
});
