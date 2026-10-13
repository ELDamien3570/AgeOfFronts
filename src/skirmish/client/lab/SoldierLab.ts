import { CAVALRY_SPACING, SOLDIER_SCALE } from "../../content/SoldierScale";
import { UNITS, VESSEL } from "../../content/Units";
import { AGES, AGE_NAMES } from "../../domain/Definitions";
import {
  createFormation,
  formationDoctrine,
  formationSlots,
} from "../../domain/FormationGeometry";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import { EraArtwork } from "../EraArtwork";
import { drawPreviewProjectile } from "../troops/ProjectilePresentation";
import { RUSSIAN_TROOP_ACTORS } from "../troops/RussianTroopCatalogue";
import { troopAssetUrl } from "../troops/TroopAssetUrls";
import {
  clipFrame,
  type ActorClip,
  type ActorManifest,
  type ManualFormation,
} from "../troops/TroopFormationModel";
import "./SoldierLab.css";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const select = (id: string) => element<HTMLSelectElement>(id);
const checked = (id: string) => element<HTMLInputElement>(id).checked;
const units = UNITS.filter(
  (u) =>
    RUSSIAN_TROOP_ACTORS.has(u.id) && !RUSSIAN_TROOP_ACTORS.get(u.id)!.vehicle,
);
const values: Record<string, number> = {};
const inputs = new Map<string, HTMLInputElement>();
function control(
  group: string,
  key: string,
  title: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  suffix = "",
) {
  const label = document.createElement("label");
  const heading = document.createElement("span");
  heading.className = "control-title";
  const text = document.createElement("span");
  text.textContent = title;
  const output = document.createElement("output");
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.id = key;
  output.htmlFor = key;
  function update() {
    values[key] = Number(input.value);
    output.textContent = `${Number(input.value)}${suffix}`;
  }
  input.value = String(initial);
  update();
  input.addEventListener("input", update);
  inputs.set(key, input);
  heading.append(text, output);
  label.append(heading, input);
  element(group).append(label);
}
control("scene-controls", "count", "Troop count", 1, 144, 1, 36);
control("scene-controls", "zoom", "Camera · pixels / tile", 12, 96, 1, 48);
control(
  "cavalry-controls",
  "size",
  "Cavalry body + artwork",
  0.25,
  1.5,
  0.05,
  1,
  "×",
);
control(
  "cavalry-controls",
  "pitch",
  "Cavalry formation pitch",
  0.25,
  1.5,
  0.05,
  1,
  "×",
);
for (const [key, title] of [
  ["flight", "In flight"],
  ["ground", "On the ground"],
  ["embedded", "Stuck in soldiers"],
])
  control("projectile-controls", key, title, 0.1, 2, 0.05, 1, "×");
control("naval-controls", "shots", "Cosmetic shots / volley", 1, 24, 1, 8);
control(
  "naval-controls",
  "flightTime",
  "Proposed flight time",
  0.3,
  3,
  0.1,
  1.2,
  " s",
);
control("stat-controls", "health", "Health modifier", 1, 500, 1, 100, "%");
control("stat-controls", "damage", "Damage / soldier", 1, 1000, 1, 40);
control("stat-controls", "accuracy", "Estimated accuracy", 0, 100, 1, 100, "%");
control("stat-controls", "range", "Attack range", 0.1, 80, 0.1, 5, " tiles");
control(
  "stat-controls",
  "reload",
  "Attack cycle / reload",
  0.1,
  30,
  0.1,
  2.5,
  " s",
);
control("stat-controls", "speed", "Movement modifier", 1, 400, 1, 100, "%");
function setValue(key: string, value: number) {
  const input = inputs.get(key)!;
  input.value = String(value);
  input.dispatchEvent(new Event("input"));
}
for (const u of units)
  select("unit").add(
    new Option(`${AGE_NAMES[AGES.indexOf(u.age)]} · ${u.name}`, u.id),
  );
