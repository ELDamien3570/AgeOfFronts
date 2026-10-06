import { GameMapImpl } from "../../../src/core/game/GameMap";
import { FIXED } from "../../../src/skirmish/Protocol";
import { Skirmish } from "../../../src/skirmish/Simulation";
import {
  SnapshotDecoder,
  SnapshotEncoder,
  snapshotTransfers,
} from "../../../src/skirmish/SnapshotCodec";
import { unpackSnapshotDetails } from "../../../src/skirmish/SnapshotDetails";
import { Renderer } from "../../../src/skirmish/client/Renderer";

const run = document.querySelector<HTMLButtonElement>("#run")!,
  result = document.querySelector<HTMLPreElement>("#result")!;
const canvas = document.querySelector<HTMLCanvasElement>("#battlefield")!,
  renderer = new Renderer(canvas);
const frame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
const summary = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p95: sorted[Math.ceil(values.length * 0.95) - 1],
    maximum: sorted[sorted.length - 1],
  };
};
run.addEventListener("click", () => void profile());
async function profile() {
  run.disabled = true;
  try {
    const width = 192,
      height = 128,
      terrain = new Uint8Array(width * height).fill(133);
    const map = new GameMapImpl(width, height, terrain, terrain.length);
    const game = new Skirmish(map, {
      seed: 42,
      aiCount: 14,
      tribes: false,
      runAi: false,
      ruleset: "ages-v1",
    });
    const template = game.squads[0];
    for (const squad of game.squads) game.removeSquad(squad.id);
    for (let at = 0; at < 1500; at++)
      game.addSquad({
        ...template,
        id: game.allocateId(),
        playerId: 1 + Math.floor(at / 100),
        x: (30 + (at % 40) * 2) * FIXED,
        y: (24 + Math.floor(at / 40) * 2) * FIXED,
        order: { type: "hold" },
        path: [],
        queuedOrders: [],
        definitionId: undefined,
      });
    const source = game.replicationSource(),
      encoder = new SnapshotEncoder(),
      decoder = new SnapshotDecoder();
    const packet = encoder.encode(source);
    const legacy = {
      ...packet,
      ...unpackSnapshotDetails(packet.details!),
      details: undefined,
    };
    const cloneTimes: number[] = [],
      transferTimes: number[] = [],
      encodeTimes: number[] = [],
      decodeTimes: number[] = [];
    for (let at = 0; at < 120; at++) {
      let start = performance.now();
      structuredClone(legacy);
      cloneTimes.push(performance.now() - start);
      start = performance.now();
      const fresh = new SnapshotEncoder().encode(source);
      encodeTimes.push(performance.now() - start);
      start = performance.now();
      const received = structuredClone(fresh, {
        transfer: snapshotTransfers(fresh),
      });
      transferTimes.push(performance.now() - start);
      start = performance.now();
      decoder.decode(received, false);
      decodeTimes.push(performance.now() - start);
    }
    const snapshot = decoder.decode(packet);
    snapshot.owners.fill(1);
    snapshot.players[0].name = "Browser verification";
    for (const player of snapshot.players) player.eliminated = player.id !== 1;
    renderer.setMap(map);
    renderer.update(snapshot);
    renderer.home();
    const ctx = canvas.getContext("2d")!,
      measure = ctx.measureText.bind(ctx);
    let measurements = 0;
    ctx.measureText = (text) => {
      measurements++;
      return measure(text);
    };
    const drawTimes: number[] = [],
      intervals: number[] = [];
    let drawn = 0,
      previous = 0;
    for (let at = 0; at < 150; at++) {
      const now = await frame(),
        start = performance.now();
      if (renderer.draw(now, 1, true)) {
        drawn++;
        drawTimes.push(performance.now() - start);
        if (previous) intervals.push(now - previous);
        previous = now;
      }
    }
    ctx.measureText = measure;
    if (measurements !== 0)
      throw new Error(`Frame loop made ${measurements} text measurements`);
    // Deterministic timestamps also prove population does not impose a 33ms gate.
    let admitted = 0;
    for (let at = 0; at < 60; at++)
      if (renderer.draw(previous + 1000 + at * (1000 / 60 + 0.01), 1, true))
        admitted++;
    if (admitted !== 60)
      throw new Error(`Only ${admitted}/60 synthetic 60Hz frames admitted`);
    const evidence = {
      status: "PASS",
      browser: navigator.userAgent,
      scene:
        "1500 stationary squads, 192x128 all land; no AI, sockets or simulated load",
      visibleLabels: "Browser verification",
      sampledFrames: 150,
      drawn,
      admittedAt60Hz: admitted,
      frameTextMeasurements: measurements,
      legacyStructuredClone: summary(cloneTimes),
      packedEncode: summary(encodeTimes),
      packedTransfer: summary(transferTimes),
      packedDecode: summary(decodeTimes),
      frameDraw: summary(drawTimes),
      drawInterval: summary(intervals),
      limitations:
        "Synthetic browser checks and local synchronous clone/transfer timings; no DevTools allocation trace, real worker round-trip timing, or sustained multiplayer 60FPS qualification.",
    };
    result.textContent = JSON.stringify(evidence, null, 2);
    console.info(
      JSON.stringify({ event: "debloat-browser-profile", ...evidence }),
    );
  } catch (error) {
    result.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    run.disabled = false;
  }
}
