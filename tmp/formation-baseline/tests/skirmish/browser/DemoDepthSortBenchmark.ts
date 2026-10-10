import { performance } from "node:perf_hooks";
import { SoldierDrawQueue } from "../../../src/skirmish/client/SoldierDrawQueue";
const queue = new SoldierDrawQueue();
const image = {} as CanvasImageSource;
const frame = {
  x: 0,
  y: 0,
  width: 512,
  height: 512,
  pivot: { x: 256, y: 256 },
};
const samples: number[] = [];
for (let tick = 0; tick < 630; tick++) {
  queue.clear();
  for (let i = 0; i < 3900; i++) {
    const y = ((i * 37) % 128) + Math.sin(tick * 0.03 + i) * 3;
    queue.add(Math.floor(i / 12), i % 12, 100, y, 0, 32, image, frame);
  }
  const started = performance.now();
  queue.sort();
  if (tick >= 30) samples.push(performance.now() - started);
}
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      soldiers: 3900,
      frames: samples.length,
      sortMeanMs: samples.reduce((sum, n) => sum + n, 0) / samples.length,
      sortP95Ms: samples[Math.floor((samples.length - 1) * 0.95)],
      sortMaxMs: samples[samples.length - 1],
      environment:
        "Node CPU component benchmark; excludes Canvas and browser frame cost",
    },
    null,
    2,
  ),
);
