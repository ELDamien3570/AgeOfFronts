import { createHash } from "node:crypto";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import { generateMigration } from "../../../src/skirmish/MigrationMap";
import type { Squad } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";

/** Idle-tick equality fixture (roadmap Next #2, I-2/I-3): a small Migration
 * match with AI nations and many marching tribes, so moving land squads,
 * clearance certification and spatial rebuilds are all exercised. */
export const IDLE_TICK_FIXTURE_TICKS = 400;
/** Digests after IDLE_TICK_FIXTURE_TICKS ticks. Re-recorded at the Next batch
 * integration with I-2, I-3 and I-4 reverted (the merged lanes change AI,
 * balance and checkpoint content); the full tree gives the same digests.
 * I-2 and I-3 must leave both unchanged. Re-recorded for D2 (Next #1
 * remediation: AI cohorts plan short moves and spine connectors
 * synchronously); with the connector port removed the fixture still gives
 * the previous 58442984... / 5a6c5153.... The checkpoint digest then moved
 * from dcf33c01... for planner scheduling version 6 (its version field); the
 * squad digest is unchanged by it. OD-10 (tribes start with 3 squads) then
 * moved them from d6b6d993... / 45c688d7..., and OD-6 (land income scaled
 * by age) from ad84c0cb... / d5a36cb1.... AI infrastructure capacity,
 * intended equipment demand and persistent placement checkpoints now move
 * them from e85f6612... / 25da28ca.... Re-recorded after two fresh 400-tick
 * runs matched, each preserving exact checkpoint restoration and 30-tick
 * continuation. Spatial-grid and clearance equivalence assertions remain
 * independent of these intentional AI behaviour and checkpoint changes.
 * The lossless AI minimum migration changes only the checkpoint digest from
 * 13925232... to 287408ab...: putting its 16 unbounded sentinels back to
 * Infinity exactly reproduces the previous digest. The squad digest stays
 * unchanged; no clearance or spatial assertion was weakened. */
export const IDLE_TICK_GOLDEN = Object.freeze({
  squads: "6d313fe09f509de5dc20505bb1c7fb8059d874a80d9a334a934b6942ca82cac0",
  checkpoint: "287408ab7664b3e5a88dadceae4fef34e7fd75b00a3eb1f302ce0d67508e8fac",
});

export function idleTickFixture(policy: "legacy" | "responsive" = "responsive"): Skirmish {
  const game = new Skirmish(generateMigration(250, 3).map, {
    ...DEFAULT_AI_POLICIES, ...FORMATION_MOVEMENT,
    seed: 3, aiCount: 4, tribes: true, tribeCount: 12, ruleset: "ages-v1",
    diplomacyRules: "raids-v1", armyTravel: "corridors-v1", startingAge: "Napoleonic",
  });
  if(policy === "legacy") {
    // These historical cache/spatial goldens must remain an exact regression
    // for the old scheduler, rather than being re-recorded after a policy change.
    const admission=game.movementAdmission.checkpoint();delete admission.policyVersion;delete admission.families;
    game.movementAdmission.restore(admission);
    const planning=game.routePlanner.checkpoint();planning.scheduling.version=6;game.routePlanner.restore(planning);
  }
  return game;
}

/** Order-dependent digest of the observable squad state, squads sorted by id.
 * Every own enumerable field is included (orders, formations, locomotion,
 * movement status, transport state), so any behaviour change shows. */
export function squadDigest(squads: readonly Squad[]): string {
  const hash = createHash("sha256");
  for (const squad of [...squads].sort((a, b) => a.id - b.id)) hash.update(JSON.stringify(squad)).update("\n");
  return hash.digest("hex");
}

export function checkpointDigest(game: Skirmish): string {
  return createHash("sha256").update(JSON.stringify(game.checkpoint(), (_key, value) =>
    ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value instanceof Map
      ? [...value] : value instanceof Set ? [...value] : value)).digest("hex");
}
