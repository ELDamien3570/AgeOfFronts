import { describe, expect, it } from "vitest";
import {
  roundedBorderEdge,
  TERRITORY_CORNER_RADIUS,
} from "../../src/skirmish/client/RoundedTerritoryBorders";
import type { BorderEdge } from "../../src/skirmish/client/TerritoryBorders";

function trace(owners: number[], edge: BorderEdge) {
  const operations: { kind: string; values: number[] }[] = [];
  const path = {
    moveTo: (...values: number[]) => {
      operations.push({ kind: "move", values });
    },
    lineTo: (...values: number[]) => {
      operations.push({ kind: "line", values });
    },
    quadraticCurveTo: (...values: number[]) => {
      operations.push({ kind: "curve", values });
    },
  };
  roundedBorderEdge(path, edge, (x, y) =>
    x < 0 || y < 0 || x >= 2 || y >= 2 ? 0 : owners[y * 2 + x],
  );
  return operations;
}

describe("closely rounded territory outlines", () => {
  it("joins the two halves of a corner at the same point within a tenth of a tile", () => {
    const horizontal = trace([1, 0, 0, 0], { x1: 0, y1: 1, x2: 1, y2: 1 });
    const vertical = trace([1, 0, 0, 0], { x1: 1, y1: 0, x2: 1, y2: 1 });
    const h = horizontal[horizontal.length - 1].values.slice(-2);
    const v = vertical[vertical.length - 1].values.slice(-2);
    expect(h).toEqual(v);
    expect(Math.hypot(h[0] - 1, h[1] - 1)).toBeLessThan(0.1);
    expect(horizontal[1].values.slice(-2)).toEqual([
      TERRITORY_CORNER_RADIUS,
      1,
    ]);
  });
  it("preserves three-country junctions and diagonal contacts without connecting territories", () => {
    for (const owners of [
      [1, 1, 2, 3],
      [1, 2, 2, 1],
    ]) {
      const operations = trace(owners, { x1: 1, y1: 1, x2: 1, y2: 2 });
      expect(operations[0]).toEqual({ kind: "move", values: [1, 1] });
    }
  });
  it("leaves the middle of a straight international boundary on its tile edge", () => {
    const operations = trace([1, 2, 1, 2], { x1: 1, y1: 0, x2: 1, y2: 1 });
    expect(operations).toEqual([
      { kind: "move", values: [1, 0] },
      { kind: "line", values: [1, 1] },
    ]);
  });
});
