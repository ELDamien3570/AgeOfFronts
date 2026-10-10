import {
  clipFrame,
  type ActorManifest,
} from "../../../src/skirmish/client/troops/TroopFormationModel";
import audit from "./FormationScaleAudit.json";
type Row = (typeof audit.rows)[number];
type ActorAsset = {
  manifest: ActorManifest;
  images: Map<string, HTMLImageElement>;
};
export function installScaleGallery(
  section: HTMLElement,
  zoom: () => number,
  paused: () => boolean = () => false,
) {
  const root = document.createElement("div");
  root.className = "scale-review";
  root.hidden = true;
  root.innerHTML = `<h2>Every land troop — Clubman scale review</h2><p>42 individual troop actors, including six vehicles, plus all 17 additional land-unit definitions. Left: Clubman for foot troops, proposed Druzhina for cavalry. Right: the troop. Foot troops match body size; horses match Druzhina horse size. Equipment is excluded from those measurements.</p><div class="scale-toolbar"><label><input type="checkbox" data-current> Use current size settings</label><label>Pose <select data-pose><option value="idle">Idle</option><option value="running">Walking</option><option value="attack">Attack</option></select></label><label><input type="checkbox" data-animate> Animate</label><label><input type="checkbox" data-guides checked> Reference-size guide</label></div><p data-status>Loading scale gallery…</p><h3>Soldiers and cavalry riders — common scale</h3><div class="scale-human-grid"></div><h3>Vehicles — existing physical hull sizes retained</h3><p>Vehicle cards use half the human-gallery magnification, including their Clubman reference. Hulls have not been resized to a human body.</p><div class="scale-vehicle-grid"></div><h3>Other recruitable land units — existing composed artwork</h3><p>These use the game's existing composed-art/icon path, not individual-soldier scaling. Their scale is unchanged and is shown separately so no troop is omitted.</p><div class="scale-extra-grid"></div>`;
  const style = document.createElement("style");
  style.textContent = `.scale-review[hidden]{display:none}.scale-review h2{margin-top:0}.scale-review p{line-height:1.55;color:#bed0c2}.scale-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:18px;border:1px solid #3a5147;padding:12px}.scale-toolbar label{margin:0}.scale-toolbar select{width:auto;margin-left:6px}.scale-human-grid,.scale-extra-grid{display:grid;grid-template-columns:repeat(auto-fill,var(--scale-card,220px));gap:12px}.scale-vehicle-grid{display:grid;grid-template-columns:repeat(auto-fill,var(--vehicle-card,500px));gap:12px}.scale-card{padding:10px;background:#1b2b29;border:1px solid #3a5147;border-radius:7px}.scale-card h4{margin:0 0 5px;font-size:14px;min-height:34px}.scale-card small{display:block;color:#9cb5a9;min-height:34px}.scale-card canvas{display:block;width:230px;height:320px;border:none;border-radius:0;background:#21392e}.scale-vehicle-grid canvas{width:480px;height:500px}.scale-extra-grid canvas{height:220px}.scale-change{padding-top:8px;color:#d0e0cb;font:12px system-ui}.scale-source{font-size:11px;overflow-wrap:anywhere;color:#aebead;margin-top:6px}.scale-warn{color:#e0b286}`;
  document.head.append(style);
  section.insertBefore(root, section.firstChild);
  const controls = {
    current: root.querySelector<HTMLInputElement>("[data-current]")!,
    pose: root.querySelector<HTMLSelectElement>("[data-pose]")!,
    animate: root.querySelector<HTMLInputElement>("[data-animate]")!,
    guides: root.querySelector<HTMLInputElement>("[data-guides]")!,
  };
  const assets = new Map<string, ActorAsset>(),
    legacy = new Map<string, HTMLImageElement>();
  const cards: { row: Row; canvas: HTMLCanvasElement; note: HTMLElement }[] =
    [];
  async function loadImage(url: string) {
    const img = new Image();
    img.src = encodeURI(url);
    await img.decode();
    return img;
  }
  async function actor(row: Row) {
    if (!row.actor) return;
    const base = row.actor.assetRoot,
      response = await fetch(encodeURI(base + "animations.json"));
    if (!response.ok) throw Error(base);
    const manifest: ActorManifest = await response.json();
    const clip = manifest.animations.find((c) => c.id === "idle")!;
    assets.set(row.id, {
      manifest,
      images: new Map([["idle", await loadImage(base + clip.file)]]),
    });
  }
  for (const row of audit.rows) {
    const card = document.createElement("article");
    card.className = "scale-card";
    card.dataset.unit = row.id;
    const h = document.createElement("h4");
    h.textContent = row.name;
    card.append(h);
    const subtitle = document.createElement("small");
    subtitle.textContent = `${row.ageName} · ${row.troopClass}`;
    card.append(subtitle);
    const canvas = document.createElement("canvas");
    canvas.width = row.actor?.vehicle ? 480 : 230;
    canvas.height = row.actor?.vehicle ? 500 : row.actor ? 320 : 220;
    card.append(canvas);
    const note = document.createElement("div");
    note.className = "scale-change";
    card.append(note);
    const source = document.createElement("div");
    source.className = "scale-source";
    source.textContent = row.actor
      ? `${row.actor.key}${row.topDownVerified ? " · Top-down review source ✓" : ""}`
      : row.art
        ? "Composed artwork · unchanged"
        : "Dedicated troop artwork missing";
    card.append(source);
    const group = row.actor?.vehicle
      ? "vehicle"
      : row.actor
        ? "human"
        : "extra";
    root.querySelector(`.scale-${group}-grid`)!.append(card);
    cards.push({ row, canvas, note });
  }
  function drawActor(
    context: CanvasRenderingContext2D,
    row: Row,
    x: number,
    y: number,
    pixels: number,
    scale: number,
    pose: string,
    time: number,
    alpha = 1,
  ) {
    const asset = assets.get(row.id);
    if (!asset) return;
    const clip =
      asset.manifest.animations.find((c) => c.id === pose) ??
      asset.manifest.animations.find((c) => c.id === "idle")!;
    const img = asset.images.get(clip.id);
    if (!img) return;
    const idle = asset.manifest.animations.find((c) => c.id === "idle")!;
    const frame = clip.frames[clipFrame(clip, time)],
      size =
        (audit.reference.footprint * pixels * scale * (clip.scale ?? 1)) /
        (idle.scale ?? 1);
    context.save();
    context.globalAlpha = alpha;
    context.translate(x, y);
    const calibration = row.scale as typeof row.scale & {
      bodyAnchorsPx128?: Record<string, { x: number; y: number }>;
      reviewFacingOffset?: number;
    };
    const anchor =
      controls.current.checked || row.actor?.vehicle
        ? frame.pivot
        : calibration?.bodyAnchorsPx128?.[clip.id]
          ? {
              x: (calibration.bodyAnchorsPx128[clip.id].x * frame.width) / 128,
              y: (calibration.bodyAnchorsPx128[clip.id].y * frame.height) / 128,
            }
          : frame.pivot;
    context.rotate(
      controls.current.checked
        ? (row.actor?.facingOffset ?? 0)
        : (calibration?.reviewFacingOffset ?? row.actor?.facingOffset ?? 0),
    );
    context.drawImage(
      img,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      (-size * anchor.x) / frame.width,
      (-size * anchor.y) / frame.height,
      size,
      size,
    );
    context.restore();
  }
  const club = audit.rows.find((r) => r.binding === audit.reference.binding)!;
  const druzhina = audit.rows.find(
    (r) => r.binding === "EarlyMedieval:heavyCavalry",
  )!;
  function render(time: number) {
    if (root.hidden) return;
    const z = zoom();
    root.style.setProperty("--scale-card", `${200 * z + 20}px`);
    root.style.setProperty("--vehicle-card", `${480 * z + 20}px`);
    const pose = controls.pose.value,
      ms = controls.animate.checked ? time : 0;
    for (const { row, canvas, note } of cards) {
      const baseWidth = row.actor?.vehicle ? 480 : 200,
        baseHeight = row.actor?.vehicle ? 500 : row.actor ? 260 : 200;
      const width = Math.ceil(baseWidth * z),
        height = Math.ceil(baseHeight * z);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#21392e";
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.save();
      c.scale(z, z);
      const vehicle = !!row.actor?.vehicle,
        pixels = vehicle ? 48 : 96,
        baseY = vehicle ? 230 : 105;
      c.strokeStyle = "#d1dbc31f";
      c.beginPath();
      c.moveTo(0, baseY);
      c.lineTo(baseWidth, baseY);
      c.stroke();
      if (row.actor) {
        const cavalry =
          !vehicle &&
          ["lightCavalry", "heavyCavalry", "rangedCavalry"].includes(
            row.troopClass,
          );
        const reference = cavalry ? druzhina : club;
        const scale = controls.current.checked
          ? row.scale!.currentScale
          : row.scale!.proposedScale;
        drawActor(
          c,
          reference,
          vehicle ? 40 : 35,
          baseY,
          pixels,
          cavalry ? druzhina.scale!.proposedScale : club.scale!.currentScale,
          "idle",
          0,
          1,
        );
        drawActor(c, row, vehicle ? 270 : 135, baseY, pixels, scale, pose, ms);
        if (controls.guides.checked && !vehicle) {
          const span = cavalry
            ? (audit.reference.footprint *
                pixels *
                druzhina.scale!.proposedScale *
                90) /
              128
            : (audit.reference.footprint *
                pixels *
                audit.reference.memberScale *
                audit.reference.bodySpanPx128) /
              128;
          c.strokeStyle = "#c9e5ba55";
          c.setLineDash([3, 3]);
          for (const x of [35, 135]) {
            const width = cavalry ? span / 2 : span;
            c.strokeRect(x - width / 2, baseY - span / 2, width, span);
          }
          c.setLineDash([]);
        }
        const delta =
          (row.scale!.proposedScale / row.scale!.currentScale - 1) * 100;
        note.textContent = vehicle
          ? "Physical hull scale retained"
          : `Scale ${row.scale!.currentScale.toFixed(3)} → ${row.scale!.proposedScale.toFixed(3)} · ${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`;
        c.fillStyle = "#bed2ba";
        c.font = "11px system-ui";
        c.fillText(
          cavalry ? "Druzhina" : "Clubman",
          vehicle ? 10 : 9,
          baseHeight - 14,
        );
        c.fillText(
          controls.current.checked ? "Current size" : "Proposed size",
          vehicle ? 220 : 100,
          baseHeight - 14,
        );
      } else {
        const img = legacy.get(row.id);
        if (img) c.drawImage(img, baseWidth / 2 - 58, baseY - 58, 116, 116);
        else {
          c.fillStyle = "#97b6a0";
          c.font = "12px system-ui";
          c.fillText("Missing dedicated artwork", 20, baseY);
        }
        note.textContent = "No individual-body scale change";
      }
      c.restore();
    }
  }
  async function loadPose() {
    const pose = controls.pose.value;
    await Promise.all(
      audit.rows
        .filter((r) => r.actor)
        .map(async (row) => {
          const asset = assets.get(row.id)!;
          const clip = asset.manifest.animations.find((c) => c.id === pose);
          if (clip && !asset.images.has(pose))
            asset.images.set(
              pose,
              await loadImage(row.actor!.assetRoot + clip.file),
            );
        }),
    );
    elapsed = 0;
    render(elapsed);
  }
  controls.pose.onchange = () =>
    void loadPose().catch((e) => {
      root.querySelector("[data-status]")!.textContent = String(e);
    });
  let ready = false,
    next = 0,
    previous = 0,
    elapsed = 0;
  function frame(now: number) {
    if (previous && !paused() && !root.hidden && controls.animate.checked)
      elapsed += Math.min(100, now - previous);
    previous = now;
    if (ready && now >= next) {
      render(elapsed);
      next = now + 100;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  const loaded = Promise.all(
    audit.rows.map(async (row) => {
      if (row.actor) await actor(row);
      else if (row.art) {
        const file =
          (row.art as any).poster ??
          (row.art as any).file ??
          (row.art as any).clips?.idle?.file;
        if (file)
          legacy.set(
            row.id,
            await loadImage(
              `/Art/Runtime/${file.startsWith("unit-portrait-") || row.source?.includes("Russians") ? "Russians" : "Ages"}/${file}`,
            ),
          );
      }
    }),
  )
    .then(() => {
      ready = true;
      root.querySelector("[data-status]")!.textContent =
        "59 land-unit definitions loaded. Size, body-anchor and ATGM-facing proposals affect this gallery only; the three requested TopDownReview source corrections are already baked into their game assets.";
      render(0);
    })
    .catch((e) => {
      root.querySelector("[data-status]")!.textContent =
        "Gallery load failed: " + String(e);
      console.error(e);
    });
  return {
    show(visible: boolean) {
      root.hidden = !visible;
      canvasToggle(visible);
      if (visible) void loaded;
    },
    ready: loaded,
  };
  function canvasToggle(visible: boolean) {
    section.querySelector<HTMLCanvasElement>("#canvas")!.hidden = visible;
  }
}
