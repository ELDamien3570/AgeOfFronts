import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";
import { Session } from "node:inspector";
import { Skirmish } from "../src/skirmish/Simulation";
import { createSkirmishMap } from "../src/skirmish/Elevation";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings, type LobbySettings } from "../src/skirmish/lobby/LobbyDirectory";
import { lobbyMatchOptions } from "../src/skirmish/multiplayer/application/LobbyMatchOptions";
import { SnapshotEncoder } from "../src/skirmish/SnapshotCodec";
import { TICKS_PER_SECOND } from "../src/skirmish/Protocol";
import { MAX_AI_OPPONENTS, MAX_TRIBES } from "../src/skirmish/FactionRules";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: profileSeaTrade.ts (--fresh | --checkpoint FILE) --out NEW_DIRECTORY [--policy legacy|lanes-v1] [--map ID --size 250|500|1000 --seed N --ai N --tribes N --technology-speed 1|2|3] [--warmup N --ticks N --publish-every N --sample-every N --trace-routing true|false --cpu-profile true|false]");
  process.exit(0);
}
const valuedFlags = new Set(["--checkpoint", "--out", "--policy", "--map", "--size", "--seed", "--ai", "--tribes",
  "--technology-speed", "--warmup", "--ticks", "--publish-every", "--sample-every", "--trace-routing", "--cpu-profile"]);
const seenFlags = new Set<string>();
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (flag !== "--fresh" && !valuedFlags.has(flag)) throw Error(`Unknown profiling option: ${flag}`);
  if (seenFlags.has(flag)) throw Error(`Duplicate profiling option: ${flag}`);
  seenFlags.add(flag);
  if (valuedFlags.has(flag)) {
    const argument = args[++index];
    if (argument === undefined || argument.startsWith("--")) throw Error(`Missing value for ${flag}`);
  }
}
const value = (key: string, fallback?: string) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const integer = (key: string, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value(key, String(fallback))); if (!Number.isSafeInteger(n) || n < minimum || n > maximum) throw Error(`Invalid ${key}`); return n;
};
const boolean = (key: string) => { const v = value(key, "false"); if (v !== "true" && v !== "false") throw Error(`Invalid ${key}`); return v === "true"; };
const policy = value("--policy", "legacy"); if (!["legacy", "lanes-v1"].includes(policy!)) throw Error("Invalid policy");
const input = value("--checkpoint"), fresh = args.includes("--fresh");
if (Boolean(input) === fresh) throw Error("Choose exactly one of --checkpoint or --fresh");
const output = value("--out"); if (!output || existsSync(output)) throw Error("Supply a new --out directory");
const ticks = integer("--ticks", 4800, 1), warmup = integer("--warmup", 0);
const publishEvery = integer("--publish-every", 2, 1), sampleEvery = integer("--sample-every", 8, 1);
const trace = boolean("--trace-routing"), cpu = boolean("--cpu-profile");
let fixture: any;
if (input) {
  fixture = deserialize(readFileSync(input));
  if ((fixture.options.seaTradeRouting ?? "legacy") !== policy) throw Error("Checkpoint policy differs; use convertSeaTradeFixture.ts explicitly");
  for (const key of ["--seed", "--map", "--size", "--ai", "--tribes", "--technology-speed"]) if (args.includes(key)) throw Error(`Checkpoint supplies ${key}; do not override it`);
} else {
  const seed = integer("--seed", 1606492585, 0, 0x7fffffff), size = integer("--size", 1000);
  if (![250, 500, 1000].includes(size)) throw Error("Unsupported qualification size");
  const settings: LobbySettings = { ...defaultLobbySettings(value("--map", "migration") as LobbySettings["mapId"], size as LobbySettings["worldSize"]),
    aiCount: integer("--ai", 14, 0, MAX_AI_OPPONENTS), tribeCount: integer("--tribes", 30, 0, MAX_TRIBES),
    technologySpeed: Number(value("--technology-speed", "3")) as LobbySettings["technologySpeed"], startProtectionMinutes: 0 };
  if (![1, 2, 3].includes(settings.technologySpeed)) throw Error("Invalid --technology-speed");
  fixture = { seed, settings, options: { ...lobbyMatchOptions(settings, [{ name: "Fixture" }], seed),
    ...(policy === "lanes-v1" ? { seaTradeRouting: "lanes-v1" } : {}) } };
  if (policy === "legacy") delete fixture.options.seaTradeRouting;
}
const loaded = await loadServerMap(fixture.settings, undefined, fixture.seed), m = loaded.map;
if (fresh && loaded.territoryIncomeScale !== undefined) fixture.options.territoryIncomeScale = loaded.territoryIncomeScale;
const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), fixture.options);
if (input) game.restore(fixture.checkpoint);
else for (const player of game.players) if (!player.ai) game.setAiController(player.id, true);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(output, { recursive: false });
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const changed = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--name-only", "HEAD"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const untracked = execFileSync("git", ["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const hashes = Object.fromEntries([...new Set([...changed, ...untracked])].filter(path => existsSync(path)).map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]));
const manifest = { sha, hashes, node: process.version, platform: process.platform, arch: process.arch,
  seed: fixture.seed, settings: fixture.settings, options: fixture.options, input: input && resolve(input),
  checkpointHash: input && createHash("sha256").update(readFileSync(input)).digest("hex"),
  conversionManifest: input && existsSync(`${input}.json`) ? JSON.parse(readFileSync(`${input}.json`, "utf8")) : undefined,
  mapSignature: createHash("sha256").update(m.terrain).digest("hex"), startTick: game.tick,
  ticks, warmup, publishEvery, sampleEvery, trace, cpu,
  policyParameters: { nearbyExtra: 16, nearbyRatioNumerator: 3, nearbyRatioDenominator: 2 },
  timingQualified: false, qualification: "Development runs may overlap other validation. Read-only sampled telemetry; ready-delay and lane-latency gates require event-level tests. Timing includes instrumentation when trace=true." };
writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
const profiler = new Session();
const post = (method: string) => new Promise<any>((resolve, reject) => profiler.post(method, (error, result) => error ? reject(error) : resolve(result)));
if (cpu) { profiler.connect(); await post("Profiler.enable"); await post("Profiler.start"); }
const encoder = new SnapshotEncoder(true, { compactFormationSlots: true, compactTraders: true });
let phases: Record<string, number> = {};
game.onPhase = (name, ms) => { phases[name] = (phases[name] ?? 0) + ms; };
const trade = game.expansion!.trade;
const laneLatency = new Uint32Array(4802), sourceLatency = new Uint32Array(4802);
let latencyCount = 0, sourceLatencyCount = 0, maxLaneLatency = 0, maxSourceLatency = 0, censoredDemands = 0;
const pendingSubscribers = new Map<string, { laneId: number; tick: number; source: boolean; kind: string }>();
const demandLatencies = new Map<string, { rows: Uint32Array; count: number; max: number }>();
const laneSubscribers = new Map<number, Set<string>>();
const events: unknown[] = [];
const readyEligible = new Map<number, number>();
const readyDelay = new Uint32Array(10);
const pairHistory = new Map<string, number>();
let recurringAcquisitions = 0, recurringReady = 0;
const recurringByHolder = new Map<string, {acquisitions:number;ready:number}>();
const selectedDelay = new Uint32Array(4802); let selectedDelayCount = 0, selectedDelayMax = 0;
const returnDistances: Record<string, { count: number; total: number; max: number }> = {};
const observeLatency = (ticks: number, source: boolean, kind: string) => {
  let byKind = demandLatencies.get(kind); if (!byKind) { byKind = { rows: new Uint32Array(4802), count: 0, max: 0 }; demandLatencies.set(kind, byKind); }
  byKind.rows[Math.min(4801, ticks)]++; byKind.count++; byKind.max = Math.max(byKind.max, ticks);
  laneLatency[Math.min(4801, ticks)]++; latencyCount++; maxLaneLatency = Math.max(maxLaneLatency, ticks);
  if (source) { sourceLatency[Math.min(4801, ticks)]++; sourceLatencyCount++; maxSourceLatency = Math.max(maxSourceLatency, ticks); }
};
const removePending = (key: string) => {
  const sub = pendingSubscribers.get(key); if (!sub) return;
  pendingSubscribers.delete(key); const subscribers = laneSubscribers.get(sub.laneId)!; subscribers.delete(key);
  if (!subscribers.size) laneSubscribers.delete(sub.laneId);
};
if (trade.seaTrade) {
  trade.seaTrade.routes.onEvent = event => {
    if (trace) events.push(event);
    if (event.type === "acquire" && event.subscriber) {
      if (!event.ready && event.selectedDemandTick !== undefined) {
        const delay = event.tick - event.selectedDemandTick;
        selectedDelay[Math.min(4801, delay)]++; selectedDelayCount++; selectedDelayMax = Math.max(selectedDelayMax, delay);
      }
      if ((event.holder === "actor-demand" || event.holder === "source-demand") && (event.kind === "departure" || event.kind === "continuation")) {
        const actorId = Number(event.subscriber.split(":")[1]);
        if (event.holder === "source-demand" || event.kind === "departure" || !trade.seaTrade!.voyages.get(actorId)?.legacyVoyage) {
          const pair = `${Math.min(event.start, event.goal)}:${Math.max(event.start, event.goal)}`;
          const firstEligible = pairHistory.get(pair);
          if (firstEligible !== undefined && event.tick - firstEligible >= 5 * 60 * TICKS_PER_SECOND) {
            recurringAcquisitions++; recurringReady += Number(!!event.ready);
            const cohort = recurringByHolder.get(event.holder) ?? {acquisitions:0,ready:0};
            cohort.acquisitions++; cohort.ready += Number(!!event.ready); recurringByHolder.set(event.holder,cohort);
          }
          if (firstEligible === undefined) pairHistory.set(pair, event.tick);
        }
      }
      if (event.ready) observeLatency(0, event.holder === "source-demand", event.kind ?? "unknown");
      else {
        pendingSubscribers.set(event.subscriber, { laneId: event.laneId, tick: event.tick, source: event.holder === "source-demand", kind: event.kind ?? "unknown" });
        let subscribers = laneSubscribers.get(event.laneId); if (!subscribers) { subscribers = new Set(); laneSubscribers.set(event.laneId, subscribers); }
        subscribers.add(event.subscriber);
      }
    } else if (event.type === "ready") {
      for (const key of [...laneSubscribers.get(event.laneId) ?? []]) {
        const sub = pendingSubscribers.get(key)!; observeLatency(event.tick - sub.tick, sub.source, sub.kind); removePending(key);
      }
    } else if (event.type === "released" && event.subscriber && pendingSubscribers.has(event.subscriber)) {
      censoredDemands++; removePending(event.subscriber);
    }
  };
  trade.seaTrade.onEvent = event => {
    if (trace) events.push(event);
    if (event.type === "ready-eligible") readyEligible.set(event.actorId, event.tick);
    else if (event.type === "departure") {
      const first = readyEligible.get(event.actorId); if (first !== undefined) readyDelay[Math.min(9, event.tick - first)]++;
      readyEligible.delete(event.actorId);
    } else if (event.type === "return" && event.kind && event.distanceTiles !== undefined) {
      const summary = returnDistances[event.kind] ??= { count: 0, total: 0, max: 0 };
      summary.count++; summary.total += event.distanceTiles; summary.max = Math.max(summary.max, event.distanceTiles);
    }
  };
}
const histogram = (rows: Uint32Array, count: number, max: number) => {
  const at = (fraction: number) => { let seen = 0; for (let i = 0; i < rows.length; i++) { seen += rows[i]; if (seen >= Math.max(1, Math.ceil(count * fraction))) return i === 4801 ? ">4800" : i; } return undefined; };
  return { count, p50Ticks: at(.5), p95Ticks: at(.95), p99Ticks: at(.99), maxTicks: max };
};
let firstMeasuredCounters: typeof trade.diagnostics | undefined;
const series = new Map<string, number[]>();
const record = (key: string, n: number) => { let rows = series.get(key); if (!rows) { rows = []; series.set(key, rows); } rows.push(n); };
let instrumentMeasuring = false;
if (trace) {
  const measure = <T>(name: string, action: () => T): T => {
    const start = performance.now(); try { return action(); } finally { if (instrumentMeasuring) record(name, performance.now() - start); }
  };
  const stepTrade = trade.step.bind(trade); trade.step = () => measure("tradeMs", stepTrade);
  const copy = trade.stepSeaCopies.bind(trade); trade.stepSeaCopies = budget => measure("packingMs", () => copy(budget));
  if (trade.seaTrade) {
    const ports = trade.seaTrade.ports, discover = ports.step.bind(ports);
    ports.step = (budget, markets) => measure("portDiscoveryMs", () => discover(budget, markets));
  }
}
const last = new Map<number, { x: number; y: number; shipment: number; delivered: number; returned: number; state: string; useful: number; eligibleSince?: number }>();
let departures = 0, deliveries = 0, cycles = 0;
const started = performance.now();
let measured = 0;
for (let index = 0; index < warmup + ticks && game.winner === null; index++) {
  instrumentMeasuring = index >= warmup;
  if (index === warmup) {
    firstMeasuredCounters = { ...trade.diagnostics };
    laneLatency.fill(0); sourceLatency.fill(0); readyDelay.fill(0); demandLatencies.clear(); selectedDelay.fill(0);
    selectedDelayCount = selectedDelayMax = recurringAcquisitions = recurringReady = 0; recurringByHolder.clear();
    latencyCount = sourceLatencyCount = maxLaneLatency = maxSourceLatency = censoredDemands = 0;
    for (const kind of Object.keys(returnDistances)) delete returnDistances[kind];
  }
  phases = {}; const before = performance.now(); game.step(); const duration = performance.now() - before;
  if (events.length) { appendFileSync(`${output}/routing-events.jsonl`, events.map(event => JSON.stringify(event)).join("\n") + "\n"); events.length = 0; }
  const measuring = index >= warmup;
  if (measuring) { measured++; record("stepMs", duration); for (const [name, ms] of Object.entries(phases)) record(name, ms); }
  if (game.tick % publishEvery === 0) {
    const before = performance.now(); encoder.encode(game.replicationSource(true), game.tileChanges, game.replicationFacts());
    if (measuring) record("publicationMs", performance.now() - before);
  }
  if (game.tick % sampleEvery !== 0) continue;
  const sites = new Map(trade.siteSnapshot().filter(site => site.naval).map(site => [`${site.playerId}:${site.tile}`, site]));
  const live = new Set<number>(), outliers: unknown[] = [];
  for (const actor of trade.actors) {
    if (!actor.naval) continue; live.add(actor.id);
    const previous = last.get(actor.id), probe = trade.seaTrade?.probe(actor);
    const changed = !previous || previous.x !== actor.x || previous.y !== actor.y || previous.shipment !== actor.shipmentId ||
      previous.delivered !== actor.delivered || previous.returned !== actor.returned || previous.state !== actor.state;
    if (measuring && previous) {
      departures += Number(previous.shipment !== actor.shipmentId);
      deliveries += Number(previous.delivered < actor.delivered);
      cycles += Number(previous.state === "returning" && actor.state === "loading");
    }
    const site = sites.get(`${actor.playerId}:${actor.originTile}`);
    const eligible = actor.state === "loading" && actor.waitTicks === 0 && !!site && site.cargo >= site.shipmentCapacity && !!probe?.ready;
    const useful = changed ? game.tick : previous!.useful;
    const eligibleSince = eligible ? previous?.eligibleSince ?? game.tick : undefined;
    last.set(actor.id, { x: actor.x, y: actor.y, shipment: actor.shipmentId, delivered: actor.delivered, returned: actor.returned, state: actor.state, useful, eligibleSince });
    if (trace || game.tick - useful >= 120 * TICKS_PER_SECOND || eligibleSince !== undefined && game.tick - eligibleSince >= TICKS_PER_SECOND)
      outliers.push({ id: actor.id, owner: actor.playerId, source: actor.originTile, x: actor.x, y: actor.y, cargo: actor.cargo, loaded: actor.loaded,
        state: actor.state, destination: actor.destination, wait: actor.waitingReason, detail: actor.waitDetail, waitTicks: actor.waitTicks,
        stationaryTicks: game.tick - useful, eligibleSince, sourceStock: site?.cargo, capacity: site?.shipmentCapacity, probe });
  }
  for (const id of last.keys()) if (!live.has(id)) last.delete(id);
  const row = { tick: game.tick, measured: measuring, departures, deliveries, cycles, portCount: sites.size, actors: live.size,
    actualSea: { loads: trade.diagnostics.seaLoads, arrivals: trade.diagnostics.seaArrivals, cycles: trade.diagnostics.seaCycles, salvages: trade.diagnostics.seaSalvages },
    planner: game.routePlanner.pendingCount, lanes: trade.seaTrade?.routes.usage, laneCounters: trade.seaTrade?.routes.diagnostics,
    voyageCounters: trade.seaTrade?.diagnostics, discoveryCounters: trade.seaTrade?.ports.diagnostics, memory: process.memoryUsage(), outliers };
  appendFileSync(`${output}/samples.jsonl`, `${JSON.stringify(row)}\n`);
  if (game.tick % (60 * TICKS_PER_SECOND) === 0) console.log(JSON.stringify({ tick: game.tick, departures, deliveries, cycles, lanes: row.lanes }));
}
if (cpu) { const result = await post("Profiler.stop"); writeFileSync(`${output}/cpu.cpuprofile`, JSON.stringify(result.profile)); profiler.disconnect(); }
const stats = Object.fromEntries([...series].map(([key, rows]) => {
  rows.sort((a, b) => a - b); const sum = rows.reduce((a, b) => a + b, 0);
  return [key, { count: rows.length, mean: sum / rows.length, p50: rows[Math.floor(rows.length * .5)], p95: rows[Math.floor(rows.length * .95)], p99: rows[Math.floor(rows.length * .99)], max: rows[rows.length - 1] }];
}));
const checkpoint = game.checkpoint(), encoded = serialize(checkpoint), wallSeconds = (performance.now() - started) / 1000;
writeFileSync(`${output}/final.v8`, serialize({ ...fixture, checkpoint }));
const result = { endTick: game.tick, winner: game.winner, endReason: game.endReason, measured, wallSeconds,
  gameSecondsPerWallSecond: (game.tick - manifest.startTick) / TICKS_PER_SECOND / wallSeconds,
  departures, deliveries, cycles,
  actualSea: firstMeasuredCounters && { loads: trade.diagnostics.seaLoads - firstMeasuredCounters.seaLoads,
    arrivals: trade.diagnostics.seaArrivals - firstMeasuredCounters.seaArrivals, cycles: trade.diagnostics.seaCycles - firstMeasuredCounters.seaCycles,
    salvages: trade.diagnostics.seaSalvages - firstMeasuredCounters.seaSalvages },
  recurringReuse: { acquisitions: recurringAcquisitions, ready: recurringReady, rate: recurringAcquisitions ? recurringReady / recurringAcquisitions : undefined,
    byHolder: Object.fromEntries(recurringByHolder), population: "Nonlegacy departure/continuation registry acquisitions for a physical pair first acquired while eligible at least five game minutes earlier. Includes cold source subscriptions and actor subscriptions as separate acquisition stages; excludes idempotent polls, holder transfers, returns and salvage." },
  selectedToColdSubscription: histogram(selectedDelay, selectedDelayCount, selectedDelayMax),
  laneAcquisition: histogram(laneLatency, latencyCount, maxLaneLatency), sourceAcquisition: histogram(sourceLatency, sourceLatencyCount, maxSourceLatency),
  laneAcquisitionByDemand: Object.fromEntries([...demandLatencies].map(([kind, value]) => [kind, histogram(value.rows, value.count, value.max)])),
  readyDelayTicks: [...readyDelay], censoredDemands, unresolvedSubscriptions: pendingSubscribers.size, returnDistances,
  checkpointBytes: encoded.byteLength, stats, memory: process.memoryUsage(),
  laneUsage: game.expansion!.trade.seaTrade?.routes.usage, laneCounters: game.expansion!.trade.seaTrade?.routes.diagnostics };
writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
