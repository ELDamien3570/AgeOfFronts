import { describe, expect, it } from "vitest";
import { FIXED, TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import {
  ASSAULT_MOTION,
  CavalryAssaultMotion,
  CavalryRidePath,
  type AssaultRiderPose,
} from "../../src/skirmish/client/troops/CavalryAssaultPresentation";
import type { CavalryAssault } from "../../src/skirmish/domain/CavalryAssault";

const geometry = (penetrates = true): CavalryAssault => ({
  startTick: 0,
  bonusUntilTick: 48,
  strength: 1,
  penetrates,
  x: 0,
  y: 0,
  nx: 1,
  ny: 0,
  halfWidth: FIXED,
  depth: penetrates ? FIXED * 0.7 : 0,
  approach: FIXED * 1.5,
  pressure: 2,
  resistance: 1,
});
const members = () =>
  Array.from({ length: 16 }, (_, id) => ({
    id,
    x: -1.3 + (id % 3) * 0.12,
    y: -0.8 + (id / 16) * 1.6,
    angle: -Math.PI / 2,
  }));
const angle = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));

describe("cavalry assault movement", () => {
  it("keeps the first riders in contact while the rear begins its approach", () => {
    const motion = new CavalryAssaultMotion();
    const group = [
      { id: 1, x: -0.1, y: 0.2, angle: -Math.PI / 2 },
      { id: 2, x: -1.2, y: -0.2, angle: -Math.PI / 2 },
    ];
    for (let frame = 0; frame <= 60; frame++) {
      const poses = motion.sample(
        geometry(),
        (frame / 60) * TICKS_PER_SECOND,
        group,
        91,
      );
      expect(poses.get(1)).toMatchObject({
        x: group[0].x,
        y: group[0].y,
        phase: "attack",
        moving: false,
      });
      expect(poses.get(2)?.phase).not.toBe("attack");
    }
  });

  it("builds momentum, brakes to a stop, and slows for curved escape paths", () => {
    const path = new CavalryRidePath([
      { x: 0, y: 0 },
      { x: 0, y: 0.5 },
      { x: -1, y: -1.3 },
      { x: 0, y: -1 },
    ]);
    expect(path.sample(0).speed).toBe(0);
    expect(path.sample(path.duration).speed).toBeCloseTo(0, 7);
    let previous = path.sample(0),
      velocity = { x: 0, y: 0 },
      peak = 0,
      maxYaw = 0,
      maxAcceleration = 0;
    const dt = 1 / 240;
    for (let t = dt; t < path.duration; t += dt) {
      const p = path.sample(t),
        v = { x: (p.x - previous.x) / dt, y: (p.y - previous.y) / dt };
      peak = Math.max(peak, Math.hypot(v.x, v.y));
      maxAcceleration = Math.max(
        maxAcceleration,
        Math.hypot(v.x - velocity.x, v.y - velocity.y) / dt,
      );
      if (p.speed > 0.02 && previous.speed > 0.02)
        maxYaw = Math.max(
          maxYaw,
          Math.abs(angle(previous.angle, p.angle)) / dt,
        );
      previous = p;
      velocity = v;
    }
    expect(peak).toBeLessThanOrEqual(ASSAULT_MOTION.speed * 1.02);
    expect(maxYaw).toBeLessThanOrEqual(ASSAULT_MOTION.movingTurnRate * 1.15);
    expect(maxAcceleration).toBeLessThan(
      Math.hypot(ASSAULT_MOTION.braking, ASSAULT_MOTION.lateralAcceleration) *
        1.45,
    );
    expect(path.sample(0.1).speed).toBeLessThan(
      ASSAULT_MOTION.acceleration * 0.11,
    );
    expect(path.sample(path.duration - 0.1).speed).toBeLessThan(
      ASSAULT_MOTION.braking * 0.11,
    );
  });

  it("gives riders stationary attack windows, controlled turns, and varied individual passes", () => {
    const motion = new CavalryAssaultMotion(),
      a = geometry(),
      group = members();
    let previous = new Map<number, AssaultRiderPose>(),
      maxSpeed = 0,
      maxYaw = 0,
      maxConcurrentPhases = 0;
    let worst: unknown;
    const holds = new Map<number, number>(),
      phases = new Set<string>(),
      turnDirections = new Set<number>();
    const dt = 1 / 120;
    for (let frame = 0; frame <= 30 / dt; frame++) {
      const poses = motion.sample(a, frame * dt * TICKS_PER_SECOND, group, 91);
      maxConcurrentPhases = Math.max(
        maxConcurrentPhases,
        new Set([...poses.values()].map((p) => p.phase)).size,
      );
      for (const [id, p] of poses) {
        phases.add(p.phase);
        const old = previous.get(id);
        if (old) {
          const speed = Math.hypot(p.x - old.x, p.y - old.y) / dt;
          maxSpeed = Math.max(maxSpeed, speed);
          const yaw = Math.abs(angle(old.angle, p.angle)) / dt;
          if (yaw > maxYaw) {
            maxYaw = yaw;
            worst = { frame, id, old, p };
          }
          if (p.phase === "attack" && old.phase === "attack") {
            holds.set(id, (holds.get(id) ?? 0) + dt);
            expect(speed).toBeLessThan(1e-7);
            expect(p.gaitDistance).toBe(old.gaitDistance);
          }
          if (
            p.phase === "turn" &&
            old.phase === "turn" &&
            Math.abs(angle(old.angle, p.angle)) > 0.001
          )
            turnDirections.add(Math.sign(angle(old.angle, p.angle)));
        }
      }
      previous = poses;
    }
    expect([...phases].sort()).toEqual([
      "approach",
      "attack",
      "exit",
      "ready",
      "turn",
    ]);
    expect(holds.size).toBe(16);
    expect(Math.min(...holds.values())).toBeGreaterThan(0.7);
    expect(turnDirections.size).toBe(2);
    expect(maxSpeed).toBeLessThanOrEqual(ASSAULT_MOTION.speed * 1.02);
    expect(maxYaw, JSON.stringify(worst)).toBeLessThanOrEqual(
      ASSAULT_MOTION.pivotRate * 1.03,
    );
    expect(maxConcurrentPhases).toBeGreaterThanOrEqual(3);
  });

  it("keeps held-line riders outside the line and penetrating riders inside the certified depth", () => {
    for (const penetrates of [true, false]) {
      const motion = new CavalryAssaultMotion(),
        a = geometry(penetrates),
        group = members();
      for (let frame = 0; frame < 1800; frame++)
        for (const p of motion
          .sample(a, (frame / 60) * TICKS_PER_SECOND, group, 5)
          .values()) {
          expect(p.x).toBeLessThanOrEqual(
            (penetrates ? a.depth / FIXED : 0) + 1e-6,
          );
          expect(p.x).toBeGreaterThanOrEqual(-a.approach / FIXED - 1e-6);
          expect(Math.abs(p.y)).toBeLessThanOrEqual(a.halfWidth / FIXED + 1e-6);
        }
    }
  });

  it("is independent of draw rate, stays still while paused, and preserves survivors after casualty reseating", () => {
    const a = geometry(),
      group = members(),
      fast = new CavalryAssaultMotion(),
      slow = new CavalryAssaultMotion();
    let left = new Map<number, AssaultRiderPose>(),
      right = new Map<number, AssaultRiderPose>();
    for (let i = 0; i <= 720; i++) {
      left = fast.sample(a, (i / 60) * TICKS_PER_SECOND, group, 33);
      if (i % 2 === 0)
        right = slow.sample(a, (i / 60) * TICKS_PER_SECOND, group, 33);
    }
    expect(left).toEqual(right);
    expect(fast.sample(a, 12 * TICKS_PER_SECOND, group, 33)).toEqual(left);
    const survivors = fast.sample(
      a,
      12 * TICKS_PER_SECOND,
      [...group.slice(3)].reverse().map((m) => ({ ...m, x: 100, y: 100 })),
      33,
    );
    for (const [id, p] of survivors) expect(p).toEqual(left.get(id));
  });

  it("freezes a pass through minor contact updates and starts major retargets from the drawn pose", () => {
    const a = geometry(),
      group = members(),
      motion = new CavalryAssaultMotion();
    motion.sample(a, 0, group, 10);
    const before = motion.sample(a, 8, group, 10);
    const minor = motion.sample({ ...a, x: 2 }, 8, group, 10);
    expect(minor).toEqual(before);
    const changed = motion.sample({ ...a, x: FIXED }, 8, group, 10);
    for (const [id, p] of changed) {
      expect(p.x).toBe(before.get(id)!.x);
      expect(p.y).toBe(before.get(id)!.y);
      expect(p.angle).toBe(before.get(id)!.angle);
    }
    expect(motion.sample({ ...a, approach: 0 }, 9, group).size).toBe(0);
  });

  it("handles a very narrow contact and late detail entry without spinning or replaying old passes", () => {
    const a = { ...geometry(false), halfWidth: 0, approach: FIXED * 0.3 },
      group = [{ id: 1, x: -0.2, y: 0, angle: Math.PI / 2 }],
      motion = new CavalryAssaultMotion();
    for (let frame = 0; frame < 600; frame++) {
      const p = motion
        .sample(a, (frame / 60) * TICKS_PER_SECOND, group, 3)
        .get(1)!;
      expect([p.x, p.y, p.angle, p.gaitDistance].every(Number.isFinite)).toBe(
        true,
      );
      expect(Math.abs(p.y)).toBeLessThan(1e-8);
      expect(p.x).toBeLessThanOrEqual(0);
    }
    const late = motion.sample(a, 800, group, 3).get(1)!;
    expect(late.phase).toBe("ready");
    const held = motion.sample(a, 800, group, 3).get(1)!;
    expect(held).toEqual(late);
  });
});

