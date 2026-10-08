// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { EmpireView, empireMarkup } from "../../src/skirmish/client/EmpireView";
import { EmpireViewModel } from "../../src/skirmish/client/EmpireViewModel";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import { TECHNOLOGIES } from "../../src/skirmish/content/Technology";
import { UNITS } from "../../src/skirmish/content/Units";
import { AGES } from "../../src/skirmish/domain/Definitions";

afterEach(() => document.body.replaceChildren());
describe("six-class recruitment controls", () => {
  it.each(AGES)(
    "exposes each researched class in %s and dispatches specialist recruitment",
    (age) => {
      const data = new Uint8Array(64 * 64).fill(133);
      const m = new Skirmish(new GameMapImpl(64, 64, data, data.length), {
        seed: 42,
        aiCount: 1,
        tribes: false,
        runAi: false,
        ruleset: "ages-v1",
        startingAge: age,
      });
      const p = m.players[0],
        state = m.expansion!.progression.states[p.id];
      state.completed = TECHNOLOGIES.filter(
        (t) => AGES.indexOf(t.age) <= AGES.indexOf(age),
      ).map((t) => t.id);
      p.gold = 1000000;
      p.reserves = 100000;
      const troops = UNITS.filter((u) => u.age === age && u.troopClass);
      for (const u of troops) {
        Object.assign(
          m.expansion!.supply.inventories[p.id],
          Object.fromEntries(
            Object.keys(u.cost.items ?? {}).map((id) => [id, 10000]),
          ),
        );
        m.addBuilding({
          id: m.allocateId(),
          playerId: p.id,
          type: u.building,
          tile: p.base,
          remainingTicks: 0,
          age,
        });
      }
      const root = document.body.appendChild(document.createElement("div"));
      root.innerHTML =
        empireMarkup() + `<main class="battlefield">${hudMarkup()}</main>`;
      const view = new EmpireView(root, {
        refresh: () => {},
        command: (c) => {
          expect(m.applyCommand(c)).toBeNull();
        },
        build: () => {},
        notify: () => {},
        focusedRef: () => null,
        target: () => {},
      });
      view.update(
        new EmpireViewModel(m.snapshot(), {
          selected: new Set(),
          selectedShips: new Set(),
          selectedBuilding: null,
        }),
      );
      for (const u of troops) {
        const primary = [
          "frontline",
          "rangedInfantry",
          "lightCavalry",
        ].includes(u.troopClass!);
        const button = root.querySelector<HTMLButtonElement>(
          primary
            ? `#recruit-${u.line}`
            : `[data-dock-action="support"][data-value="${u.id}"]`,
        )!;
        expect(button, u.name).not.toBeNull();
        expect(button.disabled, u.name).toBe(false);
        if (primary) expect(button.dataset.definition).toBe(u.id);
        else {
          button.click();
          expect(m.recruitment.jobs.some((j) => j.definitionId === u.id)).toBe(
            true,
          );
        }
      }
    },
  );
});
