// Manual probe, outside the vitest include. Prints the map identity and the
// generation time of procedural maps so a stream or revision change can be
// recorded and compared. Not a gate.
//   npx tsx tests/skirmish/perf/MapHashProbe.ts [mapId[,mapId]] [size[,size]] [seed[,seed]]
// Defaults: every procedural map, sizes 250 and 500, seeds 42, 43 and 2026.
import { defaultLobbySettings } from "../../../src/skirmish/lobby/LobbyDirectory";
import { PROCEDURAL_MAPS } from "../../../src/skirmish/content/Maps";
import { mapIdentity } from "../../../src/skirmish/multiplayer/application/MapIdentity";
import { loadServerMap } from "../../../src/skirmish/multiplayer/infrastructure/ServerMap";

const list = (value: string | undefined, fallback: string[]) =>
  value ? value.split(",") : fallback;
const maps = list(process.argv[2], PROCEDURAL_MAPS.map((map) => map.id));
const sizes = list(process.argv[3], ["250", "500"]).map(Number);
const seeds = list(process.argv[4], ["42", "43", "2026"]).map(Number);

for (const mapId of maps)
  for (const size of sizes)
    for (const seed of seeds) {
      const started = performance.now();
      const loaded = await loadServerMap(
        defaultLobbySettings(mapId as never, size as never),
        undefined,
        seed,
      );
      const genMs = Math.round(performance.now() - started);
      console.log(
        JSON.stringify({ mapId, size, seed, mapHash: await mapIdentity(loaded.map), genMs }),
      );
    }
