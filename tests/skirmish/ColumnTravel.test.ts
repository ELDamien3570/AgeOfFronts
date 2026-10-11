import { describe, expect, it } from "vitest";
import { minimumTravelAssignment } from '../../src/skirmish/domain/FormationSlotAssignment';
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import {
  formationPoseContains,
  formationRenderPose,
} from "../../src/skirmish/client/FormationRenderPose";
import { TERRAIN } from "../../src/skirmish/content/TacticalRules";
import { UNIT, UNITS } from "../../src/skirmish/content/Units";
import { columnDecision } from "../../src/skirmish/domain/ColumnTravel";
import { attackContributors } from "../../src/skirmish/domain/Combat";
import {
  certifyFootprint,
  formationApproach,
  formationContact,
  formationFootprint,
  formationFootprints,
  formationPointContact,
  formationSweepEntry,
  polygonContact,
  transitionFootprint,
} from "../../src/skirmish/domain/FormationContact";
import {
  advanceColumnTrail,
  createFormation,
  formationDoctrine,
  formationEnvelope,
  formationSlots,
  TURN,
  validateFormation,
} from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";

function scene(
  count = 48,
  kind: "open" | "gate-1" | "gate-2" | "bend" = "open",
  deferredPlanning = false,
) {
  const size = 160,
    terrain = new Uint8Array(size * size).fill(133);
  if (kind !== "open")
    for (let x = 88; x < 112; x++)
      for (let y = 0; y < size; y++) {
        const open =
          kind === "bend"
            ? (x < 100 && y === 64) ||
              (x === 100 && y >= 64 && y <= 76) ||
              (x >= 100 && y === 76)
            : y >= 64 && y < 64 + (kind === "gate-2" ? 2 : 1);
        if (!open) terrain[y * size + x] = 0;
      }
  const map = new GameMapImpl(
    size,
    size,
    terrain,
    terrain.filter((v) => v & 128).length,
  );
  const options = {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1" as const,
    deferredPlanning,
  };
  const game = new Skirmish(map, options),
    s = game.squads.find((s) => s.playerId === 1)!;
  game.expansion!.progression.states[1].completed = [];
  game.expansion!.progression.states[1].research = {};
  // These are hard narrow-passage fixtures, not shores: water overlap is now
  // explicitly permitted for RTS formation bodies.
  if(kind!=="open")game.expansion!.fortifications.intactWallAt=tile=>!map.isLand(tile);
  for (const other of [...game.squads])
    if (other.id !== s.id) game.removeSquad(other.id);
  const id = count === 96 ? "latemedieval-infantry" : "napoleonic-infantry",
    u = UNIT.get(id)!;
  game.updateSquad(s.id, {
    definitionId: id,
    kind: u.line,
    troops: count,
    // Oversized cases intentionally stress the geometry ceiling; persisted
    // and paid-lifecycle cases use the real recipe capacities.
    manpower: {...createManpower(u,count>u.formationRecipe!.capacity?'enlarged':'base'),capacity:Math.max(count,u.formationRecipe!.capacity)},
    formation: {
      ...createFormation(id),
      facing: (3 * TURN) / 4,
      layoutTroops: count,
    },
    x: 64.5 * FIXED,
    y: 64.5 * FIXED,
    order: { type: "hold" },
    path: [],
  });
  return { game, s: game.squad(s.id)!, map, terrain, options, size };
}
function move(f: ReturnType<typeof scene>) {
  expect(
    f.game.applyCommand({
      type: "order",
      playerId: 1,
      squadIds: [f.s.id],
      order: {
        type: "move",
        tile: f.map.ref(
          152,
          f.terrain[76 * f.size + 100] === 133 &&
            f.terrain[64 * f.size + 101] === 0
            ? 76
            : 64,
        ),
      },
    }),
  ).toBeNull();
}
function memberPositions(f: ReturnType<typeof scene>) {
  const angle = formationEnvelope(f.s, f.game.tick).angle,
    c = Math.cos(angle),
    sin = Math.sin(angle);
  return formationSlots(f.s, f.game.tick).map((p) => ({
    x: f.s.x + p.x * c - p.y * sin,
    y: f.s.y + p.x * sin + p.y * c,
  }));
}
function legal(f: ReturnType<typeof scene>) {
  return formationFootprints(f.s, f.game.tick).every((poly) =>
    certifyFootprint(f.map, poly, () => false, false, TERRAIN.softHold),
  );
}

