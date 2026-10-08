import { AircraftAnimationReview } from './aircraft-animation-review.js';
import { REVIEW_AGES } from './review-ages.js';
import { loadCivIndex, loadCivManifest, selectedCiv, writeCivLocation, createCivDropdown } from "./civ-review.js";

// Context for the related building inspectors. Shared markers stay explicit;
// a missing cultural wall or aviation set never borrows unlabeled base artwork.
const kind = document.body.dataset.cultureInspection;
const configs = {
  walls: { toolbar: ".toolbar", panel: "#age-panel", extras: ["#ages", ".badge"], filter: asset => asset.id === "tower", empty: "No wall tiles have been authored for this culture yet. Tower artwork is shown below when available." },
  aviation: { toolbar: ".controls", panel: ".grid", extras: [], filter: asset => asset.age === state.age && asset.category === "Military Airstrip", empty: "No aviation artwork has been authored for this culture and age yet." },
  markers: { toolbar: ".toolbar", extras: [], empty: "Role symbols are shared across cultures. This selector sets the inspection context; it does not substitute building artwork." }
};
const config = configs[kind];
const state = { age: REVIEW_AGES.some(([id]) => id === location.hash.slice(1)) ? location.hash.slice(1) : "EarlyModern", civ: null, request: 0, manifests: new Map() };
const toolbar = document.querySelector(config.toolbar);
const basePanel = config.panel && document.querySelector(config.panel);
const aircraftPlayback = kind === "aviation" ? new AircraftAnimationReview(toolbar) : null;
const aircraftScale = kind === "aviation" && document.getElementById("aircraft-scale");
const label = document.createElement("label"); label.htmlFor = "culture"; label.textContent = "Culture ";
const select = document.createElement("select"); select.id = "culture"; select.setAttribute("aria-label", "Culture"); label.append(select); toolbar.prepend(label);
if (kind === "aviation") {
  const ageLabel = document.createElement("label"), ageSelect = document.createElement("select");
  ageLabel.textContent = "Age "; ageSelect.id = "aviation-age"; ageSelect.setAttribute("aria-label", "Aviation age");
  for (const [id, name] of REVIEW_AGES) { const option = document.createElement("option"); option.value = id; option.textContent = name; ageSelect.append(option); }
  ageSelect.value = state.age; ageLabel.append(ageSelect); toolbar.append(ageLabel);
  ageSelect.addEventListener("change", () => { state.age = ageSelect.value; if (state.civ) choose(state.civ); });
  window.addEventListener("hashchange", () => {
    const age = location.hash.slice(1);
    if (REVIEW_AGES.some(([id]) => id === age) && age !== state.age) { state.age = age; ageSelect.value = age; if (state.civ) choose(state.civ); }
  });
}
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
function renderAircraftScale(assets, manifestUrl) {
  if (!aircraftScale) return;
  const host = aircraftScale.querySelector("#aircraft-scale-table"), table = document.createElement("table");
  table.style.cssText = "width:100%;max-width:800px;margin-top:18px;background:var(--surface);border-collapse:collapse";
  const header = table.createTHead().insertRow();
  for (const label of ["Aircraft", "Parked · 28 px", "Flight · 42 px", "Detail · 64 px"]) {
    const cell = document.createElement("th"); cell.textContent = label; cell.scope = "col"; cell.style.padding = "16px 8px"; header.append(cell);
  }
  for (const asset of assets) {
    const row = table.insertRow(), label = document.createElement("th"); label.scope = "row"; label.textContent = asset.label; row.append(label);
    for (const size of [28, 42, 64]) {
      const cell = row.insertCell(), image = asset.metadata ? aircraftPlayback.canvas(asset, manifestUrl, size, size === 28 ? "parked" : "flight", false) : document.createElement("img");
      image.src = new URL(asset.file, manifestUrl).href; image.width = size; image.height = size;
      image.alt = `${asset.label} at ${size} pixels`; image.style.cssText = "display:block;margin:auto";
      cell.style.padding = "16px 8px"; cell.append(image);
    }
  }
  host.replaceChildren(table); aircraftScale.hidden = !assets.length;
}
async function choose(civ) {
  if (aircraftPlayback) aircraftPlayback.clear();
  const request = ++state.request; state.civ = civ; select.value = civ.id; writeCivLocation(civ.id);
  const cultural = civ.id !== "base";
  if (kind === "aviation") {
    const url = new URL(location.href); url.hash = state.age; history.replaceState(null, "", url);
    const ageName = REVIEW_AGES.find(([id]) => id === state.age)[1];
    document.querySelector("h1").textContent = `${civ.label} · ${ageName} · Aviation`;
    document.title = `${civ.label} · ${ageName} — Aviation review`;
    for (const card of basePanel.children) card.hidden = card.dataset.age !== state.age;
  }
  if (basePanel) basePanel.hidden = cultural;
  for (const element of extras) element.hidden = cultural;
  if (baseStatus) baseStatus.hidden = cultural;
  if (baseNote) baseNote.hidden = cultural;
  panel.replaceChildren(); panel.hidden = !cultural || kind === "markers";
  if (aircraftScale) { aircraftScale.hidden = true; aircraftScale.querySelector("#aircraft-scale-table").replaceChildren(); }
  notice.textContent = kind === "markers" ? `${civ.label} · ${config.empty}` : cultural ? `${civ.label} · ${config.empty}` : kind === "aviation" && ![...basePanel.children].some(card => !card.hidden) ? "Base · No aviation artwork for this age yet." : "Base artwork selected. Original art remains available.";
  const gallery = new URL("../Building Icons/Top-Down-Correction-Review.html", import.meta.url); gallery.searchParams.set("civ", civ.id); link.href = gallery.href;
  if (kind === "aviation") {
    const airstripLink = toolbar.querySelector('a[href*="Top-Down-Correction-Review.html"]');
    const destination = new URL(airstripLink.href); destination.searchParams.set("civ", civ.id); destination.searchParams.set("age", state.age); airstripLink.href = destination.href;
  }
  if (!cultural || kind === "markers") return;
  try {
    if (!state.manifests.has(civ.id)) state.manifests.set(civ.id, loadCivManifest(civ).catch(error => { state.manifests.delete(civ.id); throw error; }));
    const aircraftUrl = kind === "aviation" && civ.resources.aircraft;
    if (aircraftUrl && !state.manifests.has(aircraftUrl)) {
      state.manifests.set(aircraftUrl, loadCivManifest({manifestUrl: aircraftUrl}).catch(error => { state.manifests.delete(aircraftUrl); throw error; }));
    }
    const [manifest, aircraft] = await Promise.all([state.manifests.get(civ.id), aircraftUrl ? state.manifests.get(aircraftUrl) : null]);
    if (request !== state.request) return;
    const buildings = manifest.data.assets.filter(config.filter);
    const planes = aircraft ? aircraft.data.assets.filter(asset => asset.age === state.age && ["Fighter", "Bomber"].includes(asset.category)) : [];
    panel.replaceChildren(...planes.map(asset => asset.metadata ? aircraftPlayback.card(asset, aircraft.url) : renderAsset(asset, aircraft.url)), ...buildings.map(asset => renderAsset(asset, manifest.url)));
    if (kind === "aviation" && (buildings.length || planes.length)) {
      notice.textContent = `${civ.label} · ${buildings.length} airstrip artwork · ${planes.length} aircraft drafts. Animated preview; match integration unverified.`;
      if (aircraft) renderAircraftScale(planes, aircraft.url);
    }
  } catch (error) { if (request === state.request) notice.textContent = `Could not load ${civ.label} artwork: ${error.message}`; }
}
try {
  const index = await loadCivIndex("buildings"); createCivDropdown(select, index, choose); await choose(selectedCiv(index));
} catch (error) { notice.textContent = `Could not load culture choices: ${error.message}`; }
