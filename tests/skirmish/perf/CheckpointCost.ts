/**
 * Checkpoint cadence probe (roadmap Next #10, P3). Not a vitest file.
 *
 *   npx tsx tests/skirmish/perf/CheckpointCost.ts [med|mig] [warmTicks=1200] [stepTicks=200]
 *
 * Loads Med 500 ("heightmap-test1") or Mig 500 ("migration") with the 52-faction
 * load-harness settings (8 human seats handed to the AI, 14 AI nations, 30
 * tribes, Napoleonic start, raids-v1 diplomacy, corridors-v1 army travel),
 * warms `warmTicks` ticks, then measures on an idle machine:
 *   checkpointMs   median of 5 `checkpoint()` calls
 *   bytes          `v8.serialize(checkpoint()).length`
 *   restoreMs      median of 3 `new Skirmish(map, options)` + `restore()` (rollback latency)
 *   tickMs         mean `step()` over the next `stepTicks` ticks
 *   squads         live squad count
 * and prints one JSON line with the cadence the decision rule below selects.
 *
 * Decision rule (owner decision OD-3): checkpoint every tick if checkpointMs is
 * at most 5% of tickMs. Otherwise CHECKPOINT_INTERVAL_TICKS is the smallest N
 * with checkpointMs / N <= 2% of tickMs and N * tickMs <= 2,000 ms (the replay
 * budget of a rollback). When no N satisfies both, the probe reports the
 * smallest N meeting the 2% rule and `replayBudgetExceeded: true`.
 *
 * Recorded results (Next batch integration, desktop, before checkpoint() stopped
 * cloning its sub-checkpoints twice):
 *   Med 500: 715 squads, checkpointMs 86.3, 7.97 MB, restoreMs 662.6,
 *            tickMs 48.3, interval 90, replayBudgetExceeded true
 *   Mig 500: 705 squads, checkpointMs 136.1, 12.7 MB, restoreMs 798,
 *            tickMs 38.7, interval 176, replayBudgetExceeded true
 *   EightHumanLoad Med 500, 8 active humans, CHECKPOINT_EVERY=20: checkpoint()
 *            mean 199 ms, p95 260, p99 443, max 492; tick+checkpoint p95 248.
 * The single clone halves checkpoint() (same contended host, Med 500 warm
 * fixture at tick 1,300: 248 -> 121 ms). No N meets both conditions, so the
 * rule's 2% interval applies; CHECKPOINT_INTERVAL_TICKS is 80 (10 s), see
 * MatchJournal.ts. Re-run on a quiet host and refine that constant.
 */
import { serialize } from "node:v8";
import { join } from "node:path";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import { createSkirmishMap } from "../../../src/skirmish/Elevation";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { loadServerMap } from "../../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { CHECKPOINT_INTERVAL_TICKS } from "../../../src/skirmish/multiplayer/application/MatchJournal";
import { Skirmish } from "../../../src/skirmish/Simulation";

const [mapArg = "med", warmArg = "1200", stepArg = "200"] = process.argv.slice(2);
const WARM = Number(warmArg), STEPS = Number(stepArg), SEED = 1272661902;
if (!Number.isSafeInteger(WARM) || WARM < 0 || !Number.isSafeInteger(STEPS) || STEPS < 1) throw new Error("Invalid tick counts");
const mapId = mapArg === "mig" ? "migration" : "heightmap-test1";
const settings = { ...defaultLobbySettings(mapId, 500), aiCount: 14, tribeCount: 30, startingAge: "Napoleonic" as const };
const loaded = await loadServerMap(settings, join(process.cwd(), "resources"), SEED);
const options = {
  ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT, seed: SEED,
  humanNames: Array.from({ length: 8 }, (_, i) => `H${i + 1}`), aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1",
  victoryMode: "solo", technologySpeed: 1, startingAge: "Napoleonic", resourceDensity: 1, resourceOutput: 1,
  infiniteGoldForPlayers: false, alliances: false, territoryIncomeScale: loaded.territoryIncomeScale,
} as ConstructorParameters<typeof Skirmish>[1];
const m = loaded.map;
const makeMap = () => createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain);
const game = new Skirmish(makeMap(), options);
for (let id = 1; id <= 8; id++) game.setAiController(id, true);
for (let i = 0; i < WARM; i++) game.step();

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const timed = (run: () => void) => { const start = performance.now(); run(); return performance.now() - start; };
let saved = game.checkpoint();
const checkpointMs = median(Array.from({ length: 5 }, () => timed(() => { saved = game.checkpoint(); })));
const bytes = serialize(saved).length;
const restoreMs = median(Array.from({ length: 3 }, () => timed(() => { new Skirmish(makeMap(), options).restore(saved); })));
const tickMs = timed(() => { for (let i = 0; i < STEPS; i++) game.step(); }) / STEPS;

let interval = 1, replayBudgetExceeded = false;
if (checkpointMs > 0.05 * tickMs) {
  interval = Math.max(1, Math.ceil(checkpointMs / (0.02 * tickMs)));
  replayBudgetExceeded = interval * tickMs > 2000;
}
console.log(JSON.stringify({
  event: "checkpoint-cost", map: mapId, warmTicks: WARM, tick: game.tick, squads: game.squads.length,
  checkpointMs: Math.round(checkpointMs * 10) / 10, bytes, restoreMs: Math.round(restoreMs * 10) / 10,
  tickMs: Math.round(tickMs * 10) / 10, perTick: interval === 1, interval, replayBudgetExceeded,
  currentInterval: CHECKPOINT_INTERVAL_TICKS,
}));
