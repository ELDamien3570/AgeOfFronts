import { describe, expect, it } from "vitest";
import { limitSquadSelection } from "../../src/skirmish/client/SquadSelectionViewModel";
import { ControlGroups } from "../../src/skirmish/client/ControlGroups";
import type { Snapshot } from "../../src/skirmish/Protocol";

const squads = Array.from({ length: 80 }, (_, i) => ({
  id: i + 1, troops: (i + 1) * 10, playerId: 1, embarkedOn: null,
}));
describe("30-squad selection policy", () => {
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
