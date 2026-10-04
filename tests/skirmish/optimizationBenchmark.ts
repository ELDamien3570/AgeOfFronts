/** Local, isolated microbenchmarks. No server, cloud SDK, install or network.
 * Run: node --import tsx tests/skirmish/optimizationBenchmark.ts */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { EntityChangeJournal } from "../../src/skirmish/EntityChangeJournal";
import { FIXED, type Ship, type Squad } from "../../src/skirmish/Protocol";
import { Skirmish } from "../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../src/skirmish/SnapshotCodec";
import { SpatialGrid } from "../../src/skirmish/SpatialGrid";
import { CanonicalStateStream } from "../../src/skirmish/client/CanonicalStateStream";
import { Trade } from "../../src/skirmish/domain/Trade";
import { computeRuntimeBuild } from "../../src/skirmish/multiplayer/infrastructure/RuntimeBuild";

const baseline = "6409654";
const root = process.cwd(),
  output = join(root, "Optimization Handoff/Evidence/1.2.1");
const temporary: string[] = [],
  sourceHashes: Record<string, string> = {};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function original(path: string): string {
  const source = execFileSync("git", ["show", `${baseline}:${path}`], {
    encoding: "utf8",
  });
  sourceHashes[path] = hash(source);
  const file = join(root, path.replace(/\.ts$/u, ".optimization-baseline.ts"));
  if (existsSync(file))
    throw new Error(`Refusing to replace existing baseline file: ${file}`);
  writeFileSync(file, source, { flag: "wx" });
  temporary.push(file);
  return pathToFileURL(file).href;
}
function summary(samples: number[]) {
  const sorted = samples.slice().sort((a, b) => a - b);
  return {
    samples: samples.length,
    mean: samples.reduce((n, v) => n + v, 0) / samples.length,
    p95: sorted[Math.ceil(samples.length * 0.95) - 1],
    p99: sorted[Math.ceil(samples.length * 0.99) - 1],
    maximum: sorted[sorted.length - 1],
  };
}
function paired(before: () => void, after: () => void, samples = 60) {
  for (let i = 0; i < 8; i++) {
    before();
    after();
  }
  const baselineMs: number[] = [],
    candidateMs: number[] = [];
  for (let i = 0; i < samples; i++) {
    for (const candidate of i % 2 ? [true, false] : [false, true]) {
      const start = performance.now();
      (candidate ? after : before)();
      (candidate ? candidateMs : baselineMs).push(performance.now() - start);
    }
  }
  return {
    baseline: summary(baselineMs),
    candidate: summary(candidateMs),
    raw: { baselineMs, candidateMs },
  };
}
function fleet(Constructor: typeof Trade, actors: number) {
  const terrain = new Uint8Array(256 * 180).fill(133);
  const game = new Skirmish(
    new GameMapImpl(256, 180, terrain, terrain.length),
    {
      seed: 47,
      aiCount: 14,
      humanNames: Array.from({ length: 10 }, (_, i) => `Human ${i + 1}`),
      tribes: true,
      tribeCount: 30,
      runAi: false,
      ruleset: "ages-v1",
      deferredPlanning: true,
    },
  );
  if (game.players.length !== 54)
    throw new Error("Fleet fixture did not create 54 factions");
  const expansion = game.expansion!;
  let remaining = actors;
  for (const player of game.players) {
    expansion.progression.states[player.id].completed.push(
      "stoneage-goods-handling",
    );
    const count = Math.min(remaining, 48);
    remaining -= count;
    for (let site = 0; site < count; site++)
      game.addBuilding({
        id: game.allocateId(),
        type: "factory",
        playerId: player.id,
        tile: game.map.ref(4 + site, 2 + player.id * 2),
        remainingTicks: 0,
        age: "StoneAge",
      });
  }
  const trade = new Constructor(
    game,
    expansion.supply,
    expansion.progression,
    expansion.diplomacy,
    expansion.fortifications,
    expansion.roads,
  );
  game.tick = 20;
  trade.step();
  if (trade.actors.length !== actors)
    throw new Error(
      `Fleet coverage failed: expected ${actors}, got ${trade.actors.length}`,
    );
  return { game, trade };
}

