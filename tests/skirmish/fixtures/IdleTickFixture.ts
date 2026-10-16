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
/** Digests after IDLE_TICK_FIXTURE_TICKS ticks, recorded at aof/next-1 (bc7c7882)
 * before any I-2/I-3 change. I-2 and I-3 must leave both unchanged. */
export const IDLE_TICK_GOLDEN = Object.freeze({
  squads: "9168a8ec5812e44c31cbf67b1bf518708a98e9a430bcafd65c7f89eaa7b6ec61",
  checkpoint: "be0563a7510d99d0711bae8262bf15d6f0f00cb321b95ba1069b4ed1c98c511c",
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
