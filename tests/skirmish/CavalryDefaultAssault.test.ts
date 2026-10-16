import { describe, expect, it } from "vitest";
import {
  chargeReadiness,
  chargeStatus,
} from "../../src/skirmish/client/ChargeReadiness";
import { approvedDefinition } from "../../src/skirmish/client/lab/BalanceExperiment";
import { BattleLabModel } from "../../src/skirmish/client/lab/BattleLabModel";
import { assaultBonus } from "../../src/skirmish/domain/CavalryAssault";
import {
  formationEnvelope,
  type FormationShape,
} from "../../src/skirmish/domain/FormationGeometry";
import { commandSchema } from "../../src/skirmish/multiplayer/CommandSchema";
import { FIXED, secondsToTicks } from "../../src/skirmish/Protocol";
import {
  SnapshotDecoder,
  SnapshotEncoder,
} from "../../src/skirmish/SnapshotCodec";
import { cavalryImpactScene } from "./fixtures/CavalryImpact";

function battle(
  shape: FormationShape = "mass",
  mode: "assault" | "ranks" = "assault",
  bonusSeconds = 6,
) {
  const units = [
    approvedDefinition("earlymedieval-heavycavalry"),
    approvedDefinition("earlymedieval-infantry"),
  ];
  for (const unit of units) unit.formationRecipe!.soldierHp = 10000;
  units[0].charge!.bonusDurationTicks = secondsToTicks(bonusSeconds);
  const model = new BattleLabModel(
    units.map((unit, i) => ({
      side: (i + 1) as 1 | 2,
      definitionId: unit.id,
      formations: 1,
      soldiers: 12,
      variant: "base",
      shape: i === 0 ? shape : "mass",
    })),
    4,
    {},
    new Map(units.map((u) => [u.id, u])),
    0.25,
    mode,
  );
  const [rider, target] = model.game.squads;
  model.start();
  return { model, game: model.game, rider, target };
}
function contact(scene: ReturnType<typeof battle>) {
  for (
    let i = 0;
    i < secondsToTicks(15) && !scene.rider.cavalryEngagement?.assault;
    i++
  )
    scene.model.step();
  expect(scene.rider.cavalryEngagement?.assault).toBeDefined();
}
function charge(scene: ReturnType<typeof battle>) {
  const { model, rider, target } = scene;
  expect(
    model.command({
      type: "charge",
      playerId: 1,
      squadIds: [rider.id],
      targetId: target.id,
      x: target.x,
      y: target.y,
    }),
  ).toBeNull();
}

