import { CONTENT_HASH } from "../../content/Catalog";
import { UNITS } from "../../content/Units";
import { AGE_NAMES, AGES } from "../../domain/Definitions";
import { eraPortrait } from "../EraArtwork";
import { TroopCatalogViewModel } from "./TroopCatalogViewModel";
import "./style.css";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const vm = new TroopCatalogViewModel();
const root = document.querySelector<HTMLElement>("#troop-catalog")!;
root.innerHTML = `<header><a class="brand" href="/">AGE <small>OF</small> FRONTS</a><nav><a href="/">Lobbies</a><a href="/skirmish/index.html">Play vs AI ↗</a></nav></header><main><section class="intro"><p class="eyebrow">FIELD REFERENCE / ALL ${AGES.length} AGES</p><h1>Troop almanac</h1><p>Know what you recruit. Explore every land squad and compare its strengths, counters and requirements.</p><div class="note">Stats use a full-strength 1,000-troop squad. Damage is per attack, before enemy armour and bonus resistance; terrain changes movement speed. Upgrade preview uses that unit’s age, not future-age research.</div></section><form class="filters" role="search"><label>Search troops<input id="search" type="search" placeholder="Name, role or target class"></label><label>Age<select id="age"><option value="">All ages</option>${AGES.map((a, i) => `<option value="${a}">${AGE_NAMES[i]}</option>`).join("")}</select></label><label>Role<select id="role"><option value="">All roles</option>${vm.roles.map((r) => `<option>${r}</option>`).join("")}</select></label><label>Veterancy<select id="level">${Array.from({ length: 7 }, (_, i) => `<option value="${i + 1}">Level ${i + 1}</option>`).join("")}</select></label><label class="check"><input id="upgraded" type="checkbox">Age upgrades</label></form><section id="comparison" aria-label="Unit comparison" hidden></section><div class="results"><span id="count" aria-live="polite"></span><span>Select up to three units to compare</span></div><section id="cards" class="cards" aria-label="Troop catalog"></section></main><footer>© OpenFront and Contributors · Modified Age of Fronts prototype <span>Definition revision ${CONTENT_HASH}</span></footer>`;
function card(
  c: ReturnType<TroopCatalogViewModel["card"]>,
  comparison = false,
) {
  const art = eraPortrait(`unit-portrait-${c.id}`) ?? eraPortrait(c.id);
  return `<article class="troop-card ${c.selected ? "selected" : ""}"><div class="card-heading"><div class="portrait">${art ? `<img src="${art}" alt="" loading="lazy">` : `<span>${escape(c.role.slice(0, 2).toUpperCase())}</span>`}</div><div><p class="eyebrow">${escape(c.age)} / ${escape(c.role)}</p><h2>${escape(c.name)}</h2></div></div><dl>${c.stats
    .slice(0, 9)
    .map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`)
    .join(
      "",
    )}</dl><details ${comparison ? "open" : ""}><summary>Requirements & combat details</summary><dl>${c.stats
    .slice(9)
    .map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`)
    .join(
      "",
    )}</dl></details><button class="compare" data-compare="${c.id}" aria-pressed="${c.selected}">${c.selected ? "Remove from comparison" : "Compare unit"}</button></article>`;
}
function render() {
  root.querySelector("#count")!.textContent =
    `${vm.cards.length} of ${UNITS.length} troops`;
  root.querySelector("#cards")!.innerHTML =
    vm.cards.map((c) => card(c)).join("") ||
    "<p>No matching troops. Try a different filter.</p>";
  const compare = root.querySelector<HTMLElement>("#comparison")!;
  compare.hidden = !vm.compared.size;
  compare.innerHTML = `<div class="comparison-heading"><h2>Compare troops</h2><button id="clear-compare">Clear comparison</button></div><div class="compare-grid">${vm.comparison.map((c) => card(c, true)).join("")}</div>`;
  root
    .querySelectorAll<HTMLButtonElement>("[data-compare]")
    .forEach(
      (b) =>
        (b.disabled =
          !vm.compared.has(b.dataset.compare!) && vm.compared.size >= 3),
    );
}
root
  .querySelector("form")!
  .addEventListener("submit", (e) => e.preventDefault());
root.querySelector("#search")!.addEventListener("input", (e) => {
  vm.search = (e.target as HTMLInputElement).value;
  render();
});
root.querySelector("#age")!.addEventListener("change", (e) => {
  vm.age = (e.target as HTMLSelectElement).value as typeof vm.age;
  render();
});
root.querySelector("#role")!.addEventListener("change", (e) => {
  vm.role = (e.target as HTMLSelectElement).value;
  render();
});
root.querySelector("#level")!.addEventListener("change", (e) => {
  vm.level = Number((e.target as HTMLSelectElement).value);
  render();
});
root.querySelector("#upgraded")!.addEventListener("change", (e) => {
  vm.upgraded = (e.target as HTMLInputElement).checked;
  render();
});
root.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (b?.dataset.compare) {
    vm.compare(b.dataset.compare);
    render();
  } else if (b?.id === "clear-compare") {
    vm.compared.clear();
    render();
  }
});
render();