describe("cavalry motion across contact geometries", () => {
  it.each([
    { width: 0.12, reach: 0.3, depth: 0, theta: 0 },
    { width: 0.5, reach: 1.1, depth: 0.4, theta: Math.PI / 3 },
    { width: 2, reach: 1.5, depth: 0.8, theta: -Math.PI / 2 },
    { width: 0.003, reach: 0.04, depth: 0, theta: Math.PI },
  ])(
    "bounds moving and stopped turns for $width tile frontage",
    ({ width, reach, depth, theta }) => {
      const n = { x: Math.cos(theta), y: Math.sin(theta) },
        t = { x: -Math.sin(theta), y: Math.cos(theta) };
      const a = {
        ...geometry(depth > 0),
        nx: n.x,
        ny: n.y,
        halfWidth: width * FIXED,
        approach: reach * FIXED,
        depth: depth * FIXED,
      };
      const group = Array.from({ length: 8 }, (_, id) => ({
        id,
        x: -n.x * reach * 0.8 + t.x * width * (id / 8 - 0.5),
        y: -n.y * reach * 0.8 + t.y * width * (id / 8 - 0.5),
        angle: theta - Math.PI / 2,
      }));
      const motion = new CavalryAssaultMotion();
      let previous = new Map<number, AssaultRiderPose>(),
        peak = 0,
        yaw = 0;
      for (let i = 0; i <= 2400; i++) {
        const poses = motion.sample(
          a,
          (i / 120) * TICKS_PER_SECOND,
          group,
          1247,
        );
        for (const [id, p] of poses) {
          const old = previous.get(id);
          if (old) {
            peak = Math.max(peak, Math.hypot(p.x - old.x, p.y - old.y) * 120);
            yaw = Math.max(yaw, Math.abs(angle(old.angle, p.angle)) * 120);
          }
        }
        previous = poses;
      }
      expect(peak).toBeLessThanOrEqual(ASSAULT_MOTION.speed * 1.02);
      expect(yaw).toBeLessThanOrEqual(ASSAULT_MOTION.pivotRate * 1.05);
    },
  );
});
