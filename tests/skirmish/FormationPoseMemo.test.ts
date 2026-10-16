import { describe, expect, it } from "vitest";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { FIXED } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { FormationPoseMemo, formationRenderPose, strategicFormationBox, type FormationRenderPose } from "../../src/skirmish/client/FormationRenderPose";
import { createFormation, formationEnvelope, reorientedFormation, TURN } from "../../src/skirmish/domain/FormationGeometry";
import { createManpower } from "../../src/skirmish/domain/Manpower";
import { UNIT } from "../../src/skirmish/content/Units";

const UNITS = ["earlymedieval-infantry", "stoneage-archer", "napoleonic-infantry", "earlymodern-rangedcavalry"];
function squads() {
  const terrain = new Uint8Array(64 * 32).fill(133);
  const game = new Skirmish(new GameMapImpl(64, 32, terrain, terrain.length), { seed: 5, aiCount: 1, tribes: false, runAi: false, ruleset: "ages-v1" as const });
  const base = game.squads.find(s => s.playerId === 1)!;
  return UNITS.flatMap((definitionId, index) => {
    const unit = UNIT.get(definitionId)!;
    const squad = { ...base, id: 100 + index, definitionId, kind: unit.line, troops: unit.formationRecipe!.capacity,
      manpower: createManpower(unit), x: (10 + index * 9) * FIXED + 37, y: 15 * FIXED + 11,
      formation: { ...createFormation(definitionId), facing: (index * TURN) / 7 } };
    const turning = { ...squad, id: 200 + index, formation: reorientedFormation(squad, 40, (squad.formation.facing + TURN / 3) % TURN) };
    return [squad, turning];
  });
}
const close = (a: FormationRenderPose, b: FormationRenderPose) => {
  const near = (x: number, y: number) => expect(Math.abs(x - y)).toBeLessThan(1e-6);
  expect(a.geometry).toEqual(b.geometry);
  expect(a.slots).toEqual(b.slots);
  for (const key of ["left", "right", "top", "bottom"] as const) near(a.bounds[key], b.bounds[key]);
  for (const end of ["front", "rear"] as const) { near(a.anchors[end].x, b.anchors[end].x); near(a.anchors[end].y, b.anchors[end].y); }
  expect(a.footprints.length).toBe(b.footprints.length);
  a.footprints.forEach((poly, i) => poly.forEach((p, j) => { near(p.x, b.footprints[i][j].x); near(p.y, b.footprints[i][j].y); }));
  expect(a.root).toEqual(b.root);
  expect(a.tick).toBe(b.tick);
};

describe("U4 formation pose memo", () => {
  it("equals a fresh pose for steady and transitioning squads, any tick and translated roots", () => {
    const memo = new FormationPoseMemo();
    for (const squad of squads())
      for (const tick of [40, 40.25, 41, 43.5, 47, 60, 120]) {
        const root = { x: squad.x / FIXED + tick / 3, y: squad.y / FIXED - tick / 7 };
        close(memo.pose(squad, tick, root), formationRenderPose(squad, tick, root));
        close(memo.pose(squad, tick), formationRenderPose(squad, tick));
        expect(memo.broadRadius(squad, tick)).toBe(formationEnvelope(squad, tick).broadRadius);
        const box = strategicFormationBox(memo.pose(squad, tick, root), 4), fresh = strategicFormationBox(formationRenderPose(squad, tick, root), 4);
        for (const key of ["x", "y", "width", "height", "angle"] as const) expect(Math.abs(box[key] - fresh[key])).toBeLessThan(1e-6);
      }
  });

  it("recomputes nothing on a second frame of the same presentation, even when the squad moved", () => {
    const memo = new FormationPoseMemo();
    const steady = squads().filter(s => !s.formation.transition);
    for (const squad of steady) { memo.broadRadius(squad, 50); memo.pose(squad, 50.5, { x: 1, y: 2 }); }
    const misses = memo.diagnostics.misses;
    expect(misses).toBe(steady.length);
    // The next frame: new interpolated objects, moved roots, same formation records.
    for (const squad of steady) {
      const moved = { ...squad, x: squad.x + 300 };
      memo.broadRadius(moved, 51.75);
      memo.pose(moved, 51.75, { x: 3, y: 4 });
    }
    expect(memo.diagnostics.misses).toBe(misses);
  });

  it("invalidates on a new formation record, troop loss or transition tick, and retains only presented squads", () => {
    const memo = new FormationPoseMemo();
    const [steady, turning] = squads();
    memo.pose(steady, 10); memo.pose(turning, 41);
    const misses = memo.diagnostics.misses;
    memo.pose({ ...steady, troops: steady.troops - 3 }, 10);
    memo.pose({ ...steady, formation: { ...steady.formation } }, 10);
    memo.pose(turning, 42);
    expect(memo.diagnostics.misses).toBe(misses + 3);
    const fresh = memo.pose(turning, 42);
    expect(fresh).not.toBe(memo.pose(turning, 42));
    memo.retain([turning.id]);
    expect(memo.size).toBe(1);
  });
});
