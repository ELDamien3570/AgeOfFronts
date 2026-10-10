import { describe, expect, it } from "vitest";
import { FormationSoldierMotion } from "../../src/skirmish/client/FormationSoldierMotion";
import {
  chargeAligned,
  FORMATION_MOTION,
  formationLocomotion,
  headingDifference,
} from "../../src/skirmish/FormationLocomotion";
import { formationMovementProfile } from "../../src/skirmish/FormationMovementProfile";
import {
  decodeState,
  encodeState,
} from "../../src/skirmish/multiplayer/StateCodec";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import {
  SnapshotDecoder,
  SnapshotEncoder,
  snapshotTransfers,
} from "../../src/skirmish/SnapshotCodec";
import { stoneAgeDemo } from "./browser/StoneAgeDemoScenario";

function isolated() {
  const game = stoneAgeDemo();
  const cavalry = game.squads.find(
    (s) => s.playerId === 1 && s.kind === "cavalry",
  )!;
  const enemy = game.squads.find(
    (s) => s.playerId === 2 && s.kind === "cavalry",
  )!;
  for (const squad of game.squads.slice())
    if (squad.id !== cavalry.id && squad.id !== enemy.id)
      game.removeSquad(squad.id);
  game.updateSquad(enemy.id, { x: cavalry.x, y: cavalry.y + 8 * FIXED });
  return { game, cavalry, enemy };
}

