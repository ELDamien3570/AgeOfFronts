import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import type { CavalryAssault } from "../../domain/CavalryAssault";

type Point = { x: number; y: number };
type Member = Point & { id: number; angle: number };
export type AssaultPhase = "ready" | "approach" | "attack" | "turn" | "exit";
export interface AssaultRiderPose extends Member {
  phase: AssaultPhase;
  moving: boolean;
  turning: boolean;
  speed: number;
  gaitDistance: number;
}
const ASSAULT_PACE = 1.25;
/** Local visual motion, in tiles, seconds and radians. Combat never reads it.
 * Scale acceleration by pace squared to preserve braking distances and turn
 * radii while traversing the same paths 25% faster. Contact pauses are separate. */
export const ASSAULT_MOTION = Object.freeze({
  speed: 1.05 * ASSAULT_PACE,
  acceleration: 0.9 * ASSAULT_PACE ** 2,
  braking: 1.5 * ASSAULT_PACE ** 2,
  lateralAcceleration: 0.6 * ASSAULT_PACE ** 2,
  movingTurnRate: 1.1 * ASSAULT_PACE,
  pivotRate: 1.8 * ASSAULT_PACE,
  samples: 64,
});
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));
const angleDelta = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));
const smooth = (u: number) => {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
};
function noise(id: number, pass: number, stream: number): number {
  let n =
    (id ^
      Math.imul(pass + 1, 0x9e3779b9) ^
      Math.imul(stream + 1, 0x85ebca6b)) >>>
    0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function bezier(points: readonly Point[], progress: number) {
  const pieces = (points.length - 1) / 3,
    index = Math.min(pieces - 1, Math.floor(progress * pieces));
  const base = index * 3,
    p0 = points[base],
    p1 = points[base + 1],
    p2 = points[base + 2],
    p3 = points[base + 3],
    u = progress * pieces - index,
    v = 1 - u;
  const x =
    v * v * v * p0.x +
    3 * v * v * u * p1.x +
    3 * v * u * u * p2.x +
    u * u * u * p3.x;
  const y =
    v * v * v * p0.y +
    3 * v * v * u * p1.y +
    3 * v * u * u * p2.y +
    u * u * u * p3.y;
  const dx =
    3 * v * v * (p1.x - p0.x) +
    6 * v * u * (p2.x - p1.x) +
    3 * u * u * (p3.x - p2.x);
  const dy =
    3 * v * v * (p1.y - p0.y) +
    6 * v * u * (p2.y - p1.y) +
    3 * u * u * (p3.y - p2.y);
  const ddx =
    6 * v * (p2.x - 2 * p1.x + p0.x) + 6 * u * (p3.x - 2 * p2.x + p1.x);
  const ddy =
    6 * v * (p2.y - 2 * p1.y + p0.y) + 6 * u * (p3.y - 2 * p2.y + p1.y);
  const length = Math.hypot(dx, dy);
  return {
    x,
    y,
    angle: Math.atan2(dy, dx) - Math.PI / 2,
    parameterSpeed: length * pieces,
    curvature: length > 1e-7 ? Math.abs(dx * ddy - dy * ddx) / length ** 3 : 0,
  };
}
interface PathNode {
  u: number;
  distance: number;
  time: number;
  speed: number;
  parameterSpeed: number;
}
/** Arc-length motion with forward acceleration and backward braking passes.
 * Curvature limits both lateral acceleration and yaw rate before a tight turn,
 * rather than clamping the horse's orientation after it has already slid. */
export class CavalryRidePath {
  readonly nodes: readonly PathNode[];
  readonly duration: number;
  readonly length: number;
  constructor(
    private readonly points: readonly Point[],
    maximum: number = ASSAULT_MOTION.speed,
  ) {
    const count = (ASSAULT_MOTION.samples * (points.length - 1)) / 3;
    const samples = Array.from({ length: count + 1 }, (_, i) =>
      bezier(points, i / count),
    );
    // A joined cubic is C1, but its curvature can differ on either side.
    // Include both one-sided limits and interval midpoints in the speed cap.
    const curvature = samples.map((p, i) =>
      Math.max(
        p.curvature,
        ...[-0.5, -1e-5, 1e-5, 0.5].map(
          (offset) =>
            bezier(points, clamp((i + offset) / count, 0, 1)).curvature,
        ),
      ),
    );
    const nodes: PathNode[] = samples.map((p, i) => ({
      u: i / count,
      distance: i
        ? Math.hypot(p.x - samples[i - 1].x, p.y - samples[i - 1].y)
        : 0,
      time: 0,
      speed: 0,
      parameterSpeed: p.parameterSpeed,
    }));
    for (let i = 0; i < nodes.length; i++) {
      const k = Math.max(...curvature.slice(Math.max(0, i - 1), i + 2)) * 1.05;
      const limit = Math.min(
        maximum,
        k > 1e-6 ? Math.sqrt(ASSAULT_MOTION.lateralAcceleration / k) : maximum,
        k > 1e-6 ? ASSAULT_MOTION.movingTurnRate / k : maximum,
      );
      nodes[i].speed = i === 0 || i === nodes.length - 1 ? 0 : limit;
    }
    for (let i = 1; i < nodes.length; i++)
      nodes[i].speed = Math.min(
        nodes[i].speed,
        Math.sqrt(
          nodes[i - 1].speed ** 2 +
            2 * ASSAULT_MOTION.acceleration * nodes[i].distance,
        ),
      );
    for (let i = nodes.length - 2; i >= 0; i--)
      nodes[i].speed = Math.min(
        nodes[i].speed,
        Math.sqrt(
          nodes[i + 1].speed ** 2 +
            2 * ASSAULT_MOTION.braking * nodes[i + 1].distance,
        ),
      );
    for (let i = 1; i < nodes.length; i++) {
      const distance = nodes[i].distance;
      nodes[i].time =
        nodes[i - 1].time +
        (distance > 1e-8
          ? (2 * distance) / Math.max(1e-6, nodes[i - 1].speed + nodes[i].speed)
          : 0);
      nodes[i].distance += nodes[i - 1].distance;
    }
    this.nodes = nodes;
    this.duration = nodes[nodes.length - 1].time;
    this.length = nodes[nodes.length - 1].distance;
  }
  sample(seconds: number) {
    const t = clamp(seconds, 0, this.duration),
      nodes = this.nodes;
    let lo = 0,
      hi = nodes.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (nodes[mid].time < t) lo = mid;
      else hi = mid;
    }
    const a = nodes[lo],
      b = nodes[hi],
      dt = b.time - a.time,
      elapsed = t - a.time;
    const acceleration = dt ? (b.speed - a.speed) / dt : 0;
    const distance = a.speed * elapsed + (acceleration * elapsed * elapsed) / 2;
    const fraction =
      b.distance > a.distance
        ? clamp(distance / (b.distance - a.distance), 0, 1)
        : 1;
    // C1 inverse arc length: endpoint derivatives match the curve speed.
    // Linear u interpolation would introduce a small velocity jump per LUT row.
    const da = a.parameterSpeed,
      db = b.parameterSpeed;
    const length = b.distance - a.distance,
      q = fraction,
      q2 = q * q,
      q3 = q2 * q;
    const u =
      (2 * q3 - 3 * q2 + 1) * a.u +
      (-2 * q3 + 3 * q2) * b.u +
      (q3 - 2 * q2 + q) * (da > 1e-8 ? length / da : 0) +
      (q3 - q2) * (db > 1e-8 ? length / db : 0);
    return {
      ...bezier(this.points, clamp(u, a.u, b.u)),
      speed: Math.max(0, a.speed + acceleration * elapsed),
      distance: a.distance + distance,
    };
  }
}
interface Pass {
  geometry: CavalryAssault;
  start: number;
  ready: number;
  hold: number;
  arrive: number;
  turn: number;
  duration: number;
  fromAngle: number;
  strikeAngle: number;
  arriveAngle: number;
  exitAngle: number;
  approach: CavalryRidePath;
  exit: CavalryRidePath;
  gait: number;
  entry: Point & { angle: number };
  contact: Point & { angle: number };
}
function planPass(
  a: CavalryAssault,
  from: Member,
  start: number,
  serial: number,
  seed: number,
  gait: number,
): Pass {
  const id = (from.id ^ Math.imul(seed, 0x45d9f3b)) >>> 0;
  const random = (stream: number) => noise(id, serial, stream);
  const n = { x: a.nx, y: a.ny },
    t = { x: -a.ny, y: a.nx };
  const width = a.halfWidth / FIXED,
    reach = a.approach / FIXED;
  const local = (side: number, forward: number) => ({
    x: a.x / FIXED + t.x * side + n.x * forward,
    y: a.y / FIXED + t.y * side + n.y * forward,
  });
  const fromSide = (from.x - a.x / FIXED) * t.x + (from.y - a.y / FIXED) * t.y;
  const margin = Math.min(0.12, width * 0.12),
    space = Math.max(0, width - margin);
  const fromForward =
    (from.x - a.x / FIXED) * n.x + (from.y - a.y / FIXED) * n.y;
  const vanguard = serial === 0 && fromForward >= -Math.min(0.28, reach * 0.22);
  const lane = vanguard
    ? clamp(fromSide, -space, space)
    : clamp(fromSide * 0.2 + (random(0) * 2 - 1) * space * 0.9, -space, space);
  const depth = vanguard
    ? clamp(fromForward, -reach, a.depth / FIXED)
    : a.penetrates
      ? (a.depth / FIXED) * (0.08 + 0.84 * random(1))
      : -Math.min(0.18, reach * 0.3);
  const strike = vanguard ? { x: from.x, y: from.y } : local(lane, depth);
  // Riders peel both ways. Independent streams avoid lane/phase correlation.
  const sign =
    lane > space * 0.45
      ? -1
      : lane < -space * 0.45
        ? 1
        : random(2) < 0.5
          ? -1
          : 1;
  const exitLane = clamp(
    lane * 0.15 + (random(3) * 2 - 1) * space * 0.92,
    -space,
    space,
  );
  const rear = Math.min(-reach * (0.2 + 0.72 * random(4)), depth - reach * 0.2);
  const home = local(exitLane, rear);
  const narrow = space < 0.14,
    sideRoom = Math.max(0, sign > 0 ? space - lane : lane + space);
  const forwardAngle = Math.atan2(n.y, n.x) - Math.PI / 2;
  const rounded = !narrow && random(11) < 0.35;
  const approachLength = Math.hypot(strike.x - from.x, strike.y - from.y);
  const dx = strike.x - from.x,
    dy = strike.y - from.y;
  const direction = approachLength
    ? { x: dx / approachLength, y: dy / approachLength }
    : n;
  const arrival = dx * n.x + dy * n.y > 0 ? n : direction;
  const approach = new CavalryRidePath(
    [
      from,
      { x: from.x + dx * 0.35, y: from.y + dy * 0.35 },
      {
        x: strike.x - arrival.x * Math.min(0.35, approachLength * 0.3),
        y: strike.y - arrival.y * Math.min(0.35, approachLength * 0.3),
      },
      strike,
    ],
    ASSAULT_MOTION.speed * (0.65 + 0.35 * random(5)),
  );
  const bend = Math.min(sideRoom * 0.8, reach * 0.45);
  let escape: Point[];
  if (narrow)
    escape = [
      strike,
      local(lane, (depth + rear) / 2),
      local(exitLane, (depth + rear) * 0.5),
      home,
    ];
  else if (!rounded) {
    const pullBack = Math.min(depth - rear, reach) * (0.2 + 0.25 * random(12));
    escape = [
      strike,
      local(lane + sign * bend, depth - pullBack),
      local(
        clamp(exitLane + (random(13) - 0.5) * space * 0.2, -space, space),
        rear + (depth - rear) * 0.3,
      ),
      home,
    ];
  } else {
    // Retreat, then make a rounded half-turn behind the contact. Matched cubic
    // tangents keep momentum continuous; the next plunge starts facing forward.
    const inward = exitLane >= 0 ? -1 : 1;
    const room = inward > 0 ? space - exitLane : exitLane + space;
    const radius = Math.min(room * 0.4, reach * (0.13 + 0.1 * random(9)));
    const centre = -reach * (0.27 + 0.4 * random(10)),
      k = 0.5522847498307936 * radius;
    const b = local(exitLane, centre),
      middle = local(exitLane + inward * radius, centre - radius),
      c = local(exitLane + inward * 2 * radius, centre);
    escape = [
      strike,
      local(lane + sign * bend, depth),
      local(exitLane, centre + k),
      b,
      local(exitLane, centre - k),
      local(exitLane + inward * (radius - k), centre - radius),
      middle,
      local(exitLane + inward * (radius + k), centre - radius),
      local(exitLane + inward * 2 * radius, centre - k),
      c,
    ];
  }
  const exit = new CavalryRidePath(
    escape,
    ASSAULT_MOTION.speed * (0.5 + 0.4 * random(6)),
  );
  const exitAngle = exit.sample(0).angle;
  const pivotRate = ASSAULT_MOTION.pivotRate * (0.72 + 0.28 * random(14));
  const incoming =
    approachLength > 1e-6 ? approach.sample(0).angle : forwardAngle;
  const arriveAngle =
    approachLength > 1e-6
      ? approach.sample(approach.duration).angle
      : forwardAngle;
  const arrive =
    (Math.abs(angleDelta(arriveAngle, forwardAngle)) * 1.5) / pivotRate;
  const ready =
    (vanguard
      ? 0
      : serial === 0
        ? 0.08 + 0.9 * random(7)
        : 0.1 + 0.65 * random(7)) +
    (Math.abs(angleDelta(from.angle, incoming)) * 1.5) / pivotRate;
  const hold = vanguard
    ? 1.2 + 1.8 * random(8)
    : 0.8 + 0.5 * random(8) + (random(15) < 0.3 ? 1.1 * random(16) : 0);
  const turn = Math.max(
    0.3,
    (Math.abs(angleDelta(forwardAngle, exitAngle)) * 1.5) / pivotRate,
  );
  return {
    entry: approach.sample(0),
    contact: approach.sample(approach.duration),
    geometry: { ...a },
    start,
    ready,
    hold,
    arrive,
    turn,
    fromAngle: from.angle,
    strikeAngle: forwardAngle,
    arriveAngle,
    exitAngle,
    approach,
    exit,
    gait,
    duration: ready + approach.duration + arrive + hold + turn + exit.duration,
  };
}
function samplePass(p: Pass, seconds: number, id: number): AssaultRiderPose {
  let t = clamp(seconds - p.start, 0, p.duration);
  const base = {
    id,
    moving: false,
    turning: false,
    speed: 0,
    gaitDistance: p.gait,
  };
  const first = p.entry,
    strike = p.contact;
  if (p.approach.length < 1e-6) first.angle = p.strikeAngle;
  if (t < p.ready)
    return {
      ...base,
      x: first.x,
      y: first.y,
      angle:
        p.fromAngle +
        angleDelta(p.fromAngle, first.angle) * smooth(t / p.ready),
      phase: "ready",
      turning: Math.abs(angleDelta(p.fromAngle, first.angle)) > 0.01,
    };
  t -= p.ready;
  if (t < p.approach.duration) {
    const m = p.approach.sample(t);
    return {
      ...base,
      ...m,
      phase: "approach",
      moving: m.speed > 0.005,
      gaitDistance: p.gait + m.distance,
    };
  }
  t -= p.approach.duration;
  base.gaitDistance += p.approach.length;
  if (t < p.arrive)
    return {
      ...base,
      x: strike.x,
      y: strike.y,
      angle:
        p.arriveAngle +
        angleDelta(p.arriveAngle, p.strikeAngle) * smooth(t / p.arrive),
      phase: "turn",
      turning: true,
    };
  t -= p.arrive;
  if (t < p.hold)
    return {
      ...base,
      x: strike.x,
      y: strike.y,
      angle: p.strikeAngle,
      phase: "attack",
    };
  t -= p.hold;
  if (t < p.turn)
    return {
      ...base,
      x: strike.x,
      y: strike.y,
      angle:
        p.strikeAngle +
        angleDelta(p.strikeAngle, p.exitAngle) * smooth(t / p.turn),
      phase: "turn",
      turning: true,
    };
  const m = p.exit.sample(t - p.turn);
  return {
    ...base,
    ...m,
    phase: "exit",
    moving: m.speed > 0.005,
    gaitDistance: base.gaitDistance + m.distance,
  };
}
interface Rider {
  serial: number;
  pass: Pass;
  pose: AssaultRiderPose;
}
/** One bounded presentation planner per visible squad. Each pass freezes a
 * certified contact frame, and plans again only on completion or a material
 * contact change. No targeting, pathfinding, damage or independent simulation. */
