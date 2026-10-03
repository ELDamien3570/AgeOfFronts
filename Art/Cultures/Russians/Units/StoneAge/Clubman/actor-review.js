const asset = await fetch("./animations.json").then(response => {
  if (!response.ok) throw new Error("Animation data could not be loaded");
  return response.json();
});
const byId = new Map(asset.animations.map(clip => [clip.id, clip]));
const images = new Map();
const elements = Object.fromEntries(
  ["clips", "actor", "actor-panel", "clip-title", "description", "play", "restart",
   "previous", "next", "scrub", "frame-output", "speed", "backdrop", "facing",
   "anchor", "repeat", "status", "sheet"].map(id => [id, document.getElementById(id)]),
);

// This view model owns only review playback. It cannot affect a match.
class ActorReviewModel {
  constructor() {
    this.clipId = byId.has(location.hash.slice(1)) ? location.hash.slice(1) : "idle";
    this.elapsed = 0;
    this.frame = 0;
    this.playing = true;
    this.completed = false;
    this.speed = 1;
    this.repeat = elements.repeat.checked;
    this.angle = 0;
    this.anchor = false;
  }
  get clip() { return byId.get(this.clipId); }
  get duration() { return this.clip.durations.reduce((sum, value) => sum + value, 0); }
  select(id) {
    this.clipId = id;
    this.restart();
  }
  restart() {
    this.elapsed = 0;
    this.frame = 0;
    this.completed = false;
    this.playing = true;
  }
  seek(frame) {
    this.frame = Math.max(0, Math.min(this.clip.frameCount - 1, frame));
    this.elapsed = this.clip.durations.slice(0, this.frame).reduce((a, b) => a + b, 0);
    this.playing = false;
    this.completed = false;
  }
  advance(dt) {
    if (!this.playing || !images.has(this.clipId)) return;
    this.elapsed += dt * this.speed;
    const duration = this.duration;
    if (this.clip.loop) this.elapsed %= duration;
    else if (this.elapsed >= duration) {
      if (this.repeat && this.elapsed >= duration + 750) this.elapsed = 0;
      else {
        this.frame = this.clip.frameCount - 1;
        if (!this.repeat) { this.playing = false; this.completed = true; }
        return;
      }
    }
    let boundary = 0;
    this.frame = this.clip.durations.findIndex(value => {
      boundary += value;
      return this.elapsed < boundary;
    });
    if (this.frame < 0) this.frame = this.clip.frameCount - 1;
  }
}
const model = new ActorReviewModel();
const canvases = [{ element: elements.actor, footprint: 460 },
  ...Array.from(document.querySelectorAll("[data-size]")).map(element =>
    ({ element, footprint: Number(element.dataset.size) }))];
function draw() {
  const clip = model.clip;
  const image = images.get(model.clipId);
  const frame = clip.frames[model.frame];
  for (const { element, footprint } of canvases) {
    const context = element.getContext("2d");
    context.clearRect(0, 0, element.width, element.height);
    if (!image) continue;
    const scale = footprint / frame.width * clip.scale;
    context.save();
    context.translate(element.width / 2, element.height / 2);
    context.rotate(model.angle);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, frame.x, frame.y, frame.width, frame.height,
      -frame.pivot.x * scale, -frame.pivot.y * scale,
      frame.width * scale, frame.height * scale);
    context.restore();
    if (model.anchor) {
      context.strokeStyle = "#f1c59d";
      context.lineWidth = 1;
      const x = element.width / 2, y = element.height / 2;
      context.beginPath();
      context.moveTo(x - 6, y); context.lineTo(x + 6, y);
      context.moveTo(x, y - 6); context.lineTo(x, y + 6);
      context.stroke();
    }
  }
  elements.scrub.value = String(model.frame);
  elements["frame-output"].textContent = (model.frame + 1) + " / " + clip.frameCount;
  elements.play.textContent = model.playing ? "Pause" : "Play";
  elements.actor.dataset.clip = clip.id;
  elements.actor.dataset.frame = String(model.frame);
}
function updateClip() {
  const clip = model.clip;
  elements["clip-title"].textContent = clip.label + " · " + (clip.loop ? "Loop" : "Plays once");
  elements.description.textContent = clip.description;
  elements.sheet.href = clip.file;
  elements.scrub.max = String(clip.frameCount - 1);
  elements["actor-panel"].setAttribute("aria-labelledby", "clip-" + clip.id);
  for (const button of elements.clips.children) {
    const selected = button.dataset.clip === clip.id;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  draw();
}
const clips = asset.animations;
for (const [index, clip] of clips.entries()) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = "clip-" + clip.id;
  button.dataset.clip = clip.id;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", "actor-panel");
  button.append(document.createTextNode(clip.label));
  const detail = document.createElement("small");
  detail.textContent = clip.loop ? "LOOP" : "PLAYS ONCE";
  button.append(detail);
  button.addEventListener("click", () => {
    model.select(clip.id);
    history.replaceState(null, "", "#" + clip.id);
    updateClip();
  });
  button.addEventListener("keydown", event => {
    let next;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % clips.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index + clips.length - 1) % clips.length;
    if (next === undefined) return;
    event.preventDefault();
    elements.clips.children[next].click();
    elements.clips.children[next].focus();
  });
  elements.clips.append(button);
}
elements.play.addEventListener("click", () => {
  if (model.completed) model.restart();
  else model.playing = !model.playing;
  draw();
});
elements.restart.addEventListener("click", () => { model.restart(); draw(); });
elements.previous.addEventListener("click", () => { model.seek(model.frame - 1); draw(); });
elements.next.addEventListener("click", () => { model.seek(model.frame + 1); draw(); });
elements.scrub.addEventListener("input", () => { model.seek(Number(elements.scrub.value)); draw(); });
elements.speed.addEventListener("change", () => { model.speed = Number(elements.speed.value); });
elements.backdrop.addEventListener("change", () => { document.body.dataset.bg = elements.backdrop.value; });
elements.facing.addEventListener("change", () => { model.angle = Number(elements.facing.value) * Math.PI / 180; draw(); });
elements.anchor.addEventListener("change", () => { model.anchor = elements.anchor.checked; draw(); });
elements.repeat.addEventListener("change", () => {
  model.repeat = elements.repeat.checked;
  if (model.repeat && model.completed) model.restart();
});
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1);
  if (byId.has(id)) { model.select(id); updateClip(); }
});
updateClip();
const results = await Promise.allSettled(clips.map(async clip => {
  const image = new Image();
  image.decoding = "async";
  image.src = clip.file;
  await image.decode();
  if (image.naturalWidth !== asset.sheetSize.width || image.naturalHeight !== asset.sheetSize.height)
    throw new Error(clip.label + ": wrong sheet dimensions");
  images.set(clip.id, image);
}));
const failures = results.flatMap((result, index) => result.status === "rejected" ? [clips[index].label] : []);
elements.status.textContent = failures.length ? "Could not load: " + failures.join(", ") :
  "All " + clips.length + " clips loaded · one soldier · reactions hold their final frame.";
elements["actor-panel"].setAttribute("aria-busy", "false");
let previous = performance.now();
function animate(now) {
  model.advance(Math.min(100, now - previous));
  previous = now;
  draw();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
