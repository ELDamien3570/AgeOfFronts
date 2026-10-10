import { describe, expect, it } from "vitest";
import { TerritoryBorders } from "../../src/skirmish/client/TerritoryBorders";

function edges(owners: number[], width: number, height: number) {
  const values = new Uint8Array(owners);
  const borders = new TerritoryBorders(width, height);
  for (let tile = 0; tile < values.length; tile++)
    borders.updateTile(values, tile);
  return { values, borders };
}

describe("territory borders", () => {
  it("does not outline neutral land or internal edges of the same nation", () => {
    expect([...edges([0, 0], 2, 1).borders.segments]).toHaveLength(0);
    expect([...edges([1, 1], 2, 1).borders.segments]).toHaveLength(6);
  });
  it("outlines claimed land and draws each international border once", () => {
    const { borders } = edges([1, 2], 2, 1);
    const segments = [...borders.segments];
    expect(segments).toHaveLength(7);
    expect(
      segments.filter((edge) => edge.x1 === 1 && edge.x2 === 1),
    ).toHaveLength(1);
    expect([...edges([1, 0], 2, 1).borders.segments]).toHaveLength(4);
  });
  it("updates adjoining edges after capture, removes stale borders, and leaves unchanged topology cached", () => {
    const { borders, values } = edges([1, 2], 2, 1);
    values[1] = 1;
    expect(borders.updateTile(values, 1)).toBe(true);
    expect([...borders.segments]).toHaveLength(6);
    expect(borders.updateTile(values, 1)).toBe(false);
    values[0] = 0;
    borders.updateTile(values, 0);
    expect([...borders.segments]).toHaveLength(4);
    values[1] = 0;
    borders.updateTile(values, 1);
    expect([...borders.segments]).toHaveLength(0);
  });
});
