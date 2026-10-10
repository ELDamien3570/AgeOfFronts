import { describe, expect, it } from "vitest";
import layout from "../../Art/Cultures/Russians/FormationLayouts/Clubman.json";
import { TroopChoreography } from "./browser/TroopChoreography";
import {
  formationSlots,
  type FormationShape,
} from "./browser/TroopPrototypeModel";

describe("cosmetic troop choreography", () => {
  it("resumes detail with current strength, complete front ranks, and no fabricated deaths", () => {
    const slots = formationSlots(layout, 12, "line");
    const motion = new TroopChoreography(slots, 2, 10000, 7);
    expect(motion.soldiers(10000)).toHaveLength(7);
    expect(motion.soldiers(10000).filter((s) => s.front)).toHaveLength(4);
    motion.advance(20000, 7);
    expect(motion.dead(20000)).toHaveLength(0);
    expect(new TroopChoreography(slots, 0, 0, 0).count).toBe(0);
  });
  it("takes casualties on a threatened flank and fills from behind that edge", () => {
    const slots = formationSlots(layout, 12, "line");
    const motion = new TroopChoreography(slots, 0, 0);
    const right = Math.max(...slots.map((s) => s.x));
    const front = new Set(
      motion
        .soldiers(0)
        .filter((s) => s.x === right)
        .map((s) => s.id),
    );
    motion.advance(100, 11, { angle: -Math.PI / 2, front });
    const dead = motion.dead(100)[0];
    expect(dead.x).toBe(right);
    expect(motion.soldiers(100).some((s) => s.id === dead.id)).toBe(false);
    const filled = motion
      .soldiers(3000)
      .find((s) => s.x === dead.x && s.y === dead.y);
    expect(filled).toBeDefined();
    expect(filled!.id).not.toBe(dead.id);
  });
  it("keeps identities and scale through all directed formation transitions", () => {
    const shapes: FormationShape[] = [
      "mass",
      "line",
      "wedge",
      "shield-wall",
      "square",
    ];
    for (const from of shapes)
      for (const to of shapes) {
        const initial = formationSlots(layout, 12, from);
        const target = formationSlots(layout, 12, to);
        const motion = new TroopChoreography(initial, 2, 0);
        motion.reshape(target, 100);
        const mid = motion.soldiers(700);
        expect(new Set(mid.map((m) => m.id)).size).toBe(12);
        expect(
          mid.every(
            (m) =>
              Number.isFinite(m.x + m.y + (m.angle ?? 0)) &&
              m.scale === initial[0].scale,
          ),
        ).toBe(true);
        const final = motion.soldiers(10000);
        expect(final.every((m) => !m.moving)).toBe(true);
        expect(final.map((m) => `${m.x},${m.y}`).sort()).toEqual(
          target.map((m) => `${m.x},${m.y}`).sort(),
        );
      }
  });
  it("kills one front soldier and fills their slot while keeping the corpse fixed", () => {
    const slots = formationSlots(layout, 12, "line");
    const motion = new TroopChoreography(slots, 0, 0);
    motion.advance(100, 9);
    expect(motion.count).toBe(11);
    const dead = motion.dead(100)[0];
    expect(dead.row).toBe(Math.max(...slots.map((s) => s.row)));
    motion.advance(600, 9);
    expect(motion.count).toBe(11);
    expect(motion.soldiers(600).some((m) => m.moving)).toBe(true);
    expect(motion.dead(600)[0].x).toBe(dead.x);
    expect(motion.dead(600)[0].y).toBe(dead.y);
    motion.soldiers(2000);
    expect(
      motion.soldiers(2000).some((m) => m.x === dead.x && m.y === dead.y),
    ).toBe(true);
  });
  it("varies victims and clears expired corpses while draining to zero", () => {
    const slots = formationSlots(layout, 12, "line");
    const victims = [0, 1, 2].map((variant) => {
      const motion = new TroopChoreography(slots, variant, 0);
      motion.advance(1000, 11);
      return motion.dead(1000)[0].x;
    });
    expect(new Set(victims).size).toBe(3);
    const motion = new TroopChoreography(slots, 0, 0);
    for (let now = 0; now <= 60000; now += 100) motion.advance(now, 0);
    expect(motion.count).toBe(0);
    expect(motion.dead(60000)).toHaveLength(0);
    expect(motion.soldiers(60000)).toHaveLength(0);
  });
  it("starts interrupted transitions from the current pose and keeps rear vacancies", () => {
    const slots = formationSlots(layout, 12, "line");
    const motion = new TroopChoreography(slots, 0, 0);
    motion.reshape(formationSlots(layout, 12, "wedge"), 0);
    const before = motion.soldiers(500);
    motion.reshape(formationSlots(layout, 12, "square"), 500);
    expect(motion.soldiers(500).map((s) => [s.id, s.x, s.y])).toEqual(
      before.map((s) => [s.id, s.x, s.y]),
    );
    motion.soldiers(10000);
    motion.advance(10000, 8);
    for (let now = 10000; now < 30000; now += 100) motion.advance(now, 8);
    motion.reshape(slots, 30000);
    const final = motion.soldiers(40000);
    expect(final).toHaveLength(8);
    expect(final.filter((s) => s.front)).toHaveLength(4);
  });
});
