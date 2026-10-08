import { canCharge } from "../../../src/skirmish/client/ChargeReadiness";
import { Renderer } from "../../../src/skirmish/client/Renderer";
import { type Command, type Snapshot } from "../../../src/skirmish/Protocol";
import { DEMO_TROOP_BY_ID, registerDemoTroops } from "./DemoTroops";
import { FormationManeuvers } from "./FormationManeuvers";
import { StoneAgeDemoActors } from "./StoneAgeDemoActors";
import { stoneAgeDemoMap } from "./StoneAgeDemoMap";
import type { ManualFormation } from "./TroopPrototypeModel";
registerDemoTroops();

const canvas = document.querySelector<HTMLCanvasElement>("#battlefield")!;
const status = document.querySelector<HTMLElement>("#status")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;
const renderer = new Renderer(canvas),
  actors = new StoneAgeDemoActors();
const maneuvers = new FormationManeuvers(
  document.querySelector<HTMLElement>("#stage")!,
);
const map = stoneAgeDemoMap();
renderer.setMap(map);
renderer.squadArtworkOverride = actors.draw;
renderer.squadArtworkFlush = actors.flush;
renderer.squadVolleyArtwork = actors.drawVolley;
renderer.squadRemainsArtwork = actors.drawRemains;
renderer.squadArtworkViewRadius = (squad, tileSize) =>
  DEMO_TROOP_BY_ID.has(squad.definitionId ?? "") ? tileSize * 3 : 0;
let snapshot: Snapshot | undefined,
  showcaseFixture: Snapshot | undefined,
  paused = true,
  initialized = false;
const worker = new Worker(new URL("./StoneAgeDemoWorker.ts", import.meta.url), {
  type: "module",
});
const command = (command: Command) =>
  worker.postMessage({ type: "command", command });
function focus(): void {
  renderer.focusStartingLocation(map.ref(64, 64));
  renderer.zoom(1.7, canvas.clientWidth / 2, canvas.clientHeight / 2);
}
function overview(): void {
  renderer.focusStartingLocation(map.ref(64, 64));
  renderer.zoom(0.01, canvas.clientWidth / 2, canvas.clientHeight / 2);
}
let workerPerformance = { stepMs: 0, stepP95: 0, snapshotMs: 0 };
worker.onmessage = (
  event: MessageEvent<{
    snapshot?: Snapshot;
    paused?: boolean;
    reset?: boolean;
    error?: string;
    performance?: typeof workerPerformance;
  }>,
) => {
  if (event.data.error) {
    status.textContent = event.data.error;
    return;
  }
  if (!event.data.snapshot) return;
  if (event.data.reset) {
    actors.clear();
    renderer.setMap(map);
  }
  if (event.data.performance) workerPerformance = event.data.performance;
  snapshot = event.data.snapshot;
  showcaseFixture ??= snapshot;
  paused = event.data.paused ?? true;
  renderer.update(snapshot);
  actors.prune(snapshot);
  if (!initialized || event.data.reset) {
    overview();
    initialized = true;
  }
  pauseButton.textContent = paused ? "Resume" : "Pause";
  const friendly = snapshot.squads.filter((s) => s.playerId === 1);
  const preparing = friendly.filter(
    (s) => s.charge?.phase === "preparing",
  ).length;
  status.textContent = actors.ready
    ? `${paused ? "Paused" : "Live combat"} · ${[1, 2, 3, 4].map((id) => `Faction ${id}: ${snapshot!.squads.filter((s) => s.playerId === id).length}`).join(" / ")} squads · ${renderer.selected.size} selected · losses ${snapshot.players.reduce((sum, player) => sum + player.losses, 0)} · 12 foot / 6 mounted soldiers at full strength`
    : "Loading Russian Stone Age soldiers…";
  if (actors.ready && preparing)
    status.textContent += ` · ${preparing} preparing charge${preparing === 1 ? "" : "s"}`;
};
worker.onerror = (event) => {
  status.textContent = `Simulation error: ${event.message}`;
};
void actors
  .load()
  .then(() => worker.postMessage({ type: "inspect" }))
  .catch((error) => {
    worker.terminate();
    status.textContent = `Artwork error: ${String(error)}`;
  });
for (const id of ["pause", "engage"])
  document
    .querySelector(`#${id}`)!
    .addEventListener("click", () => worker.postMessage({ type: id }));
document
  .querySelector("#reset")!
  .addEventListener("click", () => worker.postMessage({ type: "reset" }));
document.querySelector("#focus")!.addEventListener("click", focus);
document.querySelector("#overview")!.addEventListener("click", overview);
document
  .querySelector<HTMLSelectElement>("#formation")!
  .addEventListener("change", (event) => {
    actors.formation = maneuvers.formation = (event.target as HTMLSelectElement)
      .value as ManualFormation;
  });