describe("authoritative column travel", () => {
  it.each([72, 96, 144])(
    "moves %i soldiers through a one-cell gate and deploys legally",
    (count) => {
      const f = scene(count, "gate-1");
      move(f);
      let column = false;
      for (let tick = 0; tick < 2000; tick++) {
        const before = { x: f.s.x, y: f.s.y },
          members = memberPositions(f);
        f.game.step();
        const after = memberPositions(f);
        const assignment=minimumTravelAssignment(members,after);
        expect(
          Math.max(
            ...after.map((p, i) =>
              Math.hypot(p.x - members[assignment[i]].x, p.y - members[assignment[i]].y),
            ),
          ),
        ).toBeLessThanOrEqual(FIXED);
        column ||= f.s.formation?.shape === "column";
        expect(legal(f), `tick ${f.game.tick}, x ${f.s.x / FIXED}`).toBe(true);
        expect(
          Math.hypot(f.s.x - before.x, f.s.y - before.y),
        ).toBeLessThanOrEqual(FIXED);
        if (
          f.s.order.type === "hold" &&
          !f.s.formation?.transition &&
          f.s.formation?.shape !== "column"
        )
          break;
      }
      expect(column).toBe(true);
      expect(f.s.x / FIXED).toBeGreaterThan(150);
      expect(f.s.formation?.shape).not.toBe("column");
      expect(f.s.troops).toBe(count);
    },
    30000,
  );
  it("follows queued bends without filling the empty interior of the turn", () => {
    const f = scene(144, "bend", true);
    move(f);
    let bent = false;
    for (let tick = 0; tick < 2400; tick++) {
      f.game.step();
      expect(
        legal(f),
        `tick ${f.game.tick}, root ${f.s.x / FIXED},${f.s.y / FIXED}`,
      ).toBe(true);
      bent ||= (f.s.formation?.trail?.length ?? 0) > 2;
      if (
        f.s.order.type === "hold" &&
        !f.s.formation?.transition &&
        f.s.formation?.shape !== "column"
      )
        break;
    }
    expect(bent).toBe(true);
    expect(f.s.x / FIXED).toBeGreaterThan(150);
    expect(f.s.formation?.shape).not.toBe("column");
  }, 30000);
  it("restores mid-fold and mid-travel with identical decisions and bounded history", () => {
    const f = scene(72, "gate-1");
    f.game.updateSquad(f.s.id, { x: 80.5 * FIXED });
    move(f);
    for (let i = 0; i < 25; i++) f.game.step();
    let sawTravel = false;
    for (let round = 0; round < 2; round++) {
      const restored = new Skirmish(
        new GameMapImpl(
          f.size,
          f.size,
          f.terrain,
          f.terrain.filter((v) => v & 128).length,
        ),
        f.options,
      );
      restored.restore(f.game.checkpoint());
      restored.expansion!.fortifications.intactWallAt=tile=>!restored.map.isLand(tile);
      const packet = new SnapshotEncoder().encode(f.game.snapshot());
      expect(
        new SnapshotDecoder().decode(packet).squads.find((s) => s.id === f.s.id)
          ?.formation,
      ).toEqual(f.s.formation);
      for (let i = 0; i < 220; i++) {
        f.game.step();
        restored.step();
        expect(restored.squads).toEqual(f.game.squads);
        if (f.s.formation?.trail) {
          sawTravel = true;
          expect(f.s.formation.trail.length).toBeLessThanOrEqual(256);
        }
      }
      expect(restored.checkpoint()).toEqual(f.game.checkpoint());
    }
    expect(sawTravel).toBe(true);
  }, 30000);
  it("retains manual column intent, queues deployed shape changes, and forbids a charge in travel", () => {
    const f = scene(72, "gate-1");
    move(f);
    for (let i = 0; i < 230; i++) f.game.step();
    expect(f.s.formation?.automatic).toBe(true);
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.s.id],
        shape: "line",
      }),
    ).toBeNull();
    expect(f.s.formation?.deployedShape).toBe("line");
    expect(f.s.formation?.shape).toBe("column");
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.s.id],
        shape: "column",
      }),
    ).toBeNull();
    expect(f.s.formation?.automatic).toBe(false);
    expect(
      f.game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [f.s.id],
        order: { type: "hold" },
      }),
    ).toBeNull();
    for (let i = 0; i < 100; i++) f.game.step();
    expect(f.s.formation?.shape).toBe("column");
    expect(
      f.game.applyCommand({
        type: "charge",
        playerId: 1,
        squadIds: [f.s.id],
        x: f.s.x + FIXED,
        y: f.s.y,
      }),
    ).toContain("Deploy");
  });
  it("keeps blocked deployment compressed, preserves reload state and retries when space changes", () => {
    const f = scene(72, "gate-1");
    f.game.updateSquad(f.s.id, {
      x: 100.5 * FIXED,
      y: 64.5 * FIXED,
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        automatic: true,
        deployedShape: "line",
        trail: [
          { x: -30 * FIXED, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    });
    const weaponState = {
      sharedReadyTick: 900,
      ranged: { nextTick: 900, shots: 7, remainder: 0, reloadStartedTick: 1 },
    };
    f.game.updateSquad(f.s.id, { weaponState });
    for (let i = 0; i < 25; i++) f.game.step();
    expect(f.s.formation?.blocked).toBe(true);
    expect(f.s.formation?.shape).toBe("column");
    expect(f.s.weaponState).toEqual(weaponState);
    expect(legal(f)).toBe(true);
    f.game.updateSquad(f.s.id, { x: 145.5 * FIXED });
    for (let i = 0; i < 250; i++) f.game.step();
    expect(f.s.formation?.shape).toBe("line");
    expect(f.s.formation?.blocked).toBe(false);
    expect(legal(f)).toBe(true);
  });
  it("uses bent row bodies for contact, projectiles and selection", () => {
    const f = scene(72);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        trail: [
          { x: -20 * FIXED, y: -8 * FIXED },
          { x: 0, y: -8 * FIXED },
          { x: 0, y: 0 },
        ],
      },
    });
    const empty = { x: f.s.x - 4 * FIXED, y: f.s.y - 4 * FIXED };
    expect(formationPointContact(f.s, empty, 0).gap).toBeGreaterThan(2 * FIXED);
    expect(
      formationSweepEntry(
        f.s,
        { x: empty.x - FIXED, y: empty.y },
        { x: empty.x + FIXED, y: empty.y },
        0,
      ),
    ).toBeNull();
    expect(
      formationPoseContains(formationRenderPose(f.s, 0), {
        x: empty.x / FIXED,
        y: empty.y / FIXED,
      }),
    ).toBe(false);
    const before = formationSlots(f.s, 0);
    f.game.updateSquad(f.s.id, { troops: 60 });
    expect(formationSlots(f.s, 0)).toEqual(before.slice(0, 60));
    expect(attackContributors(f.s, UNIT.get(f.s.definitionId!)!.attack)).toBe(
      4,
    );
  });
  it("supports columns across the soldier roster and rejects malformed travel state", () => {
    for (const u of UNITS) {
      const d = formationDoctrine(u.id);
      if (!d.hull) expect(d.shapes).toContain("column");
      if (d.shapes.includes("shield-wall"))
        expect(d.shieldEquipment).toBe(true);
    }
    const f = scene();
    expect(() =>
      validateFormation(
        { ...f.s.formation!, trail: Array(257).fill({ x: 0, y: 0 }) },
        f.s.definitionId,
      ),
    ).toThrow();
    expect(
      columnDecision(
        { ...f.s, order: { type: "attack", targetId: 123 }, path: [1] },
        1,
        true,
      ),
    ).toBe("fold");
    const trail = advanceColumnTrail(
      {
        ...f.s,
        formation: { ...f.s.formation!, shape: "column", mode: "travel" },
      },
      FIXED,
      0,
    );
    expect(trail!.length).toBe(2);
  });
  it("crosses a two-cell gate with queued movement orders intact", () => {
    const f = scene(96, "gate-2", true);
    move(f);
    expect(
      f.game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [f.s.id],
        append: true,
        order: { type: "move", tile: f.map.ref(148, 72) },
      }),
    ).toBeNull();
    for (let i = 0; i < 2200; i++) {
      f.game.step();
      expect(legal(f)).toBe(true);
      if (
        f.s.order.type === "hold" &&
        !f.s.formation?.transition &&
        !f.s.formation?.automatic &&
        f.s.y > 71 * FIXED &&
        !f.s.queuedOrders.length
      )
        break;
    }
    expect(f.s.y / FIXED).toBeGreaterThan(71);
    expect(f.s.queuedOrders).toHaveLength(0);
    expect(f.s.formation?.shape).not.toBe("column");
  }, 30000);
  it("crosses a two-cell hard gate with an enlarged mounted column", () => {
    const f = scene(144, "gate-2"),
      u = UNIT.get("napoleonic-cavalry")!;
    f.game.updateSquad(f.s.id, {
      definitionId: u.id,
      kind: u.line,
      troops: 36,
      manpower: createManpower(u, "enlarged"),
      formation: {
        ...createFormation(u.id),
        facing: (3 * TURN) / 4,
        layoutTroops: 36,
      },
    });
    move(f);
    for (let i = 0; i < 2000; i++) {
      f.game.step();
      expect(legal(f)).toBe(true);
      if (
        f.s.order.type === "hold" &&
        !f.s.formation?.transition &&
        !f.s.formation?.automatic
      )
        break;
    }
    expect(f.s.x / FIXED).toBeGreaterThan(150);
    expect(f.s.troops).toBe(36);
  }, 30000);
  it("enlarges a stationary column through the paid lifecycle, preserving wounds and missing members", () => {
    const f = scene(),
      u = UNIT.get(f.s.definitionId!)!,
      player = f.game.player(1)!;
    f.game.updateSquad(f.s.id, {
      troops: 46,
      manpower: { ...f.s.manpower!, wounds: 5000 },
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        layoutTroops: 46,
      },
    });
    f.game.owners[f.game.tileOf(f.s)] = 1;
    f.game.expansion!.progression.states[1].completed.push(
      u.formationRecipe!.technologyId!,
    );
    player.gold = 100000;
    player.reserves = 100000;
    for (const item of Object.keys(u.cost.items ?? {}))
      f.game.expansion!.supply.inventories[1][item] = 100000;
    const before = player.reserves;
    expect(
      f.game.applyCommand({
        type: "enlarge",
        playerId: 1,
        squadIds: [f.s.id],
        definitionId: u.id,
      }),
    ).toBeNull();
    expect(player.reserves).toBe(before - 24);
    for (let i = 0; i < 500; i++) {
      f.game.step();
      expect(legal(f)).toBe(true);
    }
    expect(f.s.troops).toBe(70);
    expect(f.s.manpower?.capacity).toBe(72);
    expect(f.s.manpower?.wounds).toBe(5000);
    expect(f.s.formation?.shape).toBe("column");
  }, 30000);
  it("contains every intermediate member in the fixed-facing transition certificate", () => {
    const f = scene(144),
      source = formationSlots(f.s, 0);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        transition: {
          from: "mass",
          fromFacing: f.s.formation!.facing,
          fromSlots: source,
          startTick: 0,
          duration: 200,
        },
      },
    });
    const sweep = transitionFootprint(f.s, 0, 200);
    for (let tick = 0; tick <= 200; tick += 4)
      for (const p of formationFootprint(f.s, tick))
        expect(polygonContact([p], sweep).gap).toBe(0);
  });
  it("invalidates a carrier-trail certificate when a physical wall is added", () => {
    const f = scene();
    move(f);
    for (let i = 0; i < 230; i++) f.game.step();
    const end = { x: f.s.x + 16, y: f.s.y };
    expect((f.game as any).formationMoveClear(f.s, end)).toBe(true);
    const occupied=memberPositions(f)[0];
    f.game.expansion!.fortifications.addBarrier({
      id: 900,
      playerId: 1,
      age: "BronzeAge",
      a: 800,
      b: 801,
      tiles: [
        f.map.ref(Math.floor(occupied.x / FIXED), Math.floor(occupied.y / FIXED)),
      ],
      health: 2000,
      maxHealth: 2000,
      remainingTicks: 0,
    });
    expect((f.game as any).formationMoveClear(f.s, end)).toBe(false);
  });

  it("preserves orders and weapon state when deployment is interrupted by a move and casualties", () => {
    const f = scene(),
      weaponState = {
        sharedReadyTick: 9999,
        ranged: {
          nextTick: 9999,
          shots: 7,
          remainder: 0,
          reloadStartedTick: 1,
        },
      };
    f.game.updateSquad(f.s.id, {
      weaponState,
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        automatic: true,
        deployedShape: "line",
      },
    });
    for(let i=0;i<12;i++)f.game.step();
    expect(f.s.formation?.transition?.from).toBe("column");
    expect(
      f.game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [f.s.id],
        order: { type: "move", tile: f.map.ref(110, 70) },
      }),
    ).toBeNull();
    f.game.updateSquad(f.s.id, { troops: 60 });
    for (let i = 0; i < 1400; i++) {
      f.game.step();
      expect(legal(f)).toBe(true);
      expect(f.s.weaponState).toEqual(weaponState);
      if (
        f.s.x > 109 * FIXED &&
        f.s.order.type === "hold" &&
        !f.s.formation?.transition &&
        f.s.formation?.shape === "line"
      )
        break;
    }
    expect(f.s.troops).toBe(60);
    expect(f.s.x / FIXED).toBeGreaterThan(109);
    expect(f.s.formation?.shape).toBe("line");
  }, 30000);

  it("preserves charge fallback orders in column and old-unit doctrine access after an age advance", () => {
    const f = scene();
    f.game.updateSquad(f.s.id, {
      formation: { ...f.s.formation!, shape: "column", mode: "travel" },
    });
    expect(
      f.game.applyCommand({
        type: "charge",
        playerId: 1,
        squadIds: [f.s.id],
        x: f.s.x + FIXED,
        y: f.s.y,
        fallbackOrder: { type: "move", tile: f.map.ref(90, 64) },
      }),
    ).toBeNull();
    expect(f.s.order.type).toBe("move");
    const u = UNIT.get("bronzeage-infantry")!;
    f.game.updateSquad(f.s.id, {
      definitionId: u.id,
      kind: u.line,
      troops: u.formationRecipe!.capacity,
      manpower: createManpower(u),
      formation: createFormation(u.id),
      order: { type: "hold" },
      path: [],
    });
    f.game.expansion!.progression.states[1].age = "Modern";
    expect(
      f.game.applyCommand({
        type: "formation",
        playerId: 1,
        squadIds: [f.s.id],
        shape: "shield-wall",
      }),
    ).toBeNull();
    expect(f.s.formation?.shape).toBe("shield-wall");
    expect(() =>
      f.game.restore({ ...f.game.checkpoint(), version: 5 } as any),
    ).toThrow("Checkpoint");
  });

  it("matches exhaustive boundary contact for bent columns", () => {
    const f = scene(144);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        trail: [
          { x: -24 * FIXED, y: -8 * FIXED },
          { x: 0, y: -8 * FIXED },
          { x: 0, y: 0 },
        ],
      },
    });
    for (const [dx, dy] of [
      [2, 0],
      [-5, -8],
      [-6, -4],
      [0, 2],
    ]) {
      const other = {
        ...f.s,
        id: 999,
        troops: 12,
        x: f.s.x + dx * FIXED,
        y: f.s.y + dy * FIXED,
      };
      let gap = Infinity;
      for (const a of formationFootprints(f.s, 0))
        for (const b of formationFootprints(other, 0))
          gap = Math.min(gap, polygonContact(a, b).gap);
      expect(formationContact(f.s, other, 0).gap).toBeCloseTo(gap, 8);
    }
  });

  it("retains exact surviving travel slots for every live count, including odd rows and one soldier", () => {
    const f = scene(144);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        trail: [
          { x: -30 * FIXED, y: -8 * FIXED },
          { x: 0, y: -8 * FIXED },
          { x: 0, y: 0 },
        ],
      },
    });
    const before = formationSlots(f.s, 0);
    for (let troops = 1; troops < 144; troops++)
      expect(formationSlots({ ...f.s, troops }, 0)).toEqual(
        before.slice(0, troops),
      );
  });
  it("keeps small mobs and modern loose teams deployed on open travel and unfolds automatic columns for combat", () => {
    const f = scene();
    for (const id of ["stoneage-infantry", "modern-infantry"]) {
      const u = UNIT.get(id)!;
      const s = {
        ...f.s,
        definitionId: id,
        troops: u.formationRecipe!.capacity,
        manpower: createManpower(u),
        formation: createFormation(id),
        order: { type: "move" as const, tile: 100 },
        path: Array.from({ length: 20 }, (_, i) => i),
        nextPathIndex: 0,
      };
      expect(columnDecision(s, 1, false)).toBe("keep");
      expect(columnDecision(s, 1, true)).toBe("fold");
    }
    expect(
      columnDecision(
        {
          ...f.s,
          formation: {
            ...f.s.formation!,
            shape: "column",
            mode: "travel",
            automatic: true,
          },
          order: { type: "attack", targetId: 999 },
          path: [1, 2],
          nextPathIndex: 0,
          combatTargetId: 999,
        },
        1,
        false,
      ),
    ).toBe("deploy");
  });
  it("retains automatic travel ownership and supported deployment intent through a definition upgrade", () => {
    const f = scene(),
      u = UNIT.get("earlymodern-anticavalry")!;
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        automatic: true,
        deployedShape: "line",
        deploymentFacing: 0,
        trail: [
          { x: -20 * FIXED, y: 0 },
          { x: 0, y: 0 },
        ],
      },
    });
    f.game.updateSquad(f.s.id, {
      definitionId: u.id,
      kind: u.line,
      manpower: createManpower(u),
    });
    expect(f.s.formation?.automatic).toBe(true);
    expect(f.s.formation?.deployedShape).toBe("line");
    expect(f.s.formation?.deploymentFacing).toBe(0);
    expect(f.s.formation?.trail).toHaveLength(2);
    validateFormation(f.s.formation, f.s.definitionId);
  });
  it("retains the empty interior of a curved column while deployment starts", () => {
    const f = scene(144);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        trail: [
          { x: -24 * FIXED, y: -8 * FIXED },
          { x: 0, y: -8 * FIXED },
          { x: 0, y: 0 },
        ],
      },
    });
    const source = formationSlots(f.s, 0),
      empty = { x: f.s.x - 4 * FIXED, y: f.s.y - 4 * FIXED };
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "mass",
        mode: "deployed",
        trail: undefined,
        transition: {
          from: "column",
          fromFacing: f.s.formation!.facing,
          fromSlots: source,
          startTick: 0,
          duration: 200,
        },
      },
    });
    for (const tick of [0, 1, 4]) {
      expect(formationPointContact(f.s, empty, tick).gap).toBeGreaterThan(
        2 * FIXED,
      );
      expect(
        formationPoseContains(formationRenderPose(f.s, tick), {
          x: empty.x / FIXED,
          y: empty.y / FIXED,
        }),
      ).toBe(false);
    }
  });
  it("plans a reachable boundary approach against bent target parts", () => {
    const f = scene(144);
    f.game.updateSquad(f.s.id, {
      formation: {
        ...f.s.formation!,
        shape: "column",
        mode: "travel",
        trail: [
          { x: -24 * FIXED, y: -8 * FIXED },
          { x: 0, y: -8 * FIXED },
          { x: 0, y: 0 },
        ],
      },
    });
    const attacker = {
      ...f.s,
      id: 999,
      troops: 12,
      x: f.s.x - 12 * FIXED,
      y: f.s.y - 14 * FIXED,
      formation: { ...createFormation(f.s.definitionId), facing: 0 },
    };
    const point = formationApproach(attacker, f.s, 0, FIXED / 2);
    expect(
      formationContact({ ...attacker, ...point }, f.s, 0).gap,
    ).toBeLessThanOrEqual(FIXED / 2 + 4);
  });
});
