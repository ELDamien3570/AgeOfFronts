import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FormationOccupancy } from "../../src/skirmish/FormationOccupancy";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";
import { UnitIndex } from "../../src/skirmish/UnitIndex";
import {
  formationPoseContains,
  formationRenderPose,
} from "../../src/skirmish/client/FormationRenderPose";
import { TroopChoreography } from "../../src/skirmish/client/troops/TroopChoreography";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";
import {
  createFormation,
  formationDoctrine,
  formationEnvelope,
  formationLayoutKey,
  formationSlots,
  geometryKey,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";

function fixture(id = "bronzeage-infantry") {
  const terrain = new Uint8Array(64 * 64).fill(133),
    map = new GameMapImpl(64, 64, terrain, terrain.length);
  const options = {
    seed: 42,
    aiCount: 1,
    runAi: false,
    tribes: false,
    ruleset: "ages-v1" as const,
  };
  const game = new Skirmish(map, options),
    squad = game.squads.find((s) => s.playerId === 1)!,
    unit = UNIT.get(id)!;
  game.updateSquad(squad.id, {
    definitionId: id,
    kind: unit.line,
    troops: unit.formationRecipe!.capacity,
    manpower: createManpower(unit),
    formation: createFormation(id),
    order: { type: "hold" },
    x: 24 * FIXED,
    y: 24 * FIXED,
  });
  return { game, squad: game.squad(squad.id)!, unit, map, terrain, options };
}
describe("shared authoritative formation geometry", () => {
  it("validates equipment eligibility, ownership and bounded command shape atomically", () => {
    const f = fixture(),
      enemy = f.game.squads.find((s) => s.playerId === 2)!;
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.squad.id, enemy.id],
        shape: "shield-wall",
      }),
    ).toContain("owned");
    expect(f.squad.formation!.shape).toBe("mass");
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.squad.id],
        shape: "shield-wall",
      }),
    ).toBeNull();
    expect(f.squad.formation!.shape).toBe("shield-wall");
    const woods = fixture("earlymedieval-infantry");
    expect(
      woods.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [woods.squad.id],
        shape: "shield-wall",
      }),
    ).toContain("equipment");
    expect(
      commandSchema.safeParse({
        type: "formation",
        playerId: 1,
        squadIds: [1],
        shape: "mass",
        facing: TURN,
      }).success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({
        type: "formation",
        playerId: 1,
        squadIds: [1],
        shape: "mass",
        width: 100,
      }).success,
    ).toBe(false);
    expect(formationDoctrine("stoneage-archer").shapes).not.toContain("line");
    expect(formationDoctrine("modern-infantry").defaultShape).toBe(
      "modern-loose",
    );
  });
  it("preserves health, wounds, orders and weapon phase during bounded reform and recovery", () => {
    const f = fixture();
    const state = {
      sharedReadyTick: 100,
      ranged: {
        nextTick: 160,
        shots: 12,
        remainder: 37,
        reloadStartedTick: 100,
      },
    };
    f.game.updateSquad(f.squad.id, {
      weaponState: state,
      manpower: { ...f.squad.manpower!, wounds: 7000 },
    });
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.squad.id],
        shape: "shield-wall",
        facing: TURN / 4,
      }),
    ).toBeNull();
    const checkpoint = f.game.checkpoint(),
      restored = new Skirmish(
        new GameMapImpl(64, 64, f.terrain, f.terrain.length),
        f.options,
      );
    restored.restore(checkpoint);
    const decoded = new SnapshotDecoder().decode(
      new SnapshotEncoder().encode(f.game.snapshot()),
    );
    const client = decoded.squads.find((s) => s.id === f.squad.id)!;
    for (const tick of [0, 5, 10, 20, 30]) {
      expect(formationEnvelope(client, tick)).toEqual(
        formationEnvelope(restored.squad(f.squad.id)!, tick),
      );
      expect(formationSlots(client, tick)).toEqual(
        formationSlots(f.squad, tick),
      );
    }
    expect(restored.squad(f.squad.id)!.weaponState).toEqual(state);
    expect(restored.squad(f.squad.id)!.manpower!.wounds).toBe(7000);
    expect(restored.squad(f.squad.id)!.order).toEqual({ type: "hold" });
    expect(() =>
      f.game.restore({ ...checkpoint, version: 3 } as any),
    ).toThrow();
  });
  it("continues an in-flight reform identically after restore and rejects malformed state", () => {
    const f = fixture();
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.squad.id],
        shape: "shield-wall",
        facing: TURN / 4,
      }),
    ).toBeNull();
    for (let i = 0; i < 5; i++) f.game.step();
    const checkpoint = f.game.checkpoint();
    const restored = new Skirmish(
      new GameMapImpl(64, 64, f.terrain, f.terrain.length),
      f.options,
    );
    restored.restore(checkpoint);
    for (let i = 0; i < 60; i++) {
      f.game.step();
      restored.step();
      expect(restored.squad(f.squad.id)!.formation).toEqual(
        f.game.squad(f.squad.id)!.formation,
      );
      expect(
        formationSlots(restored.squad(f.squad.id)!, restored.tick),
      ).toEqual(formationSlots(f.game.squad(f.squad.id)!, f.game.tick));
    }
    expect(f.game.squad(f.squad.id)!.formation!.transition).toBeUndefined();
    const invalid = {
      ...checkpoint,
      squads: checkpoint.squads.map((s) =>
        s.id === f.squad.id
          ? { ...s, formation: { ...s.formation!, facing: TURN } }
          : s,
      ),
    };
    expect(() => restored.restore(invalid)).toThrow("Invalid formation");
  });
  it("keeps every shared slot inside current bounds for all authored shapes and large variants", () => {
    for (const unit of UNITS)
      for (const shape of formationDoctrine(unit.id).shapes) {
        const f = fixture(unit.id),
          capacity = unit.formationRecipe!.enlargedCapacity;
        f.game.updateSquad(f.squad.id, {
          troops: capacity,
          manpower: createManpower(unit, "enlarged"),
          formation: {
            ...createFormation(unit.id),
            shape,
            mode: shape === "column" ? "travel" : "deployed",
            facing: (TURN / 7) | 0,
          },
        });
        const e = formationEnvelope(f.squad, 0);
        for (const slot of formationSlots(f.squad, 0)) {
          expect(Math.abs(slot.x)).toBeLessThanOrEqual(e.width / 2);
          expect(Math.abs(slot.y)).toBeLessThanOrEqual(e.depth / 2);
        }
        expect(e.navigationRadius).toBeLessThanOrEqual(FIXED / 2);
      }
  });
  it("invalidates spatial, layout and occupancy facts when soldiers or purchased capacity change", () => {
    const f = fixture(),
      index = new UnitIndex<typeof f.squad>();
    index.add(f.squad);
    const before = index.spatialRevision,
      key = geometryKey(f.squad),
      layout = formationLayoutKey(f.squad);
    f.game.updateSquad(f.squad.id, { troops: f.squad.troops - 1 });
    index.changed(f.squad);
    expect(index.spatialRevision).toBeGreaterThan(before);
    expect(geometryKey(f.squad)).not.toBe(key);
    expect(formationLayoutKey(f.squad)).not.toBe(layout);
    const occupancy = new FormationOccupancy(f.map);
    occupancy.rebuild([f.squad]);
    const old = [...occupancy.buckets.values()][0][0].geometryRevision;
    f.game.updateSquad(f.squad.id, {
      manpower: createManpower(f.unit, "enlarged"),
    });
    occupancy.refresh(f.squad);
    expect([...occupancy.buckets.values()][0][0].geometryRevision).not.toBe(
      old,
    );
    const e = formationEnvelope(f.squad, 0),
      nav = e.navigationRadius;
    expect(e.width).toBe(
      formationEnvelope({ ...f.squad, manpower: createManpower(f.unit) }, 0)
        .width,
    );
    expect(e.navigationRadius).toBe(nav);
  });
  it("finds an overlapping wide formation whose centre is outside the query radius", () => {
    const f = fixture("latemedieval-infantry");
    f.game.updateSquad(f.squad.id, {
      formation: { ...createFormation(f.unit.id), shape: "shield-wall" },
      x: 8 * FIXED,
      y: 5 * FIXED,
    });
    const grid = new SpatialGrid<typeof f.squad>(
      64 * FIXED,
      64 * FIXED,
      4 * FIXED,
      undefined,
      (s) => formationEnvelope(s, 0).broadRadius,
    );
    grid.rebuild([f.squad]);
    const found: (typeof f.squad)[] = [];
    const queryX=f.squad.x-formationEnvelope(f.squad,0).broadRadius-FIXED/2;
    grid.query(queryX, 5 * FIXED, FIXED, found);
    expect(found).toHaveLength(0);
    grid.queryOverlaps(queryX, 5 * FIXED, FIXED, found);
    expect(found).toEqual([f.squad]);
  });
  it("uses an interpolated visual root without changing authoritative geometry or centroid", () => {
    const f = fixture();
    const before = f.game.checkpoint();
    const pose = formationRenderPose(f.squad, 0, { x: 12.25, y: 14.5 });
    expect(formationPoseContains(pose, pose.root)).toBe(true);
    expect(pose.anchors.front.y).toBeGreaterThan(pose.root.y);
    expect(
      pose.slots.reduce((n, p) => n + p.x, 0) / pose.slots.length,
    ).toBeCloseTo(0, 0);
    expect(f.game.checkpoint()).toEqual(before);
    const motion = new TroopChoreography(
      pose.slots.map((p) => ({
        ...p,
        x: p.x / FIXED,
        y: p.y / FIXED,
        scale: 0.24,
      })),
      f.squad.id,
      0,
    );
    const ids = motion.soldiers(0).map((s) => s.id);
    const newSlots = formationSlots(
      {
        ...f.squad,
        formation: { ...createFormation(f.unit.id), shape: "shield-wall" },
      },
      10,
    ).map((p) => ({ ...p, x: p.x / FIXED, y: p.y / FIXED, scale: 0.24 }));
    motion.setAuthoritativeSlots(newSlots, 10);
    expect(motion.formationSoldiers(10).map((s) => s.id)).toEqual(ids);
  });
});
