import {
  FormationArtwork,
  type FormationType,
} from "../../../src/skirmish/client/FormationArtwork";
import {
  drawFormationMarker,
  formationMarkerLayout,
  formationSymbolLight,
} from "../../../src/skirmish/client/FormationMarker";
import {
  formationRenderPose,
  strategicFormationBox,
} from "../../../src/skirmish/client/FormationRenderPose";
import { StrategicSprites } from "../../../src/skirmish/client/StrategicSprites";
import { createFormation } from "../../../src/skirmish/domain/FormationGeometry";
import { FIXED, type Squad } from "../../../src/skirmish/Protocol";

const artwork = new FormationArtwork();
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => element<HTMLInputElement>(id);
const canvas = (id: string) => element<HTMLCanvasElement>(id);
const gpu = new StrategicSprites(canvas("canvas-gpu"));
const gpuSurface =
  document.querySelector<HTMLCanvasElement>(".strategic-sprites");
const contextControl = gpuSurface
  ?.getContext("webgl2")
  ?.getExtension("WEBGL_lose_context");
let recovering = false;

function squad(
  troops: number,
  shape: NonNullable<Squad["formation"]>["shape"],
  angle: number,
  kind: FormationType,
): Squad {
  const definitionId =
    kind === "cavalry"
      ? "stoneage-lightcavalry"
      : kind === "archer"
        ? "stoneage-archer"
        : kind === "siege"
          ? "stoneage-siege"
          : "stoneage-frontline";
  return {
    id: 1,
    playerId: 1,
    kind: kind === "siege" ? "archer" : (kind as Squad["kind"]),
    definitionId,
    troops,
    x: 5 * FIXED,
    y: 5 * FIXED,
    xp: 0,
    fighting: false,
    combatTargetId: null,
    order: { type: "hold" },
    embarkedOn: null,
    lastCombatTick: 0,
    moved: false,
    firingCharge: 0,
    queuedOrders: [],
    path: [],
    nextPathIndex: 0,
    plannedTile: 0,
    lastPlanTick: 0,
    manpower: {
      model: "soldiers",
      capacity: troops,
      hp: troops * 100,
      wounds: 0,
      variant: "base",
      revision: 1,
      replenishRemainder: 0,
    },
    formation: {
      ...createFormation(definitionId),
      shape,
      facing: Math.round((angle / 360) * 65536) % 65536,
      mode: "deployed",
    },
  };
}

