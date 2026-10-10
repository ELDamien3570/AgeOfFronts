// QA-only: create RendererBoatBaseline.ts from the documented base commit before running.
import { GameMapImpl } from "../src/core/game/GameMap";
import { Renderer } from "../src/skirmish/client/Renderer";
import { Renderer as BaselineRenderer } from "../src/skirmish/client/RendererBoatBaseline";
import { FIXED } from "../src/skirmish/Protocol";
import { Skirmish } from "../src/skirmish/Simulation";

const width = 48,
  height = 30;
const land = new Uint8Array(width * height).fill(133);
const snapshot = new Skirmish(
  new GameMapImpl(width, height, land, land.length),
  { seed: 42, aiCount: 1, runAi: false, tribes: false, ruleset: "ages-v1" },
).snapshot();
const water = new Uint8Array(width * height);
const map = new GameMapImpl(width, height, water, 0);
snapshot.players = [];
snapshot.expansion!.deposits = [];
snapshot.squads = [];
snapshot.buildings = [];
snapshot.owners.fill(0);
snapshot.ships = ["transport", "warship"].map((kind, i) => ({
  id: 500 + i,
  playerId: 1,
  kind: kind as "transport" | "warship",
  x: 8 * FIXED,
  y: (10 + i * 8) * FIXED,
  health: 600,
  destination: 500,
  waypoints: [],
  fighting: false,
  boarding: null,
  definitionId: `bronzeage-${kind}`,
}));
snapshot.expansion!.traders = [
  {
    id: 500,
    playerId: 1,
    definitionId: "bronzeage-trade",
    naval: true,
    x: 8 * FIXED,
    y: 25 * FIXED,
  } as never,
];
const renderers = [
  new BaselineRenderer(document.querySelector("#before")!),
  new Renderer(document.querySelector("#after")!),
];
for (const r of renderers) {
  r.setGroundStyle("classic");
  r.setMap(map);
  r.zoom(1.2, 320, 220);
  r.update(structuredClone(snapshot));
}
let paused = false,
  jitter = false,
  packet = 0,
  nextAt = performance.now() + 200,
  duplicateAt = Infinity;
const durations: number[][] = [[], []];
const paths: number[][] = [[], []];
let lastSnapshot = structuredClone(snapshot);
const start = performance.now();
const status = document.querySelector("#status")!;
function animate(now: number) {
  if (!paused && now >= nextAt) {
    packet++;
    snapshot.tick += 4;
    const t = packet * 0.2;
    // Smooth changing direction, well within ordinary movement/discontinuity bounds.
    const x = (24 + 15 * Math.sin(t * 0.45)) * FIXED;
    const dy = 2 * Math.cos(t * 0.45) * FIXED;
    for (let i = 0; i < snapshot.ships.length; i++) {
      snapshot.ships[i].x = x;
      snapshot.ships[i].y = (10 + i * 8) * FIXED + dy;
    }
    snapshot.expansion!.traders[0].x = x;
    snapshot.expansion!.traders[0].y = 25 * FIXED + dy;
    lastSnapshot = structuredClone(snapshot);
    for (const r of renderers) r.update(structuredClone(lastSnapshot));
    nextAt = now + (jitter ? (packet % 2 ? 150 : 250) : 200);
    duplicateAt = jitter ? now + 80 : Infinity;
  }
  if (!paused && now >= duplicateAt) {
    for (const r of renderers) r.update(structuredClone(lastSnapshot));
    duplicateAt = Infinity;
  }
  renderers.forEach((r, i) => {
    const t = performance.now();
    if (r.draw(now, 1, paused)) durations[i].push(performance.now() - t);
  });
  paths[0].push(snapshot.ships[0].x / FIXED);
  paths[1].push(
    (renderers[1] as Renderer).shipScreenPosition(snapshot.ships[0]).x,
  );
  if (durations[0].length > 600) {
    durations[0].shift();
    durations[1].shift();
  }
  const pose = renderers[1].shipScreenPosition(snapshot.ships[0]);
  const hit = renderers[1].shipAt(pose.x, pose.y);
  status.textContent = `${jitter ? "Jitter + duplicates" : "Regular 5 Hz"} · ${paused ? "Paused" : "Running"} · Drawn ship hit-test: ${hit === 500 ? "aligned" : "ERROR"} · ${Math.round(now - start)} ms elapsed`;
  requestAnimationFrame(animate);
}
document
  .querySelector("#regular")!
  .addEventListener("click", () => (jitter = false));
document
  .querySelector("#jitter")!
  .addEventListener("click", () => (jitter = true));
document
  .querySelector("#pause")!
  .addEventListener("click", () => (paused = !paused));
Object.assign(window, {
  boatQA: {
    renderers,
    snapshot,
    map,
    durations,
    paths,
    setJitter: (v: boolean) => (jitter = v),
    setPaused: (v: boolean) => (paused = v),
  },
  ready: true,
});
requestAnimationFrame(animate);