select("unit").value = units.find(
  (u) => u.age === "StoneAge" && formationDoctrine(u.id).mounted,
)!.id;
const unit = () => units.find((u) => u.id === select("unit").value)!;
type Asset = { clip: ActorClip; image: HTMLImageElement; idleScale: number };
const assets = new Map<string, Map<string, Asset>>();
const pending = new Map<string, Promise<void>>();
async function load(id: string) {
  if (pending.has(id)) return pending.get(id);
  const task = (async () => {
    const actor = RUSSIAN_TROOP_ACTORS.get(id)!;
    const root = actor.assetRoot!;
    const response = await fetch(troopAssetUrl(root + "animations.json"));
    if (!response.ok) throw new Error(`Missing manifest: ${id}`);
    const manifest: ActorManifest = await response.json();
    const result = new Map<string, Asset>();
    await Promise.all(
      manifest.animations
        .filter((c) => ["idle", "running", "attack"].includes(c.id))
        .map(async (clip) => {
          const image = new Image();
          image.src = troopAssetUrl(root + clip.file);
          await image.decode();
          result.set(clip.id, {
            clip,
            image,
            idleScale:
              manifest.animations.find((c) => c.id === "idle")?.scale ?? 1,
          });
        }),
    );
    assets.set(id, result);
  })();
  pending.set(id, task);
  return task;
}
let selectionRevision = 0;
async function selectionChanged() {
  const revision = ++selectionRevision;
  const u = unit();
  select("shape").replaceChildren();
  const doctrine = formationDoctrine(u.id);
  for (const shape of doctrine.shapes)
    select("shape").add(new Option(shape.replace(/-/g, " "), shape));
  select("shape").value = doctrine.defaultShape;
  for (const key of ["size", "pitch"])
    inputs.get(key)!.disabled = !doctrine.mounted;
  const attack = u.rangedAttack ?? u.meleeAttack ?? u.attack;
  setValue("health", u.healthPercent ?? 100);
  setValue("speed", u.speedPercent);
  setValue("damage", attack.damage);
  setValue("range", attack.range / FIXED);
  setValue(
    "reload",
    attack.reloadMs
      ? attack.reloadMs / 1000
      : attack.reloadTicks / TICKS_PER_SECOND,
  );
  setValue("accuracy", 100);
  element("asset-status").textContent = "Loading artwork…";
  try {
    await load(u.id);
    if (revision !== selectionRevision) return;
    const available = assets.get(u.id)!;
    for (const option of select("pose").options)
      option.disabled = !available.has(option.value);
    if (!available.has(select("pose").value)) select("pose").value = "idle";
    element("asset-status").textContent = "Runtime artwork loaded";
  } catch (error) {
    if (revision === selectionRevision)
      element("asset-status").textContent = `Artwork error: ${String(error)}`;
  }
}
select("unit").addEventListener("change", () => void selectionChanged());
void selectionChanged();

