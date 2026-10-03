import { describe, expect, it } from "vitest";
import { buildingOwner } from "./BuildingFixtures";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { HudViewModel } from "../../src/skirmish/client/HudViewModel";
import {
  SkirmishViewModel,
  type SelectionState,
} from "../../src/skirmish/client/SkirmishViewModel";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";

function setup() {
  const terrain = new Uint8Array(80 * 50).fill(133);
  const match = new Skirmish(new GameMapImpl(80, 50, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    runAi: false,
  });
  const snapshot = match.snapshot();
  const buildings = buildingOwner(snapshot.buildings);
  snapshot.buildings = [...buildings.values];
  const selection: SelectionState = {
    selected: new Set(),
    selectedShips: new Set(),
    selectedBuilding: null,
  };
  const vm = () => new HudViewModel(new SkirmishViewModel(snapshot, selection));
  const own = snapshot.squads.filter((s) => s.playerId === 1);
  return { snapshot, selection, vm, own, buildings };
}
describe("snapshot-driven HUD selection", () => {
  it("hides an empty selection and shows real troop health for a single squad", () => {
    const { selection, vm, own } = setup();
    expect(vm().selectionCard(null).mode).toBe("empty");
    own[0].troops = 640;
    selection.selected.add(own[0].id);
    const card = vm().selectionCard(null);
    expect(card.mode).toBe("detail");
    if (card.mode !== "detail") throw new Error("Expected detail");
    expect(card.card.meter).toEqual({
      label: "Troop strength",
      value: 640,
      max: 1000,
    });
    expect(card.card.count).toBe(1);
  });
  it("aggregates same-type health and count without merging units or orders", () => {
    const { snapshot, selection, vm, own } = setup();
    own[0].troops = 640;
    own[1].troops = 810;
    own[1].order = { type: "move", tile: 20 };
    selection.selected = new Set([own[0].id, own[1].id]);
    const before = structuredClone(snapshot);
    const card = vm().selectionCard(null);
    expect(card.mode).toBe("group");
    if (card.mode !== "group") throw new Error("Expected group");
    expect(card.card.count).toBe(2);
    expect(card.card.subtitle).toBe("2 squads selected");
    expect(card.card.meter?.value).toBe(1450);
    expect(card.card.meter?.max).toBe(2000);
    expect(card.card.status).toBe("Multiple orders");
    expect(snapshot).toEqual(before);
  });
  it("uses individual mixed cells and inspects one without changing the selected army", () => {
    const { selection, vm, own, snapshot } = setup();
    own[1].kind = "archer";
    selection.selected = new Set([own[0].id, own[1].id]);
    const before = new Set(selection.selected);
    expect(vm().selectionCard(null).mode).toBe("mixed");
    const focused = vm().selectionCard(`squad:${own[1].id}`);
    expect(focused.mode).toBe("detail");
    if (focused.mode !== "detail") throw new Error("Expected detail");
    expect(focused.card.kind).toBe("archer");
    expect(focused.entities.length).toBe(2);
    expect(selection.selected).toEqual(before);
    snapshot.squads = snapshot.squads.filter((s) => s.id !== own[1].id);
    expect(vm().selectionCard(`squad:${own[1].id}`).entities.length).toBe(1);
  });
  it("projects a 200-squad army with current health, selection and order stats", () => {
    const { selection, vm, own, snapshot } = setup();
    snapshot.squads = Array.from({ length: 200 }, (_, index) => ({
      ...own[0],
      id: 1000 + index,
      troops: 750,
      queuedOrders: [],
    }));
    selection.selected = new Set(snapshot.squads.map((s) => s.id));
    const hud = vm();
    const group = hud.selectionCard(null);
    if (group.mode !== "group") throw new Error("Expected group");
    expect(group.card.count).toBe(200);
    expect(group.card.meter?.value).toBe(150000);
    snapshot.squads[0].kind = "archer";
    snapshot.squads[0].troops = 250;
    snapshot.squads[0].queuedOrders.push({ type: "move", tile: 20 });
    const current = hud.entities;
    expect(hud.selectionCard(null, current).mode).toBe("mixed");
    const detail = hud.selectionCard("squad:1000", current);
    if (detail.mode !== "detail") throw new Error("Expected detail");
    expect(detail.card.meter?.value).toBe(250);
    expect(
      detail.card.stats.find((s) => s.label === "Queued orders")?.value,
    ).toBe("1");
    expect(
      detail.card.stats.find((s) => s.label === "Volley damage")?.value,
    ).toBe("25");
    selection.selected.delete(1000);
    expect(hud.selectionCard(null).entities).toHaveLength(199);
    expect(
      hud
        .actionCard("recruit-infantry")
        ?.stats.some((s) => s.label === "Recruitment"),
    ).toBe(true);
  });
  it("excludes enemy and embarked squads even if stale IDs remain selected", () => {
    const { selection, vm, own, snapshot } = setup();
    own[0].embarkedOn = 999;
    selection.selected = new Set([
      own[0].id,
      snapshot.squads.find((s) => s.playerId === 2)!.id,
    ]);
    expect(vm().selectionCard(null).mode).toBe("empty");
  });
  it("aggregates ship hulls and reports actual transport cargo in individual inspection", () => {
    const { selection, vm, own, snapshot } = setup();
    snapshot.ships = [1, 2].map((id) => ({
      id,
      playerId: 1,
      kind: "transport",
      x: FIXED,
      y: FIXED,
      health: 450,
      destination: null,
      waypoints: [],
      fighting: false,
      boarding: null,
    }));
    own[0].embarkedOn = 1;
    selection.selectedShips = new Set([1, 2]);
    const group = vm().selectionCard(null);
    expect(group.mode).toBe("group");
    if (group.mode !== "group") throw new Error("Expected group");
    expect(group.card.meter).toEqual({
      label: "Hull health",
      value: 900,
      max: 1200,
    });
    const solo = vm().selectionCard("ship:1");
    if (solo.mode !== "detail") throw new Error("Expected detail");
    expect(
      solo.card.stats.find((s) => s.label === "Squads aboard")?.value,
    ).toBe("1");
    expect(selection.selectedShips.size).toBe(2);
  });
  it("shows building construction and ownership without inventing building health", () => {
    const { selection, vm, snapshot, buildings } = setup();
    const building = snapshot.buildings.find((b) => b.playerId === 2)!;
    buildings.update(building.id, { type: "city" });
    buildings.update(building.id, { remainingTicks: 40 });
    selection.selectedBuilding = building.id;
    const result = vm().selectionCard(null);
    if (result.mode !== "detail") throw new Error("Expected detail");
    expect(result.card.subtitle).toBe("Enemy building");
    expect(result.card.meter).toEqual({
      label: "Construction",
      value: 120,
      max: 160,
    });
    expect(
      result.card.stats.find((s) => s.label === "Reserve income")?.value,
    ).toBe("+40 / sec");
    buildings.update(building.id, { remainingTicks: 0 });
    const ready = vm().selectionCard(null);
    if (ready.mode !== "detail") throw new Error("Expected detail");
    expect(ready.card.meter).toBeUndefined();
    expect(ready.card.status).toBe("Ready");
  });
});
describe("HUD action costs and availability", () => {
  it("keeps costs and stats visible for blocked recruitment and unaffordable buildings", () => {
    const { snapshot, vm } = setup();
    snapshot.players[0].reserves = 500;
    expect(vm().actionCard("recruit-infantry")?.status).toContain(
      "1,000 reserve",
    );
    const ranged = vm().actionCard("recruit-archer")!;
    expect(ranged.status).toContain("archery range");
    expect(ranged.stats.find((s) => s.label === "Volley damage")?.value).toBe(
      "25",
    );
    expect(ranged.stats.find((s) => s.label === "Moving volley")?.value).toBe(
      "5 sec",
    );
    snapshot.players[0].gold = 0;
    expect(vm().actionCard("build-city")?.status).toBe("Not enough gold");
    expect(
      vm()
        .actionCard("build-city")
        ?.stats.find((s) => s.label === "Construction cost")?.value,
    ).toBe("800 gold");
    expect(
      vm()
        .actionCard("warship")
        ?.stats.find((s) => s.label === "Recruitment")?.value,
    ).toBe("700 gold");
  });
  it("reports replenishment only for eligible selected squads", () => {
    const { snapshot, selection, own, vm } = setup();
    own[0].troops = 500;
    snapshot.owners[
      Math.floor(own[0].y / FIXED) * snapshot.width +
        Math.floor(own[0].x / FIXED)
    ] = 1;
    selection.selected.add(own[0].id);
    expect(vm().actionCard("replenish")?.status).toBe("Ready");
    snapshot.players[0].reserves = 0;
    expect(vm().actionCard("replenish")?.status).toContain(
      "available reserves",
    );
  });

  it("reports building repair when buildings are selected", () => {
    const { snapshot, selection, vm, buildings } = setup();
    const building = snapshot.buildings[0];
    buildings.update(building.id, { playerId: 1 });
    buildings.update(building.id, { health: 600 });
    buildings.update(building.id, { maxHealth: 1200 });
    buildings.update(building.id, { remainingTicks: 0 });
    selection.selectedBuilding = building.id;

    const card = vm().actionCard("replenish");
    expect(card?.title).toBe("Repair selected buildings");
    expect(card?.subtitle).toContain("structure repair");
    expect(card?.status).toBe("Ready");

    buildings.update(building.id, { health: 1200 });
    expect(vm().actionCard("replenish")?.status).toBe("No repair needed");
  });
});
