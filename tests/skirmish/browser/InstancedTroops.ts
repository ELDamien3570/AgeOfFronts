import { FormationArtwork } from "../../../src/skirmish/client/FormationArtwork";
import {
  ACTOR_INSTANCE_STRIDE,
  InstancedActorSprites,
} from "../../../src/skirmish/client/InstancedActorSprites";
import {
  clampMapScale,
  mapFitScale,
  mapStartingScale,
  MAX_MAP_SCALE,
} from "../../../src/skirmish/client/MapCameraScale";
import {
  squadSymbol,
  squadViewRadius,
} from "../../../src/skirmish/client/MapSymbols";
import {
  SPRITE_FOOTPRINT,
  squadSpriteSize,
} from "../../../src/skirmish/client/UnitAnimation";
import {
  HEIGHTMAP_MAPS,
  heightmapDimensions,
} from "../../../src/skirmish/content/Maps";
import { FIXED, type SquadType } from "../../../src/skirmish/Protocol";
import { squadRadius } from "../../../src/skirmish/SquadGeometry";
import { TroopChoreography } from "./TroopChoreography";
import {
  battlePreviewPlacement,
  clipFrame,
  formationSlots,
  formationVisible,
  liveSlotCount,
  representativeCount,
  resolveFormation,
  type ActorClip,
  type ActorManifest,
  type FormationLayout,
  type FormationShape,
  type FormationSlot,
  type ManualFormation,
} from "./TroopPrototypeModel";

const NAMES = ["Clubman", "Javelinist", "MountedSpearman"] as const;
const CLIPS = ["idle", "running", "attack", "death"] as const;
type ActorName = (typeof NAMES)[number];
type ClipName = (typeof CLIPS)[number];
interface LoadedClip {
  clip: ActorClip;
  layer: number;
  page: HTMLCanvasElement;
}
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const stage = element<HTMLElement>("stage");
const gpuCanvas = element<HTMLCanvasElement>("gpu");
const canvas = element<HTMLCanvasElement>("fallback");
const ground = element<HTMLCanvasElement>("ground");
const overlay = element<HTMLCanvasElement>("overlay");
const ctx = canvas.getContext("2d")!;
const groundCtx = ground.getContext("2d")!;
const overlayCtx = overlay.getContext("2d")!;
const gpu = new InstancedActorSprites(gpuCanvas);
const markers = new FormationArtwork();
const rendererControl = element<HTMLSelectElement>("renderer");
const actorControl = element<HTMLSelectElement>("actor");
const actionControl = element<HTMLSelectElement>("action");
const formationsControl = element<HTMLInputElement>("formations");
const soldiersControl = element<HTMLSelectElement>("soldiers");
const strengthControl = element<HTMLInputElement>("strength");
const zoomControl = element<HTMLInputElement>("zoom");
const detailControl = element<HTMLInputElement>("detail");
const mapControl = element<HTMLSelectElement>("map");
const worldSizeControl = element<HTMLSelectElement>("worldSize");
const troopsControl = element<HTMLInputElement>("troops");
const insetControl = element<HTMLInputElement>("hudInset");
const boundsControl = element<HTMLInputElement>("bounds");
const formationControl = element<HTMLSelectElement>("formation");
const sceneControl = element<HTMLSelectElement>("scene");
const footprintControl = element<HTMLSelectElement>("footprint");
const horseControl = element<HTMLInputElement>("horseSize");
let activeShape = formationControl.value as ManualFormation;
let chargeUntil = 0,
  regularAction = actionControl.value,
  tourStep = 0;
function effectiveShape(name: ActorName): FormationShape {
  return resolveFormation(
    activeShape,
    name === "MountedSpearman",
    chargeUntil > elapsed,
  );
}
function beginCharge(): void {
  if (actionControl.value !== "charge") regularAction = actionControl.value;
  actionControl.value = "charge";
  chargeUntil = elapsed + 5000;
  layoutRevision++;
}
actionControl.addEventListener("change", () => {
  if (actionControl.value === "charge") beginCharge();
  else {
    regularAction = actionControl.value;
    chargeUntil = 0;
    layoutRevision++;
  }
});
function syncFormationControl(): void {
  const mounted = actorControl.value === "MountedSpearman";
  formationControl.disabled = mounted;
  formationControl.value = mounted ? "line" : activeShape;
}
actorControl.addEventListener("change", syncFormationControl);
let layoutRevision = 0;
const presentations = new Map<
  number,
  {
    name: ActorName;
    capacity: number;
    revision: number;
    motion: TroopChoreography;
  }
