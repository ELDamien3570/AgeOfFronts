// Pacing probe (13 R8; balance table "pacing table"). Not a test and not a
// timing gate: it records when factions reach each age in a full-size match.
//
//   npx tsx scripts/pacingProbe.ts --out <file.json> [--seeds 424242,9001,47]
//     [--minutes 60] [--mode idle|ai] [--resources <dir>]
//
// Match: heightmap-test1 at 500, 8 human seats + 14 AI nations + 30 tribes
// (52 factions), Stone start, technology speed 1, the default AI policies,
// raids-v1 diplomacy, corridor army travel, formation movement, no alliances,
// solo victory. Mode "idle": human seats issue no commands. Mode "ai": the human
// seats are handed to the AI at tick 0.
//
// Output (rewritten after every simulated minute, so a long run can be read
// while it continues): per seed, the minute each regular faction first reached
// each age, the leader and median minute per age, humans alive at minutes 10,
// 20 and 30, tribes promoted, and squads alive. One seed takes on the order of
// a wall-clock hour for 60 minutes on a quiet 8-core machine; run seeds one at
// a time in the background, never next to a test or timing run.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSkirmishMap } from "../src/skirmish/Elevation";
import { DEFAULT_AI_POLICIES } from "../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../src/skirmish/content/FormationMovement";
import { AGES, type Age } from "../src/skirmish/domain/Definitions";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap";
import { TICKS_PER_SECOND } from "../src/skirmish/Protocol";
import { Skirmish } from "../src/skirmish/Simulation";

function arg(name: string, fallback?: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
}
const out = arg("out");
if (!out) throw new Error("Pass --out <file.json>");
const seeds = (arg("seeds", "424242,9001,47") ?? "").split(",").map(Number).filter(Number.isFinite);
const minutes = Number(arg("minutes", "60"));
const mode = arg("mode", "idle");
if (mode !== "idle" && mode !== "ai") throw new Error("--mode must be idle or ai");

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

interface SeedResult {
  seed: number; mode: string; minutesRun: number; wallSeconds: number;
  regularFactions: number;
  ages: Record<string, { leader: number | null; median: number | null; reached: number }>;
  humansAlive: Record<string, number>;
  tribesPromoted: number; squads: number;
  firstReached: Record<number, Partial<Record<Age, number>>>;
}

(async () => {
  const results: SeedResult[] = [];
  for (const seed of seeds) {
    const settings = { ...defaultLobbySettings("heightmap-test1" as never, 500), aiCount: 14, tribeCount: 30 };
    const loaded = await loadServerMap(settings as never, arg("resources", join(process.cwd(), "resources"))!, seed);
    const m = loaded.map;
    const map = createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain);
    const game = new Skirmish(map, {
      ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT,
      seed, humanNames: Array.from({ length: 8 }, (_, i) => `H${i + 1}`), aiCount: 14, tribes: true, tribeCount: 30,
      ruleset: "ages-v1", startingAge: "StoneAge", victoryMode: "solo", technologySpeed: 1,
      territoryIncomeScale: loaded.territoryIncomeScale, alliances: false,
    } as never);
    const humans = game.players.filter(p => !p.ai).map(p => p.id);
    if (mode === "ai") for (const id of humans) game.setAiController(id, true);
    const progression = game.expansion!.progression;
    const firstReached: Record<number, Partial<Record<Age, number>>> = {};
    const humansAlive: Record<string, number> = {};
    const started = performance.now();
    const result: SeedResult = {
      seed, mode, minutesRun: 0, wallSeconds: 0, regularFactions: 0, ages: {}, humansAlive,
      tribesPromoted: 0, squads: 0, firstReached,
    };
    results.push(result);
    for (let minute = 1; minute <= minutes; minute++) {
      for (let i = 0; i < 60 * TICKS_PER_SECOND; i++) game.step();
      // Promoted tribes count as regular factions from their promotion on.
      const regular = game.players.filter(p => p.kind === "regular");
      for (const p of regular) {
        const age = progression.states[p.id]?.age;
        if (!age) continue;
        const reached = (firstReached[p.id] ??= {});
        for (const a of AGES.slice(1, AGES.indexOf(age) + 1)) reached[a] ??= minute;
      }
      if (minute === 10 || minute === 20 || minute === 30)
        humansAlive[String(minute)] = humans.filter(id => !game.player(id)?.eliminated).length;
      result.minutesRun = minute;
      result.wallSeconds = Math.round((performance.now() - started) / 1000);
      result.regularFactions = regular.length;
      result.tribesPromoted = game.players.filter(p => p.colorKind === "tribe" && p.kind === "regular").length;
      result.squads = game.squads.length;
      result.ages = Object.fromEntries(AGES.slice(1).map(a => {
        const at = Object.values(firstReached).map(r => r[a]).filter((n): n is number => n !== undefined);
        return [a, { leader: at.length ? Math.min(...at) : null, median: median(at), reached: at.length }];
      }));
      writeFileSync(out, JSON.stringify({ map: "heightmap-test1", worldSize: 500, factions: game.players.length, minutes, results }, null, 1));
      console.log(JSON.stringify({ seed, minute, wall: result.wallSeconds,
        leaders: Object.fromEntries(Object.entries(result.ages).map(([a, v]) => [a, v.leader])) }));
    }
  }
})();
