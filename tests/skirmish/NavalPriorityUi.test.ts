// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { hudMarkup, HudView } from "../../src/skirmish/client/HudView";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import type { Command } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

it("updates owned fleet priority from authoritative snapshots and handles mixed selections", () => {
  const data = new Uint8Array(48 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(48, 48, data, data.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1",
  });
  const add = (playerId: number) =>
    game.addShip({
      id: game.allocateId(),
      playerId,
      kind: "warship",
      definitionId: "stoneage-warship",
      health: 1000,
      x: 128,
      y: 128,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
    });
  const first = add(1),
    second = add(1),
    foreign = add(2);
  const root = document.createElement("div");
  root.innerHTML = hudMarkup();
  document.body.replaceChildren(root);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  try {
    const send = vi.fn((command: Command) =>
      expect(game.applyCommand(command)).toBeNull(),
    );
    const view = new HudView(root, () => {}, send);
    const selectedShips = new Set([first.id, second.id, foreign.id]);
    const update = () =>
      view.update(
        new HudViewModel(
          new SkirmishViewModel(game.snapshot(), {
            selected: new Set(),
            selectedShips,
            selectedBuilding: null,
          }),
        ),
      );
    update();
    const control = root.querySelector<HTMLSelectElement>("#naval-priority")!;
    expect(control.value).toBe("transports");
    control.value = "warships";
    control.dispatchEvent(new Event("change"));
    expect(send).toHaveBeenCalledWith({
      type: "naval-priority",
      playerId: 1,
      shipIds: [first.id, second.id],
      priority: "warships",
    });
    expect(foreign.navalPriority).toBeUndefined();
    update();
    expect(control.value).toBe("warships");
    game.updateShip(second.id, { navalPriority: "transports" });
    update();
    expect(control.value).toBe("mixed");
    selectedShips.clear();
    update();
    expect(control.disabled).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
