import { describe, expect, it, vi } from "vitest";
import layout from "../../Art/Cultures/Russians/Units/StoneAge/Clubman/Formation/formation.json";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FormationSoldierMotion } from "../../src/skirmish/client/FormationSoldierMotion";
import { SoldierDrawQueue } from "../../src/skirmish/client/SoldierDrawQueue";
import { formationLocomotion } from "../../src/skirmish/FormationLocomotion";
import { FIXED, type Snapshot, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { actorFormationSlots } from "./browser/DemoTroopPresentation";
import { StoneAgeDemoActors } from "./browser/StoneAgeDemoActors";
import { TroopChoreography } from "./browser/TroopChoreography";
import {
  resolveFormation,
  type ActorClip,
  type FormationLayout,
} from "./browser/TroopPrototypeModel";

describe("mobile mass formation", () => {
  it("keeps followers close through acceleration, reversal, and cornering without increasing root speed", () => {
    const terrain = new Uint8Array(48 * 48).fill(133);
    const game = new Skirmish(
      new GameMapImpl(48, 48, terrain, terrain.length),
      { seed: 42, aiCount: 1, tribes: false, runAi: false },
    );
    for (const mounted of [false, true])
      for (const framesPerTick of [1, 3, 6]) {
        let squad: Squad = {
          ...game.squads[0],
          x: 0,
          y: 0,
          kind: mounted ? "cavalry" : "infantry",
          fighting: false,
          charge: null,
          order: { type: "move", tile: 0 },
          locomotion: {
            heading: -Math.PI / 2,
            targetHeading: -Math.PI / 2,
            speed: 0,
          },
        };
        const maximum = ((mounted ? 2.5 : 1.5) * FIXED) / 20;
        const followers = new FormationSoldierMotion(2);
        const base = actorFormationSlots(
          layout,
          mounted,
          "mass",
          mounted ? 0.51 : 0.24,
        ).map((slot, id) => ({ ...slot, id, front: true }));
        const options = {
          footprint: 2 / 0.75,
          mounted,
          engaged: false,
          combatFootwork: true,
          reformInPlace: true,
          looseTravel: true,
        };
        followers.sample(0, { x: 0, y: 0 }, 0, base, options);
        let worst = 0;
        for (let tick = 1; tick <= 200; tick++) {
          const goal =
            tick < 60
              ? { x: 12 * FIXED, y: 0 }
              : tick < 120
                ? { x: -5 * FIXED, y: 0 }
                : { x: -5 * FIXED, y: 7 * FIXED };
          const previous = { x: squad.x / FIXED, y: squad.y / FIXED };
          const result = formationLocomotion(
            squad,
            { squad, goal, speed: maximum },
            maximum,
            true,
            true,
          );
          const velocity = result.intent.preferredVelocity!;
          expect(result.motion.speed).toBeLessThanOrEqual(maximum);
          squad = {
            ...squad,
            x: squad.x + velocity.x,
            y: squad.y + velocity.y,
            locomotion: result.motion,
          };
          for (let frame = 1; frame <= framesPerTick; frame++) {
            const t = frame / framesPerTick;
            const anchor = {
              x: previous.x + (squad.x / FIXED - previous.x) * t,
              y: previous.y + (squad.y / FIXED - previous.y) * t,
            };
            const slots = base.map((s) => ({
              ...s,
              angle: result.motion.targetHeading,
            }));
            const soldiers = followers.sample(
              (tick - 1 + t) * 50,
              anchor,
              0,
              slots,
              options,
            );
            soldiers.forEach((s, i) => {
              worst = Math.max(
                worst,
                Math.hypot(
                  s.x - anchor.x - base[i].x * options.footprint,
                  s.y - anchor.y - base[i].y * options.footprint,
                ),
              );
            });
          }
        }
        expect(worst).toBeLessThan(0.65);
      }
  });
  it("faces each soldier's velocity, permits varied lag, and settles without idle twisting", () => {
    const followers = new FormationSoldierMotion(3);
    const slots = Array.from({ length: 12 }, (_, id) => ({
      id,
      x: (id % 4) * 0.2,
      y: Math.floor(id / 4) * 0.2,
      angle: 0,
      scale: 0.24,
      front: true,
    }));
    const options = {
      footprint: 1,
      mounted: false,
      engaged: false,
      combatFootwork: true,
      reformInPlace: true,
      looseTravel: true,
    };
    followers.sample(0, { x: 0, y: 0 }, 0, slots, options);
    let soldiers = followers.sample(0, { x: 0, y: 0 }, 0, slots, options);
    for (let frame = 1; frame <= 120; frame++)
      soldiers = followers.sample(
        (frame * 1000) / 60,
        { x: frame / 60, y: 0 },
        0,
        slots,
        options,
      );
    expect(soldiers.every((s) => Math.abs(s.angle + Math.PI / 2) < 0.2)).toBe(
      true,
    );
    const lag = soldiers.map((s, i) => 2 + slots[i].x - s.x);
    expect(Math.max(...lag) - Math.min(...lag)).toBeGreaterThan(0.05);
    expect(Math.max(...lag)).toBeLessThan(0.4);
    for (let frame = 121; frame <= 420; frame++)
      soldiers = followers.sample(
        (frame * 1000) / 60,
        { x: 2, y: 0 },
        0,
        slots,
        options,
      );
    const settled = soldiers.map((s) => ({ x: s.x, y: s.y, angle: s.angle }));
    for (let frame = 421; frame <= 480; frame++)
      soldiers = followers.sample(
        (frame * 1000) / 60,
        { x: 2, y: 0 },
        0,
        slots,
        options,
      );
    soldiers.forEach((s, i) => {
      expect(s.x).toBeCloseTo(settled[i].x, 4);
      expect(s.y).toBeCloseTo(settled[i].y, 4);
      expect(s.angle).toBeCloseTo(settled[i].angle, 4);
    });
  });
  it("keeps all soldiers at their audited size and clears cavalry in every turn direction", () => {
    for (const mounted of [false, true]) {
      const scale = mounted ? 0.51 : 0.24;
      const slots = actorFormationSlots(layout, mounted, "mass", scale);
      expect(slots).toHaveLength(mounted ? 6 : 12);
      expect(slots.every((s) => s.scale === scale)).toBe(true);
      if (mounted)
        for (let i = 0; i < slots.length; i++)
          for (let j = i + 1; j < slots.length; j++)
            expect(
              Math.hypot(slots[i].x - slots[j].x, slots[i].y - slots[j].y) *
                (2 / 0.75),
            ).toBeGreaterThan(scale * (400 / 512) * (2 / 0.75));
      expect(resolveFormation("mass", mounted, false)).toBe("mass");
      expect(resolveFormation("mass", mounted, true)).toBe("wedge");
    }
  });
  it("turns while beginning loose travel instead of waiting for every soldier to pivot", () => {
    const slots = [{ id: 0, x: 0, y: 0, scale: 0.24, front: true, angle: 0 }];
    const ordinary = {
      footprint: 1,
      mounted: false,
      engaged: false,
      combatFootwork: true,
      reformInPlace: true,
    };
    const strict = new FormationSoldierMotion(),
      mass = new FormationSoldierMotion();
    strict.sample(0, { x: 0, y: 0 }, 0, slots, ordinary);
    mass.sample(0, { x: 0, y: 0 }, 0, slots, {
      ...ordinary,
      looseTravel: true,
    });
    const changed = [{ ...slots[0], angle: -Math.PI / 2 }];
    const held = strict.sample(50, { x: 0.1, y: 0 }, 0, changed, ordinary)[0];
    const mobile = mass.sample(50, { x: 0.1, y: 0 }, 0, changed, {
      ...ordinary,
      looseTravel: true,
    })[0];
    expect(held.x).toBe(0);
    expect(mobile.x).toBeGreaterThan(0);
    expect(mobile.x).toBeLessThan(0.1);
    expect(mobile.turning).toBe(true);
  });
  it("does not compile reshape tracks or exchange positions on direction changes", () => {
    let now = 0;
    const troop = {
      name: "Clubman",
      age: "StoneAge",
      mounted: false,
      ranged: false,
      memberScale: 0.24,
    };
    const actors = new StoneAgeDemoActors(() => now, {
      reformInPlace: true,
      troops: [troop],
      byDefinitionId: new Map([["stoneage-infantry", troop]]),
      formationForSquad: () => "mass",
    });
    const internal = actors as unknown as {
      loaded: Set<string>;
      layouts: Map<string, FormationLayout>;
      assets: Map<string, { clip: ActorClip; image: HTMLImageElement }>;
      motions: Map<number, { motion: TroopChoreography }>;
      drawQueue: SoldierDrawQueue;
    };
    internal.layouts.set("Clubman", layout);
    const frame = {
      x: 0,
      y: 0,
      width: 512,
      height: 512,
      pivot: { x: 256, y: 256 },
    };
    for (const id of ["idle", "running", "attack", "death"])
      internal.assets.set(`Clubman:${id}`, {
        image: {} as HTMLImageElement,
        clip: { id, file: "test.png", frameCount: 1, fps: 6, frames: [frame] },
      });
    actors.ready = true;
    internal.loaded.add("Clubman");
    const terrain = new Uint8Array(48 * 48).fill(133);
    const game = new Skirmish(
      new GameMapImpl(48, 48, terrain, terrain.length),
      { seed: 42, aiCount: 1, tribes: false, runAi: false },
    );
    let squad = {
      ...game.snapshot().squads[0],
      definitionId: "stoneage-infantry",
      troops: 1000,
      fighting: false,
      charge: null,
      locomotion: { heading: 0, targetHeading: 0, speed: 0 },
    } as Snapshot["squads"][number];
    const ctx = {
      canvas: { width: 800, height: 600 },
    } as CanvasRenderingContext2D;
    const draw = () => {
      actors.prune({
        ...game.snapshot(),
        squads: [squad],
        buildings: [],
        volleys: [],
      });
      actors.beginFrame();
      expect(
        actors.draw(ctx, squad, { x: 400, y: 300 }, 0, 32, 0, { x: 12, y: 12 }),
      ).toBe(true);
      return internal.drawQueue
        .sort()
        .map((e) => [e.soldierId, e.screenX, e.screenY]);
    };
    const initial = draw();
    const choreography = internal.motions.get(squad.id)!.motion;
    const reorient = vi.spyOn(choreography, "reorient"),
      reshape = vi.spyOn(choreography, "reshape");
    for (const facing of [Math.PI / 2, Math.PI, -Math.PI / 2, 0]) {
      now += 100;
      squad = {
        ...squad,
        locomotion: { heading: facing, targetHeading: facing, speed: 0 },
      };
      expect(draw()).toEqual(initial);
    }
    expect(reorient).not.toHaveBeenCalled();
    expect(reshape).not.toHaveBeenCalled();
    expect(choreography.count).toBe(12);
  });
});
