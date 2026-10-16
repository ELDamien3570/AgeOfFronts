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
 * the previous 58442984... / 5a6c5153.... */
export const IDLE_TICK_GOLDEN = Object.freeze({
  squads: "d6b6d993daa2a8aa8d14af71621e8ab2c44817f0c34d27191e6c6ca618693eb9",
  checkpoint: "dcf33c01e62c33875d6b00c7dac149b618893a0d8f765e67405355eead8d2a40",
});

export function idleTickFixture(): Skirmish {
  return new Skirmish(generateMigration(250, 3).map, {
    ...DEFAULT_AI_POLICIES, ...FORMATION_MOVEMENT,
    seed: 3, aiCount: 4, tribes: true, tribeCount: 12, ruleset: "ages-v1",
    diplomacyRules: "raids-v1", armyTravel: "corridors-v1", startingAge: "Napoleonic",
  });
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
