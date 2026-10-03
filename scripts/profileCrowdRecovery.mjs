import fs from "node:fs";
import path from "node:path";
import { deserialize, serialize } from "node:v8";
import { createSkirmishMap } from "../src/skirmish/Elevation.ts";
import { defaultLobbySettings } from "../src/skirmish/lobby/LobbyDirectory.ts";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap.ts";
import { RuntimeDiagnostics } from "../src/skirmish/RuntimeDiagnostics.ts";
import { Skirmish } from "../src/skirmish/Simulation.ts";
import { SnapshotEncoder } from "../src/skirmish/SnapshotCodec.ts";
const args = process.argv.slice(2),
  value = (name, fallback) => {
    const at = args.indexOf(name);
    return at < 0 ? fallback : args[at + 1];
  };
const restore = value(
  "--restore",
  "data/investigation-20261003/navigation-oracle-arm/checkpoint-final.v8",
);
const out = value("--out", "data/investigation-20261003/crowd-recovery-local");
fs.mkdirSync(out, { recursive: true });
const saved = deserialize(fs.readFileSync(restore));
const loaded = await loadServerMap({
  ...defaultLobbySettings("valles-kairulia", 500),
  aiCount: 10,
  tribeCount: 25,
});
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
const ids = [126, 127, 346, 352, 412, 420, 489, 5166, 5228, 5258, 10502];
const focus = ids
  .map((id) => {
    const s = game.squad(id);
    return (
      s && {
        id,
        x: s.x,
        y: s.y,
        order: s.order,
        path: s.path,
        nextPathIndex: s.nextPathIndex,
        maximum: 0,
        movingTicks: 0,
        minimumOriginal: Infinity,
        statuses: {},
        distance:
          s.order.type === "move"
            ? Math.hypot(
                s.x - (s.order.x ?? ((s.order.tile % map.width()) + 0.5) * 256),
                s.y -
                  (s.order.y ??
                    (Math.floor(s.order.tile / map.width()) + 0.5) * 256),
              )
            : null,
      }
    );
  })
  .filter(Boolean);
const diagnostic = new RuntimeDiagnostics(256, true);
game.onPhase = (phase, ms) => diagnostic.record(phase, ms);
const encoder = new SnapshotEncoder(true),
  start = game.tick,
  started = performance.now(),
  ticks = Number(value("--ticks", 600));
for (let at = 0; at < ticks; at++) {
  game.step();
  if (game.tick % 4 === 0)
    diagnostic.measure("snapshot", () =>
      encoder.encode(
        game.replicationSource(),
        game.tileChanges,
        game.replicationFacts(),
      ),
    );
  for (const p of focus) {
    const s = game.squad(p.id);
    if (!s) continue;
    p.maximum = Math.max(p.maximum, Math.hypot(s.x - p.x, s.y - p.y));
    if (s.moved) p.movingTicks++;
    if (p.order.type === "move")
      p.minimumOriginal = Math.min(
        p.minimumOriginal,
        Math.hypot(
          s.x - (p.order.x ?? ((p.order.tile % map.width()) + 0.5) * 256),
          s.y -
            (p.order.y ?? (Math.floor(p.order.tile / map.width()) + 0.5) * 256),
        ),
      );
    const reason = s.movementStatus?.reason ?? "moving";
    p.statuses[reason] = (p.statuses[reason] ?? 0) + 1;
  }
  if (game.tick % 100 === 0)
    console.log(
      JSON.stringify({
        tick: game.tick,
        elapsedMs: Math.round(performance.now() - started),
        moving: focus.filter((p) => p.maximum > 64).length,
      }),
    );
}
const result = {
  start,
  tick: game.tick,
  elapsedMs: performance.now() - started,
  phases: diagnostic.snapshot(),
  focus: focus.map((p) => {
    const s = game.squad(p.id);
    return {
      ...p,
      maximum: Math.round(p.maximum),
      final: s && {
        x: s.x,
        y: s.y,
        delta: Math.round(Math.hypot(s.x - p.x, s.y - p.y)),
        order: s.order,
        nextPathIndex: s.nextPathIndex,
        status: s.movementStatus,
        remainingOriginal:
          p.order.type === "move"
            ? Math.hypot(
                s.x - (p.order.x ?? ((p.order.tile % map.width()) + 0.5) * 256),
                s.y -
                  (p.order.y ??
                    (Math.floor(p.order.tile / map.width()) + 0.5) * 256),
              )
            : null,
      },
    };
  }),
  recovery: game.checkpoint().avoidance.recovery,
};
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(result));
fs.writeFileSync(
  path.join(out, "checkpoint-final.v8"),
  serialize(game.checkpoint()),
);
console.log(
  JSON.stringify(
    result.focus.map((p) => ({
      id: p.id,
      maximum: p.maximum,
      movingTicks: p.movingTicks,
      distance: p.distance,
      minimumOriginal: p.minimumOriginal,
      remaining: p.final?.remainingOriginal,
      order: p.final?.order,
      status: p.final?.status,
    })),
  ),
);
