// Writes late-game parity fixtures for scripts/fixtureParityPair.ts: the lobby
// match an online room ships (lobbyMatchOptions), every human seat handed to
// the AI so the match reaches the late game, stepped without pacing. Each
// fixture is v8-serialized { seed, settings, options, checkpoint }.
//
//   node node_modules/tsx/dist/cli.mjs scripts/createLateGameFixture.ts \
//     [--map migration] [--size 1000] [--ai 14] [--tribes 30] [--speed 3] \
//     [--seed 1606492585] [--minutes 45,60] [--out out/fixtures]
import { mkdirSync, writeFileSync } from "node:fs";
import { serialize } from "node:v8";
import { loadServerMap } from "../src/skirmish/multiplayer/infrastructure/ServerMap";
import { defaultLobbySettings, type LobbySettings } from "../src/skirmish/lobby/LobbyDirectory";
import { lobbyMatchOptions } from "../src/skirmish/multiplayer/application/LobbyMatchOptions";
import { createSkirmishMap } from "../src/skirmish/Elevation";
import { Skirmish } from "../src/skirmish/Simulation";
import { TICKS_PER_SECOND } from "../src/skirmish/Protocol";

const args = process.argv.slice(2);
const value = (key: string, fallback: string) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const mapId = value("--map", "migration") as LobbySettings["mapId"];
const size = Number(value("--size", "1000")) as LobbySettings["worldSize"];
const seed = Number(value("--seed", "1606492585"));
const minutes = value("--minutes", "45,60").split(",").map(Number);
const out = value("--out", "out/fixtures");
const settings: LobbySettings = {
  ...defaultLobbySettings(mapId, size),
  aiCount: Number(value("--ai", "14")),
  tribeCount: Number(value("--tribes", "30")),
  technologySpeed: Number(value("--speed", "3")) as LobbySettings["technologySpeed"],
  startProtectionMinutes: 0,
};
const loaded = await loadServerMap(settings, undefined, seed);
const options = {
  ...lobbyMatchOptions(settings, [{ name: "Fixture" }], seed),
  ...(loaded.territoryIncomeScale === undefined ? {} : { territoryIncomeScale: loaded.territoryIncomeScale }),
};
const m = loaded.map;
const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain, m.elevation, m.forest, m.resourceTerrain), options);
for (const player of game.players) if (!player.ai) game.setAiController(player.id, true);
mkdirSync(out, { recursive: true });
const perMinute = 60 * TICKS_PER_SECOND;
const last = Math.max(...minutes);
while (game.tick < last * perMinute && game.winner === null) {
  game.step();
  if (game.tick % perMinute !== 0) continue;
  const minute = game.tick / perMinute;
  console.log(`minute ${minute}: ${game.squads.length} squads, ${game.buildings.length} buildings`);
  if (minutes.includes(minute)) {
    const file = `${out}/${mapId}-${size}-s${seed}-m${minute}.v8`;
    writeFileSync(file, serialize({ seed, settings, options, checkpoint: game.checkpoint() }));
    console.log(`fixture ${file}`);
  }
}
process.exit(0);
