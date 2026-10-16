import type { GameMap } from "../../../core/game/GameMap";
import { SpawnSelection } from "../../domain/SpawnSelection";
import { isProceduralMap } from "../../content/Maps";
import type { LobbySettings } from "../../lobby/LobbyDirectory";
import type { MatchOptions } from "../../Protocol";
import type { PreparedMatch, RuntimeMap } from "./MatchExecutor";
import { PUBLIC_SETUP_ERRORS } from "./TerminalMessages";

/** A bad generated seed is retried this many times (four attempts in all). */
export const PREPARE_MAX_RETRIES = 3;
/**
 * No new attempt starts when the time spent plus one more attempt of the last
 * attempt's length would pass this. It keeps retries inside the parent's
 * PREPARE_REQUEST_TIMEOUT_MS (150 s), which would otherwise terminate the
 * worker mid-attempt (Black Forest 1000 is about 46 s on the ARM host).
 */
export const PREPARE_RETRY_BUDGET_MS = 120_000;

/**
 * Seed for the next attempt after a generator rejected `seed`. A 32-bit LCG
 * step (Math.imul keeps the product exact) masked to the valid seed range, so
 * it is deterministic and every executor that sees the same failures agrees.
 */
export function deriveRetrySeed(seed: number): number {
  return (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
}

export interface PrepareInput {
  settings: LobbySettings;
  options: MatchOptions;
  /** A pre-built map skips generation, so there is nothing to retry. */
  map?: RuntimeMap;
}
export interface PrepareDeps {
  load(
    settings: LobbySettings,
    seed: number,
  ): Promise<{ map: RuntimeMap; territoryIncomeScale: number }>;
  identity(map: RuntimeMap): Promise<string>;
  makeMap(map: RuntimeMap): GameMap;
  now(): number;
  log(level: "info" | "warn", event: Record<string, unknown>): void;
}
export interface PreparedPlan {
  /** Hash and the options the match must run with. `options.seed` is the seed that produced the map. */
  prepared: PreparedMatch;
  map: RuntimeMap;
  setup: SpawnSelection;
}

/** Only generated maps can have a bad seed, and only for internal failures: setup errors are the lobby's settings. */
const retryable = (settings: LobbySettings, error: unknown, hasMap: boolean) =>
  !hasMap &&
  isProceduralMap(settings.mapId) &&
  !(error instanceof Error && PUBLIC_SETUP_ERRORS.has(error.message));

/**
 * Generate the map, resolve the spawn plan and hash the world. A generator
 * invariant failure retries with a derived seed (R2-L7); the seed that
 * finally produced the map is returned in `prepared.options` so the manifest,
 * the clients and the simulation all use it. The seed is logged here, in the
 * worker, and never sent to clients except as part of the manifest options.
 */
export async function preparePlan(
  input: PrepareInput,
  deps: PrepareDeps,
): Promise<PreparedPlan> {
  const { settings } = input;
  const started = deps.now();
  let seed = input.options.seed;
  let lastAttemptMs = 0;
  for (let attempt = 0; ; attempt++) {
    const attemptStarted = deps.now();
    let genMs: number | undefined;
    try {
      const loaded = input.map
        ? { map: input.map, territoryIncomeScale: input.options.territoryIncomeScale }
        : await deps.load(settings, seed);
      genMs = deps.now() - attemptStarted;
      const options: MatchOptions = {
        ...input.options,
        seed,
        territoryIncomeScale: loaded.territoryIncomeScale,
      };
      const setup = new SpawnSelection(deps.makeMap(loaded.map), options);
      setup.resolve();
      const mapHash = await deps.identity(loaded.map);
      deps.log("info", {
        event: "map-prepared",
        mapId: settings.mapId,
        size: settings.worldSize,
        seed,
        mapHash,
        genMs: Math.round(genMs),
        attempt,
      });
      return { prepared: { mapHash, options }, map: loaded.map, setup };
    } catch (error) {
      const now = deps.now();
      genMs ??= now - attemptStarted;
      lastAttemptMs = now - attemptStarted;
      deps.log("warn", {
        event: "map-prepare-failed",
        mapId: settings.mapId,
        size: settings.worldSize,
        seed,
        attempt,
        genMs: Math.round(genMs),
        message: error instanceof Error ? error.message : String(error),
      });
      if (
        attempt >= PREPARE_MAX_RETRIES ||
        !retryable(settings, error, !!input.map) ||
        now - started + lastAttemptMs > PREPARE_RETRY_BUDGET_MS
      )
        throw error;
      seed = deriveRetrySeed(seed);
    }
  }
}
