// Shared inspection data and civ selection; this module cannot change a match.
const reviewLoad = Date.now();
async function readJson(url) {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("review", String(reviewLoad));
  const response = await fetch(requestUrl, {cache: "no-store"});
  if (!response.ok) throw new Error("Could not load art manifest: " + url);
  return response.json();
}
export async function loadCivIndex(section) {
  const registryUrl = new URL("./review-civs.json", import.meta.url);
  const index = await readJson(registryUrl);
  return { defaultCivId: index.defaultCivId, civs: index.civs.map(civ => ({
    id: civ.id, label: civ.label, manifestUrl: new URL(civ[section], registryUrl).href,
    resources: Object.fromEntries(Object.entries(civ[section + "Resources"] || {}).map(([name, file]) => [name, new URL(file, registryUrl).href])),
  })) };
}
export async function loadCivManifest(civ) {
  return { data: await readJson(civ.manifestUrl), url: civ.manifestUrl };
}
export function selectedCiv(index) {
  const id = new URLSearchParams(location.search).get("civ");
  return index.civs.find(civ => civ.id === id) ||
    index.civs.find(civ => civ.id === index.defaultCivId);
}
export function civReviewUrl(address, civId) {
  const url = new URL(address, location.href);
  if (civId === "base") url.searchParams.delete("civ");
  else url.searchParams.set("civ", civId);
  return url;
}
export function writeCivLocation(civId, ageHash) {
  const url = civReviewUrl(location.href, civId);
  if (ageHash !== undefined) url.hash = ageHash;
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}
export function createCivDropdown(select, index, onSelect) {
  select.replaceChildren();
  for (const civ of index.civs) {
    const option = document.createElement("option");
    option.value = civ.id; option.textContent = civ.label; select.append(option);
  }
  select.addEventListener("change", () => onSelect(index.civs.find(civ => civ.id === select.value)));
  return id => { select.value = id; };
}
export function createCivTabs(host, index, panelId, onSelect) {
  for (const [position, civ] of index.civs.entries()) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = civ.label;
    button.id = "civ-" + civ.id; button.dataset.civ = civ.id;
    button.setAttribute("role", "tab"); button.setAttribute("aria-controls", panelId);
    button.addEventListener("click", () => onSelect(civ));
    button.addEventListener("keydown", event => {
      let next;
      if (event.key === "ArrowRight") next = (position + 1) % index.civs.length;
      if (event.key === "ArrowLeft") next = (position + index.civs.length - 1) % index.civs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = index.civs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation();
      host.children[next].click(); host.children[next].focus();
    });
    host.append(button);
  }
  return id => {
    for (const button of host.children) {
      const active = button.dataset.civ === id;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
  };
}
