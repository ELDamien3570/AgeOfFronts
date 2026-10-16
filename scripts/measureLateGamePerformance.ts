import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
const label = process.argv[2] ?? "candidate",
  count = Number(process.argv[3] ?? 1000);
const root = "out/performance-investigation-20261012";
const source = label.includes("combined")
  ? `../out/performance-investigation-20261012/combined-${label.startsWith("baseline") ? "baseline" : "candidate"}/src/skirmish`
  : label.startsWith("baseline")
  ? "../out/performance-investigation-20261012/baseline/src/skirmish"
  : "../src/skirmish";
const { generateMigration } = await import(`${source}/MigrationMap.ts`),
  { Skirmish } = await import(`${source}/Simulation.ts`),
  { SnapshotEncoder, SnapshotDecoder } = await import(
    `${source}/SnapshotCodec.ts`
  );
// I-0: thread CPU next to wall time, so a contended host is visible
// (wall/CPU above WALL_PER_CPU_FLAG flags the run).
const { threadCpuClock, WALL_PER_CPU_FLAG } = await import("../src/skirmish/RuntimeDiagnostics.ts");
const saved = deserialize(readFileSync(`${root}/fresh-checkpoint.v8`)),
  loaded = generateMigration(1000, 504565698),
  game = new Skirmish(loaded.map, saved.options);
game.restore(saved);
if (label.includes("warm")) {
  game.paths.prepare();
  game.waterPaths.prepare();
}
const methods: Record<string, { calls: number; ms: number; max: number; slowCall?: unknown }> = {};
let measuring = false;
if (label.includes("profile")) {
  const { PlanningPath } = await import(`${source}/PlanningWorkspace.ts`);
  const owners: any[] = [
    [game.paths, "land", ["warm", "find", "stepCorridor", "beginPlanning"]],
    [game.waterPaths, "water", ["warm", "find", "stepCorridor", "beginPlanning"]],
    [game.routePlanner, "planner", ["step", "selectJob", "nextJob", "cohort"]],
    [(game.routePlanner as any).ports, "plannerPorts", ["valid", "obstacleRevision", "blocked", "prepare", "completed", "priority", "identity", "corridorReady"]],
    [PlanningPath.prototype, "exactSearch", ["step"]],
    [game.routeWork, "legacy", ["drain"]],
    [game.movementAdmission, "admission", ["step", "stepInteractive"]],
    [game.expansion?.armies, "army", ["stepPlanning", "resolveRoute"]],
  ];
  for (const [owner, prefix, names] of owners) {
    if (!owner) continue;
    for (const name of names) {
      const original = owner[name];
      if (typeof original !== "function") continue;
      const key = prefix + "." + name;
      methods[key] = { calls: 0, ms: 0, max: 0 };
      owner[name] = function (...args: any[]) {
        const at = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          if (measuring) {
            const ms = performance.now() - at;
            methods[key].calls++;
            methods[key].ms += ms;
            if (ms > methods[key].max) {
              methods[key].max = ms;
              methods[key].slowCall = {
                tick: game.tick,
                request: args[0]?.key,
                context: args[0]?.context,
                outcome: typeof args[1] === "string" || typeof args[1] === "number" ? args[1] : undefined,
                pathLength: Array.isArray(args[2]) ? args[2].length : undefined,
                searchPhase: this.state?.phase,
              };
            }
          }
        }
      };
    }
  }
}
if (label.endsWith("exact")) {
  const { RoutePlanner } =
    await import("../out/performance-investigation-20261012/baseline/src/skirmish/RoutePlanner.ts");
  game.routePlanner.step = RoutePlanner.prototype.step;
}
const encoder = new SnapshotEncoder(),
  rows: any[] = [],
  hashes: string[] = [];