describe("authoritative formation locomotion", () => {
  it("steers crowd travel through corners without a pivot stop, and launches toward a rear goal immediately", () => {
    for (const kind of ["infantry", "cavalry"] as const) {
      let squad: Squad = {
        ...isolated().cavalry,
        kind,
        fighting: false,
        charge: null,
        order: { type: "move", tile: 0 },
        locomotion: { heading: 0, targetHeading: 0, speed: 0 },
      };
      const advance = (goal: { x: number; y: number }) => {
        const previous = squad.locomotion!;
        const result = formationLocomotion(
          squad,
          { squad, goal, speed: 24 },
          24,
          true,
          true,
        );
        const velocity = result.intent.preferredVelocity!;
        const change = Math.hypot(
          velocity.x + Math.sin(previous.heading) * previous.speed,
          velocity.y - Math.cos(previous.heading) * previous.speed,
        );
        expect(change).toBeLessThanOrEqual(
          (formationMovementProfile(kind === "cavalry").squadBraking * FIXED) /
            400 +
            0.71,
        );
        squad = {
          ...squad,
          x: squad.x + velocity.x,
          y: squad.y + velocity.y,
          locomotion: result.motion,
        };
        return velocity;
      };
      expect(advance({ x: 0, y: -40 * FIXED }).y).toBeLessThan(0);
      for (let i = 0; i < 25; i++) advance({ x: 0, y: -40 * FIXED });
      const speeds: number[] = [];
      for (let i = 0; i < 40; i++) {
        advance({ x: 40 * FIXED, y: squad.y });
        speeds.push(squad.locomotion!.speed);
      }
      expect(Math.min(...speeds)).toBeGreaterThan(10);
      expect(squad.locomotion!.heading).toBeCloseTo(-Math.PI / 2);
      const preparing: Squad = {
        ...squad,
        charge: {
          ...isolated().cavalry.charge!,
          phase: "preparing",
          x: squad.x - 10 * FIXED,
          y: squad.y,
        },
      };
      const charge = formationLocomotion(preparing, undefined, 24, true, true);
      expect(charge.motion.speed).toBeLessThan(squad.locomotion!.speed);
      expect(chargeAligned({ ...preparing, locomotion: charge.motion })).toBe(
        false,
      );
    }
  });
  it("arrives and replays crowd navigation exactly without orbiting", () => {
    const { game, cavalry, enemy } = isolated();
    game.options.formationFreeTravel = true;
    game.options.formationReorientation = true;
    game.removeSquad(enemy.id);
    const tile = game.map.ref(34, 30);
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [cavalry.id],
        order: { type: "move", tile },
      }),
    ).toBeNull();
    for (let i = 0; i < 30; i++) game.step();
    const restored = stoneAgeDemo();
    restored.options.formationFreeTravel = true;
    restored.options.formationReorientation = true;
    restored.restore(game.checkpoint());
    for (let i = 0; i < 570; i++) {
      game.step();
      restored.step();
    }
    expect({ x: cavalry.x, y: cavalry.y }).toEqual({
      x: 34.5 * FIXED,
      y: 30.5 * FIXED,
    });
    expect(cavalry.order.type).toBe("hold");
    expect(cavalry.locomotion!.speed).toBe(0);
    expect(restored.snapshot()).toEqual(game.snapshot());
  });

  it("plants an attacking squad instead of dragging its planted soldiers, while allowing explicit movement", () => {
    const squad: Squad = {
      ...isolated().cavalry,
      fighting: true,
      order: { type: "attack", targetId: 123 },
      locomotion: { heading: 0, targetHeading: 0, speed: 0 },
    };
    const goal = { x: squad.x, y: squad.y + 10 * FIXED };
    const held = formationLocomotion(squad, { squad, goal, speed: 24 }, 24);
    expect(held.motion.speed).toBe(0);
    expect(held.intent.preferredVelocity).toEqual({ x: 0, y: 0 });
    const moving = { ...squad, order: { type: "move" as const, tile: 1 } };
    expect(
      formationLocomotion(moving, { squad: moving, goal, speed: 24 }, 24).motion
        .speed,
    ).toBeGreaterThan(0);
  });
  it("keeps soldier slots close to the squad through acceleration, a reversal and arrival", () => {
    for (const kind of ["infantry", "cavalry"] as const) {
      const mounted = kind === "cavalry";
      const profile = formationMovementProfile(mounted);
      let squad: Squad = {
        ...isolated().cavalry,
        kind,
        x: 0,
        y: 0,
        locomotion: {
          heading: -Math.PI / 2,
          targetHeading: -Math.PI / 2,
          speed: 0,
        },
      };
      const slots = Array.from({ length: 12 }, (_, id) => ({
        id,
        x: ((id % 4) - 1.5) * 0.2,
        y: (Math.floor(id / 4) - 1) * 0.16,
        scale: 0.24,
        front: id >= 8,
      }));
      const followers = new FormationSoldierMotion();
      const options = {
        footprint: 2.66,
        mounted,
        engaged: false,
        combatFootwork: true,
      };
      followers.sample(
        0,
        { x: 0, y: 0 },
        squad.locomotion!.heading,
        slots,
        options,
      );
      let worstGap = 0;
      for (let tick = 1; tick <= 320; tick++) {
        const before = squad;
        const result = formationLocomotion(
          squad,
          { squad, speed: 32, goal: { x: (tick < 80 ? 16 : 0) * FIXED, y: 0 } },
          32,
        );
        const velocity = result.intent.preferredVelocity!;
        squad = {
          ...squad,
          x: squad.x + velocity.x,
          y: squad.y + velocity.y,
          locomotion: {
            ...result.motion,
            speed: Math.hypot(velocity.x, velocity.y),
          },
        };
        for (let frame = 1; frame <= 3; frame++) {
          const fraction = frame / 3;
          const anchor = {
            x: (before.x + (squad.x - before.x) * fraction) / FIXED,
            y: (before.y + (squad.y - before.y) * fraction) / FIXED,
          };
          const heading =
            before.locomotion!.heading +
            headingDifference(
              before.locomotion!.heading,
              squad.locomotion!.heading,
            ) *
              fraction;
          const soldiers = followers.sample(
            (tick - 1 + fraction) * 50,
            anchor,
            heading,
            slots,
            options,
          );
          for (const soldier of soldiers) {
            const slot = slots[soldier.id];
            const targetX =
              anchor.x +
              (slot.x * Math.cos(heading) - slot.y * Math.sin(heading)) *
                options.footprint;
            const targetY =
              anchor.y +
              (slot.x * Math.sin(heading) + slot.y * Math.cos(heading)) *
                options.footprint;
            worstGap = Math.max(
              worstGap,
              Math.hypot(soldier.x - targetX, soldier.y - targetY),
            );
          }
        }
      }
      expect(profile.squadAcceleration).toBeLessThan(
        profile.followerAcceleration * 0.94,
      );
      expect(worstGap).toBeLessThan(0.3);
    }
  });
  it("accelerates to the existing maximum and brakes before reversing", () => {
    let squad: Squad = {
      ...isolated().cavalry,
      locomotion: {
        heading: -Math.PI / 2,
        targetHeading: -Math.PI / 2,
        speed: 0,
      },
    };
    const advance = (x: number) => {
      const oldHeading = squad.locomotion!.heading;
      const result = formationLocomotion(
        squad,
        { squad, goal: { x, y: squad.y }, speed: 24 },
        24,
      );
      expect(
        Math.abs(headingDifference(oldHeading, result.motion.heading)),
      ).toBeLessThanOrEqual(FORMATION_MOTION.turnRate + 1e-10);
      const step = result.intent.preferredVelocity!;
      squad = {
        ...squad,
        x: squad.x + step.x,
        y: squad.y + step.y,
        locomotion: { ...result.motion, speed: Math.hypot(step.x, step.y) },
      };
      return step;
    };
    for (let at = 0; at < 20; at++) advance(60 * FIXED);
    expect(squad.locomotion!.speed).toBe(24);
    const reverseGoal = squad.x - 10 * FIXED;
    expect(advance(reverseGoal).x).toBeGreaterThan(0);
    expect(squad.locomotion!.speed).toBeLessThan(24);
    let firstBackward = -1;
    for (let at = 0; at < 200; at++) {
      const step = advance(reverseGoal);
      if (step.x < 0 && firstBackward === -1) {
        firstBackward = at;
        expect(
          Math.abs(headingDifference(squad.locomotion!.heading, Math.PI / 2)),
        ).toBeLessThan(Math.PI / 3);
      }
    }
    expect(firstBackward).toBeGreaterThan(30);
    expect(squad.locomotion!.speed).toBe(24);
  });

  it("holds its travel heading while individual soldiers handle combat attention", () => {
    const squad = {
      ...isolated().cavalry,
      locomotion: { heading: 0, targetHeading: 0, speed: 0 },
      fighting: true,
    };
    const small = formationLocomotion(squad, undefined, 24);
    expect(small.motion.heading).toBe(0);
    expect(small.intent.preferredVelocity).toEqual({ x: 0, y: 0 });
    const large = formationLocomotion(
      { ...squad, locomotion: { ...squad.locomotion, targetHeading: Math.PI } },
      undefined,
      24,
    );
    expect(large.motion.heading).toBe(0);
    expect(large.motion.speed).toBe(0);
  });

  it("turns toward a rear charge target before run-up or commitment", () => {
    const { game, cavalry, enemy } = isolated();
    expect(
      game.applyCommand({
        type: "charge",
        playerId: 1,
        squadIds: [cavalry.id],
        x: enemy.x,
        y: enemy.y,
        targetId: enemy.id,
      }),
    ).toBeNull();
    expect(cavalry.charge?.phase).toBe("preparing");
    const startY = cavalry.y;
    for (let at = 0; at < 30; at++) game.step();
    expect(cavalry.y).toBe(startY);
    expect(cavalry.charge?.phase).toBe("preparing");
    let committed = false;
    for (let at = 0; at < 150; at++) {
      game.step();
      if (cavalry.charge?.phase === "committed") {
        expect(chargeAligned(cavalry)).toBe(true);
        expect(cavalry.y).toBeGreaterThan(startY);
        committed = true;
        break;
      }
    }
    expect(committed).toBe(true);
  });

  it("uses real navigation to turn, arrive exactly, and stop without an endless orbit", () => {
    const { game, cavalry, enemy } = isolated();
    game.removeSquad(enemy.id);
    const tile = game.map.ref(34, 30);
    const goal = { x: 34.5 * FIXED, y: 30.5 * FIXED };
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [cavalry.id],
        order: { type: "move", tile },
      }),
    ).toBeNull();
    for (let at = 0; at < 600; at++) game.step();
    expect({ x: cavalry.x, y: cavalry.y }).toEqual(goal);
    expect(cavalry.order.type).toBe("hold");
    expect(cavalry.locomotion!.speed).toBe(0);
  });

  it("retains motion and preparing charges through packed transfer, wire encoding and mid-turn checkpoint replay", async () => {
    const { game, cavalry, enemy } = isolated();
    game.applyCommand({
      type: "charge",
      playerId: 1,
      squadIds: [cavalry.id],
      x: enemy.x,
      y: enemy.y,
      targetId: enemy.id,
    });
    for (let at = 0; at < 15; at++) game.step();
    const packet = new SnapshotEncoder().encode(game.snapshot());
    const transferred = structuredClone(packet, {
      transfer: snapshotTransfers(packet),
    });
    const decodedPacket = await decodeState<typeof transferred>(
      await encodeState(transferred),
    );
    const snapshot = new SnapshotDecoder().decode(decodedPacket);
    expect(
      snapshot.squads.find((s) => s.id === cavalry.id)!.locomotion,
    ).toEqual(cavalry.locomotion);
    expect(
      snapshot.squads.find((s) => s.id === cavalry.id)!.charge?.phase,
    ).toBe("preparing");
    const restored = stoneAgeDemo();
    restored.restore(
      await decodeState<ReturnType<typeof game.checkpoint>>(
        await encodeState(game.checkpoint()),
      ),
    );
    for (let at = 0; at < 100; at++) {
      game.step();
      restored.step();
    }
    expect(restored.snapshot()).toEqual(game.snapshot());
  });
});