describe("default sustained cavalry attack", () => {
  it("uses ordinary attack orders and normal weapon damage without spending the bonus", () => {
    const scene = battle(),
      { model, game, rider } = scene;
    contact(scene);
    expect(rider.order).toEqual({ type: "attack", targetId: scene.target.id });
    expect(rider.cavalryMelee).toBeUndefined();
    expect(rider.charge).toBeNull();
    expect(assaultBonus(rider, game.tick)).toBe(0);
    expect(chargeReadiness(rider, game.tick)).toBe(1);
    expect(chargeStatus(rider, game.tick)).toContain("normal damage");
    const attacks = new Map();
    for (let i = 0; i < secondsToTicks(8); i++) {
      model.step();
      if (rider.combatFact)
        attacks.set(rider.combatFact.tick, rider.combatFact);
      expect(rider.cavalryMelee).toBeUndefined();
    }
    expect(attacks.size).toBeGreaterThan(3);
    expect([...attacks.values()].every((attack) => !attack.charge)).toBe(true);
    expect(chargeReadiness(rider, game.tick)).toBe(1);
  });
  it("retains the assault on repeated attack orders and leaves move orders able to disengage", () => {
    const scene = battle();
    contact(scene);
    const { model, game, rider, target } = scene;
    const start = rider.cavalryEngagement!.assault!.startTick;
    expect(
      model.command({
        type: "order",
        playerId: 1,
        squadIds: [rider.id],
        order: { type: "attack", targetId: target.id },
      }),
    ).toBeNull();
    expect(rider.cavalryEngagement!.assault!.startTick).toBe(start);
    const before = { x: rider.x, y: rider.y },
      tick = game.tick;
    model.controlledSide = 1;
    expect(
      model.command({
        type: "order",
        playerId: 1,
        squadIds: [rider.id],
        order: { type: "move", tile: game.map.ref(28, 48) },
      }),
    ).toBeNull();
    for (let i = 0; i < secondsToTicks(3); i++) model.step();
    expect(Math.hypot(rider.x - before.x, rider.y - before.y)).toBeGreaterThan(
      FIXED,
    );
    expect(
      game.volleys.some(
        (v) => v.squadId === rider.id && v.tick > tick && v.melee,
      ),
    ).toBe(false);
    expect(rider.order.type).toBe("move");
  });
  it("arms a late bonus for the next committed hit, preserves its per-unit duration, and cannot refresh it", () => {
    const scene = battle("line", "assault", 3);
    contact(scene);
    const { model, game, rider } = scene;
    for (let i = 0; i < secondsToTicks(125); i++) model.step();
    const start = rider.cavalryEngagement!.assault!.startTick;
    const impact = rider.chargeImpact;
    charge(scene);
    charge(scene);
    expect(rider.cavalryEngagement!.assault!.pendingBonusStrength).toBe(1);
    expect(assaultBonus(rider, game.tick)).toBe(0);
    expect(rider.chargeReadyTick ?? 0).toBe(0);
    expect(chargeStatus(rider, game.tick)).toContain("armed");
    const encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const roundtrip = () =>
      decoder
        .decode(
          encoder.encode(
            game.replicationSource(),
            game.tileChanges,
            game.replicationFacts(),
          ),
        )
        .squads.find((s) => s.id === rider.id)!;
    expect(roundtrip().cavalryEngagement).toEqual(rider.cavalryEngagement);
    for (
      let i = 0;
      i < secondsToTicks(3) &&
      rider.cavalryEngagement!.assault!.pendingBonusStrength !== undefined;
      i++
    )
      model.step();
    const active = structuredClone(rider.cavalryEngagement!.assault!);
    expect(active.pendingBonusStrength).toBeUndefined();
    expect(active.startTick).toBe(start);
    expect(active.bonusStartTick! - start).toBeGreaterThan(secondsToTicks(120));
    expect(active.bonusUntilTick - active.bonusStartTick!).toBe(
      secondsToTicks(3),
    );
    expect(rider.combatFact?.charge).toBe(true);
    expect(rider.chargeImpact).toEqual(impact);
    expect(rider.formation!.shape).toBe("line");
    expect(roundtrip().cavalryEngagement).toEqual(rider.cavalryEngagement);
    for (let i = 0; i < secondsToTicks(1); i++) model.step();
    charge(scene);
    expect(rider.cavalryEngagement!.assault!.bonusUntilTick).toBe(
      active.bonusUntilTick,
    );
    expect(chargeReadiness(rider, game.tick)).toBeCloseTo(2 / 3);
    const attacks = new Map<number, NonNullable<typeof rider.combatFact>>();
    for (let i = 0; i < secondsToTicks(5); i++) {
      model.step();
      if (rider.combatFact)
        attacks.set(rider.combatFact.tick, rider.combatFact);
    }
    expect(
      [...attacks.values()].some(
        (a) => a.tick >= active.bonusUntilTick && !a.charge,
      ),
    ).toBe(true);
    expect(chargeReadiness(rider, game.tick)).toBe(0);
    charge(scene);
    expect(
      rider.cavalryEngagement!.assault!.pendingBonusStrength,
    ).toBeUndefined();
    expect(rider.cavalryEngagement!.assault!.bonusUntilTick).toBe(
      active.bonusUntilTick,
    );
  });
  it("cancels an armed bonus on withdrawal without spending it", () => {
    const scene = battle();
    contact(scene);
    charge(scene);
    const { model, game, rider } = scene;
    model.controlledSide = 1;
    expect(
      model.command({
        type: "order",
        playerId: 1,
        squadIds: [rider.id],
        order: { type: "move", tile: game.map.ref(28, 48) },
      }),
    ).toBeNull();
    expect(
      rider.cavalryEngagement!.assault!.pendingBonusStrength,
    ).toBeUndefined();
    for (let i = 0; i < secondsToTicks(3); i++) model.step();
    expect(rider.chargeReadyTick ?? 0).toBe(0);
    expect(chargeReadiness(rider, game.tick)).toBe(1);
  });
  it("keeps ranks as an explicit order with the approved 25-percent spacing", () => {
    const { model, rider, target } = battle("mass", "ranks");
    for (let i = 0; i < secondsToTicks(10) && !rider.cavalryMelee; i++)
      model.step();
    expect(rider.order).toEqual({
      type: "attack",
      targetId: target.id,
      cavalryMode: "ranks",
    });
    expect(rider.cavalryMelee?.current.launchSpacing).toBe(0.25);
    expect(rider.cavalryEngagement?.assault).toBeUndefined();
    const command = {
      type: "order",
      playerId: 1,
      squadIds: [rider.id],
      order: { type: "attack", targetId: target.id, cavalryMode: "ranks" },
    };
    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(
      commandSchema.safeParse({
        ...command,
        order: { ...command.order, cavalryMode: "unknown" },
      }).success,
    ).toBe(false);
    expect(
      model.command({
        type: "order",
        playerId: 2,
        squadIds: [target.id],
        order: { type: "attack", targetId: rider.id, cavalryMode: "ranks" },
      }),
    ).toContain("melee cavalry");
  });
  it.each(["mass", "line", "wedge", "column"] as const)(
    "preserves a deliberately chosen %s throughout approach and impact",
    (shape) => {
      const { model, game, rider, target } = battle(shape);
      expect(
        model.command({
          type: "charge",
          playerId: 1,
          squadIds: [rider.id],
          x: target.x,
          y: target.y,
          targetId: target.id,
        }),
      ).toBeNull();
      expect(formationEnvelope(rider, game.tick).shape).toBe(shape);
      for (let i = 0; i < secondsToTicks(15) && !rider.cavalryEngagement; i++) {
        model.step();
        expect(rider.formation!.shape).toBe(shape);
      }
      expect(rider.cavalryEngagement?.assault).toBeDefined();
      expect(formationEnvelope(rider, game.tick).shape).toBe(shape);
    },
  );
  it("round trips explicit rank intent and rejects invalid packed intent", () => {
    const { model, game, rider } = battle("mass", "ranks");
    for (let i = 0; i < secondsToTicks(10) && !rider.cavalryMelee; i++)
      model.step();
    const packet = new SnapshotEncoder().encode(
      game.replicationSource(),
      game.tileChanges,
      game.replicationFacts(),
    );
    const decoded = new SnapshotDecoder().decode(packet);
    expect(decoded.squads.find((s) => s.id === rider.id)!.order).toEqual(
      rider.order,
    );
    packet.orders[1] = 2;
    expect(() => new SnapshotDecoder().decode(packet)).toThrow(
      "cavalry attack mode",
    );
  });
  it.each(["ordinary", "armed", "active"])(
    "restores and deterministically continues %s assault checkpoints",
    (state) => {
      const { game, rider, defender } = cavalryImpactScene();
      game.updateSquad(rider.id, {
        charge: null,
        order: { type: "attack", targetId: defender.id },
      });
      for (
        let i = 0;
        i < secondsToTicks(12) && !rider.cavalryEngagement?.assault;
        i++
      )
        game.step();
      expect(rider.cavalryEngagement?.assault).toBeDefined();
      if (state !== "ordinary") {
        expect(
          game.applyCommand({
            type: "charge",
            playerId: 1,
            squadIds: [rider.id],
            targetId: defender.id,
            x: defender.x,
            y: defender.y,
          }),
        ).toBeNull();
        expect(rider.cavalryEngagement!.assault!.pendingBonusStrength).toBe(1);
        if (state === "active") {
          for (
            let i = 0;
            i < secondsToTicks(3) &&
            rider.cavalryEngagement!.assault!.pendingBonusStrength !==
              undefined;
            i++
          )
            game.step();
          expect(assaultBonus(rider, game.tick)).toBe(1);
        }
      }
      const saved = game.checkpoint();
      for (let i = 0; i < 12; i++) game.step();
      const expected = game.checkpoint();
      game.restore(saved);
      for (let i = 0; i < 12; i++) game.step();
      expect(game.checkpoint()).toEqual(expected);
    },
  );
});