const era = new EraArtwork();
const shipCanvases: { id: string; canvas: HTMLCanvasElement }[] = [];
for (let i = 0; i < 4; i++) {
  const id = `${AGES[i].toLowerCase()}-warship`;
  const article = document.createElement("article");
  const title = document.createElement("h3");
  title.textContent = AGE_NAMES[i];
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", `${AGE_NAMES[i]} naval engagement`);
  article.append(title, canvas);
  element("ships").append(article);
  shipCanvases.push({ id, canvas });
  era.preload(id, "attack");
}
function stage(canvas: HTMLCanvasElement, water = false) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight,
    dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = water ? "#17343c" : "#29382b";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = water ? "#284952" : "#344734";
  ctx.lineWidth = 1;
  const grid = values.zoom;
  for (let x = (width / 2) % grid; x < width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = (height / 2) % grid; y < height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.font = "12px system-ui";
  ctx.fillStyle = "#d3ddcd";
  return { ctx, width, height };
}
function actor(
  ctx: CanvasRenderingContext2D,
  id: string,
  x: number,
  y: number,
  multiplier: number,
  time: number,
  pose = select("pose").value,
) {
  const asset = assets.get(id)?.get(pose) ?? assets.get(id)?.get("idle");
  if (!asset) return;
  const frame = asset.clip.frames[clipFrame(asset.clip, time)];
  const troop = RUSSIAN_TROOP_ACTORS.get(id)!;
  const size =
    (values.zoom *
      (2 / 0.75) *
      troop.memberScale *
      SOLDIER_SCALE *
      multiplier *
      (asset.clip.scale ?? 1)) /
    asset.idleScale;
  ctx.drawImage(
    asset.image,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    x - (size * frame.pivot.x) / frame.width,
    y - (size * frame.pivot.y) / frame.height,
    size,
    size,
  );
}
function projectile(
  ctx: CanvasRenderingContext2D,
  kind: string,
  x: number,
  y: number,
  angle: number,
  multiplier: number,
  embedded = false,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale((values.zoom / 64) * multiplier, (values.zoom / 64) * multiplier);
  drawPreviewProjectile(ctx, kind, 0, 0, angle, embedded);
  ctx.restore();
}
let slotsKey = "";
let cachedSlots: ReturnType<typeof formationSlots> = [];
function previewSlots() {
  const u = unit(),
    shape = select("shape").value as ManualFormation;
  const key = `${u.id}:${shape}:${values.count}`;
  if (key !== slotsKey) {
    cachedSlots = formationSlots(
      {
        id: 1,
        definitionId: u.id,
        troops: values.count,
        kind: u.line,
        formation: { ...createFormation(u.id), shape },
      },
      0,
    );
    slotsKey = key;
  }
  return cachedSlots;
}
function formation(
  canvas: HTMLCanvasElement,
  experiment: boolean,
  time: number,
) {
  const { ctx, width, height } = stage(canvas);
  const u = unit(),
    d = formationDoctrine(u.id);
  const size = experiment && d.mounted ? values.size : 1,
    pitch = experiment && d.mounted ? values.pitch : 1;
  const slots = previewSlots();
  const bodyW = d.bodyWidth / FIXED,
    bodyD = d.bodyDepth / FIXED;
  const w =
    ((Math.max(...slots.map((s) => s.x)) - Math.min(...slots.map((s) => s.x))) /
      FIXED) *
      pitch +
    bodyW * size;
  const h =
    ((Math.max(...slots.map((s) => s.y)) - Math.min(...slots.map((s) => s.y))) /
      FIXED) *
      pitch +
    bodyD * size;
  if (checked("footprint")) {
    ctx.strokeStyle = experiment ? "#e0c58a" : "#8bb498";
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      (width - w * values.zoom) / 2,
      (height - h * values.zoom) / 2,
      w * values.zoom,
      h * values.zoom,
    );
    ctx.setLineDash([]);
  }
  for (const slot of [...slots].sort((a, b) => a.y - b.y)) {
    const x = width / 2 + (slot.x / FIXED) * pitch * values.zoom,
      y = height / 2 + (slot.y / FIXED) * pitch * values.zoom;
    if (checked("footprint")) {
      ctx.strokeStyle = "#90a88655";
      ctx.strokeRect(
        x - (bodyW * size * values.zoom) / 2,
        y - (bodyD * size * values.zoom) / 2,
        bodyW * size * values.zoom,
        bodyD * size * values.zoom,
      );
    }
    actor(ctx, u.id, x, y, size, time);
  }
  const prefix = experiment ? "experiment" : "baseline";
  element(`${prefix}-metrics`).textContent =
    `${values.count} soldiers · ${w.toFixed(2)} × ${h.toFixed(2)} tiles · ${(values.count / (w * h)).toFixed(1)} soldiers / tile²`;
  if (w * values.zoom > width || h * values.zoom > height) {
    ctx.fillStyle = "#f0c586";
    ctx.fillText(
      "Formation exceeds view — reduce camera scale",
      12,
      height - 14,
    );
  }
  if (experiment) {
    let overlaps = 0;
    for (let i = 0; i < slots.length; i++)
      for (let j = i + 1; j < slots.length; j++)
        if (
          (Math.abs(slots[i].x - slots[j].x) / FIXED) * pitch < bodyW * size &&
          (Math.abs(slots[i].y - slots[j].y) / FIXED) * pitch < bodyD * size
        )
          overlaps++;
    element("overlap").textContent = overlaps
      ? `${overlaps} pairs of body envelopes overlap. This pitch needs formation/contact validation before live integration.`
      : "Body envelopes do not overlap at these settings. Live pathing/contact validation is still required.";
  }
}
function states(canvas: HTMLCanvasElement, experiment: boolean, time: number) {
  const { ctx, width } = stage(canvas);
  const kind = select("projectile").value;
  const x = width / 2;
  for (const [i, name] of [
    "In flight",
    "On the ground",
    "Embedded",
  ].entries()) {
    const y = 44 + i * 77;
    ctx.fillStyle = "#d3ddcd";
    ctx.fillText(name, 14, y - 16);
    const key = ["flight", "ground", "embedded"][i];
    const multiplier = experiment ? values[key] : 1;
    if (i === 0) {
      const p = (time % 1500) / 1500;
      projectile(ctx, kind, 40 + p * (width - 80), y, 0, multiplier);
    }
    if (i === 1) projectile(ctx, kind, x, y, 0.5, multiplier);
    if (i === 2) {
      projectile(ctx, kind, x + 3, y, -0.9, multiplier, true);
      actor(
        ctx,
        unit().id,
        x,
        y,
        experiment && formationDoctrine(unit().id).mounted ? values.size : 1,
        time,
        "idle",
      );
    }
  }
}
function naval(canvas: HTMLCanvasElement, id: string, time: number) {
  const { ctx, width, height } = stage(canvas, true);
  const vessel = VESSEL.get(id)!;
  const cycle = vessel.attack!.reloadTicks / TICKS_PER_SECOND,
    seconds = time / 1000;
  const phase = seconds % cycle;
  const y = height / 2;
  for (const [index, x] of [width * 0.22, width * 0.78].entries()) {
    const frame = era.get(id, phase < 0.8 ? "attack" : "idle", time / 50);
    if (!frame) {
      ctx.fillStyle = "#d3ddcd";
      ctx.fillText("Loading hull…", x - 38, y);
      continue;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(
      (index ? -Math.PI / 2 : Math.PI / 2) + era.facing(id, "screen-up"),
    );
    const size = 90;
    ctx.drawImage(
      frame.source,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      -size / 2,
      -size / 2,
      size,
      size,
    );
    ctx.restore();
  }
  if (checked("naval"))
    for (
      let previousCycle = 0;
      previousCycle <= Math.ceil(values.flightTime / cycle);
      previousCycle++
    )
      for (let i = 0; i < values.shots; i++) {
        if (seconds < previousCycle * cycle) continue;
        const age = phase + previousCycle * cycle - i * 0.015;
        if (age < 0 || age > values.flightTime) continue;
        const p = age / values.flightTime,
          offset = (i - (values.shots - 1) / 2) * 2;
        for (const direction of [1, -1]) {
          const x =
            width * (direction === 1 ? 0.22 + 0.56 * p : 0.78 - 0.56 * p);
          const arc = -Math.sin(p * Math.PI) * 22;
          const angle = Math.atan2(
            -22 * Math.PI * Math.cos(p * Math.PI),
            direction * width * 0.56,
          );
          projectile(
            ctx,
            select("naval-kind").value,
            x,
            y + offset + arc,
            angle,
            values.flight,
          );
        }
      }
  ctx.fillStyle = "#d3ddcd";
  ctx.fillText(
    `${cycle.toFixed(1)} s attack cycle · ${vessel.attack!.damage} damage / attack`,
    12,
    height - 14,
  );
}
let paused = false,
  time = 0,
  previous = performance.now();
element("pause").addEventListener("click", () => {
  paused = !paused;
  element("pause").textContent = paused ? "Resume" : "Pause";
});
element("reset").addEventListener("click", () => {
  for (const key of ["size", "pitch", "flight", "ground", "embedded"])
    setValue(key, 1);
  setValue("count", 36);
  setValue("zoom", 48);
  setValue("shots", 8);
  setValue("flightTime", 1.2);
  element<HTMLInputElement>("naval").checked = true;
  element<HTMLInputElement>("footprint").checked = true;
  select("projectile").value = "javelin";
  select("naval-kind").value = "bow";
  select("pose").value = "idle";
  time = 0;
  void selectionChanged();
});
element("export").addEventListener("click", () => {
  const settings = {
    schemaVersion: 1,
    previewOnly: true,
    unitId: unit().id,
    shape: select("shape").value,
    pose: select("pose").value,
    projectile: select("projectile").value,
    navalProjectile: select("naval-kind").value,
    navalEnabled: checked("naval"),
    showBodyEnvelope: checked("footprint"),
    values: { ...values },
    baseline: { soldierScale: SOLDIER_SCALE, cavalrySpacing: CAVALRY_SPACING },
    statisticalModel:
      "Expected damage only; ignores armour, ranks, magazines, movement, charge and target bonuses. Accuracy is hypothetical.",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "soldier-lab-settings.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  element("save-status").textContent =
    "Exported the current experiment as soldier-lab-settings.json.";
});
let lastStats = "";
function animate(now: number) {
  if (!paused) time += Math.min(now - previous, 100);
  previous = now;
  formation(element<HTMLCanvasElement>("baseline"), false, time);
  formation(element<HTMLCanvasElement>("experiment"), true, time);
  states(element<HTMLCanvasElement>("projectile-baseline"), false, time);
  states(element<HTMLCanvasElement>("projectile-experiment"), true, time);
  for (const ship of shipCanvases) naval(ship.canvas, ship.id, time);
  const volley = (values.count * values.damage * values.accuracy) / 100;
  const html = `<div>Expected volley<strong>${volley.toFixed(1)}</strong></div><div>Expected DPS<strong>${(volley / values.reload).toFixed(1)}</strong></div><div>Shots / minute / soldier<strong>${(60 / values.reload).toFixed(1)}</strong></div><div>Health · movement<strong>${values.health}% · ${values.speed}%</strong></div><div>Attack range<strong>${values.range} tiles</strong></div>`;
  if (html !== lastStats) {
    element("stats").innerHTML = html;
    lastStats = html;
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
