import { FIXED } from "./Protocol";
import type { WorldPoint } from "./SpatialGrid";

export interface DeploymentLine {
  start: WorldPoint;
  end: WorldPoint;
}
export interface LineMember {
  id: number;
  origin: WorldPoint;
}
export interface LineDeployment {
  start: WorldPoint;
  end: WorldPoint;
  facing: number;
  slots: Map<number, WorldPoint>;
}
/** Shared preview/domain geometry. Coordinates are fixed world units, not pixels.
 * Projection order avoids unnecessary lateral crossings and is ID-stable on ties. */
export function deploymentLine(
  members: readonly LineMember[],
  line: DeploymentLine,
): LineDeployment | undefined {
  const dx = line.end.x - line.start.x,
    dy = line.end.y - line.start.y;
  const length = Math.hypot(dx, dy);
  if (!members.length || !Number.isFinite(length) || length < 1)
    return undefined;
  const ux = dx / length,
    uy = dy / length;
  const width = Math.max(length, (members.length - 1) * 2.75 * FIXED);
  const center = {
    x: (line.start.x + line.end.x) / 2,
    y: (line.start.y + line.end.y) / 2,
  };
  const start = {
    x: Math.round(center.x - (ux * width) / 2),
    y: Math.round(center.y - (uy * width) / 2),
  };
  const end = {
    x: Math.round(center.x + (ux * width) / 2),
    y: Math.round(center.y + (uy * width) / 2),
  };
  const facing =
    Math.round(
      Math.atan2(
        Math.sin(Math.atan2(-ux, uy) - Math.PI / 2),
        Math.cos(Math.atan2(-ux, uy) - Math.PI / 2),
      ) * 1e6,
    ) / 1e6;
  const sorted = [...members].sort(
    (a, b) =>
      (a.origin.x - b.origin.x) * ux + (a.origin.y - b.origin.y) * uy ||
      a.id - b.id,
  );
  const slots = new Map<number, WorldPoint>();
  sorted.forEach((member, index) => {
    const t = members.length === 1 ? 0.5 : index / (members.length - 1);
    slots.set(member.id, {
      x: Math.round(start.x + (end.x - start.x) * t),
      y: Math.round(start.y + (end.y - start.y) * t),
    });
  });
  return { start, end, facing, slots };
}

/** Translate an already deployed layout without regenerating its width or assignments. */
export function translatedDeployment(
  members: readonly (LineMember & { facing?: number })[],
  target: WorldPoint,
): LineDeployment | undefined {
  const facing = members[0]?.facing;
  if (
    facing === undefined ||
    !members.every(
      (m) =>
        m.facing !== undefined &&
        Math.abs(
          Math.atan2(Math.sin(m.facing - facing), Math.cos(m.facing - facing)),
        ) < 1e-6,
    )
  )
    return undefined;
  const center = {
    x: members.reduce((sum, m) => sum + m.origin.x, 0) / members.length,
    y: members.reduce((sum, m) => sum + m.origin.y, 0) / members.length,
  };
  const slots = new Map(
    members.map((m) => [
      m.id,
      {
        x: Math.round(target.x + m.origin.x - center.x),
        y: Math.round(target.y + m.origin.y - center.y),
      },
    ]),
  );
  const ux = -Math.cos(facing),
    uy = -Math.sin(facing);
  const projections = members.map(
    (m) => (m.origin.x - center.x) * ux + (m.origin.y - center.y) * uy,
  );
  const halfWidth = Math.max(
    1,
    (Math.max(...projections) - Math.min(...projections)) / 2,
  );
  return {
    facing,
    slots,
    start: {
      x: Math.round(target.x - ux * halfWidth),
      y: Math.round(target.y - uy * halfWidth),
    },
    end: {
      x: Math.round(target.x + ux * halfWidth),
      y: Math.round(target.y + uy * halfWidth),
    },
  };
}
