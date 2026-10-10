import { FIXED } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";

export interface VelocityNeighbor {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  initial: number;
  minimumSquared: number;
  moving: boolean;
}

// Reciprocal velocity-obstacle half-planes (van den Berg et al., ORCA).
// Intersect the speed circle with incremental half-planes, choosing the nearest
// requested velocity. Held units take no responsibility for yielding. The
// caller still owns exact terrain and integer swept-collision validation.
export class CrowdVelocity {
  private readonly lines: { nx: number; ny: number; boundary: number }[] = [];

  solve(
    desired: WorldPoint,
    current: WorldPoint,
    neighbors: readonly VelocityNeighbor[],
    count: number,
    horizon: number,
  ): WorldPoint | null {
    const speed = Math.hypot(desired.x, desired.y);
    if (!speed) return { x: 0, y: 0 };
    const lines = this.lines;
    let passRight = false;
    for (let i = 0; i < count; i++) {
      const other = neighbors[i],
        px = -other.dx,
        py = -other.dy;
      if (
        other.moving &&
        other.initial < 16 * FIXED * FIXED &&
        desired.x * other.vx + desired.y * other.vy < 0 &&
        desired.x * px + desired.y * py > 0
      )
        passRight = true;
      const rvx = current.x - other.vx,
        rvy = current.y - other.vy;
      const radius = Math.sqrt(other.minimumSquared);
      let nx: number, ny: number, ux: number, uy: number;
      const inverseTime =
        other.initial > other.minimumSquared ? 1 / horizon : 1;
      const wx = rvx - px * inverseTime,
        wy = rvy - py * inverseTime;
      const lengthSquared = wx * wx + wy * wy,
        dot = wx * px + wy * py;
      if (
        other.initial <= other.minimumSquared ||
        (dot < 0 && dot * dot > other.minimumSquared * lengthSquared)
      ) {
        const length = Math.sqrt(lengthSquared);
        // Deterministic fallback for a zero relative velocity; no random jitter.
        nx = length ? wx / length : px ? -Math.sign(px) : 1;
        ny = length ? wy / length : 0;
        ux = (radius * inverseTime - length) * nx;
        uy = (radius * inverseTime - length) * ny;
      } else {
        const leg = Math.sqrt(
          Math.max(0, other.initial - other.minimumSquared),
        );
        const left = px * wy - py * wx > 0;
        const tx = left
          ? (px * leg - py * radius) / other.initial
          : -(px * leg + py * radius) / other.initial;
        const ty = left
          ? (px * radius + py * leg) / other.initial
          : -(-px * radius + py * leg) / other.initial;
        const projection = rvx * tx + rvy * ty;
        ux = projection * tx - rvx;
        uy = projection * ty - rvy;
        nx = -ty;
        ny = tx;
      }
      const responsibility = other.moving ? 0.5 : 1;
      const boundary =
        nx * (current.x + responsibility * ux) +
        ny * (current.y + responsibility * uy);
      const line = lines[i] ?? (lines[i] = { nx: 0, ny: 0, boundary: 0 });
      line.nx = nx;
      line.ny = ny;
      line.boundary = boundary;
    }
    const preference = passRight
      ? { x: desired.x - desired.y * 0.08, y: desired.y + desired.x * 0.08 }
      : desired;
    let result = this.closest(preference, speed, count, 0);
    if (!result) {
      // Dense jams can make reciprocal constraints incompatible. Minimize the
      // largest constraint violation, rather than sampling dozens of headings.
      // Exact swept validation remains mandatory after rounding the result.
      let low = 0,
        high = 0;
      for (let i = 0; i < count; i++) high = Math.max(high, lines[i].boundary);
      high += 1e-7;
      result = this.closest(preference, speed, count, high)!;
      for (let i = 0; i < 8; i++) {
        const middle = (low + high) / 2;
        const candidate = this.closest(preference, speed, count, middle);
        if (candidate) {
          high = middle;
          result = candidate;
        } else low = middle;
      }
    }
    return { x: Math.round(result.x), y: Math.round(result.y) };
  }

  private closest(
    desired: WorldPoint,
    speed: number,
    count: number,
    slack: number,
  ): WorldPoint | null {
    const magnitude = Math.hypot(desired.x, desired.y);
    const factor = magnitude > speed ? speed / magnitude : 1;
    const result = { x: desired.x * factor, y: desired.y * factor };
    const lines = this.lines;
    for (let i = 0; i < count; i++) {
      const { nx, ny } = lines[i],
        boundary = lines[i].boundary - slack;
      if (nx * result.x + ny * result.y >= boundary - 1e-7) continue;
      const discriminant = speed * speed - boundary * boundary;
      if (discriminant < 0) return null;
      const extent = Math.sqrt(discriminant);
      let low = -extent,
        high = extent;
      const lineX = nx * boundary,
        lineY = ny * boundary,
        tx = -ny,
        ty = nx;
      for (let j = 0; j < i; j++) {
        const previous = lines[j];
        const denominator = previous.nx * tx + previous.ny * ty;
        const numerator =
          previous.boundary - slack - previous.nx * lineX - previous.ny * lineY;
        if (Math.abs(denominator) < 1e-7) {
          if (numerator > 1e-7) return null;
        } else if (denominator > 0)
          low = Math.max(low, numerator / denominator);
        else high = Math.min(high, numerator / denominator);
        if (low > high) return null;
      }
      const along = Math.max(
        low,
        Math.min(high, desired.x * tx + desired.y * ty),
      );
      result.x = lineX + along * tx;
      result.y = lineY + along * ty;
    }
    return result;
  }
}
