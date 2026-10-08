import { loadCivIndex, loadCivManifest, selectedCiv, writeCivLocation, createCivTabs, civReviewUrl } from "../Cultures/civ-review.js";
const controls = Object.fromEntries(["category","age","animation","background"].map(id => [id, document.getElementById(id)]));
const ages={StoneAge:"Stone Age",BronzeAge:"Bronze Age",ClassicalAge:"Classical Age",EarlyMedieval:"Early Medieval",LateMedieval:"Late Medieval",EarlyModern:"Early Modern",Modern:"Modern"};
// Only inspection selection lives here; production entities are not changed.
const model = {civ:null, manifest:null, units:[], request:0};
const index = await loadCivIndex("siege");
const cache = new Map();
const setCivTabs = createCivTabs(document.getElementById("cultures"), index, "units", civ => selectCiv(civ));
const params = new URLSearchParams(location.search);
for (const key of Object.keys(controls))
  if (params.has(key) && [...controls[key].options].some(option => option.value === params.get(key)))
    controls[key].value = params.get(key);
function normalise(manifest) {
  return manifest.data.units.map(unit => ({
    ...unit, directoryUrl:new URL(unit.directory + "/", manifest.url).href,
    iconUrl:new URL(unit.icon || unit.directory + "/Icon.png", manifest.url).href,
    clips:Object.fromEntries(Object.entries(unit.animations || unit.clips).map(([id, clip]) => [id, {
      count:clip.frameCount || clip.count, duration:clip.durationMs || clip.duration,
      sheet:clip.file || clip.sheet, preview:clip.preview,
      frames:clip.frames.map(frame => typeof frame === "string" ? frame : frame.file),
    }])),
  }));
}
function show() {
  document.body.className = "bg-" + controls.background.value;
  const selected = model.units.filter(unit =>
    (controls.category.value === "all" || unit.category === controls.category.value) &&
    (controls.age.value === "all" || unit.age === controls.age.value));
  document.getElementById("count").textContent = selected.length + " / " + model.units.length + " units";
  const main = document.getElementById("units"); main.replaceChildren();
  main.setAttribute("aria-labelledby", "civ-" + model.civ.id);
  document.querySelector("h1").textContent = model.civ.label + " · " + (model.manifest.data.title || "Weapons across the ages");
  document.title = document.querySelector("h1").textContent + " — Art Review";
  document.getElementById("clip-notes").hidden = !model.units.length;
  document.getElementById("manifest-link").href = model.manifest.url;
  document.getElementById("soldiers-link").href = civReviewUrl(document.getElementById("soldiers-link").href, model.civ.id).href;
  for (const name of ["prompts","validation"]) {
    const link = document.getElementById(name + "-link");
    link.hidden = !model.civ.resources[name];
    if (model.civ.resources[name]) link.href = model.civ.resources[name];
  }
  const frameSize = model.manifest.data.frameSize;
  document.getElementById("catalog-summary").textContent = model.manifest.data.summary ||
    model.units.length + " crewed units · " + frameSize.width + " × " + frameSize.height +
    " transparent frames · one upward-facing set per unit. Inspect idle, movement and attack on dark, light or checkerboard backgrounds.";
  document.getElementById("artwork-contract").textContent = frameSize ?
    "Camera: vertical overhead · Facing: " + model.manifest.data.facing +
    " · Frame: " + frameSize.width + " × " + frameSize.height + " · Alpha: straight" :
    "Siege artwork for " + model.civ.label + " is awaiting its first prototype.";
  for (const unit of selected) {
    const card = document.createElement("article"); card.className = "card"; card.dataset.key = unit.key;
    const canvas = document.createElement("div"); canvas.className = "canvas";
    const image = document.createElement("img"); image.alt = unit.label + " from directly above";
    image.width = frameSize.width; image.height = frameSize.height; canvas.append(image);
    const info = document.createElement("div"); info.className = "info";
    const title = document.createElement("h2"); title.textContent = unit.label;
    const meta = document.createElement("div"); meta.className = "meta";
    meta.textContent = (ages[unit.age] || unit.age) + " · " + unit.category; info.append(title,meta);
    const buttons = document.createElement("div"); buttons.className = "buttons";
    const sliderRow = document.createElement("div"); sliderRow.className = "frames";
    const slider = document.createElement("input"); slider.type = "range"; slider.min = 0; slider.step = 1;
    slider.setAttribute("aria-label", unit.label + " frame");
    const position = document.createElement("span"); sliderRow.append(slider,position);
    const links = document.createElement("div"); links.className = "links"; let active = "icon";
    const link = (label, file) => {
      const anchor = document.createElement("a"); anchor.textContent = label;
      anchor.href = new URL(file, unit.directoryUrl).href; links.append(anchor);
    };
    function change(clip, once=false) {
      active = clip;
      image.src = clip === "icon" ? unit.iconUrl :
        new URL(once ? "Attack-OneShot.webp" : unit.clips[clip].preview, unit.directoryUrl).href +
        (once ? "?play=" + Date.now() : "");
      for (const button of buttons.children) button.classList.toggle("active",button.dataset.clip === clip && !once);
      slider.disabled = clip === "icon"; slider.max = clip === "icon" ? 0 : unit.clips[clip].count-1;
      slider.value = 0; position.textContent = clip === "icon" ? "Still" :
        unit.clips[clip].count + " frames · " + unit.clips[clip].duration/1000 + " s";
      links.replaceChildren(); link("Icon PNG","Icon.png");
      if (clip !== "icon") link("Sprite sheet",unit.clips[clip].sheet);
      link("Frames","Frames/"); link("Metadata","animations.json"); link("Prompts","generation-prompts.json");
    }
    for (const [clip,label] of [["icon","Still"],["idle","Idle"],["movement","Move"],["attack","Attack"]]) {
      const button = document.createElement("button"); button.textContent = label; button.dataset.clip = clip;
      button.onclick = () => change(clip); buttons.append(button);
    }
    const once = document.createElement("button"); once.textContent = "Attack once";
    once.onclick = () => change("attack",true); buttons.append(once);
    slider.oninput = () => {
      if (active === "icon") return;
      image.src = new URL(unit.clips[active].frames[Number(slider.value)],unit.directoryUrl).href;
      position.textContent = "Frame " + (Number(slider.value)+1) + " / " + unit.clips[active].count;
      for (const button of buttons.children) button.classList.remove("active");
    };
    info.append(buttons,sliderRow,links); card.append(canvas,info); main.append(card);
    change(controls.animation.value);
  }
  if (!selected.length) {
    const empty = document.createElement("p"); empty.className = "empty";
    empty.textContent = model.units.length ? "No weapon proposals for this selection." :
      model.manifest.data.emptyMessage || "No " + model.civ.label + " siege artwork has been authored yet.";
    main.append(empty);
  }
  const url = new URL(location.href);
  for (const key of Object.keys(controls)) {
    if (["all","icon","dark"].includes(controls[key].value)) url.searchParams.delete(key);
    else url.searchParams.set(key,controls[key].value);
  }
  history.replaceState(null,"",url.pathname+url.search+url.hash);
  writeCivLocation(model.civ.id);
  main.setAttribute("aria-busy","false");
}
async function selectCiv(civ) {
  const request = ++model.request; model.civ = civ; setCivTabs(civ.id);
  model.manifest = null; model.units = [];
  for (const control of Object.values(controls)) control.disabled = true;
  const main = document.getElementById("units"); main.replaceChildren(); main.setAttribute("aria-busy","true");
  document.getElementById("count").textContent = "Loading " + civ.label + "…";
  try {
    if (!cache.has(civ.id)) cache.set(civ.id,loadCivManifest(civ));
    const manifest = await cache.get(civ.id);
    if (request !== model.request) return;
    model.manifest = manifest; model.units = normalise(manifest);
    for (const control of Object.values(controls)) control.disabled = false;
    show();
  } catch (error) {
    if (request !== model.request) return;
    cache.delete(civ.id); main.textContent = String(error.message || error);
    main.setAttribute("aria-busy","false"); document.getElementById("count").textContent = "Manifest unavailable";
  }
}
Object.values(controls).forEach(control => control.addEventListener("change", () => { if (model.manifest) show(); }));
window.addEventListener("popstate", () => selectCiv(selectedCiv(index)));
await selectCiv(selectedCiv(index));
