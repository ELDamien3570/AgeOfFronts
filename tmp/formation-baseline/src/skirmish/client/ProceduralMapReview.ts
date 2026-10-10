import type { BlackForestMap } from "../BlackForestMap";
import type { Deposit } from "../domain/Definitions";
import { generateDeposits } from "../domain/DepositGeneration";
import type { MigrationMap } from "../MigrationMap";
import { generateProceduralMap } from "../ProceduralMaps";
import { terrainSpeed } from "../Terrain";
import { bakeGroundColors } from "./GroundBake";
import { GroundLayer } from "./GroundLayer";
import { migrationHeightView } from "./MigrationHeightView";
import { PaintedTerrain } from "./PaintedTerrain";
import {
  drawResourceDeposits,
  resourceLegend,
  resourceOptions,
} from "./ProceduralResourceView";
import { bakeTerrainFields } from "./TerrainFields";
const theme = document.body.dataset.theme ?? "black-forest";

const canvas = document.querySelector<HTMLCanvasElement>("#map")!,
  ctx = canvas.getContext("2d")!,
  seedInput = document.querySelector<HTMLInputElement>("#seed")!,
  sizeInput = document.querySelector<HTMLSelectElement>("#size")!,
  status = document.querySelector<HTMLElement>("#status")!,
  hover = document.querySelector<HTMLElement>("#hover")!,
  play = document.querySelector<HTMLAnchorElement>("#play")!;
const groundLayer = new GroundLayer(canvas),
  groundCanvas =
    canvas.parentElement!.querySelector<HTMLCanvasElement>(".ground-layer");
let loaded: BlackForestMap | MigrationMap,
  ground: PaintedTerrain,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  paths = false,
  width = 1,
  height = 1,
  dirty = true,
  gpuActive = false,
  generation = 0,
  showHeights = false,
  showLandforms = false,
  heightView: HTMLCanvasElement | undefined,
  drag: { x: number; y: number } | undefined;
let deposits: Deposit[] = [],
  showResources = new URLSearchParams(location.search).has("resources");
const resourceSelect =
    document.querySelector<HTMLSelectElement>("#resource-filter")!,
  resourceButton = document.querySelector<HTMLButtonElement>("#resources")!;
resourceSelect.innerHTML = resourceOptions();
const resourcePanel = document.querySelector<HTMLElement>("#resource-panel")!;
resourcePanel.hidden = !showResources;
resourceButton.setAttribute("aria-pressed", String(showResources));
resourceButton.addEventListener("click", () => {
  showResources = !showResources;
  resourcePanel.hidden = !showResources;
  resourceButton.setAttribute("aria-pressed", String(showResources));
  dirty = true;
});
resourceSelect.addEventListener("change", () => {
  showResources = true;
  resourcePanel.hidden = false;
  resourceButton.setAttribute("aria-pressed", "true");
  dirty = true;
});

