import { generateBlackForest, type BlackForestMap } from "../BlackForestMap";
import { terrainSpeed } from "../Terrain";
import { PaintedTerrain } from "./PaintedTerrain";

const canvas = document.querySelector<HTMLCanvasElement>("#map")!,
  ctx = canvas.getContext("2d")!,
  seedInput = document.querySelector<HTMLInputElement>("#seed")!,
  sizeInput = document.querySelector<HTMLSelectElement>("#size")!,
  status = document.querySelector<HTMLElement>("#status")!,
  hover = document.querySelector<HTMLElement>("#hover")!,
  play = document.querySelector<HTMLAnchorElement>("#play")!;
let loaded: BlackForestMap,
  ground: PaintedTerrain,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  paths = false,
  width = 1,
  height = 1,
  dirty = true,
  generation = 0,
  drag: { x: number; y: number } | undefined;

function overview() {
  if (!loaded) return;
  scale = Math.min(width - 54, height - 54) / loaded.layout.size;
  offsetX = (width - loaded.layout.size * scale) / 2;
  offsetY = (height - loaded.layout.size * scale) / 2;
  dirty = true;
}
function detail() {
  if (!loaded) return;
  const clearing =
    loaded.layout.clearings[Math.floor(loaded.layout.clearings.length / 2)];
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
  overview();
}
async function generate() {
  if (!seedInput.reportValidity()) return;
  const request = ++generation,
    seed = Number(seedInput.value),
    size = Number(sizeInput.value);
  status.textContent = "Generating woodland…";
  delete status.dataset.error;
  delete canvas.dataset.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    const started = performance.now(),
      next = generateBlackForest(size, seed);
    if (request !== generation) return;
    loaded = next;
    ground = new PaintedTerrain(next.map, undefined, next.environment, () => {
      dirty = true;
    });
    let woodland = 0,
      land = 0,
      slowest = 56;
    for (let tile = 0; tile < next.terrain.length; tile++)
      if (next.map.isLand(tile)) {
        land++;
        woodland += Number(next.forest!.cover[tile] >= 140);
        slowest = Math.min(slowest, terrainSpeed(next.map, tile));
      }
    document.querySelector("#forest-share")!.textContent =
      `${Math.round((woodland / land) * 100)}%`;
    document.querySelector("#glade-count")!.textContent = String(
      next.layout.clearings.length,
    );
    document.querySelector("#forest-speed")!.textContent =
      `${Math.round((slowest / 56) * 100)}% of open ground`;
    const parameters = new URLSearchParams({
      map: "black-forest",
      seed: String(seed),
      size: String(size),
    });
    play.href = `/skirmish/index.html?${parameters}`;
    history.replaceState(null, "", `?seed=${seed}&size=${size}`);
    status.textContent = `${size} × ${size} · Seed ${seed}`;
    canvas.dataset.ready = String(seed);
    canvas.dataset.size = String(size);
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
  anchor.download = `Black-Forest-${loaded.layout.size}-seed-${loaded.layout.seed}.png`;
  anchor.href = blackForestMapImage();
  anchor.click();
});

/** Export the generated map, independently of viewport, pan, or inspection overlays. */
export function blackForestMapImage(): string {
  if (!loaded || !ground) throw new Error("Generate a map before exporting");
  const exported = document.createElement("canvas"),
    pixels = Math.min(2000, Math.max(750, loaded.layout.size * 2));
  exported.width = pixels;
  exported.height = pixels;
  ground.draw(
    exported.getContext("2d")!,
    pixels / loaded.layout.size,
    0,
    0,
    pixels,
    pixels,
  );
  return exported.toDataURL("image/png");
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
    ? "Woodland pond"
    : `${cover > 140 ? "Dense woodland" : cover > 30 ? "Forest edge" : "Open ground"} · ${Math.round((terrainSpeed(loaded.map, tile) / 56) * 100)}% movement speed`;
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
        (Math.min(width, height) / loaded.layout.size) * 0.5,
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

function frame() {
  if (ground && loaded && dirty) {
    ctx.fillStyle = "#111a14";
    ctx.fillRect(0, 0, width, height);
    dirty = false;
    ground.draw(ctx, scale, offsetX, offsetY, width, height);
    if (paths) {
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
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const query = new URLSearchParams(location.search);
if (query.has("seed")) seedInput.value = query.get("seed")!;
if (["250", "500", "1000"].includes(query.get("size") ?? ""))
  sizeInput.value = query.get("size")!;
void generate();