let row: any;
game.onPhase = (name: string, ms: number) => {
  if (row) row.phases[name] = ms;
};
encoder.encode(
  game.replicationSource(),
  game.tileChanges,
  game.replicationFacts(),
);
for (let i = 0; i < 40; i++) game.step();
for (let i = 0; i < count; i++) {
  measuring = true;
  row = { tick: game.tick + 1, phases: {} };
  let at = performance.now();
  const cpuAt = threadCpuClock() ?? 0;
  game.step();
  row.simulation = performance.now() - at;
  row.simulationCpu = (threadCpuClock() ?? cpuAt) - cpuAt;
  at = performance.now();
  encoder.encode(
    game.replicationSource(),
    game.tileChanges,
    game.replicationFacts(),
  );
  row.encoding = performance.now() - at;
  row.total = row.simulation + row.encoding;
  row.squads = game.squads.length;
  row.squadReads = encoder.diagnostics.squadReads;
  // Decoder runs are separate from worker time. The first packet must reset a
  // fresh decoder, so decode measurements start on a separate full encoder.
  rows.push(row);
  row = undefined;
  if (label.endsWith("proof") || label.endsWith("exact"))
    hashes.push(
      createHash("sha256").update(serialize(game.checkpoint())).digest("hex"),
    );
  if (i % 100 === 99) {
    console.log(
      JSON.stringify({
        label,
        tick: game.tick,
        squads: game.squads.length,
        mean: rows.slice(-100).reduce((a, r) => a + r.total, 0) / 100,
      }),
    );
    await new Promise((r) => setImmediate(r));
  }
}
const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  return {
    n: s.length,
    mean: xs.reduce((a, b) => a + b, 0) / s.length,
    p95: s[Math.ceil(s.length * 0.95) - 1],
    p99: s[Math.ceil(s.length * 0.99) - 1],
    max: s.at(-1),
    over50: xs.filter((x) => x > 50).length,
  };
};
// Paired projection-only timing, same packets and independent decoder owners.
const copyDecoder = new SnapshotDecoder(),
  latestDecoder = new SnapshotDecoder(),
  projectionEncoder = new SnapshotEncoder();
const full = projectionEncoder.encode(
  game.replicationSource(),
  game.tileChanges,
  game.replicationFacts(),
);
copyDecoder.decode(full);
latestDecoder.decode(full, false);
const copy: number[] = [],
  latest: number[] = [];
for (let i = 0; i < 100; i++) {
  const packet = projectionEncoder.encode(
    game.replicationSource(),
    game.tileChanges,
    game.replicationFacts(),
  );
  let at = performance.now();
  copyDecoder.decode(packet);
  copy.push(performance.now() - at);
  at = performance.now();
  latestDecoder.decode(packet, false);
  latest.push(performance.now() - at);
}
const result = {
  label,
  count,
  node: process.version,
  ticks: [saved.tick + 41, game.tick],
  simulation: stats(rows.map((r) => r.simulation)),
  simulationCpu: stats(rows.map((r) => r.simulationCpu)),
  // Whole-run wall per thread-CPU time of the steps; above the flag the host
  // was contended and the wall timings are not representative.
  wallPerCpu: rows.reduce((a, r) => a + r.simulation, 0) / Math.max(1e-9, rows.reduce((a, r) => a + r.simulationCpu, 0)),
  contended: rows.reduce((a, r) => a + r.simulation, 0) > WALL_PER_CPU_FLAG * rows.reduce((a, r) => a + r.simulationCpu, 0),
  encoding: stats(rows.map((r) => r.encoding)),
  total: stats(rows.map((r) => r.total)),
  phases: Object.fromEntries(
    Object.keys(rows[0].phases).map((k) => [
      k,
      stats(rows.map((r) => r.phases[k])),
    ]),
  ),
  entities: {
    start: rows[0].squads,
    end: game.squads.length,
    ships: game.ships.length,
  },
  details: encoder.detailDiagnostics,
  methods: Object.fromEntries(
    Object.entries(methods).map(([k, v]) => [
      k,
      {
        callsPerTick: v.calls / count,
        inclusiveMsPerTick: v.ms / count,
        max: v.max,
        slowCall: v.slowCall,
      },
    ]),
  ),
  projection: { copy: stats(copy), latest: stats(latest) },
  limitations:
    "Headless local Node. 40 warmup ticks, encode every tick. Projection timings use unchanged packets; not a browser frame benchmark. Proof runs add hashes outside the tick timer and must not be used as primary timings.",
};
mkdirSync(root, { recursive: true });
writeFileSync(`${root}/${label}-result.json`, JSON.stringify(result, null, 2));
writeFileSync(`${root}/${label}-rows.json`, JSON.stringify(rows));
writeFileSync(`${root}/${label}-final.v8`, serialize(game.checkpoint()));
if (hashes.length)
  writeFileSync(`${root}/${label}-hashes.json`, JSON.stringify(hashes));
console.log(JSON.stringify(result));
