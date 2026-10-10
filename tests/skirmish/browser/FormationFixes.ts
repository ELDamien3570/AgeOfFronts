import { FormationSoldierMotion } from "../../../src/skirmish/client/FormationSoldierMotion";
import {
  clipFrame,
  type ActorClip,
  type ActorManifest,
} from "../../../src/skirmish/client/troops/TroopFormationModel";
import { installFactionMaskGallery } from "./FactionMaskGallery";
import scaleAudit from "./FormationScaleAudit.json";
import { installScaleGallery } from "./FormationScaleGallery";
import { IncomingDamageBattle } from "./IncomingDamageBattle";
import { drawPreviewProjectile } from "./ProjectilePresentation";
const canvas = document.querySelector<HTMLCanvasElement>("#canvas")!,
  ctx = canvas.getContext("2d")!;
const field = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const proposed = field<HTMLInputElement>("proposed"),
  debug = field<HTMLInputElement>("debug"),
  numbers = field<HTMLInputElement>("numbers"),
  smoke = field<HTMLInputElement>("smoke");
let pointer: { x: number; y: number } | undefined;
let selectedId: string | undefined, hoverId: string | undefined;
let pickTargets: {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}[] = [];
canvas.addEventListener("pointermove", (event) => {
  const bounds = canvas.getBoundingClientRect(),
    zoom = Number(field<HTMLInputElement>("zoom").value) / 100;
  pointer = {
    x:
      600 +
      (((event.clientX - bounds.left) * 1200) / bounds.width - 600) / zoom,
    y:
      350 + (((event.clientY - bounds.top) * 700) / bounds.height - 350) / zoom,
  };
});
canvas.addEventListener("pointerleave", () => {
  pointer = undefined;
  hoverId = undefined;
});
canvas.addEventListener("click", () => {
  selectedId = pickTargets.find(
    (p) =>
      pointer &&
      pointer.x >= p.left &&
      pointer.x <= p.right &&
      pointer.y >= p.top &&
      pointer.y <= p.bottom,
  )?.id;
});
const sources: Record<string, string> = {
  club: "/Art/Runtime/Russians/Troops/StoneAge-Clubman/",
  javelin: "/Art/Cultures/Russians/Units/StoneAge/Javelinist/TopDownReview/",
  bow: "/Art/Cultures/Russians/Units/ClassicalAge/RecurveArcher/TopDownReview/",
  crossbow: "/Art/Cultures/Russians/Units/LateMedieval/RusCrossbowman/",
  musket: "/Art/Cultures/Russians/Units/EarlyModern/RusMusketeer/",
  grenadier: "/Art/Cultures/Russians/Units/EarlyModern/RusGrenadier/",
  rifle: "/Art/Cultures/Russians/Units/Modern/SovietAK47Rifleman/",
};
const assets = new Map<
  string,
  { clips: ActorClip[]; images: Map<string, HTMLImageElement> }
>();
const images = new Map<string, HTMLImageElement>();
const aircraftFrames = new Map<
  string,
  {
    frames: { x: number; y: number; width: number; height: number }[];
    fps: number;
  }