mkdirSync(output, { recursive: true });
let report: object;
try {
  const { EntityChangeJournal: OriginalJournal } = (await import(
    original("src/skirmish/EntityChangeJournal.ts")
  )) as { EntityChangeJournal: typeof EntityChangeJournal };
  const { Trade: OriginalTrade } = (await import(
    original("src/skirmish/domain/Trade.ts")
  )) as { Trade: typeof Trade };
  const { CanonicalStateStream: OriginalStream } = (await import(
    original("src/skirmish/client/CanonicalStateStream.ts")
  )) as { CanonicalStateStream: typeof CanonicalStateStream };
  const journals = [new OriginalJournal(), new EntityChangeJournal()];
  for (const journal of journals)
    for (let id = 0; id < 32768; id++) journal.record(id, "add");
  const cursor = journals[0].revision;
  const quiet = paired(
    () => {
      for (let i = 0; i < 100; i++) journals[0].since(cursor);
    },
    () => {
      for (let i = 0; i < 100; i++) journals[1].since(cursor);
    },
  );
  for (const journal of journals) journal.record(47, "change");
  const sparse = paired(
    () => {
      for (let i = 0; i < 100; i++) journals[0].since(cursor);
    },
    () => {
      for (let i = 0; i < 100; i++) journals[1].since(cursor);
    },
  );
  if (!isDeepStrictEqual(journals[0].since(cursor), journals[1].since(cursor)))
    throw new Error("Journal reference mismatch");
  const tradeResults = [];
  for (const actors of [0, 236, 1296, 2592]) {
    const before = fleet(OriginalTrade, actors),
      after = fleet(Trade, actors);
    const timings = paired(
      () => before.trade.step(),
      () => after.trade.step(),
    );
    if (
      !isDeepStrictEqual(before.trade.checkpoint(), after.trade.checkpoint()) ||
      !isDeepStrictEqual(before.game.players, after.game.players)
    )
      throw new Error(`Trade reference mismatch at ${actors} actors`);
    tradeResults.push({
      actors,
      factions: after.game.players.length,
      mode: "land",
      goods: "empty",
      productiveDeliveries: 0,
      timings,
      candidateOperationCounts: { ...after.trade.diagnostics },
    });
  }
  const terrain = new Uint8Array(128 * 96).fill(133),
    map = new GameMapImpl(128, 96, terrain, terrain.length);
  const geometryGame = new Skirmish(map, {
    seed: 47,
    aiCount: 1,
    tribes: false,
    runAi: false,
    ruleset: "ages-v1",
  });
  const forts = geometryGame.expansion!.fortifications,
    fortState = forts.checkpoint();
  fortState.barriers = Array.from({ length: 1000 }, (_, index) => ({
    id: index + 1000,
    playerId: 1,
    age: "StoneAge",
    a: 1,
    b: 2,
    tiles: Array.from(
      { length: 256 },
      (_, offset) => (index + offset) % terrain.length,
    ),
    health: 100,
    maxHealth: 100,
    remainingTicks: 0,
  }));
  forts.restore(fortState);
  const packet = new SnapshotEncoder(true).encode(
    geometryGame.replicationSource(),
    geometryGame.tileChanges,
    geometryGame.replicationFacts(),
  );
  const oldStream = new OriginalStream(),
    newStream = new CanonicalStateStream();
  oldStream.apply(packet);
  newStream.apply(packet);
  const projection = paired(
    () => {
      oldStream.presentationForTransfer();
    },
    () => {
      newStream.presentationForTransfer();
    },
  );
  if (
    !isDeepStrictEqual(
      structuredClone(oldStream.presentationForTransfer()),
      structuredClone(newStream.presentationForTransfer()),
    )
  )
    throw new Error("Projection reference mismatch");
  const template = geometryGame.squads[0];
  if (!template) throw new Error("Missing spatial benchmark squad");
  for (let i = geometryGame.squads.length; i < 10000; i++)
    geometryGame.addSquad({
      ...structuredClone(template),
      id: geometryGame.allocateId(),
      x: ((i % 120) + 4) * FIXED,
      y: ((Math.floor(i / 120) % 88) + 4) * FIXED,
    });
  const groundGrid = new SpatialGrid<Squad>(
      128 * FIXED,
      96 * FIXED,
      4 * FIXED,
      (s) => s.playerId,
    ),
    aliveGrid = new SpatialGrid<Squad>(
      128 * FIXED,
      96 * FIXED,
      4 * FIXED,
      (s) => s.playerId,
    ),
    shipsGrid = new SpatialGrid<Ship>(
      128 * FIXED,
      96 * FIXED,
      4 * FIXED,
      (s) => s.playerId,
    ),
    warshipsGrid = new SpatialGrid<Ship>(
      128 * FIXED,
      96 * FIXED,
      4 * FIXED,
      (s) => s.playerId,
    );
  const rebuildSpatial = () => {
    groundGrid.rebuild(
      geometryGame.squads.filter((s) => s.embarkedOn === null),
    );
    aliveGrid.rebuild(
      geometryGame.squads.filter((s) => s.embarkedOn === null && s.troops > 0),
    );
    shipsGrid.rebuild(geometryGame.ships);
    warshipsGrid.rebuild(
      geometryGame.ships.filter((s) => s.kind === "warship" && s.health > 0),
    );
  };
  const reuseSpatial = () => {
    const facts = geometryGame.spatialFacts("combat");
    void facts.ground;
    void facts.groundAlive;
    void facts.ships;
    void facts.warshipsAlive;
  };
  const unchangedSpatial = paired(rebuildSpatial, reuseSpatial);
  const move = () =>
    geometryGame.updateSquad(template.id, {
      x: template.x === 4 * FIXED ? 5 * FIXED : 4 * FIXED,
    });
  const changedSpatial = paired(
    () => {
      move();
      rebuildSpatial();
    },
    () => {
      move();
      reuseSpatial();
    },
  );
  report = {
    evidence: "synthetic local microbenchmark",
    baseline,
    sourceHashes,
    environment: {
      node: process.version,
      architecture: arch(),
      platform: platform(),
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
    },
    methodology:
      "60 alternating paired samples after 8 warmups; journal sample is 100 reads; trade sample is one fixed-tick pass over identical empty-goods land fleets; same current dependency modules for both Trade implementations",
    limitations:
      "Not full-match speedup, loaded/naval trade, largest-map, ARM, long soak, active-human or rendered-client qualification. Originals are frozen source at baseline; dependencies are current candidate modules.",
    journals: {
      retainedIds: 32768,
      quiet,
      sparse,
      sparseCandidateReads: journals[1].diagnostics.reads,
    },
    trade: tradeResults,
    projection: { barriers: 1000, geometryTiles: 256000, timings: projection },
    spatial: {
      squads: geometryGame.squads.length,
      unchanged: unchangedSpatial,
      changed: changedSpatial,
      candidateOperationCounts: geometryGame.spatialDiagnostics,
    },
  };
} finally {
  for (const file of temporary) unlinkSync(file);
}
const sources = [
  ...new Set([
    ...execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).split(
      /\r?\n/u,
    ),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    }).split(/\r?\n/u),
  ]),
]
  .filter((file) => file.endsWith(".ts"))
  .sort();
const candidateSourceHashes = Object.fromEntries(
  sources.map((file) => [file, hash(readFileSync(join(root, file), "utf8"))]),
);
writeFileSync(
  join(output, "local-benchmarks.json"),
  JSON.stringify(
    { ...report, runtimeId: computeRuntimeBuild(root), candidateSourceHashes },
    null,
    2,
  ),
);
process.stdout.write(
  JSON.stringify(
    { output: join(output, "local-benchmarks.json"), ...report },
    null,
    2,
  ),
);
