/** Offline mature-world movement qualification. Wall tick CPU is local process
 * time, not hosted/network input latency. No squads/resources are manufactured. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { deserialize } from "node:v8";
import { createSkirmishMap } from "../src/skirmish/Elevation";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap";
import { FIXED } from "../src/skirmish/Protocol";
import { Skirmish } from "../src/skirmish/Simulation";
import {
  squadRadius,
  standable,
  tilePoint,
} from "../src/skirmish/SquadGeometry";
const args = process.argv.slice(2),
  arg = (key: string, fallback?: string) =>
    args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = arg("--fixture"),
  out = arg("--out"),
  ticks = Number(arg("--ticks", "600"));
if (
  !input ||
  !out ||
  !Number.isSafeInteger(ticks) ||
  ticks < 120 ||
  ticks > 4800
)
  throw Error("--fixture, --out and --ticks 120..4800 required");
mkdirSync(out, { recursive: false });
const original = deserialize(readFileSync(input)),
  loaded = await loadServerMap(original.settings, undefined, original.seed),
  m = loaded.map;
const quantiles = (values: number[]) => {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    n: a.length,
    mean: a.reduce((sum, x) => sum + x, 0) / a.length,
    p50: a[Math.max(0, Math.ceil(a.length * 0.5) - 1)],
    p95: a[Math.max(0, Math.ceil(a.length * 0.95) - 1)],
    p99: a[Math.max(0, Math.ceil(a.length * 0.99) - 1)],
    max: a[a.length - 1],
  };
};
const result: any = {
  fixture: input,
  tick: original.checkpoint.tick,
  scope:
    "Offline restored-world probe. Admission and response are simulation ticks; tick wall cost excludes publication/network. Old-policy control and explicit versioned candidate migration.",
  cases: [],
};
for (const scenario of ["near1", "dispersed8", "compact60", "dispersed60"])
  for (const mode of ["baseline", "responsive"]) {
    const envelope = structuredClone(original),
      cp = envelope.checkpoint;
    if (mode === "responsive") {
      cp.admission.policyVersion = 3;
      cp.admission.families = [];
      cp.planning.scheduling.version = 9;
      cp.movementReadiness = {
        urgent: [],
        cursor:
          ((cp.tick + 1) * 16) %
          cp.squads.filter((s: any) => s.embarkedOn === null).length,
        lastPlayer: -1,
      };
    }
    const game = new Skirmish(
      createSkirmishMap(
        m.width,
        m.height,
        m.terrain.slice(),
        structuredClone(m.elevation),
        structuredClone(m.forest),
        structuredClone(m.resourceTerrain),
      ),
      envelope.options,
    );
    game.restore(cp);
    const candidates = game.squads.filter(
      (s) =>
        s.playerId >= 1 &&
        s.playerId <= 15 &&
        s.troops > 0 &&
        s.embarkedOn === null &&
        !s.refit &&
        !s.afloat &&
        !s.fighting,
    );
    const counts = new Map<number, number>();
    for (const s of candidates)
      counts.set(s.playerId, (counts.get(s.playerId) ?? 0) + 1);
    const spread = (player: number) => {
      const rows = candidates
          .filter((s) => s.playerId === player)
          .sort((a, b) => a.id - b.id)
          .slice(0, 60),
        anchor = rows[0];
      return rows.reduce(
        (sum, s) => sum + (s.x - anchor.x) ** 2 + (s.y - anchor.y) ** 2,
        0,
      );
    };
    const playerId =
      scenario === "dispersed60"
        ? [...counts]
            .filter(([, n]) => n >= 60)
            .sort((a, b) => spread(b[0]) - spread(a[0]) || a[0] - b[0])[0][0]
        : scenario === "compact60"
          ? [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
          : 1;
    game.setAiController(playerId, false);
    const owned = candidates
        .filter((s) => s.playerId === playerId)
        .sort((a, b) => a.id - b.id),
      anchor = owned[0];
    if (!anchor) throw Error("No anchor");
    const count = scenario.endsWith("60")
      ? 60
      : scenario === "dispersed8"
        ? 8
        : 1;
    const selected = (
      scenario === "compact60"
        ? [...owned].sort(
            (a, b) =>
              Math.hypot(a.x - anchor.x, a.y - anchor.y) -
                Math.hypot(b.x - anchor.x, b.y - anchor.y) || a.id - b.id,
          )
        : owned
    ).slice(0, count);
    if (selected.length !== count)
      throw Error("Insufficient existing squads for " + scenario);
    const ids = selected.map((s) => s.id);
    game.commandApplications.apply("profile-hold", {
      type: "order",
      playerId,
      squadIds: ids,
      order: { type: "hold" },
    });
    for (let i = 0; i < 12; i++) game.step();
    const starts = new Map(
      ids.map((id) => {
        const s = game.squad(id)!;
        return [id, { x: s.x, y: s.y, heading: s.locomotion?.heading }];
      }),
    );
    let goal: number | undefined;
    for (const distance of [6, 4, 3, 8, 12, 25])
      for (const [dx, dy] of [
        [distance, 0],
        [0, distance],
        [-distance, 0],
        [0, -distance],
      ]) {
        if (goal !== undefined) break;
        const x = Math.floor(anchor.x / FIXED) + dx,
          y = Math.floor(anchor.y / FIXED) + dy;
        if (x < 1 || y < 1 || x >= m.width - 1 || y >= m.height - 1) continue;
        const tile = y * m.width + x,
          point = tilePoint(game.map, tile);
        if (
          game.owners[tile] === playerId &&
          standable(
            game.map,
            point,
            squadRadius(anchor.kind),
            game.amphibious(playerId),
          ) &&
          game.paths.connected(game.tileOf(anchor), tile)
        )
          goal = tile;
      }
    if (goal === undefined) throw Error("No legal owned goal " + scenario);
    const startTick = game.tick,
      stages: any[] = [],
      turn = new Map<number, number>(),
      motion = new Map<number, number>(),
      commit = new Map<number, number>(),
      responses = new Map<number, number>(),
      outcomes: any[] = [],
      steps: number[] = [],
      phases: Record<string, number[]> = {};
    game.movementAdmission.onMemberProgress = (id, tick, stage) => {
      if (starts.has(id)) {
        stages.push({ id, tick, stage });
        if (stage === "commit") commit.set(id, tick);
        if (stage === "prefix" && !responses.has(id)) responses.set(id, tick);
      }
    };
    // Also records old-policy control commits, which has no new diagnostic stages.
    const ports = (game.movementAdmission as any).ports,
      originalCommit = ports.commit;
    ports.commit = (s: any, ...rest: any[]) => {
      if (starts.has(s.id)) {
        commit.set(s.id, game.tick);
        if (!responses.has(s.id)) responses.set(s.id, game.tick);
      }
      return originalCommit(s, ...rest);
    };
    game.commandApplications.onOutcome = (o) => {
      if (o.id === "profile-move") outcomes.push(o);
    };
    game.onPhase = (phase, ms) => {
      (phases[phase] ??= []).push(ms);
    };
    game.commandApplications.apply("profile-move", {
      type: "order",
      playerId,
      squadIds: ids,
      order: { type: "move", tile: goal },
    });
    const tradeBefore = { ...game.expansion!.trade.diagnostics };
    for (let i = 0; i < ticks; i++) {
      const at = performance.now();
      game.step();
      steps.push(performance.now() - at);
      for (const id of ids) {
        const s = game.squad(id),
          p = starts.get(id)!;
        if (!s) continue;
        // Hold has settled before input; post-input changes are observed separately
        // from command admission and cannot be gated on an aggregate receipt.
        if (s.locomotion?.heading !== p.heading && !turn.has(id))
          turn.set(id, game.tick);
        if (Math.hypot(s.x - p.x, s.y - p.y) > 8 && !motion.has(id))
          motion.set(id, game.tick);
      }
    }
    const members = ids.map((id) => {
      const s = game.squad(id),
        p = starts.get(id)!;
      return {
        id,
        start: p,
        distanceTiles:
          Math.hypot(
            p.x - tilePoint(game.map, goal!).x,
            p.y - tilePoint(game.map, goal!).y,
          ) / FIXED,
        firstResponseTicks: responses.has(id)
          ? responses.get(id)! - startTick
          : undefined,
        firstTurnTicks: turn.has(id) ? turn.get(id)! - startTick : undefined,
        firstTranslationTicks: motion.has(id)
          ? motion.get(id)! - startTick
          : undefined,
        commitTicks: commit.has(id) ? commit.get(id)! - startTick : undefined,
        pending: game.movementAdmission.hasPending(id),
        alive: !!s,
        order: s?.order.type,
      };
    });
    const row = {
      scenario,
      mode,
      playerId,
      count,
      startTick,
      goal,
      ticks,
      members,
      outcomes,
      stages,
      tickMs: quantiles(steps),
      rawTickMs: steps,
      phases: Object.fromEntries(
        Object.entries(phases).map(([key, values]) => [key, quantiles(values)]),
      ),
      admissionTicks: quantiles(members.map((x) => x.commitTicks ?? NaN)),
      firstResponseTicks: quantiles(
        members.map((x) => x.firstResponseTicks ?? NaN),
      ),
      firstTranslationTicks: quantiles(
        members.map((x) => x.firstTranslationTicks ?? NaN),
      ),
      unresolved: members.filter((x) => x.pending).length,
      tradeCycles:
        game.expansion!.trade.diagnostics.seaCycles - tradeBefore.seaCycles,
    };
    result.cases.push(row);
    writeFileSync(out + "/results.json", JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify({
        ...row,
        members: undefined,
        outcomes: undefined,
        stages: undefined,
        rawTickMs: undefined,
        phases: undefined,
      }),
    );
  }
