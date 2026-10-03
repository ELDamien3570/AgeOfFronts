import { GameMapImpl } from "../../../src/core/game/GameMap";
import { encodeState } from "../../../src/skirmish/multiplayer/StateCodec";
import type { Snapshot, SnapshotPacket } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import { SnapshotEncoder } from "../../../src/skirmish/SnapshotCodec";

interface WorkerResponse {
  error?: string;
  packet: { tick: number };
  canonicalOnly?: boolean;
  canonicalSequence?: number;
  snapshot?: Snapshot;
  decodeMs?: number;
  applyMs?: number;
  projectionMs?: number;
}
const run = document.querySelector<HTMLButtonElement>("#run")!;
const release = document.querySelector<HTMLButtonElement>("#release")!;
const result = document.querySelector<HTMLPreElement>("#result")!;
run.addEventListener("click", () => void test());
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function test() {
  run.disabled = true;
  const worker = new Worker(
    new URL(
      "../../../src/skirmish/client/multiplayerStateWorker.ts",
      import.meta.url,
    ),
    { type: "module" },
  );
  const trace: unknown[] = [];
  const receive = () =>
    new Promise<WorkerResponse>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Worker response deadline exceeded")),
        15000,
      );
      worker.addEventListener(
        "message",
        (event: MessageEvent<WorkerResponse>) => {
          clearTimeout(timeout);
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data);
        },
        { once: true },
      );
    });
  async function send(packet: SnapshotPacket, presentation = true) {
    const wire = await encodeState(packet),
      response = receive();
    worker.postMessage({
      ...wire,
      expectedMap: { width: 64, height: 48 },
      presentation,
    });
    const value = await response;
    trace.push({
      canonicalOnly: value.canonicalOnly ?? false,
      tick: value.packet.tick,
      decodeMs: value.decodeMs,
      applyMs: value.applyMs,
      projectionMs: value.projectionMs,
    });
    return value;
  }
  async function project() {
    const response = receive();
    worker.postMessage({ type: "presentation" });
    return response;
  }
  try {
    const map = new GameMapImpl(64, 48, new Uint8Array(3072).fill(133), 3072);
    const match = new Skirmish(map, {
      seed: 42,
      aiCount: 1,
      runAi: false,
      tribes: false,
      ruleset: "ages-v1",
    });
    match.addBuilding({
      id: 999,
      playerId: 1,
      type: "barracks",
      tile: map.ref(20, 20),
      remainingTicks: 0,
    });
    const encoder = new SnapshotEncoder(true),
      tile = map.ref(30, 20),
      original = match.owners[tile];
    const baseline = await send(encoder.encode(match.snapshot()));
    worker.postMessage({
      type: "presented",
      sequence: baseline.canonicalSequence,
    });
    match.tick = 1;
    match.owners[tile] = original === 1 ? 2 : 1;
    match.removeBuilding(999);
    const first = await send(encoder.encode(match.snapshot()), false);
    match.tick = 2;
    match.owners[tile] = original;
    const second = await send(encoder.encode(match.snapshot()), false);
    assert(
      first.canonicalOnly &&
        second.canonicalOnly &&
        !first.snapshot &&
        !second.snapshot,
      "Hidden updates materialized views",
    );
    result.textContent =
      "Canonical tick 2 applied while view held. No hidden snapshots. Release to verify changed-back dirt and removal.";
    release.disabled = false;
    await new Promise<void>((resolve) =>
      release.addEventListener("click", () => resolve(), { once: true }),
    );
    release.disabled = true;
    const latest = await project();
    assert(latest.snapshot, "Missing latest snapshot");
    assert(
      latest.canonicalSequence === 3 && latest.snapshot.tick === 2,
      "Late projection is stale",
    );
    assert(
      latest.snapshot.owners[tile] === original &&
        latest.snapshot.changedTiles?.includes(tile),
      "Changed-back dirty cell was lost",
    );
    assert(
      !latest.snapshot.buildings.some((b: { id: number }) => b.id === 999),
      "Removed building returned",
    );
    worker.postMessage({ type: "presented", sequence: 2 });
    assert(
      (await project()).snapshot?.changedTiles?.includes(tile),
      "Older acknowledgement erased late dirt",
    );
    worker.postMessage({ type: "presented", sequence: 3 });
    assert(
      (await project()).snapshot?.changedTiles?.length === 0,
      "Acknowledged dirt was retained",
    );
    const recovery = await send(
      new SnapshotEncoder(true).encode(match.snapshot()),
    );
    assert(
      recovery.snapshot &&
        recovery.snapshot.changedTiles === undefined &&
        recovery.canonicalSequence === 4,
      "Recovery baseline obligation was lost",
    );
    const evidence = {
      status: "PASS",
      browser: navigator.userAgent,
      map: "64x48 all land",
      seed: 42,
      canonicalPackets: 4,
      hiddenSnapshots: 0,
      trace,
    };
    result.textContent = JSON.stringify(evidence, null, 2);
    console.info(
      JSON.stringify({ event: "p14-browser-projection", ...evidence }),
    );
  } catch (error) {
    result.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    worker.terminate();
    run.disabled = false;
  }
}
