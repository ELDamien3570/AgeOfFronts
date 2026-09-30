// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EmpireHudView } from "../../src/skirmish/client/EmpireHudView";
import { empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { Skirmish } from "../../src/skirmish/Simulation";

function fixture() {
  const terrain = new Uint8Array(96 * 64).fill(133);
  const match = new Skirmish(new GameMapImpl(96, 64, terrain, terrain.length), {
    seed: 47,
    aiCount: 2,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  match.players[1].name = "Blue Bay";
  match.players[2].name = "Moss Dominion";
  const root = document.createElement("div");
  root.innerHTML = `${empireMarkup()}<main class="battlefield">${hudMarkup()}</main>`;
  document.body.replaceChildren(root);
  const inspect = vi.fn();
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
    inspect,
  );
  const update = () =>
    view.update(
      new EmpireViewModel(match.snapshot(), {
        selected: new Set(),
        selectedShips: new Set(),
        selectedBuilding: null,
      }),
    );
  const messages = () =>
    [...root.querySelectorAll(".feed-event span")].map((e) => e.textContent);
  const action = (
    playerId: number,
    otherId: number,
    value: "offer" | "accept" | "reject" | "renew" | "break",
  ) => {
    expect(
      match.applyCommand({
        type: "alliance",
        playerId,
        otherId,
        action: value,
      }),
    ).toBeNull();
    update();
  };
  return { match, root, view, update, messages, action, inspect };
}

describe("world alliance logger", () => {
  it("announces AI-to-AI offers, formations and breakups once and keeps faction inspection working", () => {
    const f = fixture();
    f.action(2, 3, "offer");
    f.action(3, 2, "accept");
    expect(f.messages()).toEqual([
      "Blue Bay offered an alliance to Moss Dominion",
      "Moss Dominion formed an alliance with Blue Bay",
    ]);
    f.update();
    expect(f.messages()).toHaveLength(2);
    f.root.querySelector<HTMLButtonElement>('[data-feed-player="3"]')!.click();
    expect(f.inspect).toHaveBeenCalledWith(3);
    f.action(2, 3, "break");
    expect(f.messages().slice(-1)[0]).toBe(
      "Blue Bay broke the alliance with Moss Dominion",
    );
    f.view.reset();
    expect(f.messages()).toHaveLength(0);
  });

  it("logs AI-to-AI rejections, reciprocal acceptance, renewal and expiration", () => {
    const f = fixture();
    f.action(2, 3, "offer");
    f.action(3, 2, "reject");
    expect(f.messages().slice(-1)[0]).toBe(
      "Moss Dominion declined an alliance with Blue Bay",
    );
    f.match.tick = 600;
    f.action(2, 3, "offer");
    f.action(3, 2, "offer");
    expect(f.messages().slice(-1)[0]).toBe(
      "Moss Dominion formed an alliance with Blue Bay",
    );
    const treaty = f.match.expansion!.diplomacy.state.alliances[0];
    f.match.tick = treaty.expiresTick - 100;
    f.action(2, 3, "renew");
    f.action(3, 2, "renew");
    expect(f.messages().slice(-2)).toEqual([
      "Blue Bay requested alliance renewal with Moss Dominion",
      "Moss Dominion requested alliance renewal with Blue Bay",
    ]);
    f.match.tick = treaty.expiresTick;
    f.match.expansion!.beforeStep();
    f.update();
    expect(f.messages().slice(-1)[0]).toBe(
      "Moss Dominion ended its alliance with Blue Bay",
    );
    const count = f.messages().length;
    f.match.expansion!.beforeStep();
    f.update();
    expect(f.messages()).toHaveLength(count);
  });
});
