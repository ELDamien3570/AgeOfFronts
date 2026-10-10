import {
  DEMO_BODY_WIDTH_PIXELS,
  demoActorMemberScale,
  demoActorSizeCorrection,
} from "./DemoActorCalibration";
import { DEMO_TROOPS } from "./DemoTroops";
import {
  clipFrame,
  type ActorClip,
  type ActorManifest,
} from "./TroopPrototypeModel";
const choice = document.querySelector<HTMLSelectElement>("#clip")!;
const cards = document.querySelector<HTMLElement>("#cards")!;
const assets = new Map<
  string,
  {
    manifest: ActorManifest;
    clips: Map<string, { clip: ActorClip; image: HTMLImageElement }>;
  }
>();
const panels = DEMO_TROOPS.map((troop) => {
  const card = document.createElement("div");
  card.className = "card";
  const title = document.createElement("strong");
  title.textContent = `${troop.age} � ${troop.name}`;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `Body span ~${DEMO_BODY_WIDTH_PIXELS[troop.name]}px � correction ${demoActorSizeCorrection(troop.name).toFixed(2)}� � ${troop.mounted ? "6 riders" : "12 soldiers"}`;
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 460;
  card.append(title, meta, canvas);
  cards.append(card);
  return { troop, canvas };
});
async function load() {
  await Promise.all(
    DEMO_TROOPS.map(async (troop) => {
      const root = `/Art/Cultures/Russians/Units/${troop.age}/${troop.name}/`;
      const response = await fetch(root + "animations.json");
      if (!response.ok) throw new Error(`Missing ${troop.name}`);
      const manifest: ActorManifest = await response.json();
      const clips = new Map<
        string,
        { clip: ActorClip; image: HTMLImageElement }
      >();
      await Promise.all(
        ["idle", "running", "attack", "death"].map(async (id) => {
          const clip = manifest.animations.find((c) => c.id === id)!;
          const image = new Image();
          image.src = root + clip.file;
          await image.decode();
          clips.set(id, { clip, image });
        }),
      );
      assets.set(troop.name, { manifest, clips });
    }),
  );
}
function draw(now: number) {
  const reference = assets.get("Clubman");
  for (const { troop, canvas } of panels) {
    const ctx = canvas.getContext("2d")!,
      data = assets.get(troop.name);
    if (!data || !reference) continue;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#c7cdbb";
    ctx.font = "22px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Before", 160, 36);
    ctx.fillText("Clubman target", 480, 36);
    const paint = (name: string, x: number, scale: number, alpha = 1) => {
      const data = assets.get(name)!,
        { clip, image } = data.clips.get(choice.value)!;
      const frame = clip.frames[clipFrame(clip, now % 2000)];
      const baseline =
        data.manifest.animations.find((c) => c.id === "idle")?.scale ?? 1;
      const size = (((380 * scale) / 0.5) * (clip.scale ?? 1)) / baseline;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(
        image,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        x - (size * frame.pivot.x) / frame.width,
        250 - (size * frame.pivot.y) / frame.height,
        size,
        size,
      );
      ctx.restore();
    };
    const previous = troop.mounted ? demoActorMemberScale(troop.name) : 0.24;
    paint(troop.name, 160, previous);
    paint("Clubman", 480, 0.24, 0.2);
    paint(troop.name, 480, demoActorMemberScale(troop.name));
  }
  requestAnimationFrame(draw);
}
void load()
  .then(() => requestAnimationFrame(draw))
  .catch((error) => cards.prepend(document.createTextNode(String(error))));