>();
const queuedLosses = new Map(NAMES.map((name) => [name, 0]));
let nextDemoDeath = 0,
  nextTour = 0,
  demoRestoreAt = 0;
function actorCount(name: ActorName): number {
  return representativeCount(
    Number(soldiersControl.value),
    name === "MountedSpearman",
  );
}
function currentSlots(name: ActorName): FormationSlot[] {
  const layout = layouts.get(name);
  if (!layout) return [];
  const target = formationSlots(
    layout,
    actorCount(name),
    effectiveShape(name),
    name === "MountedSpearman" ? Number(horseControl.value) : 1,
    name === "MountedSpearman",
  );
  return target;
}
formationControl.addEventListener("change", () => {
  activeShape = formationControl.value as ManualFormation;
  layoutRevision++;
  resetSamples();
});
horseControl.addEventListener("input", () => {
  layoutRevision++;
  element<HTMLOutputElement>("horseValue").value =
    `${Number(horseControl.value).toFixed(2)}×`;
  resetSamples();
});
sceneControl.addEventListener("change", () => {
  formationsControl.disabled = sceneControl.value === "battle";
  cameraX = cameraY = 0;
  if (sceneControl.value === "battle") {
    zoomControl.value = String(
      clampMapScale(
        Math.min(
          width / 22,
          (height - Number(insetControl.value)) / 12,
          MAX_MAP_SCALE,
        ),
        fitScale(),
      ),
    );
    detailControl.checked = true;
  }
  resetSamples();
});
const layouts = new Map<ActorName, FormationLayout>();
for (const map of HEIGHTMAP_MAPS) mapControl.add(new Option(map.name, map.id));
function mapDimensions() {
  const map = HEIGHTMAP_MAPS.find((map) => map.id === mapControl.value)!;
  return heightmapDimensions(
    Number(worldSizeControl.value),
    map.sourceWidth,
    map.sourceHeight,
  );
}
function fitScale(): number {
  const map = mapDimensions();
  return mapFitScale(
    width,
    height,
    map.width,
    map.height,
    Number(insetControl.value),
  );
}
function updateCameraLimits(): void {
  zoomControl.min = String(fitScale());
  zoomControl.max = String(MAX_MAP_SCALE);
  zoomControl.value = String(
    clampMapScale(Number(zoomControl.value), fitScale()),
  );
}
const loaded = new Map<string, LoadedClip>();
const actorArtRadius = new Map<ActorName, number>();
const pages: HTMLCanvasElement[] = [];
let width = 1,
  height = 1,
  ratio = 1;
let cameraX = 0,
  cameraY = 0,
  elapsed = 0;
let previousStrength = 100;
let instances = new Float32Array(16384 * ACTOR_INSTANCE_STRIDE);
let count = 0;
let stopped = false;
let previousNow = performance.now();
let reportAt = 0;
let frameSamples: number[] = [],
  cpuSamples: number[] = [],
  preparationSamples: number[] = [];
let stats: Record<string, unknown> = {};
let benchmarkRenderer: "webgl" | "canvas" | undefined;

