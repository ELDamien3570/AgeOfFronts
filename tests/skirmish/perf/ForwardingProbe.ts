// N6 probe: publications per simulated second, per-client KB/s and the
// forwarding delay of streamed publications on the real path
// (ReservedMatchWorker + serverMatchWorker + snapshot encoder thread), paced
// like LiveMatch.advanceWorld (125 ms ticks, clock-debt rebase, the single 5 Hz
// wall and simulation gate, 1 tick per advance). Every seat is AI-controlled,
// so the run is reproducible without a command log. Not a test and not a gate;
// run it on an idle machine.
//
//   npx tsx tests/skirmish/perf/ForwardingProbe.ts [med|mig] [ticks=2400] [out.json]
//
// delay = publication arrival - arrival of the advance result for that tick
// (negative when the publication overtakes its result; the coordinator then
// holds the result, never the publication).
import { writeFileSync } from "node:fs";
import { ReservedMatchWorker } from "../../../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker";
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { DEFAULT_AI_POLICIES } from "../../../src/skirmish/content/AiPolicies";
import { FORMATION_MOVEMENT } from "../../../src/skirmish/content/FormationMovement";
import type { MatchAdvance, MatchPublication } from "../../../src/skirmish/multiplayer/application/MatchExecutor";
import { PUBLICATION_MIN_INTERVAL_MS } from "../../../src/skirmish/multiplayer/application/LiveMatch";
import { MAX_ADVANCE_TICKS } from "../../../src/skirmish/multiplayer/application/MatchExecutor";
import { TICK_MS } from "../../../src/skirmish/Protocol";

const [mapArg = "med", ticksArg = "2400", outFile] = process.argv.slice(2);
const TOTAL = Number(ticksArg), mapId = mapArg === "mig" ? "migration" : "heightmap-test1", seed = 1272661902;
const settings = { ...defaultLobbySettings(mapId as never, 500), aiCount: 14, tribeCount: 30, startingAge: "Napoleonic" } as never;
const options = { ...DEFAULT_AI_POLICIES, diplomacyRules: "raids-v1", armyTravel: "corridors-v1", ...FORMATION_MOVEMENT, seed,
  humanNames: Array.from({ length: 8 }, (_, i) => `H${i + 1}`), aiCount: 14, tribes: true, tribeCount: 30, ruleset: "ages-v1",
  victoryMode: "solo", technologySpeed: 1, startingAge: "Napoleonic", resourceDensity: 1, resourceOutput: 1,
  infiniteGoldForPlayers: false, alliances: false } as never;
const stats = (values: number[]) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.ceil(v.length * p) - 1))];
  return { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), p50: +q(.5).toFixed(2), p95: +q(.95).toFixed(2), p99: +q(.99).toFixed(2), max: +v[v.length - 1].toFixed(2) };
};
const worker = new ReservedMatchWorker();
const resultAt = new Map<number, number>();
const rows: { tick: number; at: number; bytes: number }[] = [];
worker.onPublication((p: MatchPublication) => rows.push({ tick: p.tick, at: performance.now(), bytes: p.packet.binary?.byteLength ?? p.packet.payload.length }));
const initial = await worker.request<MatchAdvance>({ type: "initialize", settings, options, streamPublications: true });
for (let id = 1; id <= 8; id++) await worker.request({ type: "set-controller", playerId: id, ai: true });
let tick = initial.tick;
const started = performance.now();
let nextTickAt = started + TICK_MS, nextSnapshotAt = started + PUBLICATION_MIN_INTERVAL_MS, nextSimMs = tick * TICK_MS + PUBLICATION_MIN_INTERVAL_MS;
const rtt: number[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
while (tick < TOTAL) {
  let now = performance.now();
  if (now < nextTickAt) { await sleep(nextTickAt - now); now = performance.now(); }
  const due = Math.floor((now - nextTickAt) / TICK_MS) + 1;
  nextTickAt = due > MAX_ADVANCE_TICKS ? now - (MAX_ADVANCE_TICKS - 2) * TICK_MS : nextTickAt + TICK_MS;
  const publish = now >= nextSnapshotAt && (tick + 1) * TICK_MS >= nextSimMs;
  if (publish) {
    nextSnapshotAt += (Math.floor((now - nextSnapshotAt) / PUBLICATION_MIN_INTERVAL_MS) + 1) * PUBLICATION_MIN_INTERVAL_MS;
    nextSimMs += (Math.floor(((tick + 1) * TICK_MS - nextSimMs) / PUBLICATION_MIN_INTERVAL_MS) + 1) * PUBLICATION_MIN_INTERVAL_MS;
  }
  const sent = performance.now();
  const result = await worker.request<MatchAdvance>({ type: "advance", ticks: 1, commands: [], disconnectedPlayerIds: [], publish });
  const done = performance.now();
  rtt.push(done - sent); resultAt.set(result.tick, done); tick = result.tick;
  if (tick % 400 === 0) console.log(JSON.stringify({ tick, wallSec: Math.round((done - started) / 1000), publications: rows.length }));
}
await sleep(500);
const wallSec = (performance.now() - started) / 1000;
const summary = { mapId, ticks: TOTAL, wallSec: +wallSec.toFixed(1), simSecPerWallSec: +((TOTAL - initial.tick) / 8 / wallSec).toFixed(3),
  publications: rows.length, publicationsPerSimSecond: +(rows.length / ((TOTAL - initial.tick) / 8)).toFixed(2),
  kbPerClientPerWallSecond: +(rows.reduce((a, r) => a + r.bytes, 0) / 1024 / wallSec).toFixed(1),
  delay: stats(rows.map(r => r.at - (resultAt.get(r.tick) ?? NaN))), advanceRtt: stats(rtt) };
console.log(JSON.stringify(summary, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify(summary, null, 1));
await worker.close();
