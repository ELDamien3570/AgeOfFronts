import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { deserialize } from "node:v8";
import { standable, squadRadius } from "../src/skirmish/SquadGeometry.ts";
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
  const step = game.step.bind(game);
  game.step = () => {
    const at = performance.now();
    step();
    const ms = performance.now() - at;
    appendFileSync(
      out + "/ticks.jsonl",
      JSON.stringify({ tick: game.tick, at: Date.now(), ms }) + "\n",
    );
  };
}
