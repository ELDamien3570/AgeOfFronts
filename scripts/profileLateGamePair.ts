import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { createHash } from "node:crypto";

// Alternate order every tick so warmup, thermal drift and background load do
// not consistently favor one implementation. Both matches publish every tick.
const args = process.argv.slice(2);
const value = (key: string, fallback: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const output = value("--out", "out/late-game-20ms-20261012/paired");
const count = Number(value("--ticks", "400"));
if (!Number.isSafeInteger(count) || count < 1) throw Error("Invalid tick count");
const warmup = Number(value("--warmup", "40"));
if (!Number.isSafeInteger(warmup) || warmup < 0) throw Error("Invalid warmup count");
const saved = readFileSync(value("--checkpoint", "out/local-stability-20261012/fixed-browser-seed/final.v8"));
async function load(source: string, candidate=false) {
  const { generateMigration } = await import(`${source}/MigrationMap.ts`);
  const { Skirmish } = await import(`${source}/Simulation.ts`);
  const { SnapshotEncoder, SnapshotDecoder, snapshotTransfers } = await import(`${source}/SnapshotCodec.ts`);
  const state = deserialize(saved);
  if (args.includes("--autonomous-deadline")) state.options.autonomousRouteDeadlineTicks = 40;
  if (candidate && args.includes("--candidate-deadline")) state.options.autonomousRouteDeadlineTicks = 40;
  if (candidate && args.includes("--ai-decisions")) state.options.autonomousDecisionInterval = 30;
  const game = new Skirmish(generateMigration(state.width, state.options.seed).map, state.options);
  game.restore(state);
  const encoder = new SnapshotEncoder(false, { compactFormationSlots: true, compactTraders: true }), decoder = new SnapshotDecoder();
  const rows: any[] = [];
  const motion={squads:{ticks:0,distance:0},ships:{ticks:0,distance:0},traders:{ticks:0,distance:0}};
  const positions=Object.fromEntries(Object.keys(motion).map(key=>[key,new Map<number,{x:number;y:number;pass:number}>()]));
  let motionPass=0;
  let phases: Record<string, number> = {};
  game.onPhase = (name: string, ms: number) => { phases[name] = ms; };
  function step() {
    phases = {};
    let at = performance.now(); game.step(); const simulation = performance.now() - at;
    at = performance.now(); const packet = encoder.encode(game.replicationSource(true), game.tileChanges, game.replicationFacts());
    const encoding = performance.now() - at;
    at = performance.now(); const delivered = structuredClone(packet, { transfer: snapshotTransfers(packet) });
    const transfer = performance.now() - at;
    at = performance.now(); decoder.decodeLatest(delivered); const decoding = performance.now() - at;
    const pass=++motionPass;
    for(const [kind,entities] of Object.entries({squads:game.squads,ships:game.ships,traders:game.expansion?.trade.actors??[]})) {
      const previous=positions[kind],counter=motion[kind as keyof typeof motion];
      for(const entity of entities as any[]) {
        const old=previous.get(entity.id);
        if(old) {
          if(old.x!==entity.x || old.y!==entity.y) { counter.ticks++;counter.distance+=Math.hypot(old.x-entity.x,old.y-entity.y); }
          old.x=entity.x;old.y=entity.y;old.pass=pass;
        } else previous.set(entity.id,{x:entity.x,y:entity.y,pass});
      }
      for(const [id,old] of previous)if(old.pass!==pass)previous.delete(id);
    }
    return { tick: game.tick, simulation, encoding, transfer, decoding, worker: simulation + encoding + transfer, phases };
  }
  step(); // Establish the decoder's publication baseline.
  const metrics = () => ({ routing: game.routePlanner.diagnosticCohorts(game.tick),
    motion: Object.fromEntries(Object.entries(motion).map(([kind,counter])=>[kind,{...counter}])),
    deliveredGold: Object.values(game.expansion?.trade.deliveredGold ?? {}).reduce((a: number,b: number)=>a+b,0),
    movingTraders: game.expansion?.trade.actors.filter((a: any)=>a.nextPathIndex<a.path.length).length ?? 0 });
  return { game, rows, step, metrics, before: undefined as ReturnType<typeof metrics> | undefined };
}
const control = await load(value("--control", "../out/late-game-20ms-20261012/control/src/skirmish"));
const candidate = await load("../src/skirmish",true);
for (let tick = 0; tick < warmup + count; tick++) {
  if (tick === warmup) { control.before = control.metrics(); candidate.before = candidate.metrics(); }
  for (const run of tick % 2 ? [candidate, control] : [control, candidate]) {
    const row = run.step(); if (tick >= warmup) run.rows.push(row);
  }
  if (tick >= warmup && (tick - warmup + 1) % 100 === 0) {
    console.log(JSON.stringify({ measured: tick - warmup + 1, control: control.rows.slice(-100).reduce((n, r) => n + r.worker, 0) / 100,
      candidate: candidate.rows.slice(-100).reduce((n, r) => n + r.worker, 0) / 100 }));
    await new Promise(resolve => setImmediate(resolve));
  }
}
const stats = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { mean: values.reduce((n, v) => n + v, 0) / values.length, p95: sorted[Math.ceil(values.length * .95) - 1],
    p99: sorted[Math.ceil(values.length * .99) - 1], max: sorted.at(-1), above50: values.filter(v => v > 50).length };
};
mkdirSync(output, { recursive: true });
const results: Record<string, any> = {};
for (const [name, run] of Object.entries({ control, candidate })) {
  results[name] = { timings: Object.fromEntries(["simulation", "encoding", "transfer", "decoding", "worker"].map(key => [key, stats(run.rows.map(r => r[key]))])),
    phases: Object.fromEntries(Object.keys(run.rows[0].phases).map(key => [key, stats(run.rows.map(r => r.phases[key]))])),
    hash: createHash("sha256").update(serialize(run.game.checkpoint())).digest("hex"),
    before: run.before, after: run.metrics() };
  writeFileSync(`${output}/${name}-rows.json`, JSON.stringify(run.rows));
}
results.limitations = "Two alternating Node matches share process and GC; no renderer. Confirm gains in isolated rendered browser continuations.";
writeFileSync(`${output}/result.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
