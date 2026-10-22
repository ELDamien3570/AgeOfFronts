import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { deserialize } from "node:v8";
import { createServer } from "node:http";
import { createCoordinatorServer } from "../src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts";
import { CoordinatorStore } from "../src/skirmish/multiplayer/infrastructure/CoordinatorStore.ts";
import { ReservedMatchWorker } from "../src/skirmish/multiplayer/infrastructure/ReservedMatchWorker.ts";
const out = process.env.SEA_PROBE_OUT,
  fixture = process.env.SEA_PROBE_FIXTURE;
if (!out || !fixture)
  throw Error("SEA_PROBE_OUT and SEA_PROBE_FIXTURE required");
mkdirSync(out, { recursive: true });
const f = deserialize(readFileSync(fixture));
const store = new CoordinatorStore(
  process.env.MULTIPLAYER_DB ?? out + "/probe.sqlite",
);
const flushes = [], captures = [];
let checkpointCapture;
const captureAfterRun = () => checkpointCapture ??= Promise.all(captures.map(capture => capture()));
const server = createCoordinatorServer({
  store,
  origins: ["http://127.0.0.1:8080", "http://127.0.0.1:18081"],
  matchCapacity: 1,
  hostCustomRooms: false,
  createExecutor: () => {
    const worker = new ReservedMatchWorker();
    captures.push(() => worker.request({type: "probe-checkpoint"}));
    let rows = [];
    const flush = () => {
      if (rows.length) {
        appendFileSync(
          out + "/advances.jsonl",
          rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
        );
        rows = [];
      }
    };
    flushes.push(flush);
    return {
      get lifecycle() {
        return worker.lifecycle;
      },
      onPublication: (fn) => worker.onPublication(fn),
      close: () => {
        flush();
        return worker.close();
      },
      request: async (r) => {
        const result = await worker.request(
          r.type === "prepare" || r.type === "initialize"
            ? { ...r, settings: f.settings, options: f.options }
            : r,
        );
        if (r.type === "advance") {
          rows.push({ at: Date.now(), tick: result.tick });
          if (rows.length >= 8) flush();
        }
        return result;
      },
    };
  },
});
const probe = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/checkpoint") {
    try {
      const checkpoints = await captureAfterRun();
      res.writeHead(200, {"Content-Type": "application/json"}); res.end(JSON.stringify({checkpoints}));
    } catch (error) {
      res.writeHead(500, {"Content-Type": "application/json"}); res.end(JSON.stringify({error: String(error)}));
    }
    return;
  }
  for (const flush of flushes) flush();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      serverAt: Date.now(),
      source: process.env.GIT_COMMIT,
      fixture: {
        settings: f.settings,
        options: f.options,
        tick: f.checkpoint.tick,
      },
      initial: (() => {
        try {
          return JSON.parse(readFileSync(out + "/worker-initial.json", "utf8"));
        } catch {
          return null;
        }
      })(),
      diagnostics: server.runtimeDiagnostics(),
    }),
  );
});
await new Promise((r) =>
  probe.listen(Number(process.env.SEA_PROBE_PORT ?? 8081), "0.0.0.0", r),
);
await new Promise((r) =>
  server.http.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", r),
);
const timer = setInterval(
  () =>
    appendFileSync(
      out + "/pace.jsonl",
      JSON.stringify({ at: Date.now(), ...server.runtimeDiagnostics() }) + "\n",
    ),
  1000,
);
timer.unref();
writeFileSync(
  out + "/server-ready.json",
  JSON.stringify({
    at: Date.now(),
    source: process.env.GIT_COMMIT,
    node: process.version,
    arch: process.arch,
    fixtureTick: f.checkpoint.tick,
    policy: f.options.seaTradeRouting ?? "legacy",
    workerHeapMb: 384,
    encoderHeapMb: 256,
  }),
);
console.log("SEA_PROBE_READY");
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    clearInterval(timer);
    await captureAfterRun();
    await server.close();
    probe.close();
    store.close();
    process.exit(0);
  });
