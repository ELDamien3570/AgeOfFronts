import { describe, expect, it } from "vitest";
import { UNITS } from "../../src/skirmish/content/Units";
import {
  createFormation,
  formationDoctrine,
  type FormationShape,
  type FormationState,
  validateFormation,
} from "../../src/skirmish/domain/FormationGeometry";
import { frontageLayout } from "../../src/skirmish/domain/FormationProfiles";
import { trenchLineScene } from "./fixtures/TrenchLine";

/** R2-M11 (B-3): a definition change (refit or enlargement) must leave a
 * formation that its own validator accepts. Before the fix 390 of the 2,086
 * same-line column changes produced "Invalid formation frontage". */
describe("R2-M11: definition changes keep formations valid", () => {
  it("sweeps every same-line soldier definition change from columns and deployed shapes", () => {
    const { game, defenders } = trenchLineScene();
    const base = defenders[0];
    const soldiers = UNITS.filter((u) => u.formationRecipe?.model === "soldiers");
    let tried = 0;
    const bad: string[] = [];
    for (const a of soldiers) for (const b of soldiers) {
      if (a.id === b.id || a.line !== b.line) continue;
      const da = formationDoctrine(a.id);
      for (const dep of da.shapes) {
        if (dep === "column") continue;
        for (const troops of [2, 10, a.formationRecipe!.capacity]) {
          const w = frontageLayout(troops, da, dep)?.width;
          if (w === undefined) continue;
          const candidates: FormationState[] = [
            // The scratch repro: a manual column remembering a deployed shape.
            { ...createFormation(a.id), shape: "column" as FormationShape, mode: "travel", deployedShape: dep, preferredFrontage: w, automatic: false },
            // A manual column with a preferred width and no remembered shape.
            ...(dep === da.defaultShape ? [{ ...createFormation(a.id), shape: "column" as FormationShape, mode: "travel" as const, preferredFrontage: w, automatic: false }] : []),
            // A deployed formation with a preferred width.
            { ...createFormation(a.id), shape: dep, mode: "deployed", frontage: w, preferredFrontage: w },
          ];
          for (const f of candidates) {
            if (!da.shapes.includes(f.shape)) continue;
            try { validateFormation(f, a.id, troops); } catch { continue; }
            const s = game.addSquad({ ...structuredClone(base), id: game.allocateId(), definitionId: a.id, troops, formation: f });
            tried++;
            game.updateSquad(s.id, { definitionId: b.id });
            const after = game.squad(s.id)!;
            try { validateFormation(after.formation, b.id, troops); } catch (e) {
              bad.push(`${a.id}(${f.shape}/${f.deployedShape},${troops},w${w}) -> ${b.id}: ${(e as Error).message}; after=${JSON.stringify({ shape: after.formation!.shape, dep: after.formation!.deployedShape, pf: after.formation!.preferredFrontage })}`);
            }
            game.removeSquad(s.id);
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(2000);
    expect(bad.slice(0, 8)).toEqual([]);
    expect(bad.length).toBe(0);
  }, 120_000);
});
