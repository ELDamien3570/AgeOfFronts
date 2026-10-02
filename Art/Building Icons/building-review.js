import { loadCivIndex, loadCivManifest, selectedCiv, writeCivLocation, createCivDropdown } from "../Cultures/civ-review.js";

// Inspection-only MVVM: manifests describe artwork; state describes this view.
const model = { index: null, assets: [], cache: new Map() };
const params = new URLSearchParams(location.search);
const vm = { civ: null, age: params.get("age") || "", category: params.get("category") || "", request: 0 };
const el = Object.fromEntries(["culture", "category", "age", "background", "count", "catalog", "empty", "compare", "compare-title", "close"].map(id => [id, document.getElementById(id)]));
const ageNames = { StoneAge: "Stone Age", BronzeAge: "Bronze Age", ClassicalAge: "Classical Age", EarlyMedieval: "Early Medieval", LateMedieval: "Late Medieval", EarlyModern: "Early Modern", Modern: "Modern" };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function image(url, label) {
  const img = node("img"); img.src = url; img.alt = label; img.loading = "lazy"; return img;
}
function compare(asset) {
  el["compare-title"].textContent = `${vm.civ.label} · ${asset.label} · ${ageNames[asset.age]}`;
  for (const kind of ["original", "corrected"]) {
    const url = kind === "original" ? asset.originalUrl : asset.fileUrl;
    const img = document.getElementById(kind + "-image");
    img.closest("figure").hidden = !url;
    if (url) { img.src = url; document.getElementById(kind + "-link").href = url; }
  }
  document.getElementById("original-caption").textContent = asset.originalNote || (vm.civ.id === "base" ? "Original" : "Base artwork");
  document.getElementById("corrected-caption").textContent = vm.civ.id === "base" ? "Top-down correction" : `${vm.civ.label}${asset.status ? ` · ${asset.status}` : ""}`;
  el.compare.showModal();
}
const view = {
  card(asset) {
    const card = node("article", "card"); card.dataset.culture = vm.civ.id; card.dataset.age = asset.age; card.dataset.category = asset.category;
    const preview = node("button", "preview"); preview.type = "button"; preview.setAttribute("aria-label", `Inspect ${vm.civ.label} ${asset.label}, ${ageNames[asset.age]}`);
    preview.append(image(asset.fileUrl, `${vm.civ.label} ${ageNames[asset.age]} ${asset.label}`)); preview.addEventListener("click", () => compare(asset));
    const caption = node("div", "caption"), label = node("div"); label.append(node("strong", "", asset.label), node("span", "", `${ageNames[asset.age]} · ${vm.civ.label}${asset.status ? ` · ${asset.status}` : ""}`));
    const link = node("a", "", "PNG ↗"); link.href = asset.fileUrl; link.download = ""; caption.append(label, link); card.append(preview, caption);
    if (asset.role) card.append(node("p", "role", asset.role));
    const samples = node("div", "samples");
    for (const size of [48, 64, 128]) {
      const figure = node("figure"), img = image(asset.fileUrl, `${asset.label} at ${size} pixels`); img.width = size; img.height = size;
      figure.append(img, node("figcaption", "", `${size} px`)); samples.append(figure);
    }
    card.append(samples); return card;
  },
  render() {
    const visible = model.assets.filter(asset => (!vm.age || asset.age === vm.age) && (!vm.category || (vm.category === "New facilities" ? asset.newFacility : asset.category === vm.category)));
    el.catalog.replaceChildren(...visible.map(asset => this.card(asset)));
    el.count.textContent = `${visible.length} ${visible.length === 1 ? "icon" : "icons"} · ${vm.civ.label}`;
    el.empty.hidden = visible.length > 0;
    el.empty.textContent = `No building artwork is available for ${vm.civ.label} in this selection yet. Select another age or building type.`;
    el.catalog.setAttribute("aria-busy", "false");
  }
};
function filter() {
  vm.age = el.age.value; vm.category = el.category.value;
  const url = new URL(location.href);
  for (const [key, value] of [["age", vm.age], ["category", vm.category]]) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  history.replaceState(null, "", url.pathname + url.search + url.hash); view.render();
}
async function select(civ) {
  const request = ++vm.request; vm.civ = civ; el.culture.value = civ.id; writeCivLocation(civ.id);
  model.assets = []; el.catalog.replaceChildren(); el.catalog.setAttribute("aria-busy", "true"); el.empty.hidden = true; el.count.textContent = `Loading ${civ.label}…`;
  try {
    if (!model.cache.has(civ.id)) model.cache.set(civ.id, loadCivManifest(civ).catch(error => { model.cache.delete(civ.id); throw error; }));
    const manifest = await model.cache.get(civ.id);
    if (request !== vm.request) return;
    model.assets = manifest.data.assets.map(asset => ({ ...asset, fileUrl: new URL(asset.file, manifest.url).href, originalUrl: asset.original ? new URL(asset.original, manifest.url).href : undefined }));
    for (const asset of model.assets) if (![...el.category.options].some(option => option.value === asset.category)) el.category.append(new Option(asset.category, asset.category));
    el.age.value = vm.age; el.category.value = vm.category; view.render();
  } catch (error) {
    if (request !== vm.request) return;
    el.catalog.setAttribute("aria-busy", "false"); el.count.textContent = "Artwork unavailable"; el.empty.hidden = false; el.empty.textContent = `Could not load ${civ.label} artwork: ${error.message}`;
  }
}
el.category.addEventListener("change", filter); el.age.addEventListener("change", filter);
el.background.addEventListener("change", () => { document.body.dataset.bg = el.background.value; });
el.close.addEventListener("click", () => el.compare.close()); el.compare.addEventListener("click", event => { if (event.target === el.compare) el.compare.close(); });
try {
  model.index = await loadCivIndex("buildings");
  createCivDropdown(el.culture, model.index, select);
  await select(selectedCiv(model.index));
} catch (error) { el.empty.hidden = false; el.empty.textContent = `Could not load cultures: ${error.message}`; el.count.textContent = "Cultures unavailable"; }
