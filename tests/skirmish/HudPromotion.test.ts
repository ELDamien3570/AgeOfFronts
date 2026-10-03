import { expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import { SkirmishViewModel } from "../../src/skirmish/client/SkirmishViewModel";
import { VESSEL } from "../../src/skirmish/content/Units";
import { Skirmish } from "../../src/skirmish/Simulation";

it("projects current fleet promotions and avoids a false uniform aggregate", () => {
  const data = new Uint8Array(64 * 32).fill(133);
  const match = new Skirmish(new GameMapImpl(64, 32, data, data.length), {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const def = VESSEL.get("stoneage-warship")!;
  [0, 20000].forEach(xp => match.addShip({
      id: match.allocateId(),
      playerId: 1,
      kind: "warship" as const,
      definitionId: def.id,
      xp,
      x: 1000,
      y: 1000,
      health: def.health,
      destination: null,
      waypoints: [],
      path: [],
      nextPathIndex: 0,
      fighting: false,
      boarding: null,
    }));
  const selection = {
    selected: new Set<number>(),
    selectedShips: new Set(match.ships.map((s) => s.id)),
    selectedBuilding: null,
  };
  const model = () =>
    new HudViewModel(new SkirmishViewModel(match.snapshot(), selection));
  expect(model().selectionCard(null).mode).toBe("mixed");
  const attack = (id: number) =>
    model()
      .entities.find((e) => e.ref === `ship:${id}`)!
      .stats.find((s) => s.label === "Attack")!.value;
  expect(attack(match.ships[0].id)).toBe(String(def.attack!.damage));
  expect(attack(match.ships[1].id)).toBe(
    String(Math.floor(def.attack!.damage * 1.2)),
  );
  match.updateShip(match.ships[0].id, { xp: 20000 });
  const group = model().selectionCard(null);
  expect(group.mode).toBe("group");
  if (group.mode === "group")
    expect(group.card.meter).toMatchObject({
      value: def.health * 2,
      max: def.health * 2,
    });
});
