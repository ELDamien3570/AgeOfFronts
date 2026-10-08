import { describe, expect, it } from "vitest";
import {
  FormationEngagement,
  type EngagementIntent,
} from "../../src/skirmish/client/FormationEngagement";
import {
  FormationSoldierMotion,
  type SoldierSlot,
} from "../../src/skirmish/client/FormationSoldierMotion";
const slots: SoldierSlot[] = Array.from({ length: 12 }, (_, id) => ({
  id,
  x: ((id % 4) - 1.5) * 0.2,
  y: (Math.floor(id / 4) - 1) * 0.16,
  scale: 0.24,
  angle: 0,
  front: id >= 8,
}));
const anchor = { x: 0, y: 0 };
const intent: EngagementIntent = {
  active: true,
  charging: false,
  ranged: false,
  square: false,
  travelHeading: 0,
  footprint: 2.66,
  target: { x: 3, y: 0 },
};
describe("independent formation engagement", () => {
  it("faces the opposing frontage instead of converging outer melee troops on its center", () => {
    const model = new FormationEngagement();
    const contact = {
      ...intent,
      target: { x: 0, y: 3 },
      opponents: [
        {
          center: { x: 0, y: 3 },
          soldiers: slots
            .filter((s) => s.front)
            .map((s) => ({
              id: `enemy:${s.id}`,
              x: s.x * intent.footprint,
              y: 1,
            })),
        },
      ],
    };
    const result = model.sample(0, anchor, slots, contact);
    for (const soldier of result.slots.filter((s) => s.front))
      expect(soldier.angle).toBeCloseTo(0);
    expect(result.heading).toBe(0);
    expect(result.slots.map((s) => [s.x, s.y])).toEqual(
      slots.map((s) => [s.x, s.y]),
    );
  });
  it("retains a nearby living opponent through noise and retargets after that opponent disappears", () => {
    const model = new FormationEngagement();
    const member = [{ id: 0, x: 0, y: 0, scale: 0.24, front: true }];
    const sample = (
      now: number,
      soldiers: { id: string; x: number; y: number }[],
    ) =>
      model.sample(now, anchor, member, {
        ...intent,
        target: { x: 0, y: 3 },
        opponents: [{ center: { x: 0, y: 3 }, soldiers }],
      }).slots[0];
    expect(
      sample(0, [
        { id: "a", x: 0, y: 1 },
        { id: "b", x: 0.1, y: 1 },
      ]).angle,
    ).toBeCloseTo(0);
    expect(
      sample(50, [
        { id: "a", x: 0, y: 1 },
        { id: "b", x: 0.1, y: 0.95 },
      ]).angle,
    ).toBeCloseTo(0);
    const afterDeath = sample(100, [{ id: "b", x: 0.1, y: 0.95 }]);
    expect(afterDeath.angle).toBeCloseTo(Math.atan2(0.95, 0.1) - Math.PI / 2);
  });
  it("gives each threatened square side opponents from its own contact", () => {
    const result = new FormationEngagement().sample(0, anchor, slots, {
      ...intent,
      square: true,
      threats: [{ x: -3, y: 0 }],
      opponents: [-3, 3].map((x) => ({
        center: { x, y: 0 },
        soldiers: [-0.16, 0, 0.16].map((y, i) => ({
          id: `${x}:${i}`,
          x,
          y: y * intent.footprint,
        })),
      })),
    });
    for (const soldier of result.slots.filter((s) => s.front))
      expect(soldier.angle).toBeCloseTo(
        soldier.x < 0 ? Math.PI / 2 : -Math.PI / 2,
      );
  });
  it("holds its footprint while the threatened edge and individual attention change", () => {
    const model = new FormationEngagement(2);
    const right = model.sample(0, anchor, slots, intent);
    expect([...right.front]).toEqual([3, 7, 11]);
    expect(right.slots.map((s) => [s.x, s.y])).toEqual(
      slots.map((s) => [s.x, s.y]),
    );
    const rear = { ...intent, travelHeading: Math.PI, target: { x: 0, y: -3 } };
    model.sample(100, anchor, slots, rear);
    const turned = model.sample(500, anchor, slots, rear);
    expect(turned.heading).toBe(0);
    expect([...turned.front]).toEqual([0, 1, 2, 3]);
    expect(Math.abs(turned.slots[0].angle)).toBeGreaterThan(2.5);
    expect(turned.slots.map((s) => s.id)).toEqual(slots.map((s) => s.id));
  });
  it("does not reassign the fighting edge for boundary noise or a brief target switch", () => {
    const model = new FormationEngagement();
    model.sample(0, anchor, slots, intent);
    for (let now = 50; now <= 1000; now += 50) {
      const result = model.sample(now, anchor, slots, {
        ...intent,
        target: { x: 3, y: now % 100 ? 1.3 : 1.1 },
      });
      expect([...result.front]).toEqual([3, 7, 11]);
    }
    model.sample(1050, anchor, slots, { ...intent, target: { x: -3, y: 0 } });
    expect([...model.sample(1100, anchor, slots, intent).front]).toEqual([
      3, 7, 11,
    ]);
  });
  it("uses small staggered reserve tracks, preserving continuity when interrupted", () => {
    const model = new FormationEngagement(3);
    model.sample(0, anchor, slots, intent);
    const before = model.sample(800, anchor, slots, intent);
    expect(
      before.slots.filter(
        (s, i) => Math.hypot(s.x - slots[i].x, s.y - slots[i].y) > 0.001,
      ),
    ).toHaveLength(2);
    const removed = slots.filter((s) => s.id !== 11);
    const after = model.sample(800, anchor, removed, intent);
    expect(after.slots.map((s) => [s.id, s.x, s.y])).toEqual(
      before.slots.filter((s) => s.id !== 11).map((s) => [s.id, s.x, s.y]),
    );
    expect(after.slots.every((s) => s.scale === 0.24)).toBe(true);
  });
  it("keeps all ranged ranks in place and lets each square edge face its own threat", () => {
    const ranged = new FormationEngagement();
    ranged.sample(0, anchor, slots, { ...intent, ranged: true });
    const result = ranged.sample(2000, anchor, slots, {
      ...intent,
      ranged: true,
    });
    expect(result.slots.every((s) => s.front)).toBe(true);
    expect(result.slots.map((s) => [s.x, s.y])).toEqual(
      slots.map((s) => [s.x, s.y]),
    );
    const square = new FormationEngagement().sample(0, anchor, slots, {
      ...intent,
      square: true,
      threats: [{ x: -3, y: 0 }],
    });
    expect(square.slots.find((s) => s.id === 4)!.angle).toBeCloseTo(
      Math.PI / 2,
    );
    expect(square.slots.find((s) => s.id === 7)!.angle).toBeCloseTo(
      -Math.PI / 2,
    );
    expect(square.casualtyAngle).toBeUndefined();
  });
  it("returns to travel orientation for charging without snapping the footprint", () => {
    const model = new FormationEngagement();
    model.sample(0, anchor, slots, intent);
    const result = model.sample(100, anchor, slots, {
      ...intent,
      charging: true,
      travelHeading: Math.PI,
    });
    expect(result.engaged).toBe(false);
    expect(result.heading).toBeCloseTo(((40 * Math.PI) / 180) * 0.1);
    expect(result.slots.map((s) => s.id)).toEqual(slots.map((s) => s.id));
  });
  it("pivots the soldiers in place with varied turn rates without rotating their positions", () => {
    const model = new FormationEngagement(2),
      motion = new FormationSoldierMotion(2);
    const ranged = { ...intent, ranged: true };
    const start = model.sample(0, anchor, slots, { ...ranged, active: false });
    motion.sample(0, anchor, start.heading, start.slots, {
      footprint: 2.66,
      mounted: false,
      engaged: false,
    });
    let soldiers = motion.sample(
      50,
      anchor,
      0,
      model.sample(50, anchor, slots, ranged).slots,
      { footprint: 2.66, mounted: false, engaged: true, combatFootwork: true },
    );
    expect(
      soldiers.every(
        (s, i) => s.x === slots[i].x * 2.66 && s.y === slots[i].y * 2.66,
      ),
    ).toBe(true);
    expect(soldiers.every((s) => s.turning && s.speed === 0)).toBe(true);
    expect(new Set(soldiers.map((s) => s.angle)).size).toBeGreaterThan(1);
    for (let now = 100; now <= 3000; now += 50)
      soldiers = motion.sample(
        now,
        anchor,
        0,
        model.sample(now, anchor, slots, ranged).slots,
        {
          footprint: 2.66,
          mounted: false,
          engaged: true,
          combatFootwork: true,
        },
      );
    expect(soldiers.every((s) => !s.turning && s.facingError! < 0.01)).toBe(
      true,
    );
  });
});
