import { describe, expect, it } from "vitest";
import layout from "../../Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/formation.json";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FormationEngagement } from "../../src/skirmish/client/FormationEngagement";
import { FormationHeading } from "../../src/skirmish/client/FormationHeading";
import { minimumTravelAssignment } from "../../src/skirmish/client/FormationSlotAssignment";
import { FormationSoldierMotion } from "../../src/skirmish/client/FormationSoldierMotion";
import {
  chargeAligned,
  formationLocomotion,
  headingDifference,
} from "../../src/skirmish/FormationLocomotion";
import { FIXED, type Snapshot, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { actorFormationSlots } from "./browser/DemoTroopPresentation";
import { TroopChoreography } from "./browser/TroopChoreography";
const difference = (a: number, b: number) => Math.abs(headingDifference(a, b));
function squad(mounted: boolean): Squad {
  const terrain = new Uint8Array(48 * 48).fill(133);
  const game = new Skirmish(new GameMapImpl(48, 48, terrain, terrain.length), {
    seed: 42,
    aiCount: 1,
    tribes: false,
    runAi: false,
  });
  return {
    ...game.squads[0],
    kind: mounted ? "cavalry" : "infantry",
    fighting: false,
    order: { type: "hold" },
    charge: null,
    locomotion: { heading: 0, targetHeading: 0, speed: 0 },
  };
}
describe("turn-in-place formation reorientation", () => {
  it("globally minimizes travel instead of greedily assigning the nearest man to the first slot", () => {
    expect(
      minimumTravelAssignment(
        [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
        ],
        [
          { x: 1.1, y: 0 },
          { x: 3, y: 0 },
        ],
      ),
    ).toEqual([0, 1]);
  });
  it.each([false, true])(
    "reverses a full line without making soldiers exchange world positions (mounted=%s)",
    (mounted) => {
      const slots = actorFormationSlots(
        layout,
        mounted,
        "line",
        mounted ? 0.5 : 0.24,
      );
      const choreography = new TroopChoreography(slots, 0, 0),
        motion = new FormationSoldierMotion();
      const options = {
        footprint: 2 / 0.75,
        mounted,
        engaged: false,
        combatFootwork: true,
        reformInPlace: true,
      };
      const initial = motion.sample(
        0,
        { x: 0, y: 0 },
        0,
        choreography.soldiers(0),
        options,
      );
      choreography.reorient(-Math.PI, 0);
      for (const fps of [10, 30, 120]) {
        const walker = new FormationSoldierMotion();
        walker.sample(
          0,
          { x: 0, y: 0 },
          0,
          slots.map((s, id) => ({ ...s, id, front: true })),
          options,
        );
        let last = initial;
        for (let i = 1; i <= fps; i++) {
          last = walker.sample(
            (i * 1000) / fps,
            { x: 0, y: 0 },
            Math.PI,
            choreography.soldiers((i * 1000) / fps),
            options,
          );
          for (const soldier of last) {
            const before = initial.find((s) => s.id === soldier.id)!;
            expect(
              Math.hypot(soldier.x - before.x, soldier.y - before.y),
            ).toBeLessThan(0.001);
          }
        }
        expect(last.every((s) => difference(s.angle, Math.PI) < 0.02)).toBe(
          true,
        );
      }
      const originalFront = new Set(
        initial.filter((s) => s.front).map((s) => s.id),
      );
      expect(
        choreography
          .soldiers(1000)
          .filter((s) => s.front)
          .every((s) => !originalFront.has(s.id)),
      ).toBe(true);
    },
  );
  it("keeps world position continuous through a quarter turn and a second order during reshaping", () => {
    const motion = new TroopChoreography(
      actorFormationSlots(layout, false, "line", 0.24),
      0,
      0,
    );
    const before = motion.soldiers(0);
    motion.reorient(-Math.PI / 2, 0);
    const quarter = motion.soldiers(0);
    for (const soldier of quarter) {
      const old = before.find((s) => s.id === soldier.id)!;
      expect(-soldier.y).toBeCloseTo(old.x);
      expect(soldier.x).toBeCloseTo(old.y);
    }
    const midway = motion.soldiers(100);
    motion.reorient(Math.PI / 2, 100);
    for (const soldier of motion.soldiers(100)) {
      const old = midway.find((s) => s.id === soldier.id)!;
      expect(soldier.x).toBeCloseTo(-old.y);
      expect(soldier.y).toBeCloseTo(old.x);
    }
    expect(new Set(motion.soldiers(2000).map((s) => s.id)).size).toBe(12);
    expect(motion.soldiers(2000).every((s) => s.scale === 0.24)).toBe(true);
  });
  it.each([false, true])(
    "brakes old momentum and launches a stationary reversal within one second (mounted=%s)",
    (mounted) => {
      let actor = squad(mounted),
        firstLaunch = -1;
      const goal = { x: actor.x, y: actor.y - 10 * FIXED };
      for (let tick = 1; tick <= 20; tick++) {
        const result = formationLocomotion(
          actor,
          { squad: actor, goal, speed: 16 },
          16,
          true,
        );
        const velocity = result.intent.preferredVelocity!;
        if (velocity.y < 0 && firstLaunch < 0) {
          firstLaunch = tick;
          expect(difference(result.motion.heading, Math.PI)).toBeLessThan(
            Math.PI / 15,
          );
        }
        actor = {
          ...actor,
          x: actor.x + velocity.x,
          y: actor.y + velocity.y,
          locomotion: result.motion,
        };
      }
      expect(firstLaunch).toBeGreaterThan(0);
      expect(firstLaunch).toBeLessThanOrEqual(20);
      actor = {
        ...actor,
        locomotion: { heading: 0, targetHeading: 0, speed: 16 },
      };
      const brake = formationLocomotion(
        actor,
        { squad: actor, goal, speed: 16 },
        16,
        true,
      );
      expect(brake.motion.heading).toBe(0);
      expect(brake.intent.preferredVelocity!.y).toBeGreaterThan(0);
      expect(brake.motion.speed).toBeLessThan(16);
    },
  );
  it.each([false, true])(
    "keeps the squad and soldiers aligned through a moving reversal (mounted=%s)",
    (mounted) => {
      let actor = squad(mounted);
      const choreography = new TroopChoreography(
        actorFormationSlots(layout, mounted, "line", mounted ? 0.5 : 0.24),
        0,
        0,
      );
      const walker = new FormationSoldierMotion();
      const options = {
        footprint: 2 / 0.75,
        mounted,
        engaged: false,
        combatFootwork: true,
        reformInPlace: true,
      };
      let now = 0,
        frameHeading = 0;
      walker.sample(
        now,
        { x: actor.x / FIXED, y: actor.y / FIXED },
        frameHeading,
        choreography.soldiers(now),
        options,
      );
      let worstGap = 0,
        newLaunch = false;
      for (let tick = 1; tick <= 60; tick++) {
        const reversing = tick > 20;
        const goal = {
          x: actor.x,
          y: actor.y + (reversing ? -10 : 10) * FIXED,
        };
        const result = formationLocomotion(
          actor,
          { squad: actor, goal, speed: 16 },
          16,
          true,
        );
        now += 50;
        if (difference(frameHeading, result.motion.targetHeading) > 0.001) {
          choreography.reorient(
            frameHeading - result.motion.targetHeading,
            now,
          );
          frameHeading = result.motion.targetHeading;
        }
        const velocity = result.intent.preferredVelocity!;
        actor = {
          ...actor,
          x: actor.x + velocity.x,
          y: actor.y + velocity.y,
          locomotion: result.motion,
        };
        const soldiers = walker.sample(
          now,
          { x: actor.x / FIXED, y: actor.y / FIXED },
          frameHeading,
          choreography.soldiers(now),
          options,
        );
        if (reversing && velocity.y < 0 && !newLaunch) {
          newLaunch = true;
          expect(
            soldiers.every((s) => difference(s.angle, Math.PI) < Math.PI / 6),
          ).toBe(true);
        }
        for (const soldier of soldiers) {
          const slot = choreography
            .soldiers(now)
            .find((s) => s.id === soldier.id)!;
          const x =
            actor.x / FIXED +
            (slot.x * Math.cos(frameHeading) -
              slot.y * Math.sin(frameHeading)) *
              options.footprint;
          const y =
            actor.y / FIXED +
            (slot.x * Math.sin(frameHeading) +
              slot.y * Math.cos(frameHeading)) *
              options.footprint;
          worstGap = Math.max(
            worstGap,
            Math.hypot(soldier.x - x, soldier.y - y),
          );
        }
      }
      expect(newLaunch).toBe(true);
      expect(worstGap).toBeLessThan(0.3);
    },
  );
  it("holds preparation through a rear charge turn even in the rapid mode", () => {
    let actor = squad(true);
    actor = {
      ...actor,
      charge: {
        phase: "preparing",
        x: actor.x,
        y: actor.y - 10 * FIXED,
        startTick: 0,
        committedTick: 0,
      },
    };
    for (let tick = 1; tick <= 16; tick++) {
      const result = formationLocomotion(actor, undefined, 24, true);
      expect(result.motion.speed).toBe(0);
      expect(result.intent.preferredVelocity).toEqual({ x: 0, y: 0 });
      actor = { ...actor, locomotion: result.motion };
      if (tick <= 10) expect(chargeAligned(actor)).toBe(false);
    }
    expect(chargeAligned(actor)).toBe(true);
  });
  it("uses the requested layout frame immediately while keeping physical pivots in the soldier controller", () => {
    const actor = squad(false),
      heading = new FormationHeading(() => 0, 60, true);
    const snapshot = {
      width: 48,
      squads: [actor],
      buildings: [],
    } as unknown as Snapshot;
    heading.update(snapshot, 0);
    snapshot.squads = [
      {
        ...actor,
        locomotion: { ...actor.locomotion!, targetHeading: Math.PI },
      },
    ];
    heading.update(snapshot, 50);
    expect(difference(heading.angle(actor.id, 50), Math.PI)).toBeLessThan(
      0.001,
    );
    snapshot.squads = [
      {
        ...actor,
        locomotion: { ...actor.locomotion!, targetHeading: Math.PI + 0.02 },
      },
    ];
    heading.update(snapshot, 100);
    expect(difference(heading.angle(actor.id, 100), Math.PI)).toBeLessThan(
      0.001,
    );
    const engagement = new FormationEngagement();
    const slots = actorFormationSlots(layout, false, "square", 0.24).map(
      (s, id) => ({ ...s, id, front: true }),
    );
    const response = engagement.sample(0, { x: 0, y: 0 }, slots, {
      active: false,
      charging: false,
      ranged: false,
      square: true,
      footprint: 2 / 0.75,
      travelHeading: Math.PI,
      reformInPlace: true,
      travelling: true,
    });
    expect(response.slots.every((s) => s.angle === 0)).toBe(true);
  });
});
