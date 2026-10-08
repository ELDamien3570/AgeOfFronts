import type { GameMap } from "../../core/game/GameMap";
import { buildingFootprint } from "../BuildingFootprint";
import type { BuildingType } from "../Protocol";
import type { PreviewBounds } from "./PlacementPreview";

export interface CoverageRun {
  y: number;
  left: number;
  right: number;
}

/** Union occupied footprints, without accumulating opacity where placements overlap. */
export class PlacementCoverage {
  private differences = new Int32Array(0);

  runs(
    map: GameMap,
    anchors: readonly number[],
    type: BuildingType,
    viewport: PreviewBounds,
  ): CoverageRun[] {
    const left = Math.max(0, Math.floor(viewport.left));
    const top = Math.max(0, Math.floor(viewport.top));
    const right = Math.min(map.width(), Math.ceil(viewport.right));
    const bottom = Math.min(map.height(), Math.ceil(viewport.bottom));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0 || !anchors.length) return [];
    const stride = width + 1;
    const length = stride * height;
    if (this.differences.length < length)
      this.differences = new Int32Array(length);
    else this.differences.fill(0, 0, length);
    const shape = buildingFootprint(type);
    for (const tile of anchors) {
      const x = map.x(tile),
        y = map.y(tile);
      const start = Math.max(left, x) - left;
      const end = Math.min(right, x + shape.width) - left;
      if (start >= end) continue;
      for (
        let row = Math.max(top, y);
        row < Math.min(bottom, y + shape.height);
        row++
      ) {
        const offset = (row - top) * stride;
        this.differences[offset + start]++;
        this.differences[offset + end]--;
      }
    }
    const runs: CoverageRun[] = [];
    for (let row = 0; row < height; row++) {
      let count = 0,
        start = -1;
      for (let x = 0; x <= width; x++) {
        count += this.differences[row * stride + x];
        if (count > 0 && start < 0) start = x;
        if (count === 0 && start >= 0) {
          runs.push({ y: top + row, left: left + start, right: left + x });
          start = -1;
        }
      }
    }
    return runs;
  }
}
