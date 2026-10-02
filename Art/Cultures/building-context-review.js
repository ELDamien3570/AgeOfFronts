import { loadCivIndex, loadCivManifest, selectedCiv, writeCivLocation, createCivDropdown } from "./civ-review.js";

// Context for the related building inspectors. Shared markers stay explicit;
// a missing cultural wall or aviation set never borrows unlabeled base artwork.
const kind = document.body.dataset.cultureInspection;
const configs = {
  walls: { toolbar: ".toolbar", panel: "#age-panel", extras: ["#ages", ".badge"], filter: asset => asset.id === "tower", empty: "No wall tiles have been authored for this culture yet. Tower artwork is shown below when available." },
  aviation: { toolbar: ".controls", panel: ".grid", extras: [], filter: asset => asset.age === "Modern" && asset.category === "Military Airstrip", empty: "No Modern aviation buildings have been authored for this culture yet." },
  markers: { toolbar: ".toolbar", extras: [], empty: "Role symbols are shared across cultures. This selector sets the inspection context; it does not substitute building artwork." }
};
const config = configs[kind];
const state = { civ: null, request: 0, manifests: new Map() };
const toolbar = document.querySelector(config.toolbar);
const basePanel = config.panel && document.querySelector(config.panel);
const label = document.createElement("label"); label.htmlFor = "culture"; label.textContent = "Culture ";
const select = document.createElement("select"); select.id = "culture"; select.setAttribute("aria-label", "Culture"); label.append(select); toolbar.prepend(label);
const notice = document.createElement("p"); notice.className = "note"; notice.id = "culture-notice"; notice.setAttribute("role", "status"); toolbar.after(notice);
const panel = document.createElement("div"); panel.id = "culture-artwork"; panel.className = "grid"; notice.after(panel);
const style = document.createElement("style"); style.textContent = "[hidden]{display:none!important}#culture-artwork img{display:block;width:100%;max-width:320px;max-height:320px;object-fit:contain;margin:auto}#culture-artwork article{padding:16px}#culture-artwork h2{font-size:16px;margin:0 0 8px}#culture-artwork p{font-size:12px;margin:8px 0}#culture-notice{margin:12px 0}"; document.head.append(style);
const extras = config.extras.map(selector => document.querySelector(selector));
if (kind === "walls") for (const id of ["view", "size", "ground", "towers", "grid", "reset"]) {
  const control = document.getElementById(id); extras.push(control.closest("label") || control);
}
const baseStatus = kind === "walls" && document.getElementById("status");
const baseNote = kind === "walls" && document.querySelector("p.note:not(#culture-notice)");
const link = document.createElement("a"); link.textContent = "Open building artwork ↗"; notice.after(link);
function renderAsset(asset, manifestUrl) {
  const card = document.createElement("article"), title = document.createElement("h2"), img = document.createElement("img"), description = document.createElement("p"), fileLink = document.createElement("a");
  title.textContent = `${state.civ.label} · ${asset.label}`; img.src = new URL(asset.file, manifestUrl).href; img.alt = `${state.civ.label} ${asset.age} ${asset.label}${asset.status ? ` ${asset.status}` : ""}`;
  description.textContent = `${asset.role} · ${asset.age}${asset.status ? ` · ${asset.status}` : ""}`; fileLink.href = img.src; fileLink.textContent = "Full-size PNG ↗"; fileLink.target = "_blank"; fileLink.rel = "noopener";
  card.append(title, img, description, fileLink); return card;
}
async function choose(civ) {
  const request = ++state.request; state.civ = civ; select.value = civ.id; writeCivLocation(civ.id);
  const cultural = civ.id !== "base";
  if (basePanel) basePanel.hidden = cultural;
  for (const element of extras) element.hidden = cultural;
  if (baseStatus) baseStatus.hidden = cultural;
  if (baseNote) baseNote.hidden = cultural;
  panel.replaceChildren(); panel.hidden = !cultural || kind === "markers";
  notice.textContent = kind === "markers" ? `${civ.label} · ${config.empty}` : cultural ? `${civ.label} · ${config.empty}` : "Base artwork selected. Original art remains available.";
  const gallery = new URL("../Building Icons/Top-Down-Correction-Review.html", import.meta.url); gallery.searchParams.set("civ", civ.id); link.href = gallery.href;
  if (kind === "aviation") {
    const airstripLink = toolbar.querySelector('a[href*="Top-Down-Correction-Review.html"]');
    const destination = new URL(airstripLink.href); destination.searchParams.set("civ", civ.id); airstripLink.href = destination.href;
  }
  if (!cultural || kind === "markers") return;
  try {
    if (!state.manifests.has(civ.id)) state.manifests.set(civ.id, loadCivManifest(civ).catch(error => { state.manifests.delete(civ.id); throw error; }));
    const manifest = await state.manifests.get(civ.id);
    if (request !== state.request) return;
    panel.replaceChildren(...manifest.data.assets.filter(config.filter).map(asset => renderAsset(asset, manifest.url)));
  } catch (error) { if (request === state.request) notice.textContent = `Could not load ${civ.label} artwork: ${error.message}`; }
}
try {
  const index = await loadCivIndex("buildings"); createCivDropdown(select, index, choose); await choose(selectedCiv(index));
} catch (error) { notice.textContent = `Could not load culture choices: ${error.message}`; }
