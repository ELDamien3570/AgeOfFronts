import {
  clipFrame,
  type ActorClip,
  type ActorManifest,
} from "../../../src/skirmish/client/troops/TroopFormationModel";
import { FACTION_PALETTE } from "../../../src/skirmish/lobby/FactionPalette";
import { tintMaskedPixels } from "./FactionMaskTint";
type MaskUnit = {
  id: string;
  name: string;
  metadata: string;
  materials: string[];
  sheets: { file: string; source: string; mask: string }[];
};
type MaskManifest = { age: string; units: MaskUnit[] };
type MaskFrame = {
  source: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  pixels: Uint8ClampedArray;
  coverage: Uint8ClampedArray;
  tinted: Map<string, HTMLCanvasElement>;
};
type Card = {
  unit: MaskUnit;
  age: string;
  url: URL;
  metadata?: ActorManifest;
  select: HTMLSelectElement;
  canvases: HTMLCanvasElement[];
  root: HTMLElement;
  frames: MaskFrame[];
  clip?: ActorClip;
  token: number;
  elapsed: number;
  status: HTMLElement;
};
const manifests = import.meta.glob<MaskManifest>(
  "/Art/Cultures/Russians/FactionMasks/*/manifest.json",
  { eager: true, import: "default" },
);
export function installFactionMaskGallery(
  section: HTMLElement,
  paused: () => boolean,
) {
  const root = document.createElement("div");
  root.hidden = true;
  root.className = "faction-mask-review";
  root.innerHTML = `<h2>Russian troop faction masks</h2><p>Original artwork beside two colors from the game's faction palette. Source shading and transparent pixels are preserved; only mask-selected materials change.</p><div class="mask-toolbar"><label>Faction A <select data-color-a></select></label><label>Faction B <select data-color-b></select></label><label>Age <select data-age><option value="all">All ready ages</option></select></label><label>Pose <select data-pose><option value="idle">Idle</option><option value="running">Running</option><option value="attack">Attack</option><option value="reload">Reload</option><option value="charge">Charge</option><option value="charge-attack">Charge attack</option><option value="hit">Hit</option><option value="death">Death</option></select></label><label><input type="checkbox" data-play checked> Animate</label><label><input type="checkbox" data-mask> Show mask in original column</label></div><p data-mask-status>Preparing masks…</p><div class="mask-cards"></div>`;
  const css = document.createElement("style");
  css.textContent = `.faction-mask-review[hidden]{display:none}.mask-toolbar{display:flex;gap:14px;flex-wrap:wrap;border:1px solid #3a5147;padding:12px}.mask-toolbar label{margin:0}.mask-toolbar select{width:auto}.mask-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(470px,1fr));gap:14px}.mask-card{background:#1b2b29;border:1px solid #3a5147;border-radius:7px;padding:12px}.mask-card h3{margin:0 0 8px}.mask-views{display:flex;gap:5px;justify-content:center}.mask-views figure{margin:0;min-width:0;flex:1;text-align:center}.mask-views canvas{width:100%;height:auto;border:none;background:#23392d}.mask-views figcaption{font-size:12px;margin:5px 0}.mask-card p{color:#afc4b7;font-size:12px;overflow-wrap:anywhere}.mask-card select{width:100%}.mask-card a{font-size:12px}.mask-card [data-card-status]{color:#e8c096}.faction-mask-review p{line-height:1.5}.mask-toolbar input{width:auto}`;
  document.head.append(css);
  section.insertBefore(root, section.firstChild);
  const a = root.querySelector<HTMLSelectElement>("[data-color-a]")!,
    b = root.querySelector<HTMLSelectElement>("[data-color-b]")!,
    age = root.querySelector<HTMLSelectElement>("[data-age]")!,
    pose = root.querySelector<HTMLSelectElement>("[data-pose]")!,
    play = root.querySelector<HTMLInputElement>("[data-play]")!,
    showMask = root.querySelector<HTMLInputElement>("[data-mask]")!;
  for (const select of [a, b])
    for (const color of FACTION_PALETTE) {
      const o = document.createElement("option");
      o.value = color.hex;
      o.textContent = color.name;
      select.append(o);
    }
  a.value = FACTION_PALETTE[0].hex;
  b.value = FACTION_PALETTE[1].hex;
  const cards: Card[] = [];
  const order = [
    "StoneAge",
    "BronzeAge",
    "ClassicalAge",
    "EarlyMedieval",
    "LateMedieval",
  ];
  const entries = Object.entries(manifests).sort(
    ([, x], [, y]) => order.indexOf(x.age) - order.indexOf(y.age),
  );
  for (const [path, manifest] of entries) {
    const option = document.createElement("option");
    option.value = manifest.age;
    option.textContent = manifest.age.replace(/([a-z])([A-Z])/g, "$1 $2");
    age.append(option);
    for (const unit of manifest.units) {
      const card = document.createElement("article");
      card.className = "mask-card";
      card.dataset.maskUnit = unit.id;
      const h = document.createElement("h3");
      h.textContent = `${manifest.age.replace(/([a-z])([A-Z])/g, "$1 $2")} · ${unit.name}`;
      card.append(h);
      const select = document.createElement("select");
      select.setAttribute("aria-label", unit.name + " animation");
      card.append(select);
      const views = document.createElement("div");
      views.className = "mask-views";
      const canvases = ["Original", "Faction A", "Faction B"].map((label) => {
        const figure = document.createElement("figure"),
          c = document.createElement("canvas"),
          caption = document.createElement("figcaption");
        c.width = c.height = 240;
        caption.textContent = label;
        figure.append(c, caption);
        views.append(figure);
        return c;
      });
      card.append(views);
      const note = document.createElement("p");
      note.textContent = `Masked materials: ${unit.materials.join(", ")}.`;
      card.append(note);
      const status = document.createElement("p");
      status.dataset.cardStatus = "";
      card.append(status);
      const link = document.createElement("a");
      link.textContent = "Source manifest";
      link.target = "_blank";
      const url = new URL(path, location.origin);
      link.href = new URL(unit.metadata, url).href;
      card.append(link);
      root.querySelector(".mask-cards")!.append(card);
      const state: Card = {
        unit,
        age: manifest.age,
        url,
        select,
        canvases,
        root: card,
        frames: [],
        token: 0,
        elapsed: 0,
        status,
      };
      cards.push(state);
      select.onchange = () => void prepare(state).catch((e) => fail(state, e));
    }
  }
  async function image(url: string) {
    const i = new Image();
    i.src = url;
    await i.decode();
    return i;
  }
  function fail(card: Card, error: unknown) {
    card.status.textContent = String(error);
    card.root.dataset.maskError = "true";
  }
  async function prepare(card: Card) {
    const token = ++card.token;
    card.status.textContent = "Loading animation…";
    const clip = card.metadata!.animations.find(
      (c) => c.id === card.select.value,
    )!;
    const size = 192,
      frames: MaskFrame[] = [];
    // Build small frame surfaces once; never retain recolored full sprite atlases.
    const sheets = new Map<
      string,
      { source: HTMLImageElement; mask: HTMLImageElement }
    >();
    for (const frame of clip.frames) {
      const file =
        (frame as typeof frame & { sheet?: string }).sheet ?? clip.file;
      const sheet = card.unit.sheets.find((s) => s.file === file);
      if (!sheet)
        throw Error(
          `No faction mask for ${file}; original art is not substituted.`,
        );
      if (!sheets.has(file)) {
        const [source, mask] = await Promise.all([
          image(new URL(sheet.source, card.url).href),
          image(new URL(sheet.mask, card.url).href),
        ]);
        if (
          source.naturalWidth !== mask.naturalWidth ||
          source.naturalHeight !== mask.naturalHeight
        )
          throw Error("Mask/source dimensions disagree: " + file);
        sheets.set(file, { source, mask });
      }
      const loaded = sheets.get(file)!;
      const source = document.createElement("canvas"),
        mask = document.createElement("canvas");
      source.width = source.height = mask.width = mask.height = size;
      const sc = source.getContext("2d", { willReadFrequently: true })!,
        mc = mask.getContext("2d", { willReadFrequently: true })!;
      sc.drawImage(
        loaded.source,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        size,
        size,
      );
      mc.drawImage(
        loaded.mask,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        0,
        0,
        size,
        size,
      );
      frames.push({
        source,
        mask,
        pixels: sc.getImageData(0, 0, size, size).data,
        coverage: mc.getImageData(0, 0, size, size).data,
        tinted: new Map(),
      });
    }
    if (token !== card.token) return;
    card.frames = frames;
    card.clip = clip;
    card.elapsed = 0;
    card.status.textContent = "";
    card.root.dataset.maskReady = "true";
    delete card.root.dataset.maskError;
    render(card);
  }
  function colored(frame: MaskFrame, color: string) {
    if (!frame.tinted.has(color)) {
      if (frame.tinted.size >= 2)
        frame.tinted.delete(frame.tinted.keys().next().value!);
      const c = document.createElement("canvas");
      c.width = c.height = 192;
      c.getContext("2d")!.putImageData(
        new ImageData(
          tintMaskedPixels(frame.pixels, frame.coverage, color),
          192,
          192,
        ),
        0,
        0,
      );
      frame.tinted.set(color, c);
    }
    return frame.tinted.get(color)!;
  }
  function render(card: Card) {
    if (card.root.hidden || !card.clip || !card.frames.length) return;
    const clip = card.clip,
      index = clipFrame(clip, card.elapsed),
      frame = card.frames[index],
      original = clip.frames[index];
    const idle = card.metadata!.animations.find((c) => c.id === "idle") ?? clip;
    const factor = (clip.scale ?? 1) / (idle.scale ?? 1);
    // Each view shares the same authored pivot and scale, with room for wide poses.
    const side = Math.max(240, Math.ceil(192 * factor + 48));
    const views = [
      showMask.checked ? frame.mask : frame.source,
      colored(frame, a.value),
      colored(frame, b.value),
    ];
    for (const [i, c] of card.canvases.entries()) {
      if (c.width !== side) c.width = c.height = side;
      const context = c.getContext("2d")!;
      context.clearRect(0, 0, side, side);
      context.drawImage(
        views[i],
        side / 2 - (original.pivot.x / original.width) * 192 * factor,
        side / 2 - (original.pivot.y / original.height) * 192 * factor,
        192 * factor,
        192 * factor,
      );
      const caption = c.nextElementSibling!;
      caption.textContent =
        i === 0
          ? showMask.checked
            ? "Mask coverage"
            : "Original"
          : FACTION_PALETTE.find(
              (p) => p.hex === (i === 1 ? a.value : b.value),
            )!.name;
    }
  }
  let loaded = false;
  async function initialize() {
    for (const card of cards) {
      try {
        const response = await fetch(new URL(card.unit.metadata, card.url));
        if (!response.ok) throw Error("Source metadata unavailable");
        card.metadata = await response.json();
        for (const clip of card.metadata!.animations) {
          const option = document.createElement("option");
          option.value = clip.id;
          option.textContent = clip.id;
          card.select.append(option);
        }
        card.select.value = card.metadata!.animations.some(
          (c) => c.id === "idle",
        )
          ? "idle"
          : card.metadata!.animations[0].id;
        await prepare(card);
      } catch (error) {
        fail(card, error);
      }
    }
    root.querySelector("[data-mask-status]")!.textContent =
      `${cards.length} masked troops across ${entries.length} ages · 20 game faction colors. Close-up material review; original art and game rendering remain unchanged.`;
  }
  for (const select of [a, b]) select.onchange = () => cards.forEach(render);
  showMask.onchange = () => cards.forEach(render);
  age.onchange = () => {
    for (const card of cards) {
      card.root.hidden = age.value !== "all" && card.age !== age.value;
      render(card);
    }
  };
  pose.onchange = () => {
    for (const card of cards) {
      if (!card.metadata) continue;
      const available = card.metadata.animations.some(
        (c) => c.id === pose.value,
      );
      card.select.value = available ? pose.value : "idle";
      void prepare(card).catch((e) => fail(card, e));
    }
  };
  let prior = 0,
    next = 0;
  function frame(now: number) {
    const dt = prior ? Math.min(100, now - prior) : 0;
    prior = now;
    if (!root.hidden && loaded) {
      if (!paused() && play.checked)
        for (const card of cards) card.elapsed += dt;
      if (now >= next) {
        for (const card of cards) render(card);
        next = now + 80;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return {
    show(visible: boolean) {
      root.hidden = !visible;
      if (visible && !loaded) {
        loaded = true;
        void initialize();
      }
    },
  };
}
