import type { GameMap } from "../../core/game/GameMap";
import { elevationOf } from "../Elevation";

/** Sample authored metres at a member's ground anchor in map-cell coordinates.
 * Cell-centred interpolation avoids artificial steps at tile boundaries. Maps
 * without authored elevation stay flat; terrain artwork never invents height. */
export function soldierTerrainElevation(map: GameMap): (x: number, y: number) => number {
  const heights = elevationOf(map);
  if (!heights) return () => 0;
  const width = map.width(), height = map.height();
  return (x, y) => {
    const cx = Math.max(0, Math.min(width - 1, x - .5));
    const cy = Math.max(0, Math.min(height - 1, y - .5));
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const tx = cx - x0, ty = cy - y0;
    const a = heights.heightAt(y0 * width + x0), b = heights.heightAt(y0 * width + x1);
    const c = heights.heightAt(y1 * width + x0), d = heights.heightAt(y1 * width + x1);
    const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
    return top + (bottom - top) * ty;
  };
}