async function loadActors(): Promise<void> {
  // Explicit actor manifests select revised sheets; never use Formation/ artwork.
  for (const name of NAMES) {
    const root = `/Art/Cultures/Russians/Units/StoneAge/${name}/`;
    const layoutResponse = await fetch(`${root}Formation/formation.json`);
    if (!layoutResponse.ok)
      throw new Error(`Missing ${name} authored formation layout`);
    layouts.set(name, await layoutResponse.json());
    const response = await fetch(`${root}animations.json`);
    if (!response.ok) throw new Error(`Missing ${name} manifest`);
    const manifest: ActorManifest = await response.json();
    if (manifest.actorCount !== 1)
      throw new Error(`${name} is not individual actor art`);
    for (const id of CLIPS) {
      const clip = manifest.animations.find((value) => value.id === id);
      if (!clip || clip.frames.length !== 6)
        throw new Error(`Missing six-frame ${name} ${id}`);
      const clipRadius =
        Math.max(
          ...clip.frames.map((frame) =>
            Math.hypot(
              Math.max(
                frame.pivot.x / frame.width,
                1 - frame.pivot.x / frame.width,
              ),
              Math.max(
                frame.pivot.y / frame.height,
                1 - frame.pivot.y / frame.height,
              ),
            ),
          ),
        ) * (clip.scale ?? 1);
      actorArtRadius.set(
        name,
        Math.max(actorArtRadius.get(name) ?? 0, clipRadius),
      );
      const image = new Image();
      image.src = root + clip.file;
      await image.decode();
      const page = document.createElement("canvas");
      page.width = 384;
      page.height = 256;
      const bake = page.getContext("2d")!;
      bake.imageSmoothingQuality = "high";
      clip.frames.forEach((frame, index) =>
        bake.drawImage(
          image,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          (index % 3) * 128,
          Math.floor(index / 3) * 128,
          128,
          128,
        ),
      );
      loaded.set(`${name}:${id}`, { clip, layer: pages.length, page });
      pages.push(page);
    }
  }
  gpu.setAtlas(pages);
}
function resize(): void {
  width = stage.clientWidth;
  height = stage.clientHeight;
  ratio = window.devicePixelRatio || 1;
  for (const surface of [canvas, gpuCanvas, ground, overlay]) {
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(height * ratio);
  }
  for (const context of [ctx, groundCtx, overlayCtx])
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  updateCameraLimits();
}
new ResizeObserver(resize).observe(stage);
function resetSamples(): void {
  frameSamples = [];
  cpuSamples = [];
  preparationSamples = [];
}
function resetCasualties(): void {
  demoRestoreAt = 0;
  strengthControl.value = "100";
  previousStrength = 100;
  presentations.clear();
  for (const name of NAMES) queuedLosses.set(name, 0);
}
function setStrength(): void {
  if (Number(strengthControl.value) > previousStrength) presentations.clear();
  previousStrength = Number(strengthControl.value);
  element<HTMLOutputElement>("strengthValue").value =
    `${strengthControl.value}%`;
}
strengthControl.addEventListener("input", setStrength);
soldiersControl.addEventListener("change", () => {
  presentations.clear();
  resetCasualties();
  setStrength();
});
for (const control of [
  rendererControl,
  actorControl,
  actionControl,
  formationsControl,
  soldiersControl,
  detailControl,
  zoomControl,
  mapControl,
  worldSizeControl,
  troopsControl,
  insetControl,
  boundsControl,
  footprintControl,
])
  control.addEventListener("change", resetSamples);
element<HTMLButtonElement>("reset").onclick = () => {
  resetCasualties();
  setStrength();
};
element<HTMLButtonElement>("casualty").onclick = () => {
  for (const name of NAMES) queuedLosses.set(name, queuedLosses.get(name)! + 1);
};
element<HTMLButtonElement>("rankCasualty").onclick = () => {
  for (const name of NAMES) {
    const slots = currentSlots(name);
    const row = Math.max(...slots.map((slot) => slot.row));
    queuedLosses.set(
      name,
      queuedLosses.get(name)! + slots.filter((slot) => slot.row === row).length,
    );
  }
};
element<HTMLButtonElement>("overview").onclick = () => {
  updateCameraLimits();
  zoomControl.value = String(fitScale());
  detailControl.checked = false;
  cameraX = cameraY = 0;
  resetSamples();
};
element<HTMLButtonElement>("close").onclick = () => {
  zoomControl.value = String(MAX_MAP_SCALE);
  detailControl.checked = false;
  cameraX = cameraY = 0;
  resetSamples();
};
element<HTMLButtonElement>("starting").onclick = () => {
  zoomControl.value = String(
    mapStartingScale(width, height, fitScale(), Number(insetControl.value)),
  );
  detailControl.checked = false;
  cameraX = cameraY = 0;
  resetSamples();
};
for (const control of [mapControl, worldSizeControl, insetControl])
  control.addEventListener("change", updateCameraLimits);