function prepare(id: string, scale: number) {
  const target = canvas(id),
    width = target.clientWidth,
    height = target.clientHeight;
  const ratio = window.devicePixelRatio;
  target.width = Math.round(width * ratio);
  target.height = Math.round(height * ratio);
  const ctx = target.getContext("2d")!;
  ctx.scale(ratio, ratio);
  ctx.fillStyle = "#14221e";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ffffff09";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const spacing = Math.max(8, scale);
  for (let x = 0; x < width; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y < height; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  return { ctx, width, height, ratio };
}

function footprint(
  ctx: CanvasRenderingContext2D,
  pose: ReturnType<typeof formationRenderPose>,
  scale: number,
) {
  ctx.save();
  ctx.strokeStyle = "#f9bc6eaa";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const poly of pose.footprints) {
    ctx.beginPath();
    poly.forEach((p, i) =>
      i
        ? ctx.lineTo(p.x * scale, p.y * scale)
        : ctx.moveTo(p.x * scale, p.y * scale),
    );
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawNew(
  ctx: CanvasRenderingContext2D,
  s: Squad,
  scale: number,
  center: { x: number; y: number },
  kind: FormationType,
  color: string,
  light: boolean,
  selected: boolean,
) {
  const pose = formationRenderPose(s, 0, {
    x: center.x / scale,
    y: center.y / scale,
  });
  const box = strategicFormationBox(pose, scale),
    symbol = artwork.getSymbol(kind, light);
  const point = { x: box.x * scale, y: box.y * scale };
  const layout = formationMarkerLayout(box.width, box.height, symbol);
  drawFormationMarker(
    ctx,
    box,
    point,
    color,
    light ? "#ffffff" : "#000000",
    layout,
    symbol,
    1,
    selected ? "#c4ff36" : undefined,
  );
  footprint(ctx, pose, scale);
  return { pose, box, point, layout };
}

function render() {
  const troops = Number(input("troops").value),
    scale = Number(input("zoom").value),
    angle = Number(input("angle").value);
  const shape = element<HTMLSelectElement>("shape").value as NonNullable<
    Squad["formation"]
  >["shape"];
  const kind = element<HTMLSelectElement>("kind").value as FormationType;
  const color = input("color").value,
    rgb = [1, 3, 5].map((offset) =>
      parseInt(color.slice(offset, offset + 2), 16),
    );
  const light = formationSymbolLight(rgb),
    selected = input("selected").checked;
  const s = squad(troops, shape, angle, kind);
  element("troops-val").textContent = String(troops);
  element("zoom-val").textContent = `${scale} px/tile`;
  element("angle-val").textContent = `${angle}°`;
  const old = prepare("canvas-current", scale);
  const oldPose = formationRenderPose(s, 0, {
    x: old.width / 2 / scale,
    y: old.height / 2 / scale,
  });
  const actual = strategicFormationBox(oldPose, scale);
  const oldBox = {
    ...actual,
    width: Math.max(10, actual.width),
    height: Math.max(10, actual.height),
  };
  const legacy = artwork.get(kind, "#ffffff");
  const oldFit = legacy
    ? Math.max(
        Math.min(
          (oldBox.width - 2) / legacy.width,
          (oldBox.height - 2) / legacy.height,
        ),
        20 / legacy.width,
        12 / legacy.height,
      )
    : 0;
  old.ctx.save();
  old.ctx.translate(oldBox.x * scale, oldBox.y * scale);
  old.ctx.rotate(oldBox.angle + Math.PI);
  old.ctx.fillStyle = color;
  old.ctx.fillRect(
    -oldBox.width / 2,
    -oldBox.height / 2,
    oldBox.width,
    oldBox.height,
  );
  if (legacy)
    old.ctx.drawImage(
      legacy.source,
      legacy.x,
      legacy.y,
      legacy.width,
      legacy.height,
      (-legacy.width * oldFit) / 2,
      (-legacy.height * oldFit) / 2,
      legacy.width * oldFit,
      legacy.height * oldFit,
    );
  old.ctx.restore();
  footprint(old.ctx, oldPose, scale);
  element("metrics-current").textContent =
    `Actual bounds ${actual.width.toFixed(1)} × ${actual.height.toFixed(1)} px; padded field ${oldBox.width.toFixed(1)} × ${oldBox.height.toFixed(1)} px. Entire old marker used as symbol.`;

  const fallback = prepare("canvas-recommended", scale);
  const result = drawNew(
    fallback.ctx,
    s,
    scale,
    { x: fallback.width / 2, y: fallback.height / 2 },
    kind,
    color,
    light,
    selected,
  );
  const metrics = `Field ${result.box.width.toFixed(1)} × ${result.box.height.toFixed(1)} px; symbol ${result.layout.symbolWidth.toFixed(1)} × ${result.layout.symbolHeight.toFixed(1)} px. ${light ? "White" : "Black"} ink.`;
  element("metrics-recommended").textContent = metrics;

  const accelerated = prepare("canvas-gpu", scale);
  const pose = formationRenderPose(s, 0, {
    x: accelerated.width / 2 / scale,
    y: accelerated.height / 2 / scale,
  });
  const box = strategicFormationBox(pose, scale),
    symbol = artwork.getSymbol(kind);
  const point = { x: box.x * scale, y: box.y * scale };
  const layout = formationMarkerLayout(box.width, box.height, symbol);
  gpu.resize(accelerated.width, accelerated.height, accelerated.ratio);
  gpu.begin();
  const batched =
    symbol &&
    gpu.add(
      kind,
      symbol,
      point.x,
      point.y,
      box.width,
      box.height,
      box.angle + Math.PI,
      rgb,
      1,
      { layout, light, selection: selected ? [196, 255, 54] : undefined },
    );
  if (!batched)
    drawFormationMarker(
      accelerated.ctx,
      box,
      point,
      color,
      light ? "#ffffff" : "#000000",
      layout,
      artwork.getSymbol(kind, light),
      1,
      selected ? "#c4ff36" : undefined,
    );
  footprint(accelerated.ctx, pose, scale);
  gpu.flush();
  element("metrics-gpu").textContent =
    `${batched ? "WebGL active" : "Canvas fallback active"} · ${metrics}`;
  const magnified = prepare("canvas-magnified", scale * 4);
  magnified.ctx.translate(magnified.width / 2, magnified.height / 2);
  magnified.ctx.scale(4, 4);
  drawFormationMarker(
    magnified.ctx,
    result.box,
    { x: 0, y: 0 },
    color,
    light ? "#ffffff" : "#000000",
    result.layout,
    artwork.getSymbol(kind, light),
    1,
    selected ? "#c4ff36" : undefined,
  );
  const field = prepare("canvas-sandbox", scale);
  const examples = [
    [4, "mass"],
    [6, "line"],
    [10, "column"],
    [20, "square"],
    [30, "line"],
    [30, "column"],
    [40, "mass"],
    [60, "wedge"],
  ] as const;
  examples.forEach(([count, form], i) => {
    const center = {
      x: (field.width * ((i % 4) + 0.5)) / 4,
      y: 95 + Math.floor(i / 4) * 180,
    };
    drawNew(
      field.ctx,
      squad(count, form, angle, kind),
      scale,
      center,
      kind,
      color,
      light,
      selected,
    );
    field.ctx.fillStyle = "#c0d2c9";
    field.ctx.font = "12px system-ui";
    field.ctx.textAlign = "center";
    field.ctx.fillText(`${count} · ${form}`, center.x, center.y - 55);
  });
  if (!legacy) requestAnimationFrame(render);
}

document
  .querySelectorAll("input, select")
  .forEach((control) => control.addEventListener("input", render));
window.addEventListener("resize", render);
element("lose-context").addEventListener("click", () => {
  if (!contextControl) return;
  recovering ? contextControl.restoreContext() : contextControl.loseContext();
  recovering = !recovering;
  element("lose-context").textContent = recovering
    ? "Restore GPU"
    : "Test GPU fallback";
});
document
  .querySelector(".strategic-sprites")
  ?.addEventListener("webglcontextlost", () => requestAnimationFrame(render));
document
  .querySelector(".strategic-sprites")
  ?.addEventListener("webglcontextrestored", () =>
    requestAnimationFrame(render),
  );
void artwork.symbolsReady.then(render);