function overview() {
  if (!loaded) return;
  scale = Math.min(width - 54, height - 54) / loaded.map.width();
  offsetX = (width - loaded.map.width() * scale) / 2;
  offsetY = (height - loaded.map.width() * scale) / 2;
  dirty = true;
}
function detail() {
  if (!loaded) return;
  const clearing =
    "clearings" in loaded.layout
      ? loaded.layout.clearings[Math.floor(loaded.layout.clearings.length / 2)]
      : loaded.layout.mainland;
  scale = Math.min(width, height) / 68;
  offsetX = width / 2 - clearing.x * scale;
  offsetY = height / 2 - clearing.y * scale;
  dirty = true;
}
function resize() {
  const bounds = canvas.getBoundingClientRect(),
    ratio = devicePixelRatio || 1;
  width = bounds.width;
  height = bounds.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  groundLayer.resize(width, height, ratio);
  overview();
}
async function generate() {
  if (!seedInput.reportValidity()) return;
  const request = ++generation,
    seed = Number(seedInput.value),
    size = Number(sizeInput.value);
  status.textContent = "Generating terrain…";
  delete status.dataset.error;
  delete canvas.dataset.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const started = performance.now(),
      next = generateProceduralMap(theme, size, seed)!;
    if (request !== generation) return;
    loaded = next;
    deposits = generateDeposits(next.map, seed);
    document.querySelector("#resource-legend")!.innerHTML =
      resourceLegend(deposits);
    canvas.dataset.deposits = String(deposits.length);
    heightView = undefined;
    ground = new PaintedTerrain(next.map, undefined, next.environment, () => {
      dirty = true;
    });
    if (groundLayer.supported) {
      const source = ground.groundColorSource(),
        fields = ground.groundFieldInputs(source);
      groundLayer.setMap({
        width: source.width,
        height: source.height,
        colors: bakeGroundColors(source),
        fields: bakeTerrainFields(fields),
        hasDepth: !!fields.elevation,
      });
    }
    let woodland = 0,
      land = 0,
      slowest = 56;
    for (let tile = 0; tile < next.terrain.length; tile++)
      if (next.map.isLand(tile)) {
        land++;
        woodland += Number(next.forest!.cover[tile] >= 140);
        if (!next.map.isImpassable(tile))
          slowest = Math.min(slowest, terrainSpeed(next.map, tile));
      }
    document.querySelector("#forest-share")!.textContent =
      `${Math.round((woodland / land) * 100)}%`;
    document.querySelector("#glade-count")!.textContent = String(
      "clearings" in next.layout
        ? next.layout.clearings.length
        : next.layout.islands.length,
    );
    document.querySelector("#forest-speed")!.textContent =
      `${Math.round((slowest / 56) * 100)}% of open ground`;
    document.querySelector("#pond-count")!.textContent =
      "ponds" in next
        ? `${next.ponds.length} / ${next.layout.clearings.length}`
        : `${next.layout.mainlands.length} mainland${next.layout.mainlands.length === 1 ? "" : "s"} · ${next.layout.rivers.filter((river) => river.kind === "river").length} rivers`;
    const topography = document.querySelector("#topography");
    if (topography) {
      let peak = 0,
        mountains = 0;
      for (let tile = 0; tile < next.terrain.length; tile++)
        if (next.map.isLand(tile)) {
          peak = Math.max(peak, next.elevation!.values[tile]);
          mountains += Number(next.map.isImpassable(tile));
        }
      topography.textContent = `${Math.round(peak)} m peak · ${Math.round((mountains / land) * 1000) / 10}% mountains`;
    }
    const regions = document.querySelector("#landform-count");
    if (regions && "landforms" in next.layout)
      regions.textContent = `${next.layout.landforms.filter((f) => f.kind === "range").length} ranges · ${next.layout.landforms.filter((f) => f.kind === "plateau").length} plateaus · ${next.layout.landforms.filter((f) => f.kind === "basin").length} basins`;
    const parameters = new URLSearchParams({
      map: theme,
      seed: String(seed),
      size: String(size),
    });
    play.href = `/skirmish/index.html?${parameters}`;
    history.replaceState(
      null,
      "",
      `?seed=${seed}&size=${size}${showResources ? "&resources=all" : ""}`,
    );
    status.textContent = `${size} × ${size} · Seed ${seed}`;
    canvas.dataset.ready = String(seed);
    canvas.dataset.size = String(size);
    if ("pondMode" in next.generation)
      canvas.dataset.pondMode = next.generation.pondMode;
    canvas.dataset.generationMs = String(
      Math.round(performance.now() - started),
    );
    overview();
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : "Map generation failed";
    status.dataset.error = "true";
  }
}

document
  .querySelector("#generation-controls")!
  .addEventListener("submit", (event) => {
    event.preventDefault();
    void generate();
  });
document.querySelector("#reroll")!.addEventListener("click", () => {
  seedInput.value = String(
    crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff,
  );
  void generate();
});
document.querySelector("#overview")!.addEventListener("click", overview);
document.querySelector("#detail")!.addEventListener("click", detail);
document.querySelector("#heights")?.addEventListener("click", (event) => {
  showHeights = !showHeights;
  (event.currentTarget as HTMLElement).setAttribute(
    "aria-pressed",
    String(showHeights),
  );
  dirty = true;
});
document.querySelector("#landforms")?.addEventListener("click", (event) => {
  showLandforms = !showLandforms;
  (event.currentTarget as HTMLElement).setAttribute(
    "aria-pressed",
    String(showLandforms),
  );
  dirty = true;
});
document.querySelector("#routes")!.addEventListener("click", (event) => {
  paths = !paths;
  (event.currentTarget as HTMLElement).setAttribute(
    "aria-pressed",
    String(paths),
  );
  dirty = true;
});
document.querySelector("#save")!.addEventListener("click", () => {
  if (!loaded) return;
  const anchor = document.createElement("a");
  anchor.download = `${theme}-${loaded.map.width()}-seed-${loaded.generation.seed}.png`;
  anchor.href = proceduralMapImage();
  anchor.click();
});

