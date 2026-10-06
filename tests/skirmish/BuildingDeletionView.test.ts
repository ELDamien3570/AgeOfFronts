// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { hudMarkup, HudView } from "../../src/skirmish/client/HudView";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";

it("shows Delete warship for an owned side-card ship and routes deletion through the match", () => {
  const data = new Uint8Array(48 * 48).fill(133);
  const match = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed:42, aiCount:1, runAi:false, tribes:false, ruleset:"ages-v1",
  });
  const ship = match.addShip({id:match.allocateId(), playerId:1, kind:"warship", health:1000,
    x:128, y:128, destination:null, waypoints:[], path:[], nextPathIndex:0, fighting:false});
  const root = document.createElement("div");
  root.innerHTML = hudMarkup();
  document.body.replaceChildren(root);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const command = vi.fn(input => match.applyCommand(input));
  const view = new HudView(root, () => {}, command);
  const update = () => view.update(new HudViewModel(new SkirmishViewModel(match.snapshot(), {
    selected:new Set(), selectedShips:new Set([ship.id]), selectedBuilding:null,
  })));
  update();
  const button = root.querySelector<HTMLButtonElement>("#delete-ship")!;
  expect(button.hidden).toBe(false);
  expect(button.closest(".selection-heading")).not.toBeNull();
  const other = match.addShip({id:match.allocateId(), playerId:1, kind:"warship", health:1000,
    x:144, y:128, destination:null, waypoints:[], path:[], nextPathIndex:0, fighting:false});
  view.update(new HudViewModel(new SkirmishViewModel(match.snapshot(), {
    selected:new Set(), selectedShips:new Set([ship.id, other.id]), selectedBuilding:null,
  })));
  expect(button.hidden).toBe(true);
  button.click();
  expect(command).not.toHaveBeenCalled();
  update();
  expect(button.hidden).toBe(false);
  button.click();
  expect(command).toHaveBeenCalledWith({type:"delete-ship", playerId:1, shipId:ship.id});
  expect(match.ship(ship.id)).toBeUndefined();
  expect(match.ship(other.id)).toBeDefined();
  update();
  expect(button.hidden).toBe(true);
  vi.unstubAllGlobals();
});

it("requires confirm, supports Cancel/X/Escape, pins one stack member and closes stale dialogs", () => {
  const data = new Uint8Array(48 * 48).fill(133);
  const m = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1",
  });
  const b = m.addBuilding({
    id: m.allocateId(),
    type: "barracks",
    playerId: 1,
    tile: m.players[0].base,
    age: "BronzeAge",
    remainingTicks: 0,
  });
  m.addBuilding({
    id: m.allocateId(),
    type: "barracks",
    playerId: 1,
    tile: b.tile,
    age: "StoneAge",
    remainingTicks: 4,
  });
  const root = document.createElement("div");
  root.innerHTML = hudMarkup();
  document.body.replaceChildren(root);
  const extra = document.createElement("div");
  extra.id = "build-slot-tower";
  extra.innerHTML =
    '<button data-dock-action="build" data-value="tower">Tower</button>';
  root.append(extra);
  const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = () => {
    dialog.setAttribute("open", "");
  };
  dialog.close = () => {
    dialog.removeAttribute("open");
    dialog.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const command = vi.fn(),
    view = new HudView(root, () => {}, command);
  const model = () =>
    new HudViewModel(
      new SkirmishViewModel(m.snapshot(), {
        selected: new Set(),
        selectedShips: new Set(),
        selectedBuilding: b.id,
        selectedBuildings: new Set([b.id]),
      }),
    );
  view.update(model());
  expect(extra.querySelectorAll(".building-count")).toHaveLength(1);
  const click = (id: string) =>
    root.querySelector<HTMLButtonElement>(`#${id}`)!.click();
  expect(
    root.querySelector("#build-barracks .building-count")!.textContent,
  ).toBe("2");
  for (const id of ["delete-building-cancel", "delete-building-close"]) {
    click("delete-building");
    expect(dialog.open).toBe(true);
    expect(root.querySelector("#delete-building-message")!.textContent).toBe("Delete Barracks — Level 2 (Bronze Age)?");
    expect(command).not.toHaveBeenCalled();
    click(id);
    expect(dialog.open).toBe(false);
    click("delete-building-confirm");
    expect(command).not.toHaveBeenCalled();
  }
  click("delete-building");
  m.updateBuilding(b.id, { age: "ClassicalAge" });
  view.update(model());
  expect(root.querySelector("#delete-building-message")!.textContent).toBe("Delete Barracks — Level 3 (Classical Age)?");
  dialog.dispatchEvent(new Event("cancel"));
  dialog.close();
  click("delete-building-confirm");
  expect(command).not.toHaveBeenCalled();
  click("delete-building");
  click("delete-building-confirm");
  expect(command).toHaveBeenCalledExactlyOnceWith({
    type: "delete-building",
    playerId: 1,
    buildingId: b.id,
  });
  click("delete-building");
  view.reset();
  expect(dialog.open).toBe(false);
  click("delete-building-confirm");
  expect(command).toHaveBeenCalledTimes(1);
  view.update(model());
  click("delete-building");
  m.updateBuilding(b.id, { playerId: 2 });
  view.update(model());
  expect(dialog.open).toBe(false);
  click("delete-building-confirm");
  expect(command).toHaveBeenCalledTimes(1);
});