insetControl.addEventListener("input", updateCameraLimits);
element<HTMLButtonElement>("controls").onclick = () => {
  const aside = document.querySelector("aside")!;
  aside.hidden = !aside.hidden;
  element<HTMLButtonElement>("controls").textContent = aside.hidden
    ? "Show controls"
    : "Hide controls";
};
element<HTMLButtonElement>("stress").onclick = () => {
  sceneControl.value = "grid";
  formationsControl.disabled = false;
  element<HTMLInputElement>("playCasualties").checked = false;
  element<HTMLInputElement>("tour").checked = false;
  chargeUntil = 0;
  actionControl.value = regularAction;
  layoutRevision++;
  formationsControl.value = "1000";
  soldiersControl.value = "24";
  zoomControl.value = String(clampMapScale(6, fitScale()));
  detailControl.checked = true;
  cameraX = cameraY = 0;
  resetCasualties();
  setStrength();
  resetSamples();
};
element<HTMLButtonElement>("loss").onclick = () => {
  if (!gpu.testContextLoss())
    element<HTMLElement>("status").textContent =
      "Context-loss testing unavailable on this device.";
};
let drag: { x: number; y: number } | undefined;
stage.addEventListener("pointerdown", (event) => {
  if (benchmarkRenderer) return;
  drag = { x: event.clientX, y: event.clientY };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener("pointermove", (event) => {
  if (benchmarkRenderer) return;
  if (!drag) return;
  const zoom = Number(zoomControl.value);
  cameraX -= (event.clientX - drag.x) / zoom;
  cameraY -= (event.clientY - drag.y) / zoom;
  drag = { x: event.clientX, y: event.clientY };
});
stage.addEventListener("pointerup", () => {
  drag = undefined;
});
stage.addEventListener("pointercancel", () => {
  drag = undefined;
});
stage.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (benchmarkRenderer) return;
    const oldScale = Number(zoomControl.value);
    const nextScale = clampMapScale(
      oldScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15),
      fitScale(),
    );
    const rect = stage.getBoundingClientRect();
    cameraX +=
      (event.clientX - rect.left - width / 2) * (1 / oldScale - 1 / nextScale);
    cameraY +=
      (event.clientY -
        rect.top -
        Math.max(100, height - Number(insetControl.value)) / 2) *
      (1 / oldScale - 1 / nextScale);
    zoomControl.value = String(nextScale);
    resetSamples();
  },
  { passive: false },
);

