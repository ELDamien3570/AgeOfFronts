import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deserialize } from "node:v8";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";

const args = process.argv.slice(2),
  value = (name, fallback) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : args[i + 1];
  };
const out = value("--out", "out/query-reuse/result.json");
if (args.includes("--compare")) {
  const trials = [];
  for (const mode of [
    "baseline",
    "route",
    "capture",
    "both",
    "both",
    "capture",
    "route",
    "baseline",
  ]) {
    const trialOut = path.join(
      path.dirname(out),
      `trial-${trials.length}-${mode}.json`,
    );
    const childArgs = args.filter(
      (arg, index) =>
        arg !== "--compare" && arg !== "--out" && args[index - 1] !== "--out",
    );
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        process.argv[1],
        ...childArgs,
        "--mode",
        mode,
        "--out",
        trialOut,
      ],
      { stdio: "inherit" },
    );
    if (run.status !== 0) throw new Error(`Comparison failed: ${mode}`);
    trials.push({ mode, ...JSON.parse(fs.readFileSync(trialOut, "utf8")) });
  }
  if (new Set(trials.map((t) => t.hash)).size !== 1)
    throw new Error("Query reuse changed canonical state");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ trials }, null, 2));
  process.exit(0);
}
const saved = deserialize(
  fs.readFileSync(
    value(
      "--restore",
      "out/overnight-1000/seed42-filtered/checkpoint-60000.v8",
    ),
  ),
);
const loaded = await loadServerMap(defaultLobbySettings("old-world", 1000));
const map = createSkirmishMap(
  loaded.map.width,
  loaded.map.height,
  loaded.map.terrain,
  loaded.map.elevation,
  loaded.map.forest,
  loaded.map.resourceTerrain,
);
const game = new Skirmish(map, saved.options);
game.restore(saved);
const mode = value("--mode", "both");
if (!["baseline", "route", "capture", "both"].includes(mode))
  throw new Error("Invalid comparison mode");
if (mode === "baseline" || mode === "capture")
  game.aiFootprintAllowed = function (playerId, tile) {
    if (
      !this.options.aiWarPolicy ||
      !this.expansion?.operations.enabled(this.player(playerId))
    )
      return true;
    const cache = this.routeFootprints;
    if (cache) {
      const operations = this.expansion.operations.revision,
        diplomacy = this.expansion.diplomacy.revision,
        threats = this.expansion.operations.permissionRevision;
      if (
        operations !== this.footprintOperationRevision ||
        diplomacy !== this.footprintDiplomacyRevision ||
        threats !== this.footprintThreatRevision
      ) {
        cache.clear();
        this.footprintOperationRevision = operations;
        this.footprintDiplomacyRevision = diplomacy;
        this.footprintThreatRevision = threats;
      }
      const known = cache.get(playerId)?.get(tile);
      if (known !== undefined) return known;
    }
    let allowed = true;
    const component = this.paths.component[tile];
    this.eachInRadius(tile, 3, (neighbor) => {
      if (
        this.paths.component[neighbor] === component &&
        !this.aiCanEnter(playerId, neighbor)
      )
        allowed = false;
    });
    if (cache) {
      let tiles = cache.get(playerId);
      if (!tiles) cache.set(playerId, (tiles = new Map()));
      tiles.set(tile, allowed);
    }
    return allowed;
  };
if (mode === "baseline" || mode === "route")
  game.expansion.captureQuery = (squad) => (tile) =>
    game.expansion.canCaptureTile(squad, tile);
const counters = {
  requests: 0,
  replacements: 0,
  equivalentGeometry: 0,
  entryQueries: 0,
  captureQueries: 0,
  fortificationRays: 0,
};
if (args.includes("--instrument")) {
  const request = game.routePlanner.request.bind(game.routePlanner);
  game.routePlanner.request = (r) => {
    counters.requests++;
    const previous = game.routePlanner.jobs.get(r.key);
    if (previous) {
      counters.replacements++;
      if (
        previous.start === r.start &&
        previous.goal === r.goal &&
        previous.water === r.water &&
        previous.obstacleRevision === r.obstacleRevision
      )
        counters.equivalentGeometry++;
    }
    return request(r);
  };
  for (const [object, method, key] of [
    [game, "aiCanEnter", "entryQueries"],
    [game.expansion, "captureEligible", "captureQueries"],
    [game.expansion.fortifications, "clear", "fortificationRays"],
  ]) {
    const original = object[method].bind(object);
    object[method] = (...args) => {
      counters[key]++;
      return original(...args);
    };
  }
}
const phases = {};
game.onPhase = (phase, ms) => (phases[phase] ??= []).push(ms);
const started = performance.now();
for (let i = 0; i < Number(value("--steps", "400")); i++) game.step();
const summary = {
  wallMs: performance.now() - started,
  counters,
  phases: Object.fromEntries(
    Object.entries(phases).map(([key, values]) => {
      const ordered = [...values].sort((a, b) => a - b);
      return [
        key,
        {
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          p95: ordered[Math.floor(0.95 * (ordered.length - 1))],
        },
      ];
    }),
  ),
  hash: createHash("sha256")
    .update(JSON.stringify(game.snapshot()))
    .digest("hex"),
  planner: game.routePlanner.diagnostics,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
