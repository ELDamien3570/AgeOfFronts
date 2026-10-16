/**
 * Per-test cap for whole-map generation tests (BlackForest, Continents,
 * Migration at sizes up to 1000). Measured on a desktop under a parallel full
 * run: BlackForest 1000 about 26-46 s, Continents about 91-141 s, Migration
 * about 23-49 s, so the suite-wide 30 s testTimeout (vite.skirmish.config.ts)
 * cannot hold them. Override with SKIRMISH_SLOW_TIMEOUT (milliseconds) on a
 * slower host, for example the Oracle A1 runner.
 */
export const SLOW_MAP_TIMEOUT = Number(
  process.env.SKIRMISH_SLOW_TIMEOUT ?? 300_000,
);
