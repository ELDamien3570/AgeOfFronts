import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createCoordinatorServer } from "./infrastructure/CoordinatorServer";
import { CoordinatorStore } from "./infrastructure/CoordinatorStore";

const database = process.env.MULTIPLAYER_DB ?? "./data/multiplayer.sqlite";
mkdirSync(dirname(database), { recursive: true });
const store = new CoordinatorStore(database);
const origins = (
  process.env.MULTIPLAYER_ORIGINS ??
  "http://127.0.0.1:9010,http://localhost:9010,http://127.0.0.1:9000"
)
  .split(",")
  .map((origin) => origin.trim());
const matchCapacity = Number(process.env.MULTIPLAYER_MATCH_CAPACITY ?? 3);
const staticDir = process.env.STATIC_DIR;
const graceMs = Number(process.env.MULTIPLAYER_EMPTY_MATCH_GRACE_MS ?? 120_000);
if (!Number.isInteger(graceMs) || graceMs < 1_000 || graceMs > 300_000)
  throw new Error("MULTIPLAYER_EMPTY_MATCH_GRACE_MS must be 1000–300000");
// Per-address socket cap (0 = off). Behind a reverse proxy (e.g. Caddy) also
// set MULTIPLAYER_TRUST_PROXY=1, or every player shares the proxy's address.
const maxSocketsPerAddress = Number(process.env.MULTIPLAYER_MAX_SOCKETS_PER_ADDRESS ?? 0);
if (!Number.isInteger(maxSocketsPerAddress) || maxSocketsPerAddress < 0)
  throw new Error("MULTIPLAYER_MAX_SOCKETS_PER_ADDRESS must be a nonnegative integer");
const coordinator = createCoordinatorServer({
  store,
  origins,
  matchCapacity,
  staticDir,
  liveMatch: { graceMs },
  maxSocketsPerAddress,
  trustProxy: process.env.MULTIPLAYER_TRUST_PROXY === "1",
});
coordinator.http.listen(
  Number(process.env.PORT ?? 9011),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `Age of Fronts coordinator listening; maximum ${matchCapacity} active matches.`,
    ),
);
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await coordinator.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
