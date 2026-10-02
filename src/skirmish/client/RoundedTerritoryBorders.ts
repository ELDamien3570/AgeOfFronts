import type { BorderEdge } from "./TerritoryBorders";

export const TERRITORY_CORNER_RADIUS = 0.28;
type OwnerAt = (x: number, y: number) => number;
type BorderPath = Pick<Path2D, "moveTo" | "lineTo" | "quadraticCurveTo">;

function corner(x: number, y: number, ux: number, uy: number, at: OwnerAt) {
  const nw = at(x - 1, y - 1),
    ne = at(x, y - 1);
  const sw = at(x - 1, y),
    se = at(x, y);
  const incident: [number, number][] = [];
  if (nw !== ne) incident.push([0, -1]);
  if (ne !== se) incident.push([1, 0]);
  if (sw !== se) incident.push([0, 1]);
  if (nw !== sw) incident.push([-1, 0]);
  // Keep junctions, diagonal contacts and straight lines exactly on the grid.
  if (incident.length !== 2) return null;
  const other = incident.find(([vx, vy]) => vx !== ux || vy !== uy)!;
  if (ux * other[0] + uy * other[1] !== 0) return null;
  const r = TERRITORY_CORNER_RADIUS;
  return {
    near: [x + ux * r, y + uy * r],
    control: [x + (ux * r) / 2, y + (uy * r) / 2],
    midpoint: [x + ((ux + other[0]) * r) / 4, y + ((uy + other[1]) * r) / 4],
  };
}

// Each canonical edge owns half of its adjoining corner. Adjacent chunks use
// the same four-owner neighborhood, producing identical endpoints and tangents.
export function roundedBorderEdge(
  path: BorderPath,
  edge: BorderEdge,
  at: OwnerAt,
): void {
  const { x1, y1, x2, y2 } = edge;
  const start = corner(x1, y1, x2 - x1, y2 - y1, at);
  const end = corner(x2, y2, x1 - x2, y1 - y2, at);
  if (start) {
    path.moveTo(start.midpoint[0], start.midpoint[1]);
    path.quadraticCurveTo(
      start.control[0],
      start.control[1],
      start.near[0],
      start.near[1],
    );
  } else path.moveTo(x1, y1);
  path.lineTo(end?.near[0] ?? x2, end?.near[1] ?? y2);
  if (end)
    path.quadraticCurveTo(
      end.control[0],
      end.control[1],
      end.midpoint[0],
      end.midpoint[1],
    );
}
