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