function emit(
  name: ActorName,
  id: ClipName,
  time: number,
  x: number,
  y: number,
  size: number,
  alpha = 1,
  angle = 0,
): void {
  const asset = loaded.get(`${name}:${id}`)!;
  const frameIndex = clipFrame(asset.clip, time),
    frame = asset.clip.frames[frameIndex];
  if ((count + 1) * ACTOR_INSTANCE_STRIDE > instances.length) {
    const grown = new Float32Array(instances.length * 2);
    grown.set(instances);
    instances = grown;
  }
  const extent = size * (asset.clip.scale ?? 1);
  const offset = count++ * ACTOR_INSTANCE_STRIDE;
  instances[offset] = x;
  instances[offset + 1] = y;
  instances[offset + 2] = extent;
  instances[offset + 3] = extent;
  instances[offset + 4] = angle;
  instances[offset + 5] = asset.layer;
  instances[offset + 6] = (frameIndex % 3) / 3;
  instances[offset + 7] = Math.floor(frameIndex / 3) / 2;
  instances[offset + 8] = 1 / 3;
  instances[offset + 9] = 1 / 2;
  instances[offset + 10] = frame.pivot.x / frame.width;
  instances[offset + 11] = frame.pivot.y / frame.height;
  instances[offset + 12] = instances[offset + 13] = instances[offset + 14] = 1;
  instances[offset + 15] = alpha;
}
function drawCanvas(): void {
  ctx.clearRect(0, 0, width, height);
  for (let i = 0; i < count; i++) {
    const o = i * ACTOR_INSTANCE_STRIDE,
      page = pages[instances[o + 5]];
    ctx.globalAlpha = instances[o + 15];
    ctx.save();
    ctx.translate(instances[o], instances[o + 1]);
    ctx.rotate(instances[o + 4]);
    ctx.drawImage(
      page,
      Math.round(instances[o + 6] * page.width),
      Math.round(instances[o + 7] * page.height),
      128,
      128,
      -instances[o + 10] * instances[o + 2],
      -instances[o + 11] * instances[o + 3],
      instances[o + 2],
      instances[o + 3],
    );
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function average(values: number[]): number {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  );
}
function percentile95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}
function render(now: number): void {
  if (stopped) return;
  const start = performance.now();
  const dt = now - previousNow;
  previousNow = now;
  elapsed += Math.min(dt, 100);
  if (chargeUntil && elapsed >= chargeUntil) {
    chargeUntil = 0;
    actionControl.value = regularAction;
    layoutRevision++;
  }
  if (element<HTMLInputElement>("tour").checked && elapsed >= nextTour) {
    tourStep = (tourStep + 1) % 4;
    if (tourStep === 3) {
      beginCharge();
      nextTour = elapsed + 7500;
    } else {
      const shapes: ManualFormation[] = ["line", "shield-wall", "square"];
      activeShape = shapes[tourStep];
      syncFormationControl();
      layoutRevision++;
      nextTour = elapsed + 5000;
    }
  }
  if (
    element<HTMLInputElement>("playCasualties").checked &&
    elapsed >= nextDemoDeath
  ) {
    for (const name of NAMES)
      queuedLosses.set(name, queuedLosses.get(name)! + 1);
    nextDemoDeath = elapsed + 2200;
  }
  const zoom = Number(zoomControl.value),
    n = Number(soldiersControl.value);
  const battle = sceneControl.value === "battle";
  const total = battle
    ? 120
    : Math.max(
        1,
        Math.min(10000, Math.floor(Number(formationsControl.value) || 1)),
      );
  const live = liveSlotCount(n, Number(strengthControl.value));
  const map = mapDimensions();
  const usableHeight = Math.max(100, height - Number(insetControl.value));
  const fullStrengthTroops = Math.max(
    0,
    Math.min(1000, Number(troopsControl.value)),
  );
  const troops = (fullStrengthTroops * Number(strengthControl.value)) / 100;
  const proposed = footprintControl.value === "tile";
  const spriteSize =
    (zoom * squadSpriteSize(MAX_MAP_SCALE, fullStrengthTroops)) /
    (proposed ? 55 : MAX_MAP_SCALE);
  const formationExtent = spriteSize / SPRITE_FOOTPRINT;
  const horseSize = Number(horseControl.value);
  const detailed = detailControl.checked || spriteSize >= 28;
  const originX = width / 2 - (map.width / 2 + cameraX) * zoom;
  const originY = usableHeight / 2 - (map.height / 2 + cameraY) * zoom;
  const useGpu =
    (benchmarkRenderer ?? rendererControl.value) === "webgl" && gpu.available;
  gpuCanvas.style.visibility = useGpu ? "visible" : "hidden";
  canvas.style.visibility = useGpu ? "hidden" : "visible";
  element<HTMLElement>("stats").style.display = boundsControl.checked
    ? "block"
    : "none";
  groundCtx.clearRect(0, 0, width, height);
  overlayCtx.clearRect(0, 0, width, height);
  groundCtx.fillStyle = "#17241b";
  groundCtx.fillRect(0, 0, width, height);
  groundCtx.fillStyle = "#293d2d";
  groundCtx.fillRect(originX, originY, map.width * zoom, map.height * zoom);
  groundCtx.strokeStyle = "#ffffff20";
  groundCtx.lineWidth = 1;
  const grid = zoom;
  groundCtx.beginPath();
  for (
    let x = originX + Math.max(0, Math.ceil(-originX / grid)) * grid;
    x <= Math.min(width, originX + map.width * grid);
    x += grid
  ) {
    groundCtx.moveTo(x, Math.max(0, originY));
    groundCtx.lineTo(x, Math.min(height, originY + map.height * grid));
  }
  for (
    let y = originY + Math.max(0, Math.ceil(-originY / grid)) * grid;
    y <= Math.min(height, originY + map.height * grid);
    y += grid
  ) {
    groundCtx.moveTo(Math.max(0, originX), y);
    groundCtx.lineTo(Math.min(width, originX + map.width * grid), y);
  }
  groundCtx.stroke();
  count = 0;
  let visible = 0,
    markerCount = 0;
  const columns = Math.ceil(Math.sqrt(total));
  for (const id of presentations.keys())
    if (id >= total) presentations.delete(id);
  const spacingX = 1;
  const spacingY = spacingX;
  const rows = Math.ceil(total / columns);
  const selectedId = Math.min(
    total - 1,
    Math.floor(rows / 2) * columns + Math.floor(columns / 2),
  );
  const actorSlots = new Map(NAMES.map((name) => [name, currentSlots(name)]));
  for (let formation = 0; formation < total; formation++) {
    const placement = battle
      ? battlePreviewPlacement(formation)
      : {
          x: ((formation % columns) - Math.floor(columns / 2)) * spacingX,
          y:
            (Math.floor(formation / columns) - Math.floor(rows / 2)) * spacingY,
          enemy: false,
        };
    const facing = battle && !placement.enemy ? Math.PI : 0;
    const direction = facing === Math.PI ? -1 : 1;
    const x =
      (placement.x +
        Math.floor(map.width / 2) +
        0.5 -
        map.width / 2 -
        cameraX) *
        zoom +
      width / 2;
    const y =
      (placement.y +
        Math.floor(map.height / 2) +
        0.5 -
        map.height / 2 -
        cameraY) *
        zoom +
      usableHeight / 2;
    const name =
      actorControl.value === "mixed"
        ? NAMES[formation % 3]
        : (actorControl.value as ActorName);
    const kind: SquadType =
      name === "Clubman"
        ? "infantry"
        : name === "Javelinist"
          ? "archer"
          : "cavalry";
    const symbol = squadSymbol(zoom, troops, true, kind);
    const offsets = actorSlots.get(name)!;
    const actorTotal = offsets.length;
    const desired = Math.max(
      0,
      liveSlotCount(actorTotal, Number(strengthControl.value)) -
        queuedLosses.get(name)!,
    );
    const actorSize = name === "MountedSpearman" ? horseSize : 1;
    const artRadius =
      Math.max(
        ...offsets.map(
          (offset) =>
            Math.hypot(offset.x, offset.y) +
            offset.scale * actorSize * actorArtRadius.get(name)!,
        ),
      ) * formationExtent;
    const radius = Math.max(
      squadViewRadius(zoom, troops, formation === selectedId),
      detailed ? artRadius : 0,
    );
    if (!formationVisible(x, y, radius, width, height)) continue;
    visible++;
    let presentation = presentations.get(formation);
    if (
      !presentation ||
      presentation.name !== name ||
      presentation.capacity !== actorTotal
    ) {
      presentation = {
        name,
        capacity: actorTotal,
        revision: layoutRevision,
        motion: new TroopChoreography(offsets, formation, elapsed),
      };
      presentations.set(formation, presentation);
    }
    if (presentation.revision !== layoutRevision) {
      presentation.motion.reshape(offsets, elapsed);
      presentation.revision = layoutRevision;
    }
    presentation.motion.advance(elapsed, desired);
    const live = presentation.motion.count;
    if (!detailed) {
      if (live === 0) continue;
      const frame = markers.get(kind, "#d6bc7f");
      if (frame) {
        groundCtx.save();
        groundCtx.translate(x, y);
        groundCtx.rotate(Math.PI + facing);
        groundCtx.drawImage(
          frame.source,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          -symbol.width * frame.pivotX,
          -symbol.height * frame.pivotY,
          symbol.width,
          symbol.height,
        );
        groundCtx.restore();
      }
      markerCount++;
      continue;
    }
    // Independent cosmetic tracks; squad simulation and network state are untouched.
    for (const offset of presentation.motion.dead(elapsed)) {
      const age = offset.age;
      emit(
        name,
        "death",
        age,
        x + direction * offset.x * formationExtent,
        y + direction * offset.y * formationExtent,
        formationExtent * offset.scale * actorSize,
        Math.max(0, Math.min(1, (2600 - age) / 700)),
        (offset.angle ?? 0) + facing,
      );
    }
    for (const offset of presentation.motion.soldiers(elapsed)) {
      const front = offset.front;
      const clip: ClipName = offset.moving
        ? "running"
        : actionControl.value === "charge"
          ? chargeUntil - elapsed > 1500
            ? "running"
            : front
              ? "attack"
              : "idle"
          : actionControl.value === "attack"
            ? front
              ? "attack"
              : "idle"
            : (actionControl.value as ClipName);
      const asset = loaded.get(`${name}:${clip}`)!;
      const duration =
        asset.clip.durations?.reduce((a, b) => a + b, 0) ??
        (asset.clip.frameCount * 1000) / (asset.clip.fps ?? 6);
      const time =
        clip === "attack"
          ? (elapsed + formation * 73) % duration
          : elapsed + formation * 73;
      emit(
        name,
        clip,
        time,
        x + direction * offset.x * formationExtent,
        y + direction * offset.y * formationExtent,
        formationExtent * offset.scale * actorSize,
        1,
        (offset.angle ?? 0) + facing,
      );
    }
    if (formation === selectedId && boundsControl.checked) {
      groundCtx.strokeStyle = "#e4cb86";
      groundCtx.lineWidth = 1.5;
      groundCtx.beginPath();
      groundCtx.arc(
        x,
        y,
        proposed ? spriteSize * 0.35 + 1 : symbol.underlayRadius,
        0,
        Math.PI * 2,
      );
      groundCtx.stroke();
      if (boundsControl.checked) {
        overlayCtx.setLineDash([4, 3]);
        overlayCtx.strokeStyle = "#82c7ee";
        overlayCtx.beginPath();
        overlayCtx.arc(
          x,
          y,
          (squadRadius(kind) / FIXED) * zoom,
          0,
          Math.PI * 2,
        );
        overlayCtx.stroke();
        overlayCtx.strokeStyle = "#d7dcca80";
        overlayCtx.strokeRect(
          x - formationExtent / 2,
          y - formationExtent / 2,
          formationExtent,
          formationExtent,
        );
        overlayCtx.setLineDash([]);
      }
      overlayCtx.fillStyle = "#ede4c5";
      overlayCtx.font = "12px system-ui";
      overlayCtx.textAlign = "center";
      overlayCtx.fillText(
        `${name === "MountedSpearman" ? "Mounted Spearman" : name} · ${effectiveShape(name)} · ${live}/${actorTotal}`,
        x,
        y - formationExtent / 2 - 8,
      );
      const barY = y + spriteSize / 2 + 3;
      const barWidth = spriteSize * 0.72;
      overlayCtx.fillStyle = "#112018";
      overlayCtx.fillRect(x - barWidth / 2, barY, barWidth, 3);
      overlayCtx.fillStyle = "#cfb777";
      overlayCtx.fillRect(
        x - barWidth / 2,
        barY,
        (barWidth * troops) / 1000,
        3,
      );
    }
  }
  if (
    element<HTMLInputElement>("playCasualties").checked &&
    presentations.size &&
    [...presentations.values()].every((p) => p.motion.count === 0)
  ) {
    if (!demoRestoreAt) demoRestoreAt = elapsed + 3000;
    if (elapsed >= demoRestoreAt) {
      resetCasualties();
      setStrength();
      nextDemoDeath = elapsed + 2500;
    }
  } else demoRestoreAt = 0;
  const preparedAt = performance.now();
  if (Number(insetControl.value) > 0) {
    overlayCtx.fillStyle = "#101a16ed";
    overlayCtx.fillRect(0, usableHeight, width, height - usableHeight);
    overlayCtx.fillStyle = "#c5d0c2";
    overlayCtx.font = "12px system-ui";
    overlayCtx.textAlign = "center";
    overlayCtx.fillText(
      `Game HUD reserved area · ${insetControl.value} px`,
      width / 2,
      usableHeight + 22,
    );
  }
  if (useGpu) gpu.draw(instances, count, width, height);
  else drawCanvas();
  const end = performance.now();
  if (dt > 0 && dt < 500) {
    frameSamples.push(dt);
    cpuSamples.push(end - start);
    preparationSamples.push(preparedAt - start);
    if (frameSamples.length > 240) {
      frameSamples.shift();
      cpuSamples.shift();
      preparationSamples.shift();
    }
  }
  if (now - reportAt > 300) {
    reportAt = now;
    stats = {
      renderer: useGpu ? "WebGL2" : "Canvas2D",
      webglAvailable: gpu.available,
      detailed,
      formations: total,
      scene: sceneControl.value,
      visibleFormations: visible,
      soldiersPerFormation: n,
      mountedSoldiersPerFormation: actorCount("MountedSpearman"),
      liveSlots: live,
      instances: count,
      markerCount,
      drawCalls: useGpu ? gpu.drawCalls : count,
      frameMs: average(frameSamples),
      p95FrameMs: percentile95(frameSamples),
      cpuMs: average(cpuSamples),
      preparationMs: average(preparationSamples),
      atlasBytes: pages.length * 384 * 256 * 4,
      samples: frameSamples.length,
      zoom,
      mapWidth: map.width,
      mapHeight: map.height,
      fitScale: fitScale(),
      maxScale: MAX_MAP_SCALE,
      spriteSize,
      formation: effectiveShape(
        actorControl.value === "MountedSpearman"
          ? "MountedSpearman"
          : "Clubman",
      ),
      selectedFormation: activeShape,
      charging: chargeUntil > elapsed,
      footprint: footprintControl.value,
      horseSize,
      formationExtent,
      troops,
      spacingTiles: spacingX,
      viewportWidth: width,
      viewportHeight: height,
      error: gpu.error,
    };
    element<HTMLElement>("stats").textContent =
      `${stats.renderer} · ${detailed ? "individual soldiers" : "formation icons"}\n` +
      `${chargeUntil > elapsed ? "Charge · wedge" : actorControl.value === "MountedSpearman" ? "line" : activeShape} · ${proposed ? "one-tile world size" : "smaller world size"} · horses ${horseSize.toFixed(2)}×\n` +
      `Tile ${zoom.toFixed(2)} px · map ${map.width}×${map.height} tiles\n` +
      `Formation ${spriteSize.toFixed(1)} px · art frame ${formationExtent.toFixed(1)} px\n` +
      `Visible span ${(width / zoom).toFixed(1)}×${(usableHeight / zoom).toFixed(1)} tiles\n` +
      `${visible} / ${total} formations visible · ${count.toLocaleString()} soldier sprites\n` +
      `${stats.drawCalls} soldier draw calls · ${(1000 / Math.max(1, Number(stats.frameMs))).toFixed(0)} FPS\n` +
      `Frame ${Number(stats.frameMs).toFixed(2)} ms · p95 ${Number(stats.p95FrameMs).toFixed(2)} ms\n` +
      `CPU ${Number(stats.cpuMs).toFixed(2)} ms · prepare ${Number(stats.preparationMs).toFixed(2)} ms\n` +
      `Atlas ${(Number(stats.atlasBytes) / 1048576).toFixed(1)} MiB · ${stats.samples} samples`;
    element<HTMLOutputElement>("zoomValue").value =
      `${zoom.toFixed(2)} px / tile`;
    element<HTMLElement>("status").textContent =
      gpu.error ||
      (useGpu
        ? "12 actor atlas pages loaded. Shared geometry; one instanced soldier draw per frame."
        : "12 actor atlas pages loaded. Canvas comparison uses the same soldier positions and frames.");
  }
  requestAnimationFrame(render);
}
// Read-only diagnostics make browser verification reproducible.
element<HTMLButtonElement>("compare").onclick = async () => {
  const output = element<HTMLElement>("comparison");
  if (!gpu.available || !loaded.size) {
    output.textContent =
      "Comparison needs a working WebGL2 context and loaded actors.";
    return;
  }
  sceneControl.value = "grid";
  formationsControl.disabled = false;
  element<HTMLInputElement>("playCasualties").checked = false;
  element<HTMLInputElement>("tour").checked = false;
  chargeUntil = 0;
  actionControl.value = regularAction;
  layoutRevision++;
  formationsControl.value = "1000";
  soldiersControl.value = "24";
  zoomControl.value = String(clampMapScale(6, fitScale()));
  detailControl.checked = true;
  cameraX = cameraY = 0;
  drag = undefined;
  resetCasualties();
  setStrength();
  const controls = [
    ...document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >("aside input, aside select, aside button"),
  ];
  controls.forEach((control) => {
    control.disabled = true;
  });
  const results: {
    renderer: string;
    instances: number;
    cpu: number;
    prepare: number;
    frame: number;
    p95: number;
    samples: number;
  }[] = [];
  const delay = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  try {
    for (const mode of ["webgl", "canvas"] as const) {
      benchmarkRenderer = mode;
      output.textContent = `Measuring ${mode === "webgl" ? "WebGL2" : "Canvas"}… camera and controls locked for equal scenes.`;
      await delay(600);
      resetSamples();
      await delay(2600);
      if (!gpu.available || document.hidden)
        throw new Error(
          "Comparison interrupted by context loss or hidden tab; rerun in foreground.",
        );
      results.push({
        renderer: mode,
        instances: count,
        cpu: average(cpuSamples),
        prepare: average(preparationSamples),
        frame: average(frameSamples),
        p95: percentile95(frameSamples),
        samples: frameSamples.length,
      });
    }
    if (results[0].instances !== results[1].instances)
      throw new Error(
        "Viewport changed during comparison; rerun at a fixed size.",
      );
    output.textContent =
      `${results[0].instances.toLocaleString()} sprites in each scene. ` +
      results
        .map(
          (result) =>
            `${result.renderer === "webgl" ? "WebGL2" : "Canvas"}: CPU ${result.cpu.toFixed(2)} ms (prepare ${result.prepare.toFixed(2)}), frame ${result.frame.toFixed(2)} ms, p95 ${result.p95.toFixed(2)} ms, ${result.samples} samples.`,
        )
        .join(" ");
  } catch (error) {
    output.textContent = String(error);
  } finally {
    benchmarkRenderer = undefined;
    controls.forEach((control) => {
      control.disabled = false;
    });
    syncFormationControl();
    resetSamples();
  }
};
Object.defineProperty(window, "troopPrototypeStats", {
  get: () => ({ ...stats }),
});
document.addEventListener("visibilitychange", () => {
  previousNow = performance.now();
  resetSamples();
});
window.addEventListener("pagehide", () => {
  stopped = true;
  gpu.dispose();
});
loadActors()
  .then(() => {
    resize();
    previousNow = performance.now();
    requestAnimationFrame(render);
  })
  .catch((error) => {
    element<HTMLElement>("status").textContent = String(error);
    element<HTMLElement>("stats").textContent =
      "Actor loading failed. See status.";
  });
