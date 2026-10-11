// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { Skirmish } from "../../src/skirmish/Simulation";
import { hudMarkup } from "../../src/skirmish/client/HudView";
import type { Renderer } from "../../src/skirmish/client/Renderer";
import { installTroopPresentation } from "../../src/skirmish/client/troops/TroopPresentation";
import { UNIT } from "../../src/skirmish/content/Units";
import { createFormation } from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
vi.mock("../../src/skirmish/client/troops/TroopActors", () => ({
  TroopActors: class {
    setDetailed() {
      return false;
    }
    clear() {}
    prune() {}
    beginFrame() {}
    isLoaded() {
      return false;
    }
  },
}));
describe("authoritative formation controls", () => {
  it("sends the real shape command and displays only the resulting authoritative choice", () => {
    const terrain = new Uint8Array(48 * 48).fill(133),
      game = new Skirmish(new GameMapImpl(48, 48, terrain, terrain.length), {
        seed: 42,
        aiCount: 1,
        runAi: false,
        tribes: false,
        ruleset: "ages-v1",
      });
    const squad = game.squads.find((s) => s.playerId === 1)!,
      unit = UNIT.get("bronzeage-infantry")!;
    game.updateSquad(squad.id, {
      definitionId: unit.id,
      kind: unit.line,
      troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit),
      formation: createFormation(unit.id),
    });
    document.body.innerHTML = hudMarkup();
    const renderer = {
      selected: new Set([squad.id]),
      pixelsPerCell: 12,
      groundElevationAt: () => 0,
    } as unknown as Renderer;
    const send = vi.fn((command) =>
      expect(game.applyCommand(command)).toBeNull(),
    );
    const presentation = installTroopPresentation(renderer, send);
    presentation.update(game.snapshot());
    presentation.endFrame(200, 0);
    const button = document.querySelector<HTMLButtonElement>(
      '[data-shape="shield-wall"]',
    )!;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    expect(send).toHaveBeenCalledWith({
      type: "formation",
      playerId: 1,
      squadIds: [squad.id],
      shape: "shield-wall",
    });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    presentation.update(game.snapshot());
    presentation.endFrame(400, 0);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.disabled).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[data-shape="modern-loose"]')!
        .disabled,
    ).toBe(true);
  });
});
