import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  FIXED,
  TICK_MS,
  type ArcherVolley,
  type Snapshot,
} from "../../src/skirmish/Protocol";
import { formationRenderPose } from "../../src/skirmish/client/FormationRenderPose";
import { BattleLabModel } from "../../src/skirmish/client/lab/BattleLabModel";
import { RangedAttackPresentation } from "../../src/skirmish/client/troops/RangedAttackPresentation";
import { RUSSIAN_TROOP_ACTORS } from "../../src/skirmish/client/troops/RussianTroopCatalogue";
import { TroopActors } from "../../src/skirmish/client/troops/TroopActors";
import type { ActorManifest } from "../../src/skirmish/client/troops/TroopFormationModel";
import { TroopImpacts } from "../../src/skirmish/client/troops/TroopImpacts";
import {
  TroopVolley,
  type VolleyThrower,
} from "../../src/skirmish/client/troops/TroopVolley";
import { UNIT } from "../../src/skirmish/content/Units";
import { hybridCombatScene } from "./fixtures/HybridCombat";

const manifest = (name: string): ActorManifest =>
  JSON.parse(
    readFileSync(`Art/Runtime/Russians/Troops/${name}/animations.json`, "utf8"),
  );
const automatic = manifest("Modern-RPL20Gunner").animations.find(
  (c) => c.id === "attack",
)!;
const source = (last: number, next = last + 2) =>
  ({
    id: 1,
    fighting: true,
    lastAttackTick: last,
    nextAttackTick: next,
  }) as Snapshot["squads"][number];

