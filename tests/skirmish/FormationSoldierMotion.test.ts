import { describe, expect, it } from "vitest";
import {
  FormationSoldierMotion,
  type SoldierSlot,
} from "../../src/skirmish/client/FormationSoldierMotion";

const slots: SoldierSlot[] = [
  { id: 0, x: -0.4, y: 0, scale: 0.25, front: true },
  { id: 1, x: 0.4, y: 0, scale: 0.25, front: true },
];
const ordinary = { footprint: 1, mounted: false, engaged: false };
const turn = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

describe("individual formation motion", () => {
  it("contains diagonal travel arrivals for infantry and cavalry at low and high frame rates", () => {
    for (const mounted of [false, true])
      for (const fps of [10, 30, 120]) {
        const motion = new FormationSoldierMotion(4);
        const options = { ...ordinary, mounted, combatFootwork: true };
        motion.sample(0, { x: 0, y: 0 }, -Math.PI / 4, slots, options);
        const start = motion.position(0)!;
        let result;
        for (let frame = 1; frame <= fps * 6; frame++) {
          const now = (frame * 1000) / fps;
          const progress = Math.min(2, now / 400);
          result = motion.sample(
            now,
            { x: progress, y: progress },
            -Math.PI / 4,
            slots,
            options,
          );
          expect(result[0].x - start.x).toBeLessThanOrEqual(2.015);
          expect(result[0].y - start.y).toBeLessThanOrEqual(2.015);
        }
        expect(result![0].speed).toBeCloseTo(0, 8);
        expect(result![0].x - start.x).toBeCloseTo(2, 1);
        expect(result![0].y - start.y).toBeCloseTo(2, 1);
      }
  });
  it("settles an interrupted reserve step without sliding through the final column", () => {
    for (const fps of [30, 120]) {
      const motion = new FormationSoldierMotion();
      const options = { ...ordinary, engaged: true, combatFootwork: true };
      const facingSlots = slots.map((s) => ({ ...s, angle: -Math.PI / 2 }));
      motion.sample(0, { x: 0, y: 0 }, 0, facingSlots, options);
      let result;
      for (let frame = 1; frame <= fps * 6; frame++) {
        const now = (frame * 1000) / fps;
        result = motion.sample(
          now,
          { x: 0, y: 0 },
          0,
          facingSlots.map((s) => ({
            ...s,
            x: s.x + 0.8,
            y: now < 1000 ? s.y : s.y + 0.15,
            step: true,
          })),
          options,
        );
        expect(result[0].x).toBeLessThanOrEqual(slots[0].x + 0.825);
      }
      expect(result![0].x).toBeCloseTo(slots[0].x + 0.8, 1);
      expect(result![0].y).toBeCloseTo(0.15, 1);
      expect(result![0].speed).toBe(0);
    }
  });
  it("brakes travel followers into their final slots without coasting beyond them", () => {
    for (const fps of [30, 60, 120]) {
      const motion = new FormationSoldierMotion();
      const options = { ...ordinary, combatFootwork: true };
      motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
      let furthest = 0;
      for (let frame = 1; frame <= fps * 6; frame++) {
        const now = (frame * 1000) / fps;
        const soldiers = motion.sample(
          now,
          { x: 0, y: Math.min(2, now / 400) },
          0,
          slots,
          options,
        );
        furthest = Math.max(furthest, ...soldiers.map((s) => s.y));
      }
      expect(furthest).toBeLessThanOrEqual(2.015);
      expect(motion.position(0)!.y).toBeCloseTo(2, 1);
    }
  });
  it("builds pivot speed gradually and brakes before reversing a turn", () => {
    const motion = new FormationSoldierMotion();
    const options = { ...ordinary, engaged: true, combatFootwork: true };
    motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
    const right = slots.map((s) => ({ ...s, angle: -Math.PI / 2 }));
    const first = motion.sample(50, { x: 0, y: 0 }, 0, right, options);
    const second = motion.sample(100, { x: 0, y: 0 }, 0, right, options);
    expect(Math.abs(first[0].angle)).toBeLessThan((3 * Math.PI) / 180);
    expect(Math.abs(second[0].angle - first[0].angle)).toBeGreaterThan(
      Math.abs(first[0].angle),
    );
    const reverse = motion.sample(
      150,
      { x: 0, y: 0 },
      0,
      slots.map((s) => ({ ...s, angle: Math.PI / 2 })),
      options,
    );
    expect(reverse[0].angle).toBeLessThan(second[0].angle);
    expect(second[0].angle - reverse[0].angle).toBeLessThan(
      first[0].angle - second[0].angle,
    );
    expect(
      reverse.every((s) => s.x === slots[s.id].x && s.y === slots[s.id].y),
    ).toBe(true);
  });
  it("faces a rear threat promptly without moving the formation at varied frame rates", () => {
    for (const mounted of [false, true])
      for (const engaged of [false, true])
        for (const fps of [10, 30, 120]) {
          const motion = new FormationSoldierMotion();
          const options = {
            ...ordinary,
            mounted,
            engaged,
            combatFootwork: true,
          };
          motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
          const rear = slots.map((s) => ({ ...s, angle: Math.PI }));
          let result;
          const deadline = mounted ? 1.4 : 1.1;
          for (let frame = 1; frame <= Math.ceil(fps * deadline); frame++)
            result = motion.sample(
              (frame * 1000) / fps,
              { x: 0, y: 0 },
              0,
              rear,
              options,
            );
          for (const soldier of result!) {
            expect(turn(soldier.angle, Math.PI)).toBeLessThan(Math.PI / 180);
            expect(soldier.x).toBe(slots[soldier.id].x);
            expect(soldier.y).toBe(slots[soldier.id].y);
          }
        }
  });
  it("backsteps for short rearward combat corrections while continuing to face the opponent", () => {
    for (const mounted of [false, true])
      for (const fps of [10, 30, 120]) {
        const motion = new FormationSoldierMotion();
        const options = {
          ...ordinary,
          mounted,
          engaged: true,
          combatFootwork: true,
        };
        motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
        const rear = slots.map((s) => ({
          ...s,
          x: s.x + 0.15,
          y: s.y - 0.35,
          step: true,
        }));
        let result;
        let sawBackstep = false;
        for (let frame = 1; frame <= fps * 3; frame++) {
          result = motion.sample(
            (frame * 1000) / fps,
            { x: 0, y: 0 },
            0,
            rear,
            options,
          );
          for (const soldier of result) {
            expect(turn(soldier.angle, 0)).toBeLessThan(0.01);
            expect(soldier.speed).toBeLessThan(0.8);
            sawBackstep ||= !!soldier.backstepping && soldier.speed > 0;
          }
        }
        expect(sawBackstep).toBe(true);
        for (const soldier of result!) {
          expect(soldier.y).toBeCloseTo(-0.35, 1);
          expect(soldier.speed).toBe(0);
          expect(soldier.backstepping).toBe(false);
        }
      }
  });
  it("turns to walk for a longer rearward relocation instead of backstepping", () => {
    const motion = new FormationSoldierMotion();
    const options = { ...ordinary, engaged: true, combatFootwork: true };
    motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
    const rear = slots.map((s) => ({ ...s, y: s.y - 2, step: true }));
    let walkedAway = false;
    for (let now = 50; now <= 4000; now += 50) {
      for (const soldier of motion.sample(
        now,
        { x: 0, y: 0 },
        0,
        rear,
        options,
      )) {
        expect(soldier.backstepping).toBe(false);
        if (soldier.y < -0.1 && soldier.speed > 0.1) {
          expect(turn(soldier.angle, Math.PI)).toBeLessThan(Math.PI / 3);
          walkedAway = true;
        }
      }
    }
    expect(walkedAway).toBe(true);
  });
  it("returns to attack facing after a sideways combat step finishes", () => {
    for (const mounted of [false, true])
      for (const fps of [10, 30, 120]) {
        const motion = new FormationSoldierMotion();
        const options = {
          ...ordinary,
          mounted,
          engaged: true,
          combatFootwork: true,
        };
        motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
        const shifted = slots.map((s) => ({ ...s, x: s.x + 0.8, step: true }));
        let result;
        for (let frame = 1; frame <= fps * 6; frame++)
          result = motion.sample(
            (frame * 1000) / fps,
            { x: 0, y: 0 },
            0,
            shifted,
            options,
          );
        for (const soldier of result!) {
          expect(soldier.x).toBeCloseTo(slots[soldier.id].x + 0.8, 1);
          expect(soldier.speed).toBe(0);
          expect(soldier.facingError).toBeLessThan(0.01);
          expect(soldier.turning).toBe(false);
        }
      }
  });
  it("accelerates into a reserve step gently and sheds forward momentum on reversal", () => {
    const motion = new FormationSoldierMotion();
    const options = { ...ordinary, engaged: true, combatFootwork: true };
    motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
    const forward = slots.map((s) => ({ ...s, y: s.y + 0.8, step: true }));
    const first = motion.sample(50, { x: 0, y: 0 }, 0, forward, options);
    expect(first[0].speed).toBeGreaterThan(0);
    expect(first[0].speed).toBeLessThan(0.1);
    let moving = first;
    for (let now = 100; now <= 500; now += 50)
      moving = motion.sample(now, { x: 0, y: 0 }, 0, forward, options);
    const reverse = motion.sample(
      550,
      { x: 0, y: 0 },
      0,
      slots.map((s) => ({ ...s, y: s.y - 0.8, step: true })),
      options,
    );
    expect(reverse[0].y).toBeGreaterThan(moving[0].y);
    expect(reverse[0].speed).toBeLessThan(moving[0].speed);
  });
  it("preserves the displayed movement phase while the presentation clock is paused", () => {
    const motion = new FormationSoldierMotion();
    motion.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
    const moving = motion.sample(100, { x: 0.2, y: 0 }, 0, slots, ordinary);
    expect(moving.every((s) => s.speed > 0)).toBe(true);
    const paused = motion.sample(100, { x: 0.2, y: 0 }, 0, slots, ordinary);
    expect(paused).toEqual(moving);
  });
  it("plants the throwers while the rear follows, then resumes without a teleport", () => {
    const motion = new FormationSoldierMotion();
    motion.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
    const held = motion.sample(100, { x: 0.1, y: 0 }, 0, slots, {
      ...ordinary,
      planted: new Set([0]),
    });
    expect(held[0].x).toBe(slots[0].x);
    expect(held[0].speed).toBe(0);
    expect(held[0].gaitDistance).toBe(0);
    expect(held[1].gaitDistance).toBeGreaterThan(0);
    const released = motion.sample(150, { x: 0.15, y: 0 }, 0, slots, ordinary);
    expect(released[0].x).toBeGreaterThan(held[0].x);
    expect(released[0].x - held[0].x).toBeLessThan(0.05);
  });
  it("holds a combat stance through slot drift, then repositions and plants again", () => {
    const motion = new FormationSoldierMotion();
    const combat = { ...ordinary, engaged: true };
    motion.sample(0, { x: 0, y: 0 }, 0, slots, combat);
    let result;
    for (let now = 16; now <= 1600; now += 16)
      result = motion.sample(
        now,
        { x: 0.18 * Math.sin(now / 400), y: 0 },
        0,
        slots,
        combat,
      );
    expect(result!.every((s) => s.gaitDistance === 0)).toBe(true);
    for (let now = 1616; now <= 4800; now += 16)
      result = motion.sample(now, { x: 0.65, y: 0 }, 0, slots, combat);
    expect(
      result!.every(
        (s) => Math.abs(s.x - slots[s.id].x - 0.65) < 0.05 && s.speed === 0,
      ),
    ).toBe(true);
    const distance = result!.map((s) => s.gaitDistance);
    result = motion.sample(4816, { x: 0.65, y: 0 }, 0, slots, combat);
    expect(result.map((s) => s.gaitDistance)).toEqual(distance);
  });
  it("walks through a turn rather than rigidly rotating the group", () => {
    const motion = new FormationSoldierMotion();
    const start = motion.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
    const turned = motion.sample(
      50,
      { x: 0, y: 0 },
      Math.PI / 2,
      slots,
      ordinary,
    );
    for (let i = 0; i < slots.length; i++) {
      expect(
        Math.hypot(turned[i].x - start[i].x, turned[i].y - start[i].y),
      ).toBeLessThan(0.05);
      expect(turn(start[i].angle, turned[i].angle)).toBeLessThanOrEqual(
        Math.PI / 40 + 1e-10,
      );
      expect(turned[i].gaitDistance).toBeGreaterThan(0);
    }
    expect(
      Math.hypot(turned[0].x - turned[1].x, turned[0].y - turned[1].y),
    ).toBeLessThan(0.8);
  });
  it("faces carried travel instead of sliding sideways, then restores rank facing", () => {
    for (const looseTravel of [false, true]) {
      const motion = new FormationSoldierMotion(2);
      const options = {
        ...ordinary,
        combatFootwork: true,
        carrierRelative: true,
        looseTravel,
      };
      // Rank faces down (+y) while the squad is carried along +x.
      let result = motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
      for (let now = 50; now <= 2000; now += 50)
        result = motion.sample(now, { x: now / 1000, y: 0 }, 0, slots, options);
      for (const soldier of result)
        expect(turn(soldier.angle, -Math.PI / 2)).toBeLessThan(0.05);
      for (let now = 2050; now <= 5000; now += 50)
        result = motion.sample(now, { x: 2, y: 0 }, 0, slots, options);
      if (!looseTravel)
        for (const soldier of result)
          expect(turn(soldier.angle, 0)).toBeLessThan(0.05);
    }
  });
  it("keeps rank facing through a slight strafe", () => {
    const motion = new FormationSoldierMotion(2);
    const options = {
      ...ordinary,
      combatFootwork: true,
      carrierRelative: true,
    };
    let result = motion.sample(0, { x: 0, y: 0 }, 0, slots, options);
    // Marching down (+y) with a 5 degree sideways component.
    for (let now = 50; now <= 2000; now += 50)
      result = motion.sample(
        now,
        { x: Math.sin(Math.PI / 36) * (now / 1000), y: now / 1000 },
        0,
        slots,
        options,
      );
    for (const soldier of result)
      expect(turn(soldier.angle, 0)).toBeLessThan(1e-6);
  });
  it("allows different lag while accelerating, then settles and stops the walking phase", () => {
    const motion = new FormationSoldierMotion(3);
    let result = motion.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
    for (let now = 50; now <= 1000; now += 50)
      result = motion.sample(now, { x: now / 250, y: 0 }, 0, slots, ordinary);
    expect(result.every((s) => s.speed > 0 && s.x < 4 + slots[s.id].x)).toBe(
      true,
    );
    expect(Math.abs(result[1].x - 0.4 - (result[0].x + 0.4))).toBeGreaterThan(
      0.005,
    );
    for (let now = 1050; now <= 7000; now += 50)
      result = motion.sample(now, { x: 4, y: 0 }, 0, slots, ordinary);
    expect(
      result.every(
        (s) => s.speed < 0.12 && Math.abs(s.x - 4 - slots[s.id].x) < 0.02,
      ),
    ).toBe(true);
    const distance = result.map((s) => s.gaitDistance);
    result = motion.sample(7050, { x: 4, y: 0 }, 0, slots, ordinary);
    expect(result.map((s) => s.gaitDistance)).toEqual(distance);
  });
  it("plants feet through tiny combat corrections and faces the enemy during backward steps", () => {
    const motion = new FormationSoldierMotion();
    const combat = { ...ordinary, engaged: true };
    motion.sample(0, { x: 0, y: 0 }, 0, slots, combat);
    let result = motion.sample(16, { x: 0.02, y: 0 }, 0, slots, combat);
    for (let now = 32; now <= 1600; now += 16)
      result = motion.sample(
        now,
        { x: now % 32 ? 0.02 : -0.02, y: 0 },
        0,
        slots,
        combat,
      );
    expect(
      result.every(
        (s) => Math.abs(s.x - slots[s.id].x) < 0.001 && s.gaitDistance === 0,
      ),
    ).toBe(true);
    for (let now = 1616; now <= 2608; now += 16)
      result = motion.sample(
        now,
        { x: 0, y: -(now - 1600) / 1000 },
        0,
        slots,
        combat,
      );
    expect(
      result.every(
        (s) => s.y < -0.5 && s.speed > 0.12 && Math.abs(s.angle) < 0.001,
      ),
    ).toBe(true);
  });
  it("keeps comparable trajectories across frame rates", () => {
    const run = (fps: number) => {
      const motion = new FormationSoldierMotion();
      let result = motion.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
      for (let frame = 1; frame <= fps * 3; frame++) {
        const now = (frame / fps) * 1000;
        result = motion.sample(
          now,
          { x: now / 1000, y: 0 },
          Math.min(Math.PI / 2, now / 1000),
          slots,
          ordinary,
        );
      }
      return result;
    };
    const fast = run(120);
    for (const fps of [10, 30, 60]) {
      const slow = run(fps);
      for (let i = 0; i < slots.length; i++)
        expect(
          Math.hypot(slow[i].x - fast[i].x, slow[i].y - fast[i].y),
        ).toBeLessThan(0.12);
    }
  });
  it("rebases a resumed formation without a huge catch-up sprint and retires missing identities", () => {
    const motion = new FormationSoldierMotion();
    motion.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
    const result = motion.sample(
      2000,
      { x: 10, y: 10 },
      0,
      [slots[0]],
      ordinary,
    );
    expect(result[0]).toMatchObject({
      x: 9.6,
      y: 10,
      speed: 0,
      gaitDistance: 0,
    });
    expect(motion.position(1)).toBeUndefined();
  });
});