/** Export the whole map and selected resources, independently of viewport and relief overlays. */
export function proceduralMapImage(): string {
  if (!loaded || !ground) throw new Error("Generate a map before exporting");
  const exported = document.createElement("canvas"),
    pixels = Math.min(2000, Math.max(750, loaded.map.width() * 2));
  exported.width = pixels;
  exported.height = pixels;
  const exportContext = exported.getContext("2d")!,
    exportScale = pixels / loaded.map.width(),
    modern = groundLayer.ready && !!groundCanvas;
  ground.setDecorationsOnly(modern);
  try {
    if (modern) {
      // Copy immediately after drawing: the game's GL layer does not retain
      // its drawing buffer. Reuse its context rather than allocating one per export.
      groundLayer.resize(pixels, pixels, 1);
      groundLayer.draw(exportScale, 0, 0, performance.now());
      exportContext.drawImage(groundCanvas!, 0, 0);
    }
    ground.draw(exportContext, exportScale, 0, 0, pixels, pixels);
    if (showResources)
      drawResourceDeposits(
        exportContext,
        loaded.map,
        deposits,
        resourceSelect.value,
        exportScale,
        0,
        0,
        pixels,
        pixels,
      );
    return exported.toDataURL("image/png");
  } finally {
    if (modern) {
      groundLayer.resize(width, height, devicePixelRatio || 1);
      groundLayer.draw(scale, offsetX, offsetY, performance.now());
    }
    dirty = true;
  }
}
canvas.addEventListener("pointerdown", (event) => {
  drag = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", () => {
  drag = undefined;
});
canvas.addEventListener("pointercancel", () => {
  drag = undefined;
});
canvas.addEventListener("pointermove", (event) => {
  if (!loaded) return;
  if (drag) {
    offsetX += event.clientX - drag.x;
    offsetY += event.clientY - drag.y;
    drag = { x: event.clientX, y: event.clientY };
    dirty = true;
  }
  const bounds = canvas.getBoundingClientRect(),
    x = Math.floor((event.clientX - bounds.left - offsetX) / scale),
    y = Math.floor((event.clientY - bounds.top - offsetY) / scale);
  if (!loaded.map.isValidCoord(x, y)) {
    hover.textContent = "Drag to pan · Scroll to zoom";
    return;
  }
  const tile = loaded.map.ref(x, y),
    cover = loaded.forest!.cover[tile];
  hover.textContent = loaded.map.isWater(tile)
    ? theme === "migration"
      ? loaded.elevation!.values[tile] > 0
        ? "River"
        : "Open sea"
      : "Woodland pond"
    : loaded.map.isImpassable(tile)
      ? "Impassable mountain ridge"
      : `${cover > 140 ? "Dense woodland" : cover > 30 ? "Forest edge" : "Open ground"} · ${Math.round((terrainSpeed(loaded.map, tile) / 56) * 100)}% movement speed`;
  if (theme === "migration")
    hover.textContent += ` · ${Math.round(loaded.elevation!.values[tile])} m elevation`;
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (!loaded) return;
    const bounds = canvas.getBoundingClientRect(),
      x = event.clientX - bounds.left,
      y = event.clientY - bounds.top,
      next = Math.max(
        (Math.min(width, height) / loaded.map.width()) * 0.5,
        Math.min(32, scale * Math.exp(-event.deltaY * 0.0015)),
      ),
      ratio = next / scale;
    offsetX = x - (x - offsetX) * ratio;
    offsetY = y - (y - offsetY) * ratio;
    scale = next;
    dirty = true;
  },
  { passive: false },
);
new ResizeObserver(resize).observe(canvas);
resize();

function frame(now: number) {
  if (ground && loaded) {
    const modern = groundLayer.ready;
    if (modern !== gpuActive) dirty = true;
    gpuActive = modern;
    ground.setDecorationsOnly(modern);
    groundLayer.setVisible(modern);
    canvas.dataset.renderer = modern ? "webgl" : "classic";
    if (modern) groundLayer.draw(scale, offsetX, offsetY, now);
  }
  if (ground && loaded && dirty) {
    ctx.clearRect(0, 0, width, height);
    if (!gpuActive) {
      ctx.fillStyle = "#111a14";
      ctx.fillRect(0, 0, width, height);
    }
    dirty = false;
    ground.draw(ctx, scale, offsetX, offsetY, width, height);
    if (showHeights && "mainlands" in loaded.layout) {
      heightView ??= migrationHeightView(loaded as MigrationMap);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        heightView,
        offsetX,
        offsetY,
        loaded.map.width() * scale,
        loaded.map.height() * scale,
      );
    }
    if (showLandforms && "landforms" in loaded.layout) {
      ctx.save();
      ctx.font = "12px system-ui";
      ctx.lineWidth = 2;
      for (const feature of loaded.layout.landforms) {
        ctx.strokeStyle =
          feature.kind === "range" || feature.kind === "massif"
            ? "#f4b97b"
            : "#dfefb2";
        ctx.fillStyle = ctx.strokeStyle;
        const points = feature.points.map((p) => ({
          x: p.x * loaded.map.width() * scale + offsetX,
          y: p.y * loaded.map.height() * scale + offsetY,
        }));
        ctx.beginPath();
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        const anchor = points[Math.floor(points.length / 2)];
        ctx.fillText(feature.kind, anchor.x + 5, anchor.y - 5);
      }
      ctx.restore();
    }
    if (paths && "passages" in loaded.layout) {
      ctx.strokeStyle = "#e4d9acb0";
      ctx.lineWidth = 1.5;
      for (const passage of loaded.layout.passages) {
        ctx.beginPath();
        passage.points.forEach((point, index) => {
          const x = point.x * scale + offsetX,
            y = point.y * scale + offsetY;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
    }
    if (showResources)
      drawResourceDeposits(
        ctx,
        loaded.map,
        deposits,
        resourceSelect.value,
        scale,
        offsetX,
        offsetY,
        width,
        height,
      );
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const query = new URLSearchParams(location.search);
if (query.has("seed")) seedInput.value = query.get("seed")!;
if (["250", "500", "1000"].includes(query.get("size") ?? ""))
  sizeInput.value = query.get("size")!;
void generate();
