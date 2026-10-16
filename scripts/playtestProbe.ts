// `npm run probe:playtest`: the opt-in nightly playtest probe (13 R1-R4).
//
// Plays the shipped online lobby rules on Mediterranean 500 (8 human seats,
// 14 AI, 30 tribes) with every human seat driven by the AI from tick 0, and
// records which seats are alive each minute. It is not part of `npm run check`
// or the vitest glob: one seed takes several minutes of wall time.
//
// Gate (exit code 1 on failure): at the last probed minute, at least --gate of
// the 8 human seats are alive on every seed. With --time-limit-minutes, every
// seed must also end at the limit by score (endReason "time-limit") or earlier
// by conquest, or stop because no human seat is alive; a match that is still
// running at the limit fails.
//
// Options:
//   --seeds 424242,9001,31337   seeds, run one after another
//   --minutes 10                 simulated minutes per seed
//   --gate 6                     human seats that must be alive at the end
//   --difficulty standard        relaxed | standard | hard (lobby default: standard)
//   --protection 8               start protection minutes (0, 5, 8, 12)
//   --time-limit-minutes 90      match time limit (60, 90, 120 in the lobby;
//                                any whole minute here, e.g. 12 to prove the end)
//   --out tmp/playtest-probe     JSON output directory (one file per seed)
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createSkirmishMap } from "../src/skirmish/Elevation";
import { Skirmish } from "../src/skirmish/Simulation";
import { TICKS_PER_SECOND, type AiDifficulty } from "../src/skirmish/Protocol";
import {
  defaultLobbySettings,
  validateLobbySettings,
  type LobbySettings,
} from "../src/skirmish/lobby/LobbyDirectory";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap";
import { lobbyMatchOptions } from "../src/skirmish/multiplayer/application/LobbyMatchOptions";

