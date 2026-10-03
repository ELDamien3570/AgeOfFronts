import { loadCivIndex, loadCivManifest, selectedCiv, writeCivLocation, createCivTabs, civReviewUrl } from "../Cultures/civ-review.js";
const elements = Object.fromEntries(["cultures", "ages", "clips", "age-panel", "play", "restart", "frame", "frame-output", "review-title", "review-subtitle", "badge", "status", "pivot", "background", "speed", "repeat"].map(id => [id, document.getElementById(id)]));
// The view model owns inspection playback and selection, never combat or movement.
const model = { civ: null, manifest: null, ageId: location.hash.slice(1) || "StoneAge",
  clips: [], playing: true, elapsed: 0, manualFrame: 0, request: 0, repeatOneShots: false };
const manifestCache = new Map();
const index = await loadCivIndex("soldiers");
const setCivTabs = createCivTabs(elements.cultures, index, "age-panel", civ => selectCiv(civ));
const reviewLoad = Date.now();
function resetPlayback() {
  model.elapsed = 0; model.manualFrame = 0;
  for (const clip of model.clips) clip.startedAt = 0;
  elements.frame.value = "0";
}
function cardFor(unit, metadata, definition, metadataUrl) {
  const card = document.createElement("article");
  card.dataset.clip = definition.id;
  const header = document.createElement("header");
  const title = document.createElement("h2"); title.textContent = unit.label;
  const state = document.createElement("span");
  state.textContent = definition.label || ({idle:"Idle",running:"Running",attack:"Attack"}[definition.id] || definition.id);
  header.append(title, state);
  const stage = document.createElement("div"); stage.className = "stage";
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  canvas.setAttribute("aria-label", unit.label + " " + state.textContent + " animation");
  stage.append(canvas);
  const footer = document.createElement("footer");
  const position = document.createElement("span"); position.className = "frame";
  const sheet = document.createElement("a"); sheet.textContent = "Open sheet ↗"; sheet.target = "_blank";
  const url = new URL(definition.file, metadataUrl); url.searchParams.set("review", String(reviewLoad)); sheet.href = url.href;
  footer.append(position, sheet);
  if (unit.review) {
    const review = document.createElement("a"); review.textContent = unit.actorCount > 1 ? "Inspect formation ↗" : "Inspect actor ↗";
    const reviewUrl = new URL(unit.review, model.manifest.url); reviewUrl.hash = definition.id;
    review.href = reviewUrl.href; footer.append(review);
  }
  card.append(header, stage, footer);
  const image = new Image(); image.decoding = "async";
  const clip = { image, card, canvas, context: canvas.getContext("2d"), position, definition,
    defaultPivot: metadata.pivot || {x:256,y:256}, failed:false, startedAt:0 };
  if (!definition.loop) {
    const replay = document.createElement("button"); replay.type = "button"; replay.textContent = "Replay";
    replay.setAttribute("aria-label", "Replay " + state.textContent);
    replay.addEventListener("click", () => {
      clip.startedAt = model.elapsed; model.playing = true; elements.play.textContent = "Pause";
    });
    footer.append(replay);
  }
  image.onerror = () => { clip.failed = true; };
  image.onload = () => {
    const size = definition.sheetSize || metadata.sheetSize;
    if (image.naturalWidth !== size.width || image.naturalHeight !== size.height) clip.failed = true;
  };
  image.src = url.href;
  return clip;
}
function normalise(metadata) {
  const definitions = Array.isArray(metadata.animations) ? metadata.animations :
    Object.entries(metadata.animations).map(([id, clip]) => ({...clip, id}));
  return definitions.map(clip => ({
    ...clip, scale: clip.scale || 1,
    durations: clip.durations || Array(clip.frameCount).fill(1000 / clip.suggestedFramesPerSecond),
  }));
}
async function loadAge(id, updateLocation = true) {
  if (!model.manifest) return;
  const request = ++model.request;
  const age = model.manifest.data.ages.find(item => item.id === id) || model.manifest.data.ages[0];
  model.ageId = age.id; resetPlayback(); model.clips = []; elements.clips.replaceChildren();
  elements["age-panel"].setAttribute("aria-busy", "true");
  elements["age-panel"].setAttribute("aria-labelledby", "civ-" + model.civ.id + " tab-" + age.id);
  elements["review-title"].textContent = model.civ.label + " · " + age.label + " · Animation Review";
  elements["review-subtitle"].textContent = age.subtitle;
  document.title = model.civ.label + " · " + age.label + " — Animation Review";
  for (const tab of elements.ages.children) {
    const active = tab.dataset.age === age.id;
    tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
  }
  if (updateLocation) writeCivLocation(model.civ.id, age.id);
  elements.status.textContent = "Loading " + model.civ.label + " · " + age.label + "…";
  const units = model.manifest.data.units.filter(unit => unit.age === age.id);
  const results = await Promise.allSettled(units.map(async unit => {
    const metadataUrl = new URL(unit.metadata, model.manifest.url).href;
    const response = await fetch(metadataUrl, {cache:"no-store"});
    if (!response.ok) throw new Error("Missing animation metadata: " + unit.label);
    return {unit, metadata:await response.json(), metadataUrl};
  }));
  if (request !== model.request) return;
  const failures = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") { failures.push(units[i].label); continue; }
    const {unit, metadata, metadataUrl} = result.value;
    for (const definition of normalise(metadata)) {
      const clip = cardFor(unit, metadata, definition, metadataUrl);
      model.clips.push(clip); elements.clips.append(clip.card);
    }
  }
  model.metadataFailures = failures;
  if (failures.length && !model.clips.length) elements.status.textContent = "Could not load animation metadata: " + failures.join(", ");
  const maxFrames = Math.max(1, ...model.clips.map(clip => clip.definition.frameCount));
  elements.frame.max = String(maxFrames - 1);
  elements["frame-output"].textContent = "1 / " + maxFrames;
  elements.badge.textContent = model.clips.length + " clips · transparent PNG";
  for (const id of ["play","restart","previous","next","frame"]) document.getElementById(id).disabled = model.clips.length === 0;
  if (!units.length) {
    const empty = document.createElement("p"); empty.className = "empty";
    empty.textContent = "No soldier art has been authored for " + model.civ.label + " in " + age.label + " yet.";
    elements.clips.append(empty);
    elements.status.textContent = "Choose another age or the Base tab to inspect existing artwork.";
    elements["age-panel"].setAttribute("aria-busy", "false");
  }
}
async function selectCiv(civ, updateLocation = true) {
  const request = ++model.request;
  model.civ = civ; setCivTabs(civ.id);
  document.getElementById("siege-link").href = civReviewUrl(document.getElementById("siege-link").href, civ.id).href;
  model.manifest = null;
  model.clips = []; elements.clips.replaceChildren();
  elements.status.textContent = "Loading " + civ.label + " art manifest…";
  for (const tab of elements.ages.children) tab.disabled = true;
  try {
    if (!manifestCache.has(civ.id)) manifestCache.set(civ.id, loadCivManifest(civ));
    const manifest = await manifestCache.get(civ.id);
    if (request !== model.request) return;
    model.manifest = manifest;
    model.repeatOneShots = Boolean(manifest.data.repeatOneShots);
    elements.repeat.checked = model.repeatOneShots;
    elements.ages.replaceChildren();
    for (const [position, age] of manifest.data.ages.entries()) {
      const tab = document.createElement("button");
      tab.type = "button"; tab.id = "tab-" + age.id; tab.dataset.age = age.id;
      tab.textContent = age.label; tab.setAttribute("role", "tab"); tab.setAttribute("aria-controls", "age-panel");
      tab.addEventListener("click", () => loadAge(age.id));
      tab.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowRight") next = (position+1)%manifest.data.ages.length;
        if (event.key === "ArrowLeft") next = (position+manifest.data.ages.length-1)%manifest.data.ages.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = manifest.data.ages.length-1;
        if (next === undefined) return;
        event.preventDefault(); event.stopPropagation();
        elements.ages.children[next].click(); elements.ages.children[next].focus();
      });
      elements.ages.append(tab);
    }
    await loadAge(model.ageId, updateLocation);
  } catch (error) {
    if (request !== model.request) return;
    manifestCache.delete(civ.id);
    elements.status.textContent = String(error.message || error);
    elements["age-panel"].setAttribute("aria-busy", "false");
  }
}
function pause() { model.playing = false; elements.play.textContent = "Play"; }
function selectFrame(frame) {
  pause(); const count = Number(elements.frame.max) + 1;
  model.manualFrame = (frame + count) % count;
  elements.frame.value = String(model.manualFrame);
}
elements.play.addEventListener("click", () => {
  model.playing = !model.playing; elements.play.textContent = model.playing ? "Pause" : "Play";
  if (model.playing) model.elapsed = model.manualFrame * 100;
});
elements.restart.addEventListener("click", () => { resetPlayback(); model.playing = true; elements.play.textContent = "Pause"; });
elements.repeat.addEventListener("change", () => { model.repeatOneShots = elements.repeat.checked; resetPlayback(); });
elements.frame.addEventListener("input", () => selectFrame(Number(elements.frame.value)));
document.getElementById("previous").addEventListener("click", () => selectFrame(model.manualFrame-1));
document.getElementById("next").addEventListener("click", () => selectFrame(model.manualFrame+1));
elements.background.addEventListener("change", () => document.body.classList.toggle("solid", elements.background.checked));
document.addEventListener("keydown", event => {
  if (["INPUT","SELECT","BUTTON"].includes(event.target.tagName)) return;
  if (event.key === " ") { event.preventDefault(); elements.play.click(); }
  if (event.key === "ArrowRight") selectFrame(model.manualFrame+1);
  if (event.key === "ArrowLeft") selectFrame(model.manualFrame-1);
});
function frameAt(clip) {
  if (!model.playing) return Math.min(clip.definition.frameCount - 1, model.manualFrame);
  const duration = clip.definition.durations.reduce((sum, value) => sum + value, 0);
  let time = Math.max(0, model.elapsed - clip.startedAt);
  if (clip.definition.loop) time %= duration;
  else if (model.repeatOneShots) time %= duration + (model.manifest.data.oneShotReviewPauseMs || 0);
  if (time >= duration) return clip.definition.frameCount - 1;
  let boundary = 0;
  return clip.definition.durations.findIndex(value => { boundary += value; return time < boundary; });
}
let previous = performance.now();
function render(now) {
  const delta = Math.min(100, now - previous); previous = now;
  if (model.playing) model.elapsed += delta * Number(elements.speed.value);
  let loaded = 0, failed = 0;
  for (const clip of model.clips) {
    const index = frameAt(clip), frame = clip.definition.frames[index];
    const ctx = clip.context; ctx.clearRect(0,0,512,512);
    if (clip.failed) failed++;
    else if (clip.image.complete && clip.image.naturalWidth) {
      loaded++; const pivot = frame.pivot || clip.defaultPivot, scale = clip.definition.scale;
      ctx.drawImage(clip.image,frame.x,frame.y,frame.width,frame.height,
        256-pivot.x*scale,256-pivot.y*scale,frame.width*scale,frame.height*scale);
    }
    if (elements.pivot.checked) {
      ctx.strokeStyle="#a5dfda"; ctx.lineWidth=1; ctx.beginPath();
      ctx.moveTo(236,256); ctx.lineTo(276,256); ctx.moveTo(256,236); ctx.lineTo(256,276); ctx.stroke();
    }
    clip.position.textContent="Frame "+(index+1)+" / "+clip.definition.frameCount;
    clip.canvas.dataset.frame = String(index);
  }
  if (model.clips.length) {
    const first = frameAt(model.clips[0]);
    if (model.playing) elements.frame.value = String(first);
    elements["frame-output"].textContent=(model.playing ? first+1 : model.manualFrame+1)+" / "+(Number(elements.frame.max)+1);
    elements["age-panel"].setAttribute("aria-busy", String(loaded+failed<model.clips.length));
    const label = model.civ.label+" · "+model.manifest.data.ages.find(age=>age.id===model.ageId).label;
    const errors = [...(model.metadataFailures||[]), ...(failed ? [failed+" unavailable sheets"] : [])];
    elements.status.textContent = errors.length ? label+": "+errors.join(", ") :
      loaded===model.clips.length ? "All "+loaded+" "+label+" clips loaded. "+(model.repeatOneShots ?
        "One-shot reactions repeat for review. Uncheck Repeat to hold the final pose." : "One-shot reactions hold their final pose. Use the card's Replay to restart.") :
        label+": "+loaded+" / "+model.clips.length+" clips loaded.";
  }
  requestAnimationFrame(render);
}
function loadLocation() {
  model.ageId = location.hash.slice(1) || "StoneAge";
  const civ = selectedCiv(index);
  if (model.civ?.id !== civ.id) selectCiv(civ, false);
  else loadAge(model.ageId, false);
}
window.addEventListener("hashchange", loadLocation);
window.addEventListener("popstate", loadLocation);
await selectCiv(selectedCiv(index), false);
requestAnimationFrame(render);
