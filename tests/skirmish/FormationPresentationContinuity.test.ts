import { describe, expect, it } from "vitest";
import { FormationAngleSamples } from "../../src/skirmish/client/FormationAngleSamples";
import { formationRenderPose } from "../../src/skirmish/client/FormationRenderPose";
import {
  formationEnvelope,
  reorientedFormation,
  TURN,
} from "../../src/skirmish/domain/FormationGeometry";
import { FIXED, type Squad } from "../../src/skirmish/Protocol";
import { cavalryBattleScene } from "./fixtures/CavalryImpact";

function worldSlots(pose: ReturnType<typeof formationRenderPose>) {
  const c = Math.cos(pose.geometry.angle),
    s = Math.sin(pose.geometry.angle);
  return pose.slots.map((slot) => ({
    x: pose.root.x + (slot.x * c - slot.y * s) / FIXED,
    y: pose.root.y + (slot.x * s + slot.y * c) / FIXED,
  }));
}

describe("formation turn presentation continuity", () => {
  it("preserves occupied ground on the first publication of a coordinate reform", () => {
    const { riders } = cavalryBattleScene();
    for (const shape of ["line", "wedge", "square"] as const) {
      for (const facing of [TURN / 4, TURN / 2, (TURN * 3) / 8]) {
        const squad = {
          ...riders[0],
          formation: {
            ...riders[0].formation!,
            shape,
            facing: 0,
            transition: undefined,
          },
        };
        const samples = new FormationAngleSamples();
        samples.update([squad], 0, 1);
        const before = worldSlots(formationRenderPose(squad, 0));
        const turned = {
          ...squad,
          formation: reorientedFormation(squad, 1, facing),
        };
        samples.update([turned], 1, 1);
        for (const blend of [0, 0.25, 0.5, 1]) {
          const pose = formationRenderPose(
            turned,
            1,
            undefined,
            samples.angle(squad.id, blend),
          );
          for (const p of worldSlots(pose)) {
            expect(
              Math.min(...before.map((q) => Math.hypot(p.x - q.x, p.y - q.y))),
            ).toBeLessThan(1 / FIXED);
          }
        }
      }
    }
  });

  it("follows the canonical morph through duplicate publications, completion, and retargeting", () => {
    const { riders } = cavalryBattleScene();
    const squad: Squad = {
      ...riders[0],
      formation: {
        ...riders[0].formation!,
        shape: "wedge",
        facing: 0,
        transition: undefined,
      },
    };
    const samples = new FormationAngleSamples();
    samples.update([squad], 0, 1);
    let turned = {
      ...squad,
      formation: reorientedFormation(squad, 1, TURN / 4),
    };
    const assertPose = (tick: number, previousBlend: number) => {
      samples.update([turned], tick, previousBlend);
      const expected = worldSlots(formationRenderPose(turned, tick));
      for (const blend of [0, 0.25, 0.5, 1]) {
        const actual = worldSlots(
          formationRenderPose(
            turned,
            tick,
            undefined,
            samples.angle(squad.id, blend),
          ),
        );
        actual.forEach((p, i) => {
          expect(p.x).toBeCloseTo(expected[i].x, 6);
          expect(p.y).toBeCloseTo(expected[i].y, 6);
        });
      }
    };
    for (const tick of [1, 2, 3]) {
      assertPose(tick, 0.4);
      assertPose(tick, 0.7);
    }
    const prior = worldSlots(formationRenderPose(turned, 3));
    turned = {
      ...turned,
      formation: reorientedFormation(turned, 3, (TURN * 3) / 4),
    };
    assertPose(3, 0.3);
    for (const p of worldSlots(formationRenderPose(turned, 3))) {
      expect(
        Math.min(...prior.map((q) => Math.hypot(p.x - q.x, p.y - q.y))),
      ).toBeLessThan(1 / FIXED);
    }
    const end = 3 + turned.formation.transition!.duration;
    assertPose(end, 0.4);
    turned = {
      ...turned,
      formation: { ...turned.formation, transition: undefined },
    };
    assertPose(end + 1, 0.4);
    expect(samples.angle(squad.id, 0)).toBeCloseTo(
      formationEnvelope(turned, end + 1).angle,
    );
  });
});
