import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import { UNIT } from "../../src/skirmish/content/Units";
import { certifyFootprint, formationFootprint, formationFootprints } from "../../src/skirmish/domain/FormationContact";
import { createFormation, formationSlots, TURN } from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { FIXED, type MatchOptions } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotDecoder, SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";

function fixture(fixed = true, definitionId = "modern-infantry") {
  const width = 128, height = 96, terrain = new Uint8Array(width * height).fill(133),
    options: MatchOptions = {
      ...FORMATION_MOVEMENT, ...(fixed ? {} : { formationTravel: undefined }),
      seed: 42, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1", deferredPlanning: true,
    },
    map = new GameMapImpl(width, height, terrain, terrain.length),
    game = new Skirmish(map, options),
    s = game.squads.find(s => s.playerId === 1)!, unit = UNIT.get(definitionId)!;
  for (const other of [...game.squads]) if (other.id !== s.id) game.removeSquad(other.id);
  game.updateSquad(s.id, {
    definitionId, kind: unit.line, troops: unit.formationRecipe!.capacity, manpower: createManpower(unit),
    formation: { ...createFormation(definitionId), shape: "mass", frontage: FIXED, facing: 29865 },
    x: 40 * FIXED + 187, y: 282, order: { type: "hold" }, path: [], queuedOrders: [],
    locomotion: { heading: 3.1205462959399006, targetHeading: 3.1205462959399006, speed: 0 },
  });
  return { game, s, map, width, height, options };
}
function command(f: ReturnType<typeof fixture>, x: number, y: number) {
  return { type: "order" as const, playerId: 1, squadIds: [f.s.id],
    order: { type: "move" as const, tile: f.map.ref(x, y) } };
}
function edgeResponse(fixed: boolean) {
  const f = fixture(fixed), start = { x: f.s.x, y: f.s.y }, poses: typeof f.s.formation[] = [], frames: { tick: number; x: number; y: number }[] = [];
  // Match the observed eight-member modern team and a late-game periodic
  // adaptation cycle. A one-squad world immediately revisits and retargets its
  // automatic reform, hiding the production wait this regression covers.
  f.game.updateSquad(f.s.id, { troops: 8, formation: { ...f.s.formation!, layoutTroops: 8 } });
  for (let i = 0; i < 160; i++) f.game.addSquad({ ...structuredClone(f.s), id: f.game.allocateId(),
    playerId: 2, x: 90.5 * FIXED, y: 70.5 * FIXED, formation: createFormation(f.s.definitionId) });
  expect(f.game.applyCommand(command(f, 35, 0))).toBeNull();
  let moved: number | undefined;
  for (let tick = 0; tick < 32; tick++) {
    f.game.step(); poses.push(structuredClone(f.s.formation)); frames.push({ tick: f.game.tick, x: f.s.x, y: f.s.y });
    if (moved === undefined && Math.hypot(f.s.x - start.x, f.s.y - start.y) > 8) moved = f.game.tick;
  }
  return { ...f, moved, poses, frames };
}

