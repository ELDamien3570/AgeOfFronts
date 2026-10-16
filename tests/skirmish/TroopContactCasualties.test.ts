import { describe, expect, it, vi } from "vitest";
import { formationRenderPose } from "../../src/skirmish/client/FormationRenderPose";
import { BattleLabModel } from "../../src/skirmish/client/lab/BattleLabModel";
import { TroopActors } from "../../src/skirmish/client/troops/TroopActors";
import {
  meleeCasualtyContact,
  meleeCasualtyScores,
} from "../../src/skirmish/client/troops/TroopCasualties";
import { TroopChoreography } from "../../src/skirmish/client/troops/TroopChoreography";
import { TroopRemains } from "../../src/skirmish/client/troops/TroopRemains";
import { formationFootprint } from "../../src/skirmish/domain/FormationContact";
import {
  formationEnvelope,
  formationSlots,
} from "../../src/skirmish/domain/FormationGeometry";
import { FIXED } from "../../src/skirmish/Protocol";

describe("contact casualty presentation", () => {
  it("does not let a second shared-layout casualty batch disappear through the legacy reshape path", () => {
    const model = new BattleLabModel([
      {
        side: 1,
        definitionId: "bronzeage-infantry",
        formations: 1,
        soldiers: 6,
        variant: "base",
        shape: "mass",
      },
    ]);
    const squad = model.game.snapshot().squads[0],
      pose = formationRenderPose(squad, 0);
    const troop = {
      name: "test",
      age: "test",
      mounted: false,
      ranged: false,
      memberScale: 0.2,
      members: 24,
    };
    const actors = new TroopActors(() => 100, {
      troops: [troop],
      byDefinitionId: new Map([[squad.definitionId!, troop]]),
    });
    const motion = new TroopChoreography(
      Array.from({ length: 9 }, (_, id) => ({
        x: id % 3,
        y: Math.floor(id / 3),
        row: Math.floor(id / 3),
        scale: 0.2,
      })),
      0,
      0,
    );
    const reshape = vi.spyOn(motion, "reshape"),
      apply = motion.applyAuthoritative.bind(motion),
      stop = new Error("reconciled");
    vi.spyOn(motion, "applyAuthoritative").mockImplementation((...args) => {
      apply(...args);
      throw stop;
    });
    const drawn = new Map([
      [
        0,
        {
          x: pose.root.x - 1 + 0.3,
          y: pose.root.y,
          angle: pose.geometry.angle,
        },
      ],
    ]);
    const internals = actors as unknown as {
      loaded: Set<string>;
      motions: Map<number, unknown>;
    };
    internals.loaded.add("test");
    internals.motions.set(squad.id, {
      name: "test",
      shape: "mass",
      motion,
      angle: pose.geometry.angle,
      drawn,
      captured: new Set(),
      anchor: { x: pose.root.x - 1, y: pose.root.y },
      walkers: {},
      engagement: {},
    });
    expect(() =>
      actors.draw(
        {} as CanvasRenderingContext2D,
        squad,
        { x: 0, y: 0 },
        pose.geometry.angle,
        64,
        0,
        pose.root,
        pose,
      ),
    ).toThrow(stop);
    expect(reshape).not.toHaveBeenCalled();
    expect(drawn.get(0)!.x).toBeCloseTo(pose.root.x + 0.3);
    expect(motion.count).toBe(6);
    expect(motion.dead(100)).toHaveLength(3);
  });
  it("centers a wide frontal receiving edge even when its hit anchor is at a corner", () => {
    const model = new BattleLabModel([
      {
        side: 1,
        definitionId: "bronzeage-infantry",
        formations: 1,
        soldiers: 24,
        variant: "base",
        shape: "mass",
      },
      {
        side: 2,
        definitionId: "stoneage-infantry",
        formations: 1,
        soldiers: 12,
        variant: "base",
        shape: "mass",
      },
    ]);
    const [a, b] = model.game.squads,
      body = formationFootprint(b, 0);
    const hit = {
      toX: Math.min(...body.map((p) => p.x)),
      toY: Math.min(...body.map((p) => p.y)),
      bearing: 0,
    };
    const contact = meleeCasualtyContact(a, b, 0, hit);
    expect(Math.abs(contact.y - b.y / FIXED)).toBeLessThan(0.05);
    const angle = formationEnvelope(b, 0).angle,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const drawn = new Map(
      formationSlots(b, 0).map((p, id) => [
        id,
        {
          x: (b.x + p.x * c - p.y * s) / FIXED,
          y: (b.y + p.x * s + p.y * c) / FIXED,
        },
      ]),
    );
    const scores = meleeCasualtyScores(drawn, [contact])!,
      front = Math.min(...[...drawn.values()].map((p) => p.x));
    const first = [...drawn]
      .filter(([, p]) => Math.abs(p.x - front) < 0.000001)
      .map(([id]) => scores.get(id)!);
    const rear = [...drawn]
      .filter(([, p]) => p.x - front > 0.000001)
      .map(([id]) => scores.get(id)!);
    expect(Math.max(...first)).toBeLessThan(Math.min(...rear));
  });
  const slots = Array.from({ length: 9 }, (_, id) => ({
    x: (id % 3) - 1,
    y: Math.floor(id / 3) - 1,
    row: Math.floor(id / 3),
    scale: 0.2,
  }));
  it.each([
    [{ x: 1, y: 0, nx: -1, ny: 0, frontage: 3 }, [2, 5, 8]],
    [{ x: -1, y: 0, nx: 1, ny: 0, frontage: 3 }, [0, 3, 6]],
    [{ x: 0, y: -1, nx: 0, ny: 1, frontage: 3 }, [0, 1, 2]],
  ] as const)("takes losses from the attacked edge %j", (contact, eligible) => {
    const motion = new TroopChoreography(slots, 0, 0),
      drawn = new Map(motion.soldiers(0).map((p) => [p.id, p]));
    const scores = meleeCasualtyScores(drawn, [contact]);
    motion.applyAuthoritative(
      slots.slice(0, 7),
      7,
      100,
      undefined,
      false,
      scores,
    );
    expect(motion.dead(100)).toHaveLength(2);
    expect(
      motion
        .dead(100)
        .every((p) => (eligible as readonly number[]).includes(p.id)),
    ).toBe(true);
  });
  it("supports simultaneous front/flank contact without falling back to an unexposed rear rank", () => {
    const drawn = new Map(slots.map((p, id) => [id, p]));
    const scores = meleeCasualtyScores(drawn, [
      { x: 1, y: 0, nx: -1, ny: 0, frontage: 3 },
      { x: 0, y: -1, nx: 0, ny: 1, frontage: 3 },
    ])!;
    expect(scores.get(4)).toBeGreaterThan(scores.get(5)!);
    expect(scores.get(4)).toBeGreaterThan(scores.get(1)!);
    expect(meleeCasualtyScores(drawn, [])).toBeUndefined();
  });
  it("freezes a corpse at the final cavalry/knockdown draw pose rather than a rear walker cache", () => {
    const actors = new TroopActors(() => 100, {
      troops: [
        {
          name: "test",
          age: "test",
          mounted: true,
          ranged: false,
          memberScale: 0.2,
        },
      ],
      byDefinitionId: new Map(),
    });
    const internals = actors as unknown as {
      assets: Map<string, unknown>;
      remains: TroopRemains;
      captureDeath: (
        id: number,
        state: unknown,
        soldier: unknown,
        started: number,
      ) => void;
    };
    internals.assets.set("test:death", { clip: { frameCount: 1, fps: 1 } });
    const rear = vi.fn(() => ({ x: -20, y: -30, angle: 0 }));
    const state = {
      name: "test",
      anchor: { x: -40, y: -40 },
      angle: 2,
      captured: new Set(),
      walkers: { position: rear },
      drawn: new Map([[7, { x: 10, y: 15, angle: 1 }]]),
    };
    internals.captureDeath(
      5,
      state,
      { id: 7, x: -5, y: -5, angle: 0, scale: 0.2 },
      100,
    );
    expect(rear).not.toHaveBeenCalled();
    const corpse = internals.remains.sample(100)[0];
    expect(corpse.x).toBe(10);
    expect(corpse.y).toBe(15);
    expect(corpse.angle).toBe(1);
    state.anchor = { x: 100, y: 100 };
    expect(internals.remains.sample(500)[0].x).toBe(10);
    internals.captureDeath(5, state, { id: 7, x: 0, y: 0, scale: 0.2 }, 500);
    expect(internals.remains.sample(500)).toHaveLength(1);
  });
});
