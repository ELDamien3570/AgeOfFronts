import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { Session } from "node:inspector";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const checkpoint = value("--checkpoint", "out/local-stability-20261012/fixed-browser-seed/final.v8");
const output = value("--out", "out/late-game-pace-20261012/baseline");
const count = Number(value("--ticks", "400"));
const warmup = Number(value("--warmup", "40"));
const source = value("--source", "../src/skirmish");
const { generateMigration } = await import(`${source}/MigrationMap.ts`);
const { Skirmish } = await import(`${source}/Simulation.ts`);
const { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } = await import(`${source}/SnapshotCodec.ts`);
const { formationTemplateDiagnostics } = await import(`${source}/domain/FormationGeometry.ts`);
if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid measured tick count");
if (!Number.isSafeInteger(warmup) || warmup < 0) throw new Error("Invalid warmup count");
const saved = deserialize(readFileSync(checkpoint));
if (args.includes("--autonomous-deadline")) saved.options.autonomousRouteDeadlineTicks = 40;
if (args.includes("--ai-decisions")) saved.options.autonomousDecisionInterval = 30;
const loaded = generateMigration(saved.width, saved.options.seed);
const game = new Skirmish(loaded.map, saved.options);
game.restore(saved);
const encoder = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true }), decoder = new SnapshotDecoder();
const publish = () => encoder.encode(game.replicationSource(true), game.tileChanges, game.replicationFacts());
decoder.decodeLatest(publish());
for (let i = 0; i < warmup; i++) { game.step(); decoder.decodeLatest(publish()); }
let phases: Record<string, number> = {};
game.onPhase = (name: string, ms: number) => { phases[name] = ms; };
const methods: Record<string, { calls: number; ms: number; max: number; accepted?:number }> = {};
const cancellations: Record<string, { count: number; examples: unknown[] }> = {};
if (args.includes("--cancellations")) {
  const planner = game.routePlanner as any, cancel = planner.cancel;
  planner.cancel = function(key: string) {
    const job = this.jobs.get(key);
    if (job && !job.discard && !job.retired) {
      const origin = new Error().stack!.split("\n").slice(2, 7).join("\n");
      const group = `${job.context.playerId}:${job.context.kind}:${origin}`;
      const entry = cancellations[group] ??= { count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push({ tick: game.tick, key, start: job.start,
        goal: job.goal, createdTick: job.createdTick, context: job.context });
    }
    return cancel.call(this, key);
  };
}
if (args.includes("--trace")) {
  const traced = new WeakMap<object, Set<string>>();
  const trace = (owner: any, names: string[], prefix = "") => {
    if (!owner) return;
    const seen = traced.get(owner) ?? new Set<string>(); traced.set(owner, seen);
    for (const name of names) {
      const original = owner?.[name];
      if (typeof original !== "function" || seen.has(name)) continue;
      seen.add(name);
      owner[name] = function(...params: any[]) {
        const kind = name === "formationMoveClear" ? params[0].formation?.transition ? "reform" : params[0].formation?.shape === "column" ? "column" : "settled" : "";
        const key = `${prefix}${name}${kind ? "." + kind : ""}`;
        const row = methods[key] ??= { calls: 0, ms: 0, max: 0 }, at = performance.now();
        try { const result=original.apply(this, params); if(name.startsWith("empty") && result)row.accepted=(row.accepted??0)+1; return result; }
        finally { const ms = performance.now() - at; row.calls++; row.ms += ms; row.max = Math.max(row.max, ms); }
      };
    }
  };
  trace(game, ["emptyTerrainBounds", "emptyTransitionTerrain", "emptyMovementSweep", "formationMoveClear", "transportStepClear", "formationFits", "certifyFormationPolygon", "advanceFormationStates", "syncFormationCounts", "movementLand", "routingObstacleRevision", "transportVessel", "landingNeighbors"]);
  trace(game.expansion?.battle, ["fight", "advanceProjectiles"], "battle.");
  trace(game.expansion?.trade, ["step", "capacity"], "trade.");
  trace((game.movementAdmission as any)?.occupancy, ["rebuild"], "admission.occupancy.");
  if (args.includes("--geometry-trace")) {
    trace((game as any).facingGeometry, ["contact", "body", "envelope"], "movement.geometry.");
    trace((game.expansion?.battle as any)?.geometry, ["contact", "body", "envelope", "withinReach", "lowerBound"], "battle.geometry.");
    trace(game.expansion?.battle, ["canAttack", "canTarget", "selectStructure", "fightingProfile"], "battle.");
  }
}
const session = new Session();
const post = (method: string, params = {}) => new Promise<any>((resolve, reject) => session.post(method as any, params, (error, result) => error ? reject(error) : resolve(result)));
if (args.includes("--cpu")) { session.connect(); await post("Profiler.enable"); await post("Profiler.setSamplingInterval", { interval: 1000 }); await post("Profiler.start"); }
const rows: any[] = [];
const templateStart = formationTemplateDiagnostics?.();
const started = performance.now();
for (let i = 0; i < count; i++) {
  phases = {};
  let at = performance.now(); game.step(); const simulation = performance.now() - at;
  at = performance.now(); const packet = publish(); const encoding = performance.now() - at;
  at = performance.now(); const delivered = structuredClone(packet, { transfer: snapshotTransfers(packet) }); const transfer = performance.now() - at;
  at = performance.now(); decoder.decodeLatest(delivered); const decoding = performance.now() - at;
  rows.push({ tick: game.tick, simulation, encoding, transfer, decoding, worker: simulation + encoding + transfer, total: simulation + encoding + transfer + decoding, phases, squads: game.squads.length, ships: game.ships.length,
    planning: game.routePlanner.diagnosticCohorts(game.tick), exclusive:(game.routePlanner as any).exclusiveKey });
  if ((i + 1) % 100 === 0) { console.log(JSON.stringify({ measured: i + 1, tick: game.tick, squads: game.squads.length, mean: rows.slice(-100).reduce((sum, r) => sum + r.worker, 0) / 100 })); await new Promise(resolve => setImmediate(resolve)); }
}
mkdirSync(output, { recursive: true });
if (args.includes("--cpu")) {
  const { profile } = await post("Profiler.stop");
  writeFileSync(`${output}/cpu.cpuprofile`, JSON.stringify(profile));
  await post("Debugger.enable");
  const scripts: Record<string, { url: string; source: string }> = {};
  for (const node of profile.nodes) {
    const frame = node.callFrame;
    if (!frame.url.includes("/src/skirmish/") || scripts[frame.scriptId]) continue;
    const { scriptSource } = await post("Debugger.getScriptSource", { scriptId: frame.scriptId });
    scripts[frame.scriptId] = { url: frame.url, source: scriptSource };
  }
  writeFileSync(`${output}/cpu-sources.json`, JSON.stringify(scripts));
  session.disconnect();
}
const stats = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { samples: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, p95: sorted[Math.ceil(values.length * .95) - 1], p99: sorted[Math.ceil(values.length * .99) - 1], max: sorted[sorted.length - 1], above50: values.filter(v => v > 50).length };
};
const final = serialize(game.checkpoint());
const result = { checkpoint, initialTick: saved.tick, ticks: count, node: process.version, elapsed: performance.now() - started, entities: { squads: game.squads.length, ships: game.ships.length }, timings: Object.fromEntries(["simulation", "encoding", "transfer", "decoding", "worker", "total"].map(key => [key, stats(rows.map(row => row[key]))])), phases: Object.fromEntries(Object.keys(rows[0].phases).map(key => [key, stats(rows.map(row => row.phases[key]))])), methods: Object.fromEntries(Object.entries(methods).map(([key,row]) => [key,{callsPerTick:row.calls/count,inclusiveMsPerTick:row.ms/count,max:row.max}])), finalHash: createHash("sha256").update(final).digest("hex"), limitations: "Node replay, 40 warmup ticks, publication every tick, no renderer/HUD. Transfer measures structured clone rather than browser delivery delay. CPU sampling or method tracing adds overhead when enabled." };
writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2));
if(args.includes("--trace"))writeFileSync(`${output}/methods.json`,JSON.stringify(methods,null,2));
if (args.includes("--cancellations")) writeFileSync(`${output}/cancellations.json`, JSON.stringify(cancellations, null, 2));
if (formationTemplateDiagnostics) {
  const after = formationTemplateDiagnostics();
  writeFileSync(`${output}/template-cache.json`, JSON.stringify({ ...after,
    measuredHits: after.hits - templateStart.hits, measuredMisses: after.misses - templateStart.misses }, null, 2));
}
writeFileSync(`${output}/rows.json`, JSON.stringify(rows));
writeFileSync(`${output}/final.v8`, final);
console.log(JSON.stringify(result));