export class CavalryAssaultMotion {
  private riders = new Map<number, Rider>();
  private startTick?: number;
  private tick?: number;
  clear(): void {
    this.riders.clear();
    this.startTick = undefined;
    this.tick = undefined;
  }
  sample(
    a: CavalryAssault | undefined,
    tick: number,
    members: readonly Member[],
    seed = 0,
  ): Map<number, AssaultRiderPose> {
    const result = new Map<number, AssaultRiderPose>();
    if (!a || tick < a.startTick || a.approach <= 0) {
      this.clear();
      return result;
    }
    const jumped =
      this.tick !== undefined && tick - this.tick > 2 * TICKS_PER_SECOND;
    if (
      this.startTick !== a.startTick ||
      (this.tick !== undefined && tick < this.tick)
    )
      this.clear();
    this.startTick = a.startTick;
    this.tick = tick;
    const time = tick / TICKS_PER_SECOND,
      seen = new Set<number>();
    for (const member of members) {
      seen.add(member.id);
      let rider = this.riders.get(member.id);
      if (!rider) {
        const pass = planPass(a, member, time, 0, seed, 0);
        rider = { serial: 0, pass, pose: samplePass(pass, time, member.id) };
        this.riders.set(member.id, rider);
      } else {
        const frame = rider.pass.geometry;
        const changed =
          Math.hypot(a.x - frame.x, a.y - frame.y) / FIXED > 0.5 ||
          a.nx * frame.nx + a.ny * frame.ny < 0.8 ||
          a.penetrates !== frame.penetrates ||
          a.halfWidth + 16 < frame.halfWidth * 0.65 ||
          a.depth + 16 < frame.depth * 0.65;
        if (jumped || changed) {
          rider.pass = planPass(
            a,
            rider.pose,
            time,
            ++rider.serial,
            seed,
            rider.pose.gaitDistance,
          );
        } else if (time >= rider.pass.start + rider.pass.duration) {
          const end = rider.pass.start + rider.pass.duration,
            pose = samplePass(rider.pass, end, member.id);
          rider.pass = planPass(
            a,
            pose,
            end,
            ++rider.serial,
            seed,
            pose.gaitDistance,
          );
        }
      }
      rider.pose = samplePass(rider.pass, time, member.id);
      result.set(member.id, rider.pose);
    }
    for (const id of this.riders.keys())
      if (!seen.has(id)) this.riders.delete(id);
    return result;
  }
}
