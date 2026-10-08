import savedPlan from "../../../skirmish/plans/technology-plan.json";
import { UNIT_ROLES, type UnitRole } from "./TechnologyPlan";
import { readTechnologyPlan } from "./TechnologyPlanMigration";
import { troopArtwork } from "./TroopTreeArtwork";
import "./TroopTreePage.css";
import {
  buildTroopProposals,
  TROOP_ROLE_DESIGN,
  TROOP_STATS,
  troopTypeName,
  type TroopProposal,
} from "./TroopTreePlan";

const root = document.querySelector<HTMLDivElement>("#troop-tree")!;
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let plan = readTechnologyPlan(savedPlan);
const russian = () =>
  plan.civilizations.find((c) => c.id === "russians-rework") ??
  plan.civilizations.find((c) => c.id === "russians")!;
let age = "all";
let role: UnitRole | "all" = "all";
let selected = "";
let status = "Proposed balance · confirmed starting ages";
let proposals = buildTroopProposals(russian());
const labels = {
  health: "Health",
  attack: "Attack",
  armour: "Armour",
  speed: "Speed",
  range: "Range",
};
function card(p: TroopProposal) {
  const art = troopArtwork(p.unit);
  const icon = art
    ? `<span class="troop-icon" role="img" aria-label="${escape(p.unit.name)} artwork"><img src="${escape(art.url)}" alt="" loading="lazy" style="width:${art.width}px;height:${art.height}px;left:${art.left}px;top:${art.top}px" /></span>`
    : "";
  return `<button class="troop-node ${selected === p.unit.id ? "selected" : ""} ${p.unit.role === "heavyCavalry" && p.unit.age === "LateMedieval" ? "peak" : ""}" data-unit="${escape(p.unit.id)}" aria-pressed="${selected === p.unit.id}" style="--accent:${TROOP_ROLE_DESIGN[p.unit.role].color}"><div class="troop-identity ${art ? "has-art" : ""}">${icon}<div><span class="type">${troopTypeName(p.unit.role)}</span><h3>${escape(p.unit.name)}</h3></div></div><div class="price"><strong>${p.gold.toLocaleString()} <small>gold</small></strong><span>${p.trainingSeconds}s <small>to train</small></span></div><p class="counter">${p.targetBonus === 1 ? "Flexible baseline" : `Counters ${p.counter.toLowerCase()} · ×${p.targetBonus}`}</p><div class="stats">${TROOP_STATS.map((stat) => `<div class="stat"><span>${labels[stat]}</span><span class="bar" role="meter" aria-label="${labels[stat]} proposed rating" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.stats[stat]}"><i style="width:${p.stats[stat]}%"></i></span><b>${p.stats[stat]}</b></div>`).join("")}</div>${p.unit.role === "heavyCavalry" && p.unit.age === "LateMedieval" ? '<span class="peak-label">RUSSIAN HEAVY CAV PEAK</span>' : '<span class="proposal-label">PROPOSED STATS & COST</span>'}</button>`;
}
function render() {
  const civ = russian();
  proposals = buildTroopProposals(civ);
  const roles = role === "all" ? UNIT_ROLES : [role];
  const ages = civ.ages.filter((a) => age === "all" || a.id === age);
  const chosen = proposals.find((p) => p.unit.id === selected);
  root.innerHTML = `<header class="masthead"><a class="brand" href="/">AGE <span>OF</span> FRONTS</a><span>DESIGN WORKSHOP</span><a href="/skirmish/technology-planner.html">Research tree ↗</a></header><main><section class="intro"><div><p class="eyebrow">RUSSIANS / EIGHT-AGE UNIT PROGRESSION</p><h1>Troop Tree</h1><p class="subtitle">Six classes. Clear counters. A cheap infantry backbone.</p></div><div class="draft-badge">PLANNING DRAFT<span>Proposed stats & prices</span></div></section><div class="controls"><nav aria-label="Troop age"><button data-age="all" aria-pressed="${age === "all"}">All ages</button>${civ.ages.map((a) => `<button data-age="${a.id}" aria-pressed="${age === a.id}">${escape(a.name)}</button>`).join("")}</nav><label>Class<select id="role-filter"><option value="all">All classes</option>${UNIT_ROLES.map((r) => `<option value="${r}" ${role === r ? "selected" : ""}>${troopTypeName(r)}</option>`).join("")}</select></label></div><div class="design-note"><span>Anti-cav begins in Bronze Age.</span><span>Heavy cav begins in Early Medieval; Late Medieval is its relative peak.</span><span>Light cav → gun trucks · Heavy cav → APCs · Ranged cav → tanks.</span></div><div class="reading-guide"><b>Reading the tree</b><span>Arrows show class progression across ages, not research prerequisites. Bars are 0–100 ratings within each era; × values are proposed damage bonuses against the listed targets. Attack bars show base power before that bonus.</span></div><div class="selection" aria-live="polite">${chosen ? `<div><b>${escape(chosen.unit.name)}</b><p>${escape(chosen.specialty)}</p></div><button id="clear">Clear selection</button>` : "<span>Select a troop to see its proposed role.</span>"}</div><p id="load-status" role="status">${escape(status)} · ${proposals.length} troop nodes</p><div class="tree-scroll" tabindex="0" aria-label="Russian troop progression"><div class="troop-graph" style="--columns:${roles.length}"><svg class="progression" aria-hidden="true"><defs><marker id="progress-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs><g></g></svg><div class="role-headings">${roles.map((r) => `<div style="--accent:${TROOP_ROLE_DESIGN[r].color}"><strong>${troopTypeName(r)}</strong><small>${TROOP_ROLE_DESIGN[r].counter === "General-purpose" ? "Cheap & quick" : `Counters ${TROOP_ROLE_DESIGN[r].counter.toLowerCase()}`}</small></div>`).join("")}</div>${ages
    .map(
      (a) =>
        `<section class="age-band"><header><span>AGE ${String(civ.ages.indexOf(a) + 1).padStart(2, "0")}</span><h2>${escape(a.name)}</h2><small>${escape(a.period)}</small></header><div class="troop-row">${roles
          .map((r) => {
            const p = proposals.find(
              (n) => n.unit.age === a.id && n.unit.role === r,
            );
            return p
              ? card(p)
              : '<div class="empty-slot" aria-label="Class not unlocked in this age">—</div>';
          })
          .join("")}</div></section>`,
    )
    .join(
      "",
    )}</div></div><footer>Names follow the saved Russian civilization plan. Costs, training times, ratings and counter bonuses are design proposals. This page does not change gameplay.</footer></main>`;
  root.querySelectorAll<HTMLButtonElement>("[data-age]").forEach((b) =>
    b.addEventListener("click", () => {
      age = b.dataset.age!;
      selected = "";
      render();
    }),
  );
  root
    .querySelector<HTMLSelectElement>("#role-filter")!
    .addEventListener("change", (e) => {
      role = (e.target as HTMLSelectElement).value as typeof role;
      selected = "";
      render();
    });
  root.querySelectorAll<HTMLButtonElement>("[data-unit]").forEach((b) =>
    b.addEventListener("click", () => {
      const scroll = root.querySelector(".tree-scroll")!;
      const x = scroll.scrollLeft,
        y = scroll.scrollTop;
      selected = b.dataset.unit!;
      render();
      const next = root.querySelector(".tree-scroll")!;
      next.scrollLeft = x;
      next.scrollTop = y;
    }),
  );
  root.querySelector("#clear")?.addEventListener("click", () => {
    selected = "";
    render();
  });
  requestAnimationFrame(drawProgression);
}
function drawProgression() {
  const graph = root.querySelector<HTMLElement>(".troop-graph");
  if (!graph) return;
  const svg = graph.querySelector("svg")!;
  const origin = graph.getBoundingClientRect();
  svg.setAttribute("width", String(graph.scrollWidth));
  svg.setAttribute("height", String(graph.scrollHeight));
  const cards = new Map(
    Array.from(graph.querySelectorAll<HTMLElement>("[data-unit]")).map((el) => [
      el.dataset.unit!,
      el,
    ]),
  );
  const paths: string[] = [];
  for (const r of UNIT_ROLES) {
    let previous: HTMLElement | undefined;
    for (const a of russian().ages) {
      const p = proposals.find((n) => n.unit.age === a.id && n.unit.role === r);
      const el = p ? cards.get(p.unit.id) : undefined;
      if (!el) continue;
      if (previous) {
        const from = previous.getBoundingClientRect(),
          to = el.getBoundingClientRect();
        paths.push(
          `<path d="M ${from.left + from.width / 2 - origin.left} ${from.bottom - origin.top} V ${to.top - origin.top - 5}" stroke="${TROOP_ROLE_DESIGN[r].color}" marker-end="url(#progress-arrow)"/>`,
        );
      }
      previous = el;
    }
  }
  svg.querySelector("g")!.innerHTML = paths.join("");
}
new ResizeObserver(drawProgression).observe(root);
render();
async function load() {
  try {
    const response = await fetch("/__planning/technology-plan", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Save service unavailable");
    const result = await response.json();
    plan = readTechnologyPlan(result.plan);
    status = "Saved Russian names loaded · proposed stats & cost";
  } catch {
    status = "Bundled Russian names · repository service unavailable";
  }
  render();
}
void load();