document
  .querySelector<HTMLButtonElement>("#movement")!
  .addEventListener("click", (event) => {
    if (!snapshot) return;
    if (maneuvers.visible) maneuvers.hide();
    else {
      if (!paused) worker.postMessage({ type: "pause" });
      maneuvers.show(showcaseFixture ?? snapshot);
    }
    (event.currentTarget as HTMLButtonElement).textContent = maneuvers.visible
      ? "Back to battle"
      : "Movement showcase";
    document.querySelector<HTMLElement>("footer")!.style.display =
      maneuvers.visible ? "none" : "";
    for (const id of [
      "engage",
      "pause",
      "reset",
      "selectAll",
      "charge",
      "focus",
      "overview",
    ])
      document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled =
        maneuvers.visible;
  });
document.querySelector("#selectAll")!.addEventListener("click", () => {
  renderer.selected = new Set(
    snapshot?.squads.filter((s) => s.playerId === 1).map((s) => s.id),
  );
  worker.postMessage({ type: "inspect" });
});
document.querySelector("#charge")!.addEventListener("click", () => {
  if (!snapshot) return;
  let issued = 0;
  for (const squad of snapshot.squads.filter(
    (s) => renderer.selected.has(s.id) && s.playerId === 1,
  )) {
    const target = snapshot.squads
      .filter((s) => s.playerId !== 1)
      .sort(
        (a, b) =>
          Math.hypot(a.x - squad.x, a.y - squad.y) -
          Math.hypot(b.x - squad.x, b.y - squad.y),
      )[0];
    if (target && canCharge(squad, snapshot.tick, target.x, target.y)) {
      command({
        type: "charge",
        playerId: 1,
        squadIds: [squad.id],
        x: target.x,
        y: target.y,
        targetId: target.id,
      });
      issued++;
    }
  }
  if (!issued)
    status.textContent =
      "Select ready melee or cavalry formations within charge range.";
});
const position = (event: MouseEvent) => {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};
canvas.addEventListener("click", (event) => {
  const p = position(event),
    squad = renderer.squadAt(p.x, p.y, 1);
  if (!event.shiftKey) renderer.selected.clear();
  if (squad) {
    renderer.selected.add(squad.id);
    renderer.inspectedSquadId = squad.id;
  }
  worker.postMessage({ type: "inspect" });
});
canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const p = position(event),
    hit = renderer.squadAt(p.x, p.y),
    target = hit?.playerId !== 1 ? hit : undefined,
    tile = renderer.tileAt(p.x, p.y);
  if (!renderer.selected.size || tile === null) return;
  command({
    type: "order",
    playerId: 1,
    squadIds: [...renderer.selected],
    order: target
      ? { type: "attack", targetId: target.id }
      : { type: "move", tile },
  });
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const p = position(event);
    renderer.zoom(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
  },
  { passive: false },
);
let pan: { x: number; y: number } | undefined;
canvas.addEventListener("pointerdown", (event) => {
  if (event.button === 1) {
    event.preventDefault();
    pan = position(event);
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (pan) {
    const p = position(event);
    renderer.pan(p.x - pan.x, p.y - pan.y);
    pan = p;
  }
});
canvas.addEventListener("pointerup", () => {
  pan = undefined;
});
window.addEventListener("pagehide", () => worker.terminate(), { once: true });
const metrics = document.querySelector<HTMLElement>("#performance")!;
const frames: { interval: number; draw: number }[] = [];
let previousFrame: number | undefined,
  nextMetrics = 0,
  lastDrawn = 0;
function frame(now: number): void {
  const start = performance.now();
  const currentActors = maneuvers.visible ? maneuvers.actors : actors;
  currentActors.beginFrame();
  const drew = maneuvers.visible
    ? (maneuvers.draw(now), true)
    : renderer.draw(now, 1, paused);
  if (drew) {
    lastDrawn = currentActors.drawnSoldiers;
    if (previousFrame !== undefined && !document.hidden) {
      frames.push({
        interval: now - previousFrame,
        draw: performance.now() - start,
      });
      if (frames.length > 120) frames.shift();
    }
    previousFrame = now;
  }
  if (now >= nextMetrics && frames.length) {
    const ordered = frames.map((f) => f.interval).sort((a, b) => a - b);
    const average =
      frames.reduce((sum, f) => sum + f.interval, 0) / frames.length;
    const draw = frames.reduce((sum, f) => sum + f.draw, 0) / frames.length;
    metrics.textContent = `${(1000 / average).toFixed(0)} FPS � frame p95 ${ordered[Math.floor((ordered.length - 1) * 0.95)].toFixed(1)} ms � render CPU ${draw.toFixed(1)} ms � ${lastDrawn} soldiers drawn \u00b7 sort ${currentActors.sortMs.toFixed(2)} ms � worker tick ${workerPerformance.stepMs.toFixed(1)} ms / p95 ${workerPerformance.stepP95.toFixed(1)} ms (50 ms budget) � snapshot ${workerPerformance.snapshotMs.toFixed(1)} ms`;
    nextMetrics = now + 500;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
