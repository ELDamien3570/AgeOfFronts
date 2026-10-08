import { describe, expect, it } from "vitest";
import { applyDragSelection, limitSquadSelection } from "../../src/skirmish/client/SquadSelectionViewModel";
import { ControlGroups } from "../../src/skirmish/client/ControlGroups";
import type { Snapshot } from "../../src/skirmish/Protocol";

const squads = Array.from({ length: 80 }, (_, i) => ({
  id: i + 1, troops: (i + 1) * 10, playerId: 1, embarkedOn: null,
}));
describe("30-squad selection policy", () => {
  const selection = () => ({ selected: new Set<number>(), selectedShips: new Set<number>(), selectedAircraft: new Set<number>() });
  it("normal drag selects only soldiers even when boats could fill unused slots", () => {
    const selected = selection();
    const ids = squads.slice(0, 20).map(s => s.id);
    applyDragSelection(selected, { squads: ids, ships: [101, 102], aircraft: [201] }, false);
    expect([...selected.selected]).toEqual(ids);
    expect(selected.selectedShips.size).toBe(0);
    expect(selected.selectedAircraft.size).toBe(0);
  });
  it("normal drag falls back to boats when it finds no soldiers", () => {
    const selected = selection();
    applyDragSelection(selected, { squads: [], ships: [101, 102], aircraft: [] }, false);
    expect([...selected.selectedShips]).toEqual([101, 102]);
    expect(selected.selected.size).toBe(0);
  });
  it("shift drag adds boats while clearing previously selected soldiers and aircraft", () => {
    const selected = selection();
    selected.selected.add(1);
    selected.selectedAircraft.add(201);
    selected.selectedShips.add(101);
    applyDragSelection(selected, { squads: [2], ships: [102], aircraft: [202] }, true);
    expect([...selected.selectedShips]).toEqual([101, 102]);
    expect(selected.selected.size).toBe(0);
    expect(selected.selectedAircraft.size).toBe(0);
    applyDragSelection(selected, { squads: [3], ships: [], aircraft: [] }, true);
    expect(selected.selected.size).toBe(0);
    expect([...selected.selectedShips]).toEqual([101, 102]);
  });
  it("keeps aircraft-only ordinary drag available and applies the squad cap to mixed boxes", () => {
    const selected = selection();
    applyDragSelection(selected, { squads: [], ships: [], aircraft: [201] }, false);
    expect([...selected.selectedAircraft]).toEqual([201]);
    applyDragSelection(selected, { squads: squads.map(s => s.id), ships: [101], aircraft: [201] }, false);
    limitSquadSelection(selected.selected, squads, 1);
    expect(selected.selected.size).toBe(30);
    expect(selected.selectedShips.size).toBe(0);
    expect(selected.selectedAircraft.size).toBe(0);
  });
  it("keeps the 30 largest squads out of an 80-squad gesture", () => {
    const selected = new Set(squads.map(s => s.id));
    limitSquadSelection(selected, squads, 1);
    expect([...selected]).toEqual(squads.slice(50).map(s => s.id));
  });
  it("uses stable ties and caps successive additive selections", () => {
    const equal = squads.map(s => ({ ...s, troops: 1000 }));
    const selected = new Set(equal.slice(0, 25).map(s => s.id));
    limitSquadSelection(selected, equal, 1);
    expect(selected.size).toBe(25);
    for (const squad of equal.slice(25).reverse()) selected.add(squad.id);
    limitSquadSelection(selected, equal, 1);
    expect([...selected].sort((a, b) => a - b)).toEqual(equal.slice(0, 30).map(s => s.id));
  });
  it("excludes enemy and embarked squads when reducing oversized selections", () => {
    const unavailable = squads.map(s => ({...s,
      playerId: s.id > 70 ? 2 : 1, embarkedOn: s.id > 60 ? 99 : null }));
    const selected = new Set(squads.map(s => s.id));
    limitSquadSelection(selected, unavailable, 1);
    expect([...selected]).toEqual(squads.slice(30, 60).map(s => s.id));
  });
  it("caps additive group binding and recall without capping ships", () => {
    const snapshot = { squads, ships: [], localPlayerId: 1 } as unknown as Snapshot;
    const groups = new ControlGroups();
    groups.bind(1, {selected: new Set(squads.slice(0, 25).map(s => s.id)), selectedShips: new Set()}, snapshot, false);
    groups.bind(1, {selected: new Set(squads.slice(25).map(s => s.id)), selectedShips: new Set()}, snapshot, true);
    expect(groups.count(1)).toBe(30);
    expect([...groups.recall(1, snapshot).selected]).toEqual(squads.slice(50).map(s => s.id));
  });
});