describe("ranged attack presentation", () => {
  it("shows a hybrid unit's ranged preparation while its contacting soldiers commit melee strikes", () => {
    const { game, grenadiers } = hybridCombatScene();
    game.expansion!.battle.fight([]);
    const troop = RUSSIAN_TROOP_ACTORS.get(grenadiers.definitionId!)!;
    const actors = new TroopActors(() => 0, {
      troops: [troop],
      byDefinitionId: new Map([[grenadiers.definitionId!, troop]]),
    });
    const internals = actors as any;
    internals.loaded.add(troop.name);
    for (const clip of manifest(troop.name).animations)
      internals.assets.set(`${troop.name}:${clip.id}`, {
        clip,
        image: { id: clip.id },
      });
    vi.spyOn(internals.factionFrames, "get").mockImplementation(
      (_key: any, image: any, _mask: any, frame: any) => ({ image, frame }),
    );
    const queued = vi.spyOn(internals.drawQueue, "add");
    actors.prune(game.snapshot());
    actors.beginFrame();
    const root = { x: grenadiers.x / FIXED, y: grenadiers.y / FIXED },
      pose = formationRenderPose(grenadiers, 0, root);
    actors.draw(
      { canvas: { width: 2048, height: 2048 } } as any,
      grenadiers,
      { x: 1024, y: 1024 },
      pose.geometry.angle,
      64,
      0,
      root,
      pose,
    );
    expect(grenadiers.meleeStrike).toBeDefined();
    expect(grenadiers.weaponState?.rangedAction?.phase).toBe("preparing");
    expect(
      (queued.mock.calls as any[][]).some((c) => c[6].id === "attack"),
    ).toBe(true);
    expect(grenadiers.weaponState?.ranged?.lastShotTick).toBeUndefined();
  });
  it("enters first shots at release and retains a burst clock across successive shots and duplicate frames", () => {
    const playback = new RangedAttackPresentation();
    expect(playback.sample(source(20), 20, automatic, 100)).toBe(580);
    expect(playback.sample(source(21), 21, automatic, 100)).toBe(580 + TICK_MS);
    expect(playback.sample(source(22), 22, automatic, 100)).toBe(
      580 + 2 * TICK_MS,
    );
    expect(playback.sample(source(22), 22, automatic, 100)).toBe(
      580 + 2 * TICK_MS,
    );
    // A genuine interruption begins a new burst at release.
    expect(playback.sample(source(60), 60, automatic, 100)).toBe(580);
  });
  it("uses the ranged channel independently of newer melee timestamps and supports reset/retirement", () => {
    const playback = new RangedAttackPresentation();
    const s = {
      ...source(100),
      weaponState: {
        sharedReadyTick: 100,
        ranged: { lastShotTick: 20, nextTick: 22, shots: 1, remainder: 0 },
      },
    };
    expect(playback.sample(s, 20, automatic, 100)).toBe(580);
    expect(
      playback.sample(
        {
          ...s,
          weaponState: {
            ...s.weaponState,
            ranged: { ...s.weaponState.ranged, lastShotTick: 21 },
          },
        },
        21,
        automatic,
        100,
      ),
    ).toBe(580 + TICK_MS);
    playback.prune(new Set());
    expect(playback.sample(source(24), 24, automatic, 100)).toBe(580);
    playback.clear();
    expect(playback.sample(source(26), 26, automatic, 100)).toBe(580);
  });
  it("bridges sparse publications with retained shot facts without resetting the firing loop", () => {
    const playback = new RangedAttackPresentation();
    playback.sample(source(20), 20, automatic, 100);
    playback.observe(
      [24, 22, 21, 23].map((tick) => ({
        id: tick,
        tick,
        squadId: 1,
        playerId: 1,
        fromX: 0,
        fromY: 0,
        toX: 1,
        toY: 1,
      })),
    );
    expect(playback.sample(source(24), 24, automatic, 100)).toBe(
      580 + ((4 * TICK_MS) % 530),
    );
  });
  it("preserves slow-weapon wind-up and stops inventing attacks after overdue readiness", () => {
    const playback = new RangedAttackPresentation();
    expect(playback.sample(source(20, 70), 19, automatic, 2500)).toBe(
      580 - TICK_MS,
    );
    expect(playback.sample(source(20, 70), 20, automatic, 2500)).toBe(580);
    expect(playback.sample(source(0, 10), 40, automatic, 2500)).toBeUndefined();
  });
  it.each([
    "classicalage-rangedcavalry",
    "earlymedieval-rangedcavalry",
    "latemedieval-rangedcavalry",
    "earlymodern-rangedcavalry",
    "napoleonic-archer",
    "modern-archer",
  ])(
    "shows %s firing at a visible opponent and anchors shots to its actual draw",
    (id) => {
      const troop = RUSSIAN_TROOP_ACTORS.get(id)!;
      const count = Math.min(6, UNIT.get(id)!.formationRecipe!.capacity);
      const model = new BattleLabModel([
        {
          side: 1,
          definitionId: id,
          formations: 1,
          soldiers: count,
          variant: "base",
          shape: "mass",
        },
      ]);
      const squad = {
        ...model.game.snapshot().squads[0],
        lastAttackTick: 20,
        nextAttackTick: 70,
        fighting: true,
      };
      const actors = new TroopActors(() => 20 * TICK_MS, {
        troops: [troop],
        byDefinitionId: new Map([[id, troop]]),
      });
      const internals = actors as any;
      internals.loaded.add(troop.name);
      for (const clip of manifest(troop.name).animations)
        internals.assets.set(`${troop.name}:${clip.id}`, {
          clip,
          image: { id: clip.id },
        });
      vi.spyOn(internals.factionFrames, "get").mockImplementation(
        (_key: any, image: any, _mask: any, frame: any) => ({ image, frame }),
      );
      const queued = vi.spyOn(internals.drawQueue, "add");
      internals.cavalryContinuity.set(squad.id, {
        sample: (_key: string, _time: number, poses: any[]) =>
          new Map(
            poses.map((p) => [
              p.id,
              {
                ...p,
                x: p.x + 0.2,
                angle: p.angle + 0.1,
                recovering: true,
                moving: true,
                gaitDistance: 2,
              },
            ]),
          ),
      });
      const root = { x: squad.x / FIXED, y: squad.y / FIXED };
      internals.contacts.set(squad.id, {
        target: { x: root.x + 6, y: root.y },
        threats: [],
        opponents: [],
      });
      const pose = formationRenderPose(squad, 20, root);
      actors.beginFrame();
      actors.draw(
        { canvas: { width: 2048, height: 2048 } } as any,
        squad,
        { x: 1024, y: 1024 },
        pose.geometry.angle,
        64,
        20,
        root,
        pose,
      );
      expect(queued).toHaveBeenCalledTimes(count);
      const throwers: VolleyThrower[] = internals.throwers.get(squad.id);
      for (const call of queued.mock.calls as any[][]) {
        expect(call[6].id).toBe("attack");
        const shooter = throwers.find((s) => s.id === call[1])!;
        expect(shooter.throwing).toBe(true);
        expect(call[2]).toBeCloseTo(1024 + (shooter.x - root.x) * 64);
        expect(call[3]).toBeCloseTo(1024 + (shooter.y - root.y) * 64);
        expect(call[4]).toBeCloseTo(shooter.angle + (troop.facingOffset ?? 0));
      }
    },
  );
  it("anchors smoke to the same frozen launch, retries absent poses, and ages it from the shot tick", () => {
    const effects = new TroopImpacts(),
      flights = new TroopVolley();
    const clip = manifest("EarlyModern-MountedMusketeer").animations.find(
      (c) => c.id === "attack",
    )!;
    const fact: ArcherVolley = {
      id: 7,
      tick: 20,
      squadId: 1,
      playerId: 1,
      definitionId: "earlymodern-rangedcavalry",
      fromX: 0,
      fromY: 0,
      toX: 2560,
      toY: 0,
    };
    effects.release(fact, 20, []);
    const shooter = {
      id: 3,
      x: 2,
      y: 3,
      angle: 0,
      scale: 0.3,
      speed: 0,
      gaitDistance: 0,
      front: true,
      throwing: true,
    } as VolleyThrower;
    flights.sample(fact, 20, [shooter], clip, 2);
    effects.release(fact, 22, flights.releases(fact.id));
    effects.release(fact, 23, flights.releases(fact.id));
    const smoke = (effects as any).smoke;
    expect(smoke).toHaveLength(1);
    expect(smoke[0]).toMatchObject({
      x: flights.releases(7)[0].x,
      y: flights.releases(7)[0].y,
      time: 20 * TICK_MS,
    });
    expect(smoke[0].y).not.toBe(shooter.y);
    effects.release(
      { ...fact, id: 8 },
      20 + 2500 / TICK_MS,
      flights.releases(7),
    );
    expect(smoke).toHaveLength(1);
  });
  it("captures late muzzle smoke without replaying an already finished bullet flight", () => {
    const flights = new TroopVolley();
    const fact = {
      id: 4,
      tick: 20,
      squadId: 1,
      playerId: 1,
      fromX: 0,
      fromY: 0,
      toX: 1000,
      toY: 0,
    };
    const shooter = {
      id: 1,
      x: 0,
      y: 0,
      angle: 0,
      scale: 1,
      throwing: true,
    } as VolleyThrower;
    expect(
      flights.sample(
        fact,
        22,
        [shooter],
        automatic,
        2,
        undefined,
        0,
        false,
        200 / TICK_MS,
        [],
        [],
        530 / TICK_MS,
      ),
    ).toEqual([]);
    expect(flights.releases(fact.id)).toHaveLength(1);
    const effects = new TroopImpacts();
    effects.release(
      { ...fact, definitionId: "earlymodern-rangedcavalry" },
      22,
      flights.releases(fact.id),
      590,
    );
    expect((effects as any).smoke[0].visibleAfter).toBe(590);
  });
});
