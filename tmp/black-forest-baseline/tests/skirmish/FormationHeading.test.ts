import { describe, expect, it } from "vitest";
import { FormationHeading } from "../../src/skirmish/client/FormationHeading";
import { FIXED, type Snapshot, type Squad } from "../../src/skirmish/Protocol";

const squad = (changes: Partial<Squad> = {}): Squad => ({ id: 1, playerId: 1,
  x: 10 * FIXED, y: 10 * FIXED, moved: false, fighting: false, charge: null,
  order: { type: "hold" }, path: [], nextPathIndex: 0, ...changes } as Squad);
const snapshot = (squads: Squad[]): Snapshot => ({ width: 64, squads, buildings: [] } as unknown as Snapshot);
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

describe("formation intent heading", () => {
  it("uses authoritative facing even when a new click points behind the squad", () => {
    const heading = new FormationHeading(() => Math.PI, 60);
    const actor = squad({ locomotion: { heading: 0, targetHeading: 0, speed: 0 },
      order: { type: "move", tile: 0 } });
    heading.update(snapshot([actor]), 0);
    expect(heading.angle(1, 100)).toBe(0);
    heading.update(snapshot([{ ...actor, locomotion: { heading: Math.PI / 60, targetHeading: Math.PI, speed: 0 } }]), 100);
    expect(heading.angle(1, 150)).toBeCloseTo(Math.PI / 60);
  });
  it("ignores alternating avoidance corrections while pursuing the same enemy", () => {
    const heading = new FormationHeading();
    const enemy = squad({ id: 2, playerId: 2, y: 20 * FIXED });
    for (let tick = 0; tick < 100; tick++) {
      heading.update(snapshot([squad({ x: 10 * FIXED + (tick % 2 ? 8 : -8), moved: true,
        order: { type: "attack", targetId: 2 } }), enemy]), tick * 50);
      expect(Math.abs(heading.angle(1, tick * 50))).toBeLessThan(0.01);
    }
  });
  it("turns gradually when an actual order reverses and holds facing on arrival", () => {
    const heading = new FormationHeading();
    heading.update(snapshot([squad()]), 0);
    const move = squad({ order: { type: "move", tile: 0 } });
    heading.update(snapshot([move]), 50);
    let previous = heading.angle(1, 50);
    for (let now = 100; now <= 1000; now += 50) {
      const angle = heading.angle(1, now);
      expect(turn(previous, angle)).toBeLessThanOrEqual(Math.PI * 0.05 + 1e-10);
      previous = angle;
    }
    const expected = Math.atan2(0.5 - 10, 0.5 - 10) - Math.PI / 2;
    expect(turn(previous, expected)).toBeLessThan(1e-8);
    heading.update(snapshot([squad({ x: FIXED / 2 + 1, y: FIXED / 2,
      order: { type: "move", tile: 0 } })]), 1050);
    expect(turn(heading.angle(1, 1100), expected)).toBeLessThan(1e-8);
  });
  it("uses sustained travel to follow route bends without needing replicated waypoints", () => {
    const heading = new FormationHeading();
    const order = { type: "move", tile: 10 * 64 + 20 } as const;
    heading.update(snapshot([squad({ order })]), 0);
    for (let now = 50; now <= 1000; now += 50)
      heading.update(snapshot([squad({ y: 10.5 * FIXED, moved: true, order })]), now);
    expect(Math.abs(heading.angle(1, 1000))).toBeLessThan(0.01);
    heading.update(snapshot([squad({ x: 10 * FIXED - 2, y: 10.5 * FIXED, moved: true, order })]), 1050);
    expect(Math.abs(heading.angle(1, 1100))).toBeLessThan(0.01);
  });
  it("keeps the turn limit across long gaps and discards retired identities", () => {
    const heading = new FormationHeading(() => Math.PI);
    heading.update(snapshot([squad({ order: { type: "move", tile: 20 * 64 + 10 } })]), 0);
    expect(turn(Math.PI, heading.angle(1, 10000))).toBeLessThanOrEqual(Math.PI / 10 + 1e-10);
    heading.update(snapshot([]), 10050);
    heading.update(snapshot([squad()]), 10100);
    expect(heading.angle(1, 10100)).toBe(Math.PI);
  });
});
