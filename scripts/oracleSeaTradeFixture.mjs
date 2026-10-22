import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { deserialize, serialize } from "node:v8";
import { createHash } from "node:crypto";
import { Session } from "node:inspector";
import { standable, squadRadius } from "../src/skirmish/SquadGeometry.ts";
const journals = new WeakMap();
const post = (session, method, params = {}) => new Promise((resolve, reject) =>
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
export async function finishProbeProfiling(game) {
  const journal = journals.get(game);
  if (!journal?.cpu) return;
  await journal.cpu.ready;
  const {profile} = await post(journal.cpu.session, "Profiler.stop");
  writeFileSync(`${process.env.SEA_PROBE_OUT}/worker.cpuprofile`, JSON.stringify(profile));
  journal.cpu.session.disconnect(); journal.cpu = undefined;
}
export function captureProbeCheckpoint(game, kind = "final") {
  const journal = journals.get(game);
  if (!journal) throw Error("Probe checkpoint requested for an uninstrumented world");
  const file = `${process.env.SEA_PROBE_OUT}/worker-${kind}.v8`;
  const bytes = serialize({...journal.fixture, options: game.options,
    actionSequence: journal.sequence, checkpoint: game.checkpoint()});
  const manifest = {tick: game.tick, actionSequence: journal.sequence,
    sha256: createHash("sha256").update(bytes).digest("hex"), file,
    source: process.env.GIT_COMMIT, authoritativeServerCheckpoint: true, cpuProfiling: process.env.SEA_PROBE_CPU === "1",
    scope: "Captured outside the paced qualification interval; replay combined actions by sequence, including final-tick actions."};
  writeFileSync(file, bytes);
  writeFileSync(`${file}.json`, JSON.stringify(manifest, null, 2));
  return manifest;
}
export function probeFixtureOptions(options) {
  const f = deserialize(readFileSync(process.env.SEA_PROBE_FIXTURE));
  if (options.seaTradeRouting !== f.options.seaTradeRouting)
    throw Error("Policy mismatch");
  return f.options;
}
// Imported only by the separately built test worker. No production entry imports this.
export function restoreProbeFixture(game) {
  const input = process.env.SEA_PROBE_FIXTURE,
    out = process.env.SEA_PROBE_OUT;
  if (!input || !out) throw Error("Isolated fixture paths required");
  const f = deserialize(readFileSync(input));
  if (!f.checkpoint || !f.options || !f.settings)
    throw Error("Expected full fixture envelope");
  if (
    JSON.stringify(game.options?.seaTradeRouting) !==
    JSON.stringify(f.options.seaTradeRouting)
  )
    throw Error("Fixture routing option mismatch");
  game.restore(f.checkpoint);
  for (const id of [1, 2]) {
    const p = game.player(id);
    if (!p || p.eliminated) throw Error("Required human faction unavailable");
    game.setAiController(id, false);
  }
  const journal = {sequence: 0, fixture: {seed: f.seed, settings: f.settings, options: f.options}};
  journals.set(game, journal);
  captureProbeCheckpoint(game, "initial");
  // Optional separate diagnostic run only. Leave disabled for pace/latency
  // qualification; sampling has overhead and is identified in the manifest.
  if (process.env.SEA_PROBE_CPU === "1") {
    const session = new Session(); session.connect();
    const ready = post(session, "Profiler.enable").then(() => post(session, "Profiler.setSamplingInterval", {interval: 1000}))
      .then(() => post(session, "Profiler.start"));
    journal.cpu = {session, ready};
  }
  const control = game.setAiController.bind(game);
  game.setAiController = (playerId, ai) => {
    appendFileSync(out + "/actions-applied.jsonl", JSON.stringify({sequence: journal.sequence++,
      tick: game.tick, type: "controller", playerId, ai}) + "\n");
    return control(playerId, ai);
  };
  // Packing cosmetic road geometry is a publication-side cache write. Record
  // it too so replay compares the entire checkpoint, including that cache.
  if (game.expansion) {
    const pack = game.expansion.roads.packed.bind(game.expansion.roads);
    game.expansion.roads.packed = () => {
      appendFileSync(out + "/actions-applied.jsonl", JSON.stringify({sequence: journal.sequence++,
        tick: game.tick, type: "road-publication"}) + "\n");
      return pack();
    };
  }
  const targets = [];
  const owned = new Map([1, 2].map((id) => [id, []]));
  for (let tile = 0; tile < game.owners.length; tile++)
    owned.get(game.owners[tile])?.push(tile);
  for (const id of [1, 2])
    for (const s of game.squads
      .filter(
        (s) =>
          s.playerId === id &&
          s.embarkedOn === null &&
          !s.refit &&
          !s.fighting &&
          !s.afloat,
      )
      .sort((a, b) => a.id - b.id)
      .slice(0, 8)) {
      const origin = game.tileOf(s),
        cx = game.map.x(origin),
        cy = game.map.y(origin),
        paths = game.squadPaths(id),
        goals = { short: [], long: [] };
      for (const [kind, d] of [
        ["short", 3],
        ["long", 35],
      ])
        for (const [dx, dy] of [
          [d, 0],
          [0, d],
          [-d, 0],
          [0, -d],
        ]) {
          const x = cx + dx,
            y = cy + dy;
          if (!game.map.isValidCoord(x, y)) continue;
          const tile = game.map.ref(x, y);
          if (
            game.owners[tile] === id &&
            paths.component[tile] === paths.component[origin] &&
            paths.walkable(tile) &&
            standable(
              game.map,
              { x: (x + 0.5) * 256, y: (y + 0.5) * 256 },
              squadRadius(s.kind),
            )
          )
            goals[kind].push(tile);
        }
      const tiles = owned
        .get(id)
        .filter(
          (tile) =>
            paths.component[tile] === paths.component[origin] &&
            paths.walkable(tile) &&
            standable(
              game.map,
              {
                x: (game.map.x(tile) + 0.5) * 256,
                y: (game.map.y(tile) + 0.5) * 256,
              },
              squadRadius(s.kind),
            ),
        );
      targets.push({ id: s.id, playerId: id, x: s.x, y: s.y, goals, tiles });
    }
  writeFileSync(
    out + "/worker-initial.json",
    JSON.stringify(
      {
        targets,
        tick: game.tick,
        policy: f.options.seaTradeRouting ?? "legacy",
        humanIds: [1, 2],
        squads: game.squads.length,
        traders: game.expansion.trade.actors.length,
        ships: game.ships.length,
        checkpointRestored: true,
      },
      null,
      2,
    ),
  );
  // Log the actual authoritative application tick, including hold commands.
  // This permits an exact input replay instead of inferring ticks from client receipts.
  const apply = game.commandApplications.apply.bind(game.commandApplications);
  game.commandApplications.apply = (id, command) => {
    const action = {sequence: journal.sequence++, tick: game.tick, type: "command", id, command};
    const result = apply(id, command);
    appendFileSync(out + "/actions-applied.jsonl", JSON.stringify({...action, result}) + "\n");
    appendFileSync(out + "/commands-applied.jsonl", JSON.stringify({ id, tick: game.tick, command, result }) + "\n");
    return result;
  };
  const step = game.step.bind(game);
  game.step = () => {
    const phases = {}, observe = game.onPhase;
    game.onPhase = (phase, ms) => { phases[phase] = ms; observe?.(phase, ms); };
    const at = performance.now();
    try { step(); } finally { game.onPhase = observe; }
    const ms = performance.now() - at;
    // Test-only read views, once per game second. No checkpoint copies or
    // simulation writes in the paced run; enough detail to locate a long wait.
    if (game.tick % 8 === 0) {
      const admissions = [...game.movementAdmission.pending.values()].filter(a => a.playerId === 1 || a.playerId === 2);
      if (admissions.length) appendFileSync(out + "/movement-planning.jsonl", JSON.stringify({
        tick: game.tick,
        admissions: admissions.map(a => ({ id: a.id, playerId: a.playerId, phase: a.phase, formation: a.formation.phase,
          routeCheck: a.routeCheck, placementRetries: a.placementRetries, connectorMisses: a.connectorMisses,
          members: a.members.map(m => ({ id: m.id, requested: m.requested, pathLength: m.path?.length,
            shared: m.shared?.stage, retryAt: m.retryAt, limitedAttempts: m.limitedAttempts })) })),
        jobs: [...game.routePlanner.jobs.values()].filter(j => j.context.kind === "admission" && (j.context.playerId === 1 || j.context.playerId === 2))
          .map(j => ({ key: j.key, createdTick: j.createdTick, nodes: j.search.nodes.size, phase: j.search.phase,
            corridor: j.corridor?.phase, local: j.corridor?.local, waiting: j.waitingForWorkspace, exclusive: j.exclusiveRetry })),
        workspace: game.routePlanner.diagnostics.workspaceUsed,
      }) + "\n");
    }
    appendFileSync(
      out + "/ticks.jsonl",
      JSON.stringify({ tick: game.tick, at: Date.now(), ms, phases }) + "\n",
    );
  };
}
