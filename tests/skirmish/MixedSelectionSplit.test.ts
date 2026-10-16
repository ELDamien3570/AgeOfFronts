import { describe, expect, it } from "vitest";
import { splitMoveSelection } from "../../src/skirmish/client/MixedSelectionSplit";

const squad = (id: number, extra: Partial<{ troops: number; embarkedOn: number | null }> = {}) =>
  ({ id, troops: 100, embarkedOn: null, refit: undefined, manpower: undefined, ...extra });
const squads = [1, 2, 3, 4, 5, 6, 7].map(id => squad(id)).concat([squad(8, { embarkedOn: 99 })]);
const armies = [{ id: 20, memberIds: [3, 4] }, { id: 10, memberIds: [5, 6, 8] }];

describe("client split of mixed army moves (D4)", () => {
  it("sends each whole army and the loose squads as separate moves", () => {
    expect(splitMoveSelection([1, 2, 3, 4, 5, 6], armies, squads)).toEqual({ groups: [[5, 6], [3, 4], [1, 2]], partial: [] });
  });
  it("keeps a lone whole army or only loose squads as one move", () => {
    expect(splitMoveSelection([3, 4], armies, squads)).toEqual({ groups: [[3, 4]], partial: [] });
    expect(splitMoveSelection([1, 7], armies, squads)).toEqual({ groups: [[1, 7]], partial: [] });
  });
  it("leaves part of an army apart for the server's translated rejection", () => {
    expect(splitMoveSelection([1, 3], armies, squads)).toEqual({ groups: [[1]], partial: [3] });
  });
  it("orders an army whose missing member cannot move (embarked) as a whole army", () => {
    expect(splitMoveSelection([5, 6, 8], armies, squads)).toEqual({ groups: [[5, 6]], partial: [] });
  });
});