describe("fixed formation travel", () => {
  it("removes the map-edge automatic reform wait while preserving the selected width", () => {
    const historical = edgeResponse(false), fixed = edgeResponse(true);
    expect(historical.poses.some(f => f?.transition?.automaticTravel)).toBe(true);
    expect(fixed.poses.some(f => f?.transition?.automaticTravel)).toBe(false);
    expect(fixed.poses.every(f => f?.shape === "mass" && f.frontage === FIXED)).toBe(true);
    expect(fixed.moved).toBeDefined(); expect(historical.moved).toBeDefined();
    expect(fixed.moved!).toBeLessThanOrEqual(4);
    const paused = historical.poses.findIndex(f => f?.transition?.automaticTravel),
      start = historical.frames[paused], after = historical.frames[paused + 7];
    expect(after).toEqual({ ...start, tick: start.tick + 7 });
    expect(Math.hypot(fixed.frames[paused + 7].x - fixed.frames[paused].x,
      fixed.frames[paused + 7].y - fixed.frames[paused].y)).toBeGreaterThan(8);
  });

  it.each([[0.5, 48], [127.5, 48], [64, 0.5], [64, 95.5],
    [0.5, 0.5], [127.5, 0.5], [0.5, 95.5], [127.5, 95.5]])(
    "admits a wide formation overhanging the edge at (%s, %s) but keeps the anchor inside", (x, y) => {
      const f = fixture(true, "napoleonic-infantry");
      f.game.updateSquad(f.s.id, { x: x * FIXED, y: y * FIXED,
        formation: { ...createFormation(f.s.definitionId), shape: "line", facing: TURN / 8 } });
      expect(f.game.formationFits(f.s, f.s)).toBe(true);
      const poly = formationFootprint(f.s, f.game.tick);
      expect(certifyFootprint(f.map, poly, () => false, true)).toBe(false);
      expect(certifyFootprint(f.map, poly, () => false, true, 0, "overhang")).toBe(true);
      for (const outside of [{ x: -1, y: f.s.y }, { x: f.width * FIXED, y: f.s.y },
        { x: f.s.x, y: -1 }, { x: f.s.x, y: f.height * FIXED }])
        expect(f.game.formationFits(f.s, outside)).toBe(false);
    });

  it("still checks occupied in-map cells and bounds the full certification envelope", () => {
    const f = fixture(), rect = (left: number, top: number, right: number, bottom: number) =>
      [{ x: left * FIXED, y: top * FIXED }, { x: right * FIXED, y: top * FIXED },
        { x: right * FIXED, y: bottom * FIXED }, { x: left * FIXED, y: bottom * FIXED }];
    const overhang = rect(-2, -2, 2, 2), visited: number[] = [];
    expect(certifyFootprint(f.map, overhang, tile => { visited.push(tile); return tile === f.map.ref(0, 0); }, true, 0, "overhang")).toBe(false);
    expect(visited).toEqual([f.map.ref(0, 0)]);
    expect(certifyFootprint(f.map, rect(-3, -3, -1, -1), () => false, true, 0, "overhang")).toBe(false);
    expect(certifyFootprint(f.map, rect(-1000, -1000, 1, 1), () => false, true, 0, "overhang")).toBe(false);
    // Watercraft and direct geometry callers retain strict bounds unless ground travel explicitly opts in.
    expect(certifyFootprint(f.map, overhang, () => false, true)).toBe(false);
  });

  it("matches full occupied-cell certification at edges, including live in-map blockers", () => {
    const f = fixture(true, "napoleonic-infantry");
    f.game.updateSquad(f.s.id, { x: 0.5 * FIXED, y: 30.5 * FIXED,
      formation: { ...createFormation(f.s.definitionId), shape: "line", facing: TURN / 8 } });
    const expected = (point: { x: number; y: number }) => formationFootprints({ ...f.s, ...point }, f.game.tick)
      .every(poly => certifyFootprint(f.map, poly, tile => f.game.expansion!.fortifications.intactWallAt(tile), true, 0, "overhang"));
    const points = [f.s, { x: 0.5 * FIXED, y: 31.5 * FIXED }, { x: 1.5 * FIXED, y: 30.5 * FIXED }];
    for (const point of points) expect(f.game.formationFits(f.s, point)).toBe(expected(point));
    f.game.expansion!.fortifications.addBarrier({ id: f.game.allocateId(), playerId: 1, age: "StoneAge",
      a: 800, b: 801, tiles: [f.map.ref(0, 30)], health: 1000, maxHealth: 1000, remainingTicks: 0 });
    expect(f.game.formationFits(f.s, f.s)).toBe(false);
    for (const point of points) expect(f.game.formationFits(f.s, point)).toBe(expected(point));
  });

  it("does not change shape for a winding route or a failed future fit probe", () => {
    const f = fixture(true, "napoleonic-infantry"), width = 8 * FIXED;
    f.game.updateSquad(f.s.id, { x: 40.5 * FIXED, y: 40.5 * FIXED,
      formation: { ...createFormation(f.s.definitionId), shape: "line", frontage: width },
      order: { type: "move", tile: f.map.ref(75, 40) },
      path: Array.from({ length: 80 }, (_, i) => f.map.ref(40 + Math.min(35, i), i < 40 ? 70 : 40)), nextPathIndex: 0 });
    // A future wall/gate policy must be designed separately; the travel adapter cannot reshape units.
    f.game.formationFits = () => false;
    (f.game as any).advanceColumnTravel([f.s]);
    expect(f.s.formation?.shape).toBe("line"); expect(f.s.formation?.frontage).toBe(width);
    expect(f.s.formation?.transition).toBeUndefined();
  });

  it("keeps manual formation changes available at an edge and replicates their real poses", () => {
    const f = fixture(true, "napoleonic-infantry");
    expect(f.game.applyCommand({ type: "formation", playerId: 1, squadIds: [f.s.id], shape: "line" })).toBeNull();
    expect(f.s.formation?.transition).toBeDefined();
    expect(f.s.formation?.transition?.automaticTravel).toBeUndefined();
    const decoded = new SnapshotDecoder().decode(new SnapshotEncoder().encode(f.game.snapshot()));
    expect(decoded.squads.find(s => s.id === f.s.id)?.formation).toEqual(f.s.formation);
    for (let i = 0; i < 90; i++) f.game.step();
    expect(f.s.formation?.shape).toBe("line"); expect(f.s.formation?.transition).toBeUndefined();
    expect(formationSlots(f.s, f.game.tick)).toHaveLength(f.s.troops);
  });

  it("honors an explicit deployment-line layout after arrival without folding on the way", () => {
    const f = fixture(true, "napoleonic-infantry");
    f.game.updateSquad(f.s.id, { x: 40.5 * FIXED, y: 40.5 * FIXED,
      formation: { ...createFormation(f.s.definitionId), shape: "mass", facing: 0 },
      locomotion: { heading: 0, targetHeading: 0, speed: 0 } });
    const line = { start: { x: 38 * FIXED, y: 46 * FIXED }, end: { x: 43 * FIXED, y: 46 * FIXED } };
    expect(f.game.applyCommand({ ...command(f, 40, 46), deploymentLine: line })).toBeNull();
    const requested = f.s.order.type === "move" ? f.s.order.formationIntent : undefined;
    expect(requested).toBeDefined();
    let folded = false;
    for (let i = 0; i < 200; i++) {
      f.game.step(); folded ||= f.s.formation?.shape === "column";
      if (f.s.order.type === "hold" && !f.s.formation?.transition && !f.s.formation?.autoFrontage) break;
    }
    expect(folded).toBe(false); expect(f.s.order.type).toBe("hold");
    expect(f.s.formation?.shape).toBe(requested!.shape);
    expect(f.s.formation?.frontage).toBe(requested!.frontage);
    expect(f.s.formation?.autoFrontage).toBe(false);
  });

  it("continues exactly after restoring an overhanging moving formation", () => {
    const f = fixture(), copy = fixture();
    expect(f.game.applyCommand(command(f, 35, 0))).toBeNull();
    for (let i = 0; i < 4; i++) f.game.step();
    const saved = f.game.checkpoint(); copy.game.restore(saved);
    expect(copy.game.checkpoint()).toEqual(saved);
    for (let i = 0; i < 30; i++) { f.game.step(); copy.game.step(); }
    expect(copy.game.checkpoint()).toEqual(f.game.checkpoint());
    expect(formationFootprints(f.s, f.game.tick).length).toBeGreaterThan(0);
  });
});
