import type { Command } from "../../../src/skirmish/Protocol";
import { engageDemoArmies, stoneAgeDemo } from "./StoneAgeDemoScenario";

let game = stoneAgeDemo(),
  paused = true;
let stepMs = 0,
  samples: number[] = [];
const publish = (reset = false) => {
  const start = performance.now(),
    snapshot = game.snapshot();
  const snapshotMs = performance.now() - start;
  const ordered = samples.slice().sort((a, b) => a - b);
  self.postMessage({
    snapshot,
    paused,
    reset,
    performance: {
      stepMs,
      stepP95: ordered[Math.floor((ordered.length - 1) * 0.95)] ?? 0,
      snapshotMs,
    },
  });
};
self.onmessage = (
  event: MessageEvent<{
    type: "reset" | "pause" | "engage" | "command" | "inspect";
    command?: Command;
  }>,
) => {
  try {
    const { type, command } = event.data;
    if (type === "reset") {
      game = stoneAgeDemo();
      paused = true;
      samples = [];
      stepMs = 0;
    }
    if (type === "pause") paused = !paused;
    if (type === "engage") {
      engageDemoArmies(game);
      paused = false;
    }
    const error =
      command && type === "command" ? game.applyCommand(command) : null;
    if (error) self.postMessage({ error });
    publish(type === "reset");
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
setInterval(() => {
  if (!paused) {
    try {
      const start = performance.now();
      game.step();
      stepMs = performance.now() - start;
      samples.push(stepMs);
      if (samples.length > 200) samples.shift();
      publish();
    } catch (error) {
      paused = true;
      self.postMessage({ error: String(error) });
    }
  }
}, 50);
publish();