>();
async function image(url: string) {
  const i = new Image();
  i.src = encodeURI(url);
  await i.decode();
  return i;
}
async function load() {
  await Promise.all(
    Object.entries(sources).map(async ([key, root]) => {
      const response = await fetch(encodeURI(root + "animations.json"));
      if (!response.ok) throw Error(root);
      const manifest: ActorManifest = await response.json();
      const clips = manifest.animations.filter((c) =>
        ["idle", "running", "attack", "reload", "charge-attack"].includes(c.id),
      );
      const loaded = await Promise.all(
        clips.map(async (c) => [c.id, await image(root + c.file)] as const),
      );
      assets.set(key, { clips, images: new Map(loaded) });
    }),
  );
  const aircraftManifest = await (
    await fetch("/Art/Runtime/Russians/manifest.json")
  ).json();
  for (const kind of ["fighter", "bomber"]) {
    const clip = aircraftManifest[`earlymodern-${kind}`].clips.flight;
    const img = await image(`/Art/Runtime/Russians/${clip.file}`);
    images.set(kind, img);
    const width = img.width / clip.columns,
      height = img.height / Math.ceil(clip.frames / clip.columns);
    aircraftFrames.set(kind, {
      frames: Array.from({ length: clip.frames }, (_, i) => ({
        x: (i % clip.columns) * width,
        y: Math.floor(i / clip.columns) * height,
        width,
        height,
      })),
      fps: clip.fps,
    });
  }
}
function text(
  value: string,
  x: number,
  y: number,
  color = "#e2ebe1",
  size = 18,
) {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui`;
  ctx.fillText(value, x, y);
}
function inspected(id: string) {
  return selectedId === id || hoverId === id;
}
function centeredCount(value: string, x: number, y: number) {
  ctx.save();
  ctx.textAlign = "center";
  text(value, x, y, "#d5e2d6", 12);
  ctx.restore();
}
function line(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
  width = 2,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}
function sprite(
  key: string,
  clipId: string,
  ms: number,
  x: number,
  y: number,
  angle = 0,
  size = 52,
  hit = false,
) {
  const asset = assets.get(key);
  const clip =
    asset?.clips.find((c) => c.id === clipId) ??
    asset?.clips.find((c) => c.id === "idle");
  if (!clip) return;
  const idle = asset!.clips.find((c) => c.id === "idle");
  size *= (clip.scale ?? 1) / (idle?.scale ?? 1);
  const frame = clip.frames[clipFrame(clip, ms)],
    img = asset!.images.get(clip.id)!;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(
    img,
    frame.x,
    frame.y,
    frame.width,
    frame.height,
    (-size * frame.pivot.x) / frame.width,
    (-size * frame.pivot.y) / frame.height,
    size,
    size,
  );
  if (hit) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#d88264";
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.19, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function bar(x: number, y: number, w: number, fraction: number, color: string) {
  ctx.fillStyle = "#0c171bd9";
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
  ctx.fillStyle = color;
  ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, fraction)), 4);
}
function cross(x: number, y: number) {
  line(x - 7, y, x + 7, y, "#ffe082");
  line(x, y - 7, x, y + 7, "#ffe082");
}
/** Scripted, bounded ground residue; presentation only, underneath soldiers. */
function groundImpacts(
  kind: string,
  x: number,
  y: number,
  age: number,
  seed = 0,
) {
  const shaft = ["javelin", "bow", "bolt", "crossbow"].includes(kind);
  const lifetime = shaft ? 8000 : 4000;
  if (age < 0 || age > lifetime) return;
  ctx.save();
  const fade = Math.min(1, (lifetime - age) / 1800);
  for (let i = 0; i < 12; i++) {
    const px = x + Math.sin(i * 13.7 + seed * 2.3) * 61;
    const py = y + Math.cos(i * 9.3 + seed * 1.7) * 42;
    ctx.globalAlpha = fade * 0.65;
    if (shaft) {
      drawPreviewProjectile(
        ctx,
        kind === "crossbow" ? "bolt" : kind,
        px,
        py,
        Math.PI + Math.sin(i + seed) * 0.25,
      );
    } else {
      ctx.fillStyle = "#171e17";
      ctx.beginPath();
      ctx.ellipse(px, py, 2.8, 1.6, i, 0, Math.PI * 2);
      ctx.fill();
      line(px - 4, py + 2, px + 3, py + 2, "#806b4b", 1);
    }
    if (age < 260) {
      const t = age / 260;
      ctx.globalAlpha = (1 - t) * 0.4;
      ctx.fillStyle = "#b49d70";
      ctx.beginPath();
      ctx.ellipse(px, py - t * 8, 3 + t * 7, 2 + t * 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
const scaleGallery = installScaleGallery(
  canvas.closest("section")!,
  () => Number(field<HTMLInputElement>("zoom").value) / 100,
  () => paused,
);
const maskGallery = installFactionMaskGallery(
  canvas.closest("section")!,
  () => paused,
);
const scenes = [
  ["scaling", "All troop scales"],
  ["masks", "Faction masks"],
  ["alignment", "Movement / labels"],
  ["damage", "Incoming damage"],
  ["air", "Fighter interception"],
  ["weapons", "Reload / bayonet / smoke"],
  ["blast", "Atomic radius"],
  ["pacing", "AI / age pacing"],
] as const;
const requestedScene = new URLSearchParams(location.search).get("scene");
let scene: string = scenes.some(([id]) => id === requestedScene)
    ? requestedScene!
    : "scaling",
  clock = 0,
  last = 0,
  paused = false,
  motion = new FormationSoldierMotion(1);
const captions: Record<string, string> = {
  masks:
    "Review the ready Russian masks with the game's faction palette. Pick two colors, an age and an animation; switch individual troop clips or show the mask coverage.",
  scaling:
    "Every recruitable land unit, side by side. Approved human/rider scaling is now integrated into normal skirmish; the three requested top-down source corrections are in the game assets. Choose current sizes or proposed sizes, then compare idle/walking/attack poses.",
  alignment:
    "Current comparison uses the existing world-space follower sampler. Recommendation keeps natural local offsets around a shared carrier and positions the health indicator below the displayed footprint. Debug shows the squad root. Normal skirmish now uses carrier-relative movement and footprint-aligned status.",
  damage:
    "Local encounter with casualties, front-rank replacements and retargeting. Melee and ranged hits leave blood on troops and the ground; arrows, bolts and javelins retain distinct silhouettes. Hover or select for health and count.",
  air: "Fighters currently cause instant health loss without a visible shot. Proposed tracers make that existing damage legible; health and remaining flight-time bars replace the letters. Fighter artwork is 80% of its current display size. This is a scripted pass, not an interception simulation.",
  weapons:
    "Uses your authored attack, reload and bayonet clips. Suggested cycles: bows/javelins 2.5s, crossbow 4s, musket 6s; rifle three shots then a 1.9s reload. Grenadier bayonet contact precedes one close-range shot. Normal skirmish now uses compiled weapon cycles and bayonet charge rules; this scripted scene illustrates the clips.",
  blast:
    "16-cell current atomic radius versus the requested 12-cell radius. A 25% radius cut leaves 56.25% of the original circular area. Damage is unchanged in this proposal.",
  pacing:
    "The 40-minute current time is your observation, not a calibrated benchmark. The proposed 52.5-minute milestones show the intended breathing room per age. Fix modernization and measure resource/research wait before tuning progression prices.",
};
const nav = field("scenes");
for (const [id, label] of scenes) {
  const button = document.createElement("button");
  button.textContent = label;
  button.dataset.scene = id;
  button.onclick = () => {
    scene = id;
    reset();
    update();
  };
  nav.append(button);
}
function update() {
  field("damage-controls").hidden = scene !== "damage";
  scaleGallery.show(scene === "scaling");
  maskGallery.show(scene === "masks");
  canvas.hidden = scene === "scaling" || scene === "masks";
  for (const b of nav.querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.scene === scene));
  field("caption").textContent = captions[scene];
  field("facts").textContent =
    "Click or hover a squad for its count. All effects are client-side visual proposals; soldiers have no individual collision.";
}
function reset() {
  clock = 0;
  last = 0;
  motion = new FormationSoldierMotion(1);
}
field("reset").onclick = reset;
field("pause").onclick = () => {
  paused = !paused;
  field("pause").textContent = paused ? "Resume" : "Pause";
};
const slots = Array.from({ length: 12 }, (_, id) => ({
  id,
  x: ((id % 4) - 1.5) * 0.27,
  y: (Math.floor(id / 4) - 1) * 0.27,
  scale: 0.24,
  front: id < 4,
}));
function ground() {
  ctx.fillStyle = "#23392d";
  ctx.fillRect(0, 0, 1200, 700);
  ctx.strokeStyle = "#ffffff0a";
  ctx.lineWidth = 1;
  for (let x = 0; x < 1200; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 700);
    ctx.stroke();
  }
  for (let y = 0; y < 700; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }
}
function squad(
  x: number,
  y: number,
  key: string,
  clip: string,
  ms: number,
  angle: number,
  color: string,
  hp = 1,
  damaged = false,
) {
  const id = `${key}:${color}`;
  const points = slots.map((s) => ({ x: x + s.x * 94, y: y + s.y * 94 }));
  pickTargets.push({
    id,
    left: x - 52,
    right: x + 52,
    top: y - 50,
    bottom: y + 50,
  });
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    ctx.strokeStyle = color;
    ctx.globalAlpha = selectedId === id || hoverId === id ? 0.45 : 0;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 9, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    sprite(key, clip, ms + i * 13, p.x, p.y, angle, 52, damaged && i === 1);
  }
  const bottom = Math.max(...points.map((p) => p.y)) + 29;
  if (inspected(id)) {
    bar(x, bottom, 82, hp, color);
    if (numbers.checked) centeredCount("12", x, bottom + 20);
  }
  if (debug.checked) cross(x, y);
  return bottom;
}
function alignment() {
  text(
    proposed.checked
      ? "Bounded local motion / footprint indicator"
      : "Current follower / root indicator",
    55,
    66,
  );
  const t = clock / 1000;
  const travel = t % 16;
  const x = travel < 8 ? 2 + travel * 1.2 : 11.6 - (travel - 8) * 1.2,
    y = 4 + 0.4 * Math.sin(t);
  const heading = travel < 8 ? -Math.PI / 2 : Math.PI / 2;
  const root = { x, y };
  const current = motion.sample(clock, root, heading, slots, {
    footprint: 2.6667,
    mounted: false,
    engaged: false,
    looseTravel: true,
    travelLanes: true,
    combatFootwork: true,
    reformInPlace: true,
  });
  const points = proposed.checked
    ? slots.map((s, i) => ({
        id: i,
        x: root.x + s.x + 0.045 * Math.sin(t * 2 + i),
        y: root.y + s.y + 0.055 * Math.sin(t * 1.7 + i),
        angle: heading,
      }))
    : current;
  const ox = 135,
    oy = 80;
  for (const p of points)
    sprite(
      "club",
      "running",
      clock + p.id * 37,
      ox + p.x * 65,
      oy + p.y * 65,
      p.angle,
      53,
    );
  const centroid = points.reduce(
    (a, b) => ({ x: a.x + b.x / points.length, y: a.y + b.y / points.length }),
    { x: 0, y: 0 },
  );
  const bx = proposed.checked ? ox + centroid.x * 65 : ox + root.x * 65,
    by = proposed.checked
      ? Math.max(...points.map((p) => oy + p.y * 65)) + 35
      : oy + root.y * 65 + 20;

  pickTargets.push({
    id: "moving",
    left: bx - 75,
    right: bx + 75,
    top: by - 100,
    bottom: by + 15,
  });
  if (inspected("moving")) {
    bar(bx, by, 90, 0.8, "#97cc93");
    if (numbers.checked) centeredCount("800", bx, by + 20);
  }
  if (debug.checked) {
    cross(ox + root.x * 65, oy + root.y * 65);
    line(
      ox + root.x * 65,
      oy + root.y * 65,
      ox + centroid.x * 65,
      oy + centroid.y * 65,
      "#ffc365",
    );
  }
  text("Movement reverses every eight seconds", 55, 640, "#b4ccbb", 16);
}
type DamageUnit = (typeof scaleAudit.rows)[number];
const damageUnits = scaleAudit.rows.filter((r) => r.actor && !r.actor.vehicle);
const damageReady = new Map<string, Promise<void>>();
async function loadDamageUnit(row: DamageUnit) {
  if (assets.has(row.id)) return;
  if (!damageReady.has(row.id))
    damageReady.set(
      row.id,
      (async () => {
        const response = await fetch(row.actor!.assetRoot + "animations.json");
        if (!response.ok) throw Error(row.name + " artwork unavailable");
        const manifest: ActorManifest = await response.json();
        const clips = manifest.animations.filter((c) =>
          ["idle", "running", "attack", "death"].includes(c.id),
        );
        const loaded = await Promise.all(
          clips.map(
            async (c) =>
              [c.id, await image(row.actor!.assetRoot + c.file)] as const,
          ),
        );
        assets.set(row.id, { clips, images: new Map(loaded) });
      })(),
    );
  await damageReady.get(row.id);
}
for (const [control, defaultUnit, filter] of [
  [
    "damage-melee",
    "stoneage-infantry",
    (r: DamageUnit) =>
      r.actor?.projectile === "arrow" &&
      !["rangedInfantry", "rangedCavalry"].includes(r.troopClass),
  ],
  ["damage-target", "stoneage-infantry", (_r: DamageUnit) => true],
  [
    "damage-ranged",
    "stoneage-archer",
    (r: DamageUnit) =>
      ["rangedInfantry", "rangedCavalry"].includes(r.troopClass) ||
      ["bullet", "rocket"].includes(r.actor!.projectile),
  ],
] as const) {
  const select = field<HTMLSelectElement>(control);
  for (const row of damageUnits.filter(filter)) {
    const option = document.createElement("option");
    option.value = row.id;
    option.textContent = `${row.ageName} · ${row.name}`;
    select.append(option);
  }
  select.value = defaultUnit;
  const prepare = () => {
    selectedId = undefined;
    reset();
    void loadDamageUnit(damageUnits.find((r) => r.id === select.value)!).catch(
      (e) => {
        field("error").textContent = String(e);
      },
    );
  };
  select.onchange = prepare;
  prepare();
}
function groundBlood(
  p: { x: number; y: number },
  age: number,
  seed: number,
  lifetime = 5500,
) {
  // A short fall before blood reaches the ground; paint before the soldiers.
  const landed = age - 90;
  if (landed < 0 || landed > lifetime) return;
  const spread = Math.min(1, landed / 180);
  ctx.save();
  ctx.globalAlpha = 0.65 * Math.min(1, (lifetime - landed) / 1300);
  const x = p.x + Math.sin(seed * 2.3) * 6;
  const y = p.y + 12;
  for (let j = 0; j < 5; j++) {
    const angle = seed * 1.7 + j * 2.4;
    const offset = j ? 3 + j * 1.2 : 0;
    ctx.fillStyle = j % 2 ? "#651d24" : "#8a2729";
    ctx.beginPath();
    ctx.ellipse(
      x + Math.cos(angle) * offset * spread,
      y + Math.sin(angle) * offset * 0.55 * spread,
      (j ? 1.6 : 5) * (0.5 + 0.5 * spread),
      j ? 0.9 : 2.7,
      angle,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.restore();
}
/** Local cosmetic attachments, never authoritative soldier damage. */
function soldierImpact(
  kind: string,
  p: { x: number; y: number },
  incoming: { x: number; y: number },
  age: number,
  index: number,
  _memberId?: number,
  corpse = false,
  underlay = false,
) {
  const embedded = ["bow", "bolt", "javelin"].includes(kind);
  if (corpse) {
    if (!embedded) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(0.65, 0.65);
    drawPreviewProjectile(
      ctx,
      kind,
      0,
      0,
      Math.atan2(p.y - incoming.y, p.x - incoming.x),
      true,
    );
    ctx.restore();
    return;
  }
  if (underlay) {
    if (!embedded || age < 0 || age > 5000) return;
    ctx.save();
    ctx.globalAlpha = 0.8 * Math.min(1, (5000 - age) / 800);
    drawPreviewProjectile(
      ctx,
      kind,
      p.x,
      p.y,
      Math.atan2(p.y - incoming.y, p.x - incoming.x),
      true,
    );
    ctx.restore();
    return;
  }
  const lifetime = embedded ? 5000 : 1800;
  if (age < 0 || age > lifetime) return;
  ctx.save();
  const fade = Math.min(1, (lifetime - age) / 800);
  ctx.globalAlpha = fade * 0.8;
  ctx.fillStyle = "#782023";
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, 3.2, 2.1, index, 0, Math.PI * 2);
  ctx.fill();
  if (age < 380) {
    const t = age / 380;
    ctx.globalAlpha = (1 - t) * 0.95;
    for (let j = 0; j < 5; j++) {
      const angle = index * 2.1 + j * 1.3;
      const radius = t * (7 + j * 1.8);
      ctx.fillStyle = j % 2 ? "#ae3630" : "#762025";
      ctx.beginPath();
      ctx.ellipse(
        p.x + Math.cos(angle) * radius,
        p.y + Math.sin(angle) * radius - t * (1 - t) * 12 + t * t * 5,
        1.5 - t * 0.5,
        1.1,
        angle,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}
function battleSprite(
  row: DamageUnit,
  point: { x: number; y: number },
  angle: number,
  pose: string,
  age: number,
  bodyScale = 1,
) {
  const asset = assets.get(row.id)!;
  const clip =
    asset.clips.find((c) => c.id === pose) ??
    asset.clips.find((c) => c.id === "idle")!;
  const idle = asset.clips.find((c) => c.id === "idle")!;
  const frame = clip.frames[clipFrame(clip, age)];
  const size =
    64 * scaleAudit.reference.footprint * row.scale!.proposedScale * bodyScale;
  const calibration = row.scale as {
    bodyAnchorsPx128?: Record<string, { x: number; y: number }>;
    reviewFacingOffset?: number;
  };
  const anchor = calibration.bodyAnchorsPx128?.[pose];
  const facing =
    angle + (calibration.reviewFacingOffset ?? row.actor!.facingOffset);
  const extent = (size * (clip.scale ?? 1)) / (idle.scale ?? 1);
  const dx = anchor
    ? (frame.pivot.x / frame.width - anchor.x / 128) * extent
    : 0;
  const dy = anchor
    ? (frame.pivot.y / frame.height - anchor.y / 128) * extent
    : 0;
  sprite(
    row.id,
    clip.id,
    age,
    point.x + dx * Math.cos(facing) - dy * Math.sin(facing),
    point.y + dx * Math.sin(facing) + dy * Math.cos(facing),
    facing,
    size,
  );
}
const damageBattle = new IncomingDamageBattle({
  clip(row, id) {
    const clip = assets.get(row.id)!.clips.find((c) => c.id === id)!;
    return {
      duration: clip.durations?.reduce((a, b) => a + b, 0) ?? 1200,
      release:
        clip.durations
          ?.slice(0, clip.releaseFrame ?? 3)
          .reduce((a, b) => a + b, 0) ?? 580,
    };
  },
  draw: battleSprite,
  muzzle(row, member, angle, age) {
    const asset = assets.get(row.id)!,
      clip = asset.clips.find((c) => c.id === "attack")!,
      idle = asset.clips.find((c) => c.id === "idle")!;
    const frame = clip.frames[clipFrame(clip, age)];
    const calibration = row.scale as {
      bodyAnchorsPx128?: Record<string, { x: number; y: number }>;
      reviewFacingOffset?: number;
    };
    const anchor = calibration.bodyAnchorsPx128?.attack ?? {
      x: (frame.pivot.x / frame.width) * 128,
      y: (frame.pivot.y / frame.height) * 128,
    };
    const release = row.actor!.releasePoints[0];
    const extent =
      (64 *
        scaleAudit.reference.footprint *
        row.scale!.proposedScale *
        (clip.scale ?? 1)) /
      (idle.scale ?? 1);
    const dx = (release.x - anchor.x / 128) * extent,
      dy = (release.y - anchor.y / 128) * extent;
    const facing =
      angle + (calibration.reviewFacingOffset ?? row.actor!.facingOffset);
    return {
      x: member.x + dx * Math.cos(facing) - dy * Math.sin(facing),
      y: member.y + dx * Math.sin(facing) + dy * Math.cos(facing),
    };
  },
  blood: (p, age, seed) => groundBlood(p, age, seed, 45000),
  impact: soldierImpact,
  groundProjectile(kind, point, from, age) {
    ctx.save();
    ctx.globalAlpha = 0.65 * Math.min(1, (15000 - age) / 1500);
    if (["bow", "bolt", "javelin"].includes(kind))
      drawPreviewProjectile(
        ctx,
        kind,
        point.x,
        point.y,
        Math.atan2(point.y - from.y, point.x - from.x),
      );
    else if (age < 4000) {
      ctx.fillStyle = kind === "rocket" ? "#29251e" : "#191e17";
      ctx.beginPath();
      ctx.ellipse(
        point.x,
        point.y,
        kind === "rocket" ? 8 : 3,
        kind === "rocket" ? 5 : 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();
  },
  projectile(kind, from, to, progress) {
    const arc = ["bow", "bolt", "javelin"].includes(kind)
      ? Math.sin(progress * Math.PI) * 28
      : 0;
    drawPreviewProjectile(
      ctx,
      kind,
      from.x + (to.x - from.x) * progress,
      from.y + (to.y - from.y) * progress - arc,
      Math.atan2(
        to.y -
          from.y -
          (kind === "bullet" || kind === "rocket"
            ? 0
            : Math.cos(progress * Math.PI) * 28 * Math.PI),
        to.x - from.x,
      ),
    );
  },
  inspect(id, row, points, hp, count) {
    pickTargets.push({
      id,
      left: Math.min(...points.map((p) => p.x)) - 25,
      right: Math.max(...points.map((p) => p.x)) + 25,
      top: Math.min(...points.map((p) => p.y)) - 35,
      bottom: Math.max(...points.map((p) => p.y)) + 45,
    });
    if (!inspected(id)) return;
    const color = id.startsWith("battle:0:") ? "#87bfe7" : "#e58e81";
    for (const p of points) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 9, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const x = points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y = Math.max(...points.map((p) => p.y)) + 35;
    bar(x, y, 82, hp, color);
    if (numbers.checked) centeredCount(String(count), x, y + 20);
  },
});
function damage() {
  const get = (id: string) =>
    damageUnits.find((r) => r.id === field<HTMLSelectElement>(id).value)!;
  const rows: [DamageUnit, DamageUnit, DamageUnit] = [
    get("damage-melee"),
    get("damage-target"),
    get("damage-ranged"),
  ];
  if (!rows.every((r) => assets.has(r.id))) {
    text("Loading chosen troops…", 55, 66);
    return;
  }
  const status = damageBattle.render(clock, rows, proposed.checked);
  canvas.dataset.battleDeaths = String(status.deaths);
  canvas.dataset.battleRetargets = String(status.retargets);
  canvas.dataset.battleImpacts = String(status.impacts);
  canvas.dataset.battleSeconds = String(status.seconds);
  canvas.dataset.rangedHits = String(status.rangedHits);
  canvas.dataset.rangedResolved = String(status.rangedResolved);
  text(
    "3 melee + 2 ranged formations per side · casualties and replacements",
    55,
    48,
  );
  text(
    `Blue ${status.alive[0]} soldiers · Red ${status.alive[1]} soldiers${status.finished ? " · Battle ended — Restart to replay" : ""}`,
    55,
    76,
    "#c2d5c2",
    15,
  );
  text(
    `Ranged impacts: ${status.rangedResolved ? Math.round((status.rangedHits / status.rangedResolved) * 100) : 0}% (${status.rangedResolved} resolved shots) · lead aim + dispersion`,
    55,
    99,
    "#aac9b7",
    13,
  );
  text(
    "Local visual encounter; combat values here are illustrative, not game balance.",
    55,
    670,
    "#b4ccbb",
    14,
  );
}
function aircraft(
  kind: string,
  x: number,
  y: number,
  angle: number,
  size: number,
  hp: number,
  fuel: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const img = images.get(kind)!;
  const animation = aircraftFrames.get(kind)!;
  const frame =
    animation.frames[
      Math.floor((clock * animation.fps) / 1000) % animation.frames.length
    ];
  ctx.drawImage(
    img,
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
  pickTargets.push({
    id: `aircraft:${kind}`,
    left: x - size / 2,
    right: x + size / 2,
    top: y - size / 2,
    bottom: y + size / 2 + 20,
  });
  if (proposed.checked && inspected(`aircraft:${kind}`)) {
    bar(x, y + size * 0.5 + 4, 40, hp, "#9dd894");
    bar(x, y + size * 0.5 + 12, 40, fuel, "#79b8dd");
  } else if (!proposed.checked)
    text(kind === "fighter" ? "F" : "B", x - 4, y + size / 2 + 14, "white", 10);
}
function air() {
  text("Fighter / bomber interception", 55, 66);
  const t = (clock % 7000) / 7000,
    bx = 1050 - t * 800,
    by = 330,
    fx = 300 + Math.sin(t * Math.PI * 2) * 70,
    fy = 290 + Math.cos(t * Math.PI * 2) * 40;
  aircraft(
    "bomber",
    bx,
    by,
    -Math.PI / 2,
    65,
    Math.max(0.15, 1 - t * 0.85),
    1 - t * 0.65,
  );
  aircraft(
    "fighter",
    fx,
    fy,
    Math.PI / 2,
    proposed.checked ? 48 : 60,
    0.9,
    1 - t * 0.6,
  );
  if (proposed.checked && Math.abs(bx - fx) < 190 && clock % 400 < 110) {
    const p = (clock % 400) / 110;
    line(
      fx + (bx - fx) * p,
      fy + (by - fy) * p,
      fx + (bx - fx) * p + 10,
      fy + (by - fy) * p,
      "#f1dba1",
      2,
    );
  }
  text(
    "Hover/select aircraft â€” upper: health, lower: flight time",
    55,
    635,
    "#c0d5c5",
    16,
  );
}
const cycle: Record<string, number> = {
  javelin: 2500,
  bow: 2500,
  crossbow: 4000,
  musket: 6000,
  grenadier: 6000,
  rifle: 3500,
};
function weapons() {
  const key = field<HTMLSelectElement>("weapon").value;
  const length = cycle[key],
    ms = clock % length,
    asset = assets.get(key)!;
  let clip = "idle",
    clipMs = 0,
    shots: number[] = [0],
    shotAt = 0;
  if (key === "grenadier") {
    shots = [1640];
    shotAt = 1640;
    if (ms < 1060) {
      clip = "charge-attack";
      clipMs = ms;
    } else if (ms < 2110) {
      clip = "attack";
      clipMs = ms - 1060;
    } else if (ms < 4010) {
      clip = "reload";
      clipMs = ms - 2110;
    }
  } else if (key === "rifle") {
    shots = [580, 930, 1280];
    shotAt = 1280;
    if (ms < 1580) {
      clip = "attack";
      clipMs = ms < 580 ? ms : 580 + ((ms - 580) % 350);
    } else {
      clip = "reload";
      clipMs = ms - 1580;
    }
  } else {
    const reload = asset.clips.find((c) => c.id === "reload")!,
      reloadMs = reload.durations?.reduce((a, b) => a + b, 0) ?? 1800;
    const attackClip = asset.clips.find((c) => c.id === "attack")!;
    const attackMs = attackClip.durations!.reduce((a, b) => a + b, 0);
    shotAt = attackClip
      .durations!.slice(0, attackClip.releaseFrame ?? 3)
      .reduce((a, b) => a + b, 0);
    shots = [shotAt];
    if (ms < attackMs) {
      clip = "attack";
      clipMs = ms;
    } else if (ms < Math.min(length, attackMs + reloadMs)) {
      clip = "reload";
      clipMs =
        ((ms - attackMs) * reloadMs) / Math.min(reloadMs, length - attackMs);
    }
  }
  if (!proposed.checked && clip === "reload") clip = "idle";
  text(
    `${key} Â· ${clip} Â· ${(length / 1000).toFixed(1)}s proposed cycle`,
    55,
    66,
  );
  if (proposed.checked) {
    const destination = key === "grenadier" ? 511 : 785;
    for (const at of shots) {
      groundImpacts(
        key,
        destination,
        360,
        ms - at - 180,
        Math.floor(clock / length) * 3 + at,
      );
      if (clock >= length)
        groundImpacts(
          key,
          destination,
          360,
          ms + length - at - 180,
          (Math.floor(clock / length) - 1) * 3 + at,
        );
    }
  }
  squad(415, 360, key, clip, clipMs, -Math.PI / 2, "#80b5e2");
  squad(
    key === "grenadier" ? 511 : 785,
    360,
    "club",
    "idle",
    clock,
    Math.PI / 2,
    "#e39485",
    0.7,
  );
  for (const at of shots) {
    const delta = ms - at;
    if (delta >= 0 && delta < 180)
      for (const s of slots) {
        const destination = key === "grenadier" ? 511 : 785;
        const x = 415 + s.x * 94 + (destination - 415) * (delta / 180);
        drawPreviewProjectile(
          ctx,
          key === "crossbow"
            ? "bolt"
            : ["bow", "javelin"].includes(key)
              ? key
              : "bullet",
          x,
          360 + s.y * 94,
          0,
        );
      }
  }
  if (
    smoke.checked &&
    proposed.checked &&
    ["musket", "grenadier"].includes(key)
  ) {
    const age = ms - shotAt;
    if (age >= 0 && age < 2300) {
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = `rgba(204,211,195,${0.09 * (1 - age / 2300)})`;
        ctx.beginPath();
        ctx.ellipse(
          435 + (i % 6) * 10 + age * 0.035,
          335 + Math.floor(i / 6) * 20 - age * 0.015,
          14 + age * 0.014,
          9 + age * 0.009,
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }
  bar(600, 590, 940, ms / length, "#97c594");
  text(
    "Presentation timeline only â€” balance and release ticks remain to be implemented",
    55,
    640,
    "#b8cfbf",
    15,
  );
}
function blast() {
  ctx.fillStyle = "#23392d";
  ctx.fillRect(0, 0, 1200, 700);
  ctx.strokeStyle = "#ffffff0b";
  ctx.lineWidth = 1;
  for (let x = 0; x < 1200; x += 15) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 700);
    ctx.stroke();
  }
  for (let y = 5; y < 700; y += 15) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }

  text("Atomic blast footprint", 55, 66);
  const scale = 15,
    x = 600,
    y = 365;
  ctx.fillStyle = "#d0a37318";
  ctx.beginPath();
  ctx.arc(x, y, 16 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e3b681";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#e0735345";
  ctx.beginPath();
  ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffa487";
  ctx.stroke();
  text("Current: 16 cells", 835, 215, "#e3b681", 17);
  text("Proposed: 12 cells", 635, 345, "#ffa487", 17);
  text(
    "56.25% of the circular area Â· damage unchanged",
    55,
    640,
    "#bfd2c4",
    17,
  );
}
function pacing() {
  text("Proposed age milestones â€” not measured balance", 55, 66);
  const ages = [
    "Bronze",
    "Classical",
    "Early medieval",
    "Late medieval",
    "Napoleonic",
    "Pre-modern",
    "Modern",
  ];
  const proposedTimes = [5, 11, 18, 26, 34, 43, 52.5];
  for (let i = 0; i < ages.length; i++) {
    const y = 120 + i * 58;
    text(ages[i], 55, y + 17, "#c9dacc", 16);
    ctx.fillStyle = "#97c38c";
    ctx.fillRect(215, y, proposedTimes[i] * 13, 20);
    text(
      `${proposedTimes[i]} min`,
      225 + proposedTimes[i] * 13,
      y + 17,
      "#bfd3be",
      14,
    );
  }
  text(
    "Modernization: unlock â†’ materials â†’ equipment â†’ protected refit window",
    55,
    585,
    "#a9cbe0",
    18,
  );
  text(
    "Confirmed: intermediate kits can be ignored when the newest tier is unaffordable.",
    55,
    628,
    "#e7bb95",
    16,
  );
}
const draws: Record<string, () => void> = {
  masks: () => {},
  scaling: () => {},
  alignment,
  damage,
  air,
  weapons,
  blast,
  pacing,
};
function frame(now: number) {
  if (last && !paused) clock += Math.min(100, now - last);
  last = now;
  pickTargets = [];
  ground();
  const zoom = Number(field<HTMLInputElement>("zoom").value) / 100;
  field("zoomValue").textContent = `${Math.round(zoom * 100)}%`;
  ctx.save();
  ctx.translate(600, 350);
  ctx.scale(zoom, zoom);
  ctx.translate(-600, -350);
  draws[scene]();
  hoverId = pickTargets.find(
    (p) =>
      pointer &&
      pointer.x >= p.left &&
      pointer.x <= p.right &&
      pointer.y >= p.top &&
      pointer.y <= p.bottom,
  )?.id;
  ctx.restore();
  requestAnimationFrame(frame);
}
update();
load()
  .then(() => {
    field("facts").textContent =
      "Artwork loaded. Click or hover a squad for its count.";
    requestAnimationFrame(frame);
  })
  .catch((e) => {
    field("error").textContent = "Asset load failed: " + e;
    console.error(e);
  });
