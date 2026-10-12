import { describe, expect, it } from "vitest";
import {
  formationMarkerLayout,
  formationSymbolLight,
} from "../../src/skirmish/client/FormationMarker";
import {
  formationRenderPose,
  strategicFormationBox,
  strategicFormationContains,
} from "../../src/skirmish/client/FormationRenderPose";
import {
  createFormation,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import { hybridCombatScene } from "./fixtures/HybridCombat";

describe("formation marker footprint contract", () => {
  it("keeps the same world bounds across zoom, including subpixel formations and rotated columns", () => {
    const { grenadiers } = hybridCombatScene();
    for (const shape of ["line", "column", "square", "wedge"] as const) {
      for (const facing of [0, TURN / 8, TURN / 4]) {
        const pose = formationRenderPose(
          {
            ...grenadiers,
            troops: 4,
            formation: {
              ...createFormation(grenadiers.definitionId),
              shape,
              facing,
            },
          },
          0,
        );
        const world = strategicFormationBox(pose, 1);
        for (const zoom of [0.25, 1, 8, 24, 96]) {
          const screen = strategicFormationBox(pose, zoom);
          expect(screen.width / zoom).toBeCloseTo(world.width);
          expect(screen.height / zoom).toBeCloseTo(world.height);
          expect(screen.x).toBe(world.x);
          expect(screen.y).toBe(world.y);
          const c = Math.cos(screen.angle),
            s = Math.sin(screen.angle);
          const outside = screen.width / zoom / 2 + 0.001;
          expect(
            strategicFormationContains(
              screen,
              { x: screen.x + outside * c, y: screen.y + outside * s },
              zoom,
            ),
          ).toBe(false);
          expect(strategicFormationContains(screen, screen, zoom)).toBe(true);
        }
      }
    }
  });

  it("preserves symbol proportions, stays inside thin fields and leaves the facing indicator clear", () => {
    for (const [width, height] of [
      [0.5, 0.25],
      [2, 20],
      [100, 6],
      [12, 12],
      [80, 80],
    ]) {
      for (const symbol of [
        { width: 80, height: 80 },
        { width: 60, height: 90 },
      ]) {
        const layout = formationMarkerLayout(width, height, symbol);
        expect(layout.symbolWidth / layout.symbolHeight).toBeCloseTo(
          symbol.width / symbol.height,
        );
        expect(layout.symbolWidth).toBeLessThan(width);
        expect(layout.symbolHeight / 2 + layout.symbolOffsetY).toBeLessThan(
          height / 2,
        );
        expect(-layout.symbolHeight / 2 + layout.symbolOffsetY).toBeGreaterThan(
          -height / 2 + layout.border + layout.facingHeight,
        );
        expect(
          Math.max(layout.symbolWidth, layout.symbolHeight),
        ).toBeLessThanOrEqual(24);
      }
    }
  });

  it("selects contrasting ink for dark and light faction fields", () => {
    expect(formationSymbolLight([0, 0, 0])).toBe(true);
    expect(formationSymbolLight([30, 60, 90])).toBe(true);
    expect(formationSymbolLight([255, 255, 255])).toBe(false);
    expect(formationSymbolLight([230, 180, 90])).toBe(false);
  });
});