/** 13 OD13: 424242 and 9001 are the prior probe seeds; 31337 is the third. */
export const PLAYTEST_PROBE_SEEDS = [424242, 9001, 31337] as const;
const HUMAN_SEATS = 8;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}
function integer(name: string, fallback: number): number {
  const raw = argument(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a whole number`);
  return value;
}

const seeds = (argument("seeds") ?? PLAYTEST_PROBE_SEEDS.join(",")).split(",").map(Number);
const minutes = integer("minutes", 10);
const gate = integer("gate", 6);
const outDir = resolve(argument("out") ?? join("tmp", "playtest-probe"));
const base = defaultLobbySettings("heightmap-test1", 500);
const settings: LobbySettings = validateLobbySettings({
  ...base,
  slots: HUMAN_SEATS,
  aiCount: 14,
  tribeCount: 30,
  ...(argument("difficulty") ? { aiDifficulty: argument("difficulty") as AiDifficulty } : {}),
  ...(argument("protection") ? { startProtectionMinutes: integer("protection", 0) as LobbySettings["startProtectionMinutes"] } : {}),
});
const timeLimit = argument("time-limit-minutes") === undefined ? settings.timeLimitMinutes : integer("time-limit-minutes", 0);

interface MinuteRow {
  minute: number;
  wallMs: number;
  aliveSeats: number[];
  aliveRegular: number;
  aliveTribes: number;
  winner: number | null;
  endReason: string | null;
  /** Diagnostics: each human seat's state and the wars it is in. */
  seats: { id: number; land: number; squads: number; troops: number; age: string; eliminated: boolean;
    wars: { with: number; kind: string; initiator?: number; cause?: string }[] }[];
  /** Diagnostics: [id, kind initial, living squads, AI campaign "phase:target"] per living faction. */
  factions: [number, string, number, string][];
}

async function probe(seed: number) {
  const loaded = await loadServerMap(settings, resolve("resources"), seed);
  const m = loaded.map;
  const map = createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain);
  const humans = Array.from({ length: HUMAN_SEATS }, (_, i) => ({ name: `Seat ${i + 1}` }));
  const options = {
    ...lobbyMatchOptions(settings, humans, seed),
    territoryIncomeScale: loaded.territoryIncomeScale,
    ...(timeLimit === undefined ? {} : { timeLimitMinutes: timeLimit }),
  };
  const game = new Skirmish(map, options);
  for (let id = 1; id <= HUMAN_SEATS; id++) game.setAiController(id, true);
  const rows: MinuteRow[] = [];
  const started = performance.now();
  let stop: string | null = null;
  for (let minute = 1; minute <= minutes && !stop; minute++) {
    for (let i = 0; i < 60 * TICKS_PER_SECOND && game.winner === null; i++) game.step();
    const aliveSeats = game.players.filter(p => p.id <= HUMAN_SEATS && !p.eliminated).map(p => p.id);
    const row: MinuteRow = {
      minute,
      wallMs: Math.round(performance.now() - started),
      aliveSeats,
      aliveRegular: game.players.filter(p => !p.eliminated && p.kind === "regular").length,
      aliveTribes: game.players.filter(p => !p.eliminated && p.kind === "tribe").length,
      winner: game.winner,
      endReason: game.endReason,
      seats: game.players.filter(p => p.id <= HUMAN_SEATS).map(p => {
        const squads = game.squads.filter(q => q.playerId === p.id && q.troops > 0);
        return {
          id: p.id, land: p.land, squads: squads.length, troops: squads.reduce((n, q) => n + q.troops, 0),
          age: game.expansion?.progression.states[p.id]?.age ?? "", eliminated: p.eliminated,
          wars: (game.expansion?.diplomacy.state.wars ?? []).filter(w => w.a === p.id || w.b === p.id).map(w => {
            const other = w.a === p.id ? w.b : w.a;
            return { with: other, kind: game.player(other)?.kind ?? "", initiator: w.initiator, cause: w.cause };
          }),
        };
      }),
      factions: game.players.filter(p => !p.eliminated).map(p => {
        const op = game.expansion?.operations.state(p.id);
        return [p.id, p.kind[0], game.squads.filter(q => q.playerId === p.id && q.troops > 0).length,
          op && op.phase !== "peace" ? `${op.phase}:${op.target ?? ""}` : ""];
      }),
    };
    rows.push(row);
    console.log(JSON.stringify({ seed, minute, wallMs: row.wallMs, aliveSeats, aliveRegular: row.aliveRegular,
      aliveTribes: row.aliveTribes, winner: row.winner, endReason: row.endReason, seatSquads: row.seats.map(s => s.squads) }));
    // The online coordinator ends a match a minute after its last human seat
    // falls (NO_LIVING_HUMAN_END_MS); the simulation ends it by its own rules.
    if (game.winner !== null) stop = `ended: ${game.endReason}`;
    else if (!aliveSeats.length) stop = "no living human";
  }
  const last = rows[rows.length - 1];
  const failures: string[] = [];
  if (last.aliveSeats.length < gate)
    failures.push(`${last.aliveSeats.length}/${HUMAN_SEATS} seats alive at minute ${last.minute} (gate ${gate})`);
  if (timeLimit !== undefined && timeLimit <= minutes && game.winner === null && stop !== "no living human")
    failures.push(`match still running after its ${timeLimit}-minute limit`);
  if (game.winner !== null && game.endReason === null) failures.push("match ended without an end reason");
  const result = { seed, settings, timeLimitMinutes: timeLimit ?? null, minutes, gate, stop, failures, rows };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `probe-${seed}-${settings.aiDifficulty ?? "hard"}.json`), JSON.stringify(result, null, 1));
  return result;
}

(async () => {
  let failed = false;
  for (const seed of seeds) {
    const result = await probe(seed);
    const verdict = result.failures.length ? `FAIL ${result.failures.join("; ")}` : "PASS";
    console.log(`seed ${seed}: ${verdict} (${result.stop ?? "running"})`);
    failed ||= result.failures.length > 0;
  }
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
