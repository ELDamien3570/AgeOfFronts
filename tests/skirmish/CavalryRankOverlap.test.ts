import { describe, expect, it } from "vitest";
import {
  createBalanceDraft,
  experimentRecipes,
  parseBalanceDraft,
} from "../../src/skirmish/client/lab/BalanceDraft";
import {
  approvedDefinition,
  newExperiment,
} from "../../src/skirmish/client/lab/BalanceExperiment";
import { BattleLabModel } from "../../src/skirmish/client/lab/BattleLabModel";
import {
  cavalryCohort,
  cavalryWaves,
} from "../../src/skirmish/client/troops/CavalryMeleePresentation";
import {
  CAVALRY_RANK_MOTION,
  cavalryRankCycleTicks,
  cavalryRankExposure,
  validateCavalryMelee,
  waveTick,
  type CavalryCycle,
} from "../../src/skirmish/domain/CavalryMelee";
import { formationApproach } from "../../src/skirmish/domain/FormationContact";
import { FIXED, TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";

const id = "earlymedieval-heavycavalry";
function arena(spacing = 1, hp?: number) {
  const definition = approvedDefinition(id);
  if (hp) definition.formationRecipe!.soldierHp = hp;
  return new BattleLabModel(
    ([1, 2] as const).map((side) => ({
      side,
      definitionId: id,
      formations: 1,
      soldiers: 12,
      variant: "base",
      shape: "mass",
    })),
    4,
    {},
    new Map([[id, definition]]),
    spacing,
    "ranks",
  );
}
function contactScene(spacing: number) {
  const model = arena(spacing, 100000),
    game = model.game;
  const [rider, target] = game.squads;
  game.updateSquad(rider.id, {
    order: { type: "attack", targetId: target.id, cavalryMode: "ranks" },
  });
  game.updateSquad(rider.id, formationApproach(rider, target, 0, 32));
  game.expansion!.battle.fight([]);
  expect(rider.cavalryMelee).toBeDefined();
  return {
    model,
    game,
    rider,
    target,
    cycle: structuredClone(rider.cavalryMelee!.current),
  };
}

describe("preview cavalry rank overlap", () => {
  it("keeps ordinary timing identical and only shortens gaps between ranks", () => {
    const base = contactScene(1),
      tight = contactScene(0.1);
    expect(base.cycle.launchSpacing).toBeUndefined();
    expect(base.cycle.interval).toBe(CAVALRY_RANK_MOTION.cycle);
    expect(tight.cycle.launchSpacing).toBe(0.1);
    expect(waveTick(tight.cycle, 0)).toBe(waveTick(base.cycle, 0));
    expect(waveTick(tight.cycle, 2)).toBeLessThan(waveTick(base.cycle, 1));
    expect(tight.cycle.interval).toBeLessThan(base.cycle.interval);
    expect(tight.cycle.contacts.map((p) => p.budget)).toEqual(
      base.cycle.contacts.map((p) => p.budget),
    );
    // A fresh arena never inherits another preview's timing.
    expect(arena().game.cavalryRankLaunchSpacing()).toBe(1);
    expect(() => arena(0)).toThrow();
    expect(() => arena(1.1)).toThrow();
  });
  it.each([0.75, 0.5, 0.25, 0.1])(
    "preserves each rider's path and speed at %s launch spacing",
    (spacing) => {
      const current: CavalryCycle = {
        tick: 0,
        interval: cavalryRankCycleTicks(),
        completed: 0,
        troops: 3,
        definitionId: id,
        orderRevision: 0,
        contacts: [
          {
            targetId: 2,
            budget: 9000,
            lunge: FIXED,
            bearing: Math.PI / 2,
            fromX: 0,
            fromY: 0,
            toX: 0,
            toY: FIXED,
          },
        ],
      };
      const compact = {
        ...current,
        interval: cavalryRankCycleTicks(spacing),
        launchSpacing: spacing,
      };
      const members = [0, -0.3, -0.6].map((y, id) => ({
        id,
        x: 0,
        y,
        scale: 0.2,
      }));
      const clip = {
        id: "attack",
        file: "attack.png",
        frames: [],
        frameCount: 8,
        fps: 10,
      };
      const baselineCohort = cavalryCohort(current, members),
        compactCohort = cavalryCohort(compact, members);
      for (const member of members) {
        const rank = baselineCohort.get(member.id)!.rank;
        for (const elapsed of [-0.5, 0, 1, 3, 6, 12, 22, 30]) {
          const a = cavalryWaves(
            { current },
            waveTick(current, rank) + elapsed,
            clip,
            members,
            new Map([[0, baselineCohort]]),
          ).get(member.id);
          const b = cavalryWaves(
            { current: compact },
            waveTick(compact, rank) + elapsed,
            clip,
            members,
            new Map([[0, compactCohort]]),
          ).get(member.id);
          expect(b).toEqual(a);
          expect(
            cavalryRankExposure(compact, waveTick(compact, rank) + elapsed) &
              (1 << rank),
          ).toBe(
            cavalryRankExposure(current, waveTick(current, rank) + elapsed) &
              (1 << rank),
          );
        }
      }
      const m = CAVALRY_RANK_MOTION;
      const lastReturn = waveTick(compact, 2) + m.brake + m.turn * 2 + m.return;
      expect(compact.interval).toBeGreaterThanOrEqual(lastReturn);
      expect(() => validateCavalryMelee({ current: compact })).not.toThrow();
      expect(() =>
        validateCavalryMelee({
          current: { ...compact, interval: compact.interval - 1 },
        }),
      ).toThrow();
    },
  );
  it("keeps damage per cycle constant and round trips its launch times through snapshots", () => {
    const totals = [1, 0.25].map((spacing) => {
      const { game, rider, cycle } = contactScene(spacing);
      let damage = 0;
      for (game.tick = 1; game.tick <= waveTick(cycle, 2); game.tick++) {
        game.expansion!.battle.fight([]);
        damage += game.volleys
          .filter(
            (v) => v.squadId === rider.id && v.tick === game.tick && v.melee,
          )
          .reduce((sum, v) => sum + (v.damage ?? 0), 0);
      }
      const decoded = new SnapshotDecoder().decode(
        new SnapshotEncoder().encode(
          game.replicationSource(),
          game.tileChanges,
          game.replicationFacts(),
        ),
      );
      expect(
        decoded.squads.find((s) => s.id === rider.id)!.cavalryMelee,
      ).toEqual(rider.cavalryMelee);
      return damage;
    });
    expect(totals[0]).toBeGreaterThan(0);
    expect(totals[1]).toBeCloseTo(totals[0], 6);
  });
  it("withdraws without launching the remaining overlapped waves", () => {
    const { game, rider, cycle } = contactScene(0.25);
    for (game.tick = 1; game.tick <= waveTick(cycle, 0); game.tick++)
      game.expansion!.battle.fight([]);
    expect(
      game.applyCommand({
        type: "order",
        playerId: 1,
        squadIds: [rider.id],
        order: { type: "move", tile: game.map.ref(24, 24) },
      }),
    ).toBeNull();
    const cancelledAt = game.tick;
    game.step();
    expect(rider.order.type).toBe("move");
    for (let i = 1; i < 12 * TICKS_PER_SECOND; i++) game.step();
    expect(
      game.volleys.some(
        (v) => v.squadId === rider.id && v.tick >= cancelledAt && v.melee,
      ),
    ).toBe(false);
    expect(rider.cavalryEngagement).toBeUndefined();
    expect(
      Math.hypot(rider.x / FIXED - 24.5, rider.y / FIXED - 24.5),
    ).toBeLessThan(0.1);
  });
  it("saves overlap with the scenario and preserves legacy defaults", () => {
    const model = arena(0.6),
      state = newExperiment();
    const draft = createBalanceDraft(
      model.entries,
      4,
      experimentRecipes(state),
      state,
      undefined,
      0.6,
      "ranks",
    );
    expect(parseBalanceDraft(JSON.stringify(draft)).scenario.cavalryMode).toBe(
      "ranks",
    );
    expect(
      parseBalanceDraft(JSON.stringify(draft)).scenario.rankLaunchSpacing,
    ).toBe(0.6);
    expect(
      parseBalanceDraft(
        JSON.stringify(createBalanceDraft(model.entries, 4, [])),
      ).scenario.rankLaunchSpacing,
    ).toBe(0.25);
    const invalid = structuredClone(draft);
    invalid.scenario.rankLaunchSpacing = -1;
    expect(() => parseBalanceDraft(JSON.stringify(invalid))).toThrow();
    expect(() =>
      parseBalanceDraft(
        JSON.stringify({
          ...draft,
          scenario: { ...draft.scenario, cavalryMode: "unknown" },
        }),
      ),
    ).toThrow("cavalry");
  });
  it("shortens a real mirror fight without altering its weapon stats", () => {
    const times = [1, 0.1].map((spacing) => {
      const model = arena(spacing);
      model.start();
      while (!model.finished && model.game.tick < 300 * TICKS_PER_SECOND)
        model.step();
      expect(model.finished).toBe(true);
      return model.game.tick;
    });
    expect(times[1]).toBeLessThan(times[0]);
  });
});
