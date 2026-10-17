/**
 * I9 probe (Roadmap Next #5): AI background work at the faction cap.
 * Run: node --import tsx tests/skirmish/aiFactionScalingBenchmark.ts [seconds=320] [map=heightmap-test1] [seed=1272661902]
 * Mediterranean 500 is map "heightmap-test1" at 500% scale (as in the 8-human load harness).
 * Reports, per AI-economy faction: first completed naval assessment (game seconds after its
 * first fleet mission) and the coast goal outcome; plus the allowance scale and tick wall time.
 * Gates (integration lead): every faction with a naval mission completes an assessment within
 * 5 s of its first mission; at least one coast goal reaches "complete" before its 300 s deadline.
 */
import { performance } from "node:perf_hooks";
import { Skirmish } from "../../src/skirmish/Simulation";
import { createSkirmishMap } from "../../src/skirmish/Elevation";
import { loadServerMap } from "../../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings } from "../../src/skirmish/lobby/LobbyDirectory";
import { DEFAULT_AI_POLICIES } from "../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../src/skirmish/content/FormationMovement";
import { TICKS_PER_SECOND } from "../../src/skirmish/Protocol";
import { aiBackgroundScale } from "../../src/skirmish/domain/AiEconomicDirector";

const [secondsArg = "320", mapId = "heightmap-test1", seedArg = "1272661902"] = process.argv.slice(2);
const seed = Number(seedArg), seconds = Number(secondsArg);
const settings = { ...defaultLobbySettings(mapId as Parameters<typeof defaultLobbySettings>[0], 500), aiCount: 14, tribeCount: 30 };
const loaded = await loadServerMap(settings as never, "resources", seed);
const m = loaded.map;
const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), {
  ...DEFAULT_AI_POLICIES, ...FORMATION_MOVEMENT, seed, aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1",
  diplomacyRules: "raids-v1", armyTravel: "corridors-v1", victoryMode: "solo", technologySpeed: 1,
  territoryIncomeScale: loaded.territoryIncomeScale,
} as never);
const economy = game.expansion!.economy;
const enabled = game.players.filter((p) => economy.enabled(p));
const firstMission = new Map<number, number>(), firstAssessment = new Map<number, number>();
const coast = new Map<number, string>();
const tickMs: number[] = [];
for (let t = 0; t < seconds * TICKS_PER_SECOND; t++) {
  const start = performance.now();
  game.step();
  tickMs.push(performance.now() - start);
  const now = game.tick / TICKS_PER_SECOND;
  for (const p of enabled) {
    const mission = economy.naval.missions.get(p.id);
    if (mission && !firstMission.has(p.id)) firstMission.set(p.id, now);
    if (mission && !mission.assessment && mission.port !== undefined && !firstAssessment.has(p.id)) firstAssessment.set(p.id, now);
    const goal = economy.coasts.goals.get(p.id);
    if (goal && (goal.phase === "complete" || goal.phase === "abort") && !coast.has(p.id)) coast.set(p.id, `${goal.phase}@${now.toFixed(0)}s: ${goal.reason}`);
  }
}
const assessment = enabled.filter((p) => firstMission.has(p.id)).map((p) => +((firstAssessment.get(p.id) ?? Infinity) - firstMission.get(p.id)!).toFixed(1));
tickMs.sort((a, b) => a - b);
console.log(JSON.stringify({
  map: mapId, factions: game.players.length, aiEconomyFactions: enabled.length, scale: aiBackgroundScale(enabled.length),
  navalAssessmentSeconds: { max: Math.max(0, ...assessment), values: assessment },
  coastGoals: Object.fromEntries(coast), coastComplete: [...coast.values()].filter((v) => v.startsWith("complete")).length,
  tickMs: { mean: +(tickMs.reduce((a, b) => a + b, 0) / tickMs.length).toFixed(1), p99: +tickMs[Math.floor(tickMs.length * 0.99)].toFixed(1) },
}, null, 1));
