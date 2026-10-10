import savedPlan from "../../../skirmish/plans/technology-plan.json";
import { TREES, type Tree } from "../domain/Definitions";
import { createResearchArtwork } from "./ResearchTreeArtwork";
import type { PlanAge as Age } from "./TechnologyPlan";
import {
  ROLE_NAMES,
  UNIT_ROLES,
  cloneCivilization,
  validatePlan,
  type CivilizationPlan,
  type PlannedTechnology,
  type PlannedUnit,
  type TechnologyPlan,
} from "./TechnologyPlan";
import { layoutResearch, researchRelations } from "./TechnologyPlanGraph";
import { readTechnologyPlan } from "./TechnologyPlanMigration";
import "./TechnologyPlannerPage.css";

const root = document.querySelector<HTMLDivElement>("#planner")!;
const endpoint = "/__planning/technology-plan";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const options = (
  values: readonly string[],
  selected: string,
  labels?: readonly string[],
) =>
  values
    .map(
      (value, i) =>
        `<option value="${escape(value)}" ${value === selected ? "selected" : ""}>${escape(labels?.[i] ?? value)}</option>`,
    )
    .join("");
let plan = readTechnologyPlan(savedPlan);
let savedSnapshot = JSON.stringify(plan);
let revision = "";
let civId = plan.civilizations.some((c) => c.id === "russians-rus-eight-age-rework")
  ? "russians-rus-eight-age-rework"
  : plan.civilizations.some((c) => c.id === "russians-rework")
  ? "russians-rework"
  : "russians";
let view: "research" | "units" | Tree = "research";
let ageScope: "all" | Age = "all";
let showInspector = false;
let selection: { kind: "technology" | "unit"; id: string } | null = null;
let inspectorMode: "node" | "civilization" | "addCivilization" = "node";
let dirty = false;
let formDirty = false;
let saving = false;
let message = "Loading saved plans…";
let failed = false;
let tracedRelations = researchRelations([], undefined);
const undo: TechnologyPlan[] = [],
  redo: TechnologyPlan[] = [];
const civ = (): CivilizationPlan =>
  plan.civilizations.find((c) => c.id === civId) ?? plan.civilizations[0];
const planAges = () => civ().ages.map((a) => a.id);
const ageLabels = () => civ().ages.map((a) => a.name);
const ageName = (age: Age) => civ().ages.find((a) => a.id === age)?.name ?? age;
const agePeriod = (age: Age) =>
  civ().ages.find((a) => a.id === age)?.period ?? "";
const selectedNode = () =>
  selection?.kind === "unit"
    ? civ().units.find((n) => n.id === selection!.id)
    : civ().technologies.find((n) => n.id === selection?.id);
const setMessage = (value: string, error = false) => {
  message = value;
  failed = error;
  const status = root.querySelector<HTMLElement>("#status");
  if (status) {
    status.textContent = message;
    status.dataset.error = String(failed);
  }
};
const discardForm = () =>
  !formDirty || window.confirm("Discard unapplied inspector edits?");
function commit(next: TechnologyPlan, text: string): boolean {
  const errors = validatePlan(next);
  if (errors.length) {
    setMessage(errors.slice(0, 5).join("\n"), true);
    return false;
  }
  undo.push(structuredClone(plan));
  if (undo.length > 50) undo.shift();
  redo.length = 0;
  plan = next;
  dirty = JSON.stringify(plan) !== savedSnapshot;
  formDirty = false;
  message = text;
  failed = false;
  render();
  return true;
}

let artworkForNode: ReturnType<typeof createResearchArtwork> = () => [];
function render() {
  const current = civ();
  artworkForNode = createResearchArtwork(current);
  tracedRelations = researchRelations(
    current.technologies,
    selection?.kind === "technology" ? selection.id : undefined,
  );
  const pending = current.units.filter(
    (u) => u.availability === "undecided",
  ).length;
  root.innerHTML = `
    <header class="masthead"><a href="/" class="brand">AGE <span>OF</span> FRONTS</a><div class="workshop-tag">DESIGN WORKSHOP <span>Planning draft</span></div><a href="/skirmish/troop-tree.html">Troop tree ↗</a></header>
    <section class="intro"><div><p class="eyebrow">CIVILIZATIONS / RESEARCH & UNLOCKS</p><h1>Civilization Workshop</h1></div><div class="plan-scope"><b>Development planning</b><span>These plans do not change live gameplay.</span></div></section>
    <section class="toolbar" aria-label="Planning controls"><label class="civilization-picker">Civilization<select id="civilization">${plan.civilizations.map((c) => `<option value="${escape(c.id)}" ${c.id === current.id ? "selected" : ""}>${escape(c.name)}</option>`).join("")}</select></label><button id="add-civ">+ Civilization</button><button id="edit-civ">Civilization notes</button><div class="toolbar-spacer"></div><button id="undo" ${undo.length ? "" : "disabled"}>Undo</button><button id="redo" ${redo.length ? "" : "disabled"}>Redo</button><button id="reload">Reload saved</button><button id="import">Import JSON</button><button id="export">Export JSON</button><button id="save" class="primary" ${saving ? "disabled" : ""}>${saving ? "Saving…" : dirty ? "Save changes" : "Save plan"}</button><input type="file" id="import-file" accept="application/json,.json" hidden /></section>
    <div class="save-strip"><span class="save-indicator ${dirty ? "unsaved" : ""}">${dirty ? "Unsaved plan changes" : "Saved plan"}</span><span>Save writes <code>skirmish/plans/technology-plan.json</code> on the local dev server. Export works anywhere.</span></div>
    <div id="status" role="status" aria-live="polite" data-error="${failed}">${escape(message)}</div>
    <div class="workspace ${showInspector ? "inspector-open" : ""}"><section class="canvas-panel"><div class="canvas-heading"><div><h2>${escape(current.name)}</h2><p>${pending} undecided unit unlocks · ${current.technologies.length} research nodes</p></div><button id="add-node">+ Research node</button></div>
      <nav class="age-tabs" aria-label="Research age"><button data-age="all" aria-pressed="${ageScope === "all"}">All ages</button>${planAges()
        .map(
          (age) =>
            `<button data-age="${age}" aria-pressed="${ageScope === age}">${escape(ageName(age))}</button>`,
        )
        .join("")}</nav>
      <nav class="view-tabs" aria-label="Tree view">${["research", "units", ...TREES].map((t) => `<button data-view="${t}" aria-pressed="${view === t}">${t === "research" ? "All research" : t === "units" ? "Unit progression" : branchName(t as Tree)}</button>`).join("")}</nav>
      ${traceMarkup()}
      <div class="legend">${view === "units" ? '<span><i class="available-dot"></i>Available</span><span><i class="undecided-dot"></i>Undecided</span><span><i class="unavailable-dot"></i>Unavailable</span>' : '<span><i class="prerequisite-dot"></i>Prerequisite path</span><span><i class="downstream-dot"></i>Downstream unlocks</span><span>Click a node to trace its dependencies. Use Edit selected node to change it.</span>'}</div>
      <div class="graph-scroll" tabindex="0" aria-label="Civilization technology tree">${diagramMarkup(current)}</div>
      <footer class="canvas-footer">${view === "units" ? "Availability and unlocking technologies are separate decisions. Select a unit to edit its plan." : "Research flows from top to bottom. Parallel nodes split and rejoin like the in-game tree. All ages shows links between ages; All research includes links between branches."}</footer>
    </section><aside class="inspector" aria-label="Plan inspector"><button id="close-inspector" class="close-inspector" aria-label="Close inspector">×</button>${inspector()}</aside></div>`;
  bind();
  requestAnimationFrame(drawConnections);
}

const branchName = (tree: Tree) =>
  tree === "naval" ? "Naval" : tree === "warfare" ? "Warfare" : "Economy";
const svgMarkup = () =>
  `<svg class="connections" aria-hidden="true"><defs>${[
    ["arrow", "#819ba3"],
    ["arrow-ancestor", "#e0bf78"],
    ["arrow-descendant", "#78c9c2"],
  ]
    .map(
      ([id, color]) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" style="fill:${color}" /></marker>`,
    )
    .join("")}</defs><g></g></svg>`;
function diagramMarkup(current: CivilizationPlan) {
  const ages = planAges().filter(
    (age) => ageScope === "all" || age === ageScope,
  );
  if (view === "units")
    return `<div class="graph unit-graph">${ages
      .map(
        (age, index) =>
          `<section class="age-column"><header><span>AGE ${String(planAges().indexOf(age) + 1).padStart(2, "0")}</span><h3>${escape(ageName(age))}</h3></header>${UNIT_ROLES.map(
            (role) => {
              const unit = current.units.find(
                (u) => u.age === age && u.role === role,
              );
              return unit
                ? nodeCard(unit, "unit", ROLE_NAMES[role])
                : `<button class="node empty" data-empty-age="${age}" data-empty-role="${role}"><small>${ROLE_NAMES[role]}</small><b>+ Add unit plan</b></button>`;
            },
          ).join("")}</section>`,
      )
      .join("")}</div>`;
  const branches = view === "research" ? TREES : [view as Tree];
  const layouts = layoutResearch(current.technologies, planAges(), 4).filter(
    (layout) => ages.includes(layout.age),
  );
  return `<div class="graph research-graph" style="--branch-count:${branches.length}">${svgMarkup()}<div class="research-headings">${branches.map((tree) => `<h3>${branchName(tree)}<small>${current.technologies.filter((n) => n.tree === tree && ages.includes(n.age)).length} discoveries</small></h3>`).join("")}</div>${layouts
    .map(
      (layout) =>
        `<section class="research-age-band" data-research-age="${layout.age}"><header class="research-age-title"><span>AGE ${String(planAges().indexOf(layout.age) + 1).padStart(2, "0")}</span><h3>${escape(ageName(layout.age))}</h3><small>${escape(agePeriod(layout.age))}</small></header><div class="research-age-branches">${branches
          .map(
            (tree) =>
              `<div class="research-age-tree" data-branch="${tree}" style="--research-rows:${layout.rows};--research-columns:${layout.columns}">${current.technologies
                .filter((n) => n.age === layout.age && n.tree === tree)
                .map((node) => {
                  const placement = layout.placements.get(node.id)!;
                  return `<div class="research-node-slot" style="grid-row:${placement.row + 1};grid-column:${placement.column} / span ${placement.span}">${nodeCard(node, "technology", `Position ${node.order}`)}</div>`;
                })
                .join("")}</div>`,
          )
          .join("")}</div></section>`,
    )
    .join("")}</div>`;
}

function traceMarkup() {
  const node = selectedNode();
  if (!node) return "";
  const { ancestors, descendants } = researchRelations(
    civ().technologies,
    selection?.kind === "technology" ? node.id : undefined,
  );
  const parents = node.prerequisites
    .map((id) => civ().technologies.find((n) => n.id === id))
    .filter((n): n is PlannedTechnology => !!n);
  const children =
    selection?.kind === "technology"
      ? [...civ().technologies, ...civ().units].filter((n) =>
          n.prerequisites.includes(node.id),
        )
      : [];
  const link = (n: PlannedTechnology | PlannedUnit) =>
    `<button data-jump-kind="${"role" in n ? "unit" : "technology"}" data-jump="${escape(n.id)}">${escape(n.name)} <small>${escape(ageName(n.age))}</small></button>`;
  return `<section class="dependency-trace" aria-label="Selected dependency path"><div class="trace-heading"><div><b>${escape(node.name)}</b><span>${selection?.kind === "technology" ? `${ancestors.size} prerequisites in path · ${descendants.size} downstream technologies` : `${parents.length} unlocking technologies`}</span></div><button id="edit-selected">Edit selected node</button><button id="clear-selection">Clear trace</button></div><div class="trace-links"><div><strong>Requires</strong>${parents.length ? parents.map(link).join("") : "<span>No prerequisites assigned</span>"}</div><div><strong>Directly unlocks</strong>${children.length ? children.map(link).join("") : "<span>No direct unlocks assigned</span>"}</div></div></section>`;
}
function nodeCard(
  node: PlannedTechnology | PlannedUnit,
  kind: "technology" | "unit",
  subtitle: string,
) {
  const availability = "availability" in node ? node.availability : "available";
  const active = selection?.kind === kind && selection.id === node.id;
  const relations = tracedRelations;
  const relation =
    kind !== "technology" ||
    !selection ||
    selection.kind !== "technology" ||
    active
      ? ""
      : relations.ancestors.has(node.id)
        ? "ancestor"
        : relations.descendants.has(node.id)
          ? "descendant"
          : "unrelated";
  const art = artworkForNode(node);
  const icons = art.length
    ? `<span class="research-art" aria-label="${escape(art.map((i) => `${i.direct ? "Unlocks" : "Leads to"} ${i.label}`).join(", "))}">${art
        .slice(0, 4)
        .map((i) => {
          if (!i.art) return "";
          const image =
            "width" in i.art
              ? `<span class="research-sprite"><img src="${escape(i.art.url)}" alt="" loading="lazy" style="width:${i.art.width}px;height:${i.art.height}px;left:${i.art.left}px;top:${i.art.top}px" /></span>`
              : `<img src="${escape(i.art.url)}" alt="" loading="lazy" />`;
          return `<span class="research-art-tile" title="${escape(`${i.direct ? "Unlocks" : "Leads to"} ${i.label}`)}">${image}</span>`;
        })
        .join(
          "",
        )}${art.length > 4 ? `<span class="research-art-more">+${art.length - 4}</span>` : ""}</span>`
    : "";
  return `<button class="node ${"kind" in node ? node.kind : ""} ${availability} ${active ? "selected" : ""} ${relation}" data-kind="${kind}" data-node="${escape(node.id)}" aria-pressed="${active}"><small>${escape("kind" in node ? node.kind.toUpperCase() : subtitle)}</small>${icons}<b>${escape(node.name)}</b><span class="node-state">${kind === "unit" ? availability : `${node.prerequisites.length} prerequisite${node.prerequisites.length === 1 ? "" : "s"}`}</span>${"gold" in node ? `<span class="node-cost">${node.gold === null ? "Cost undecided" : `${node.gold.toLocaleString()}g`} · ${node.researchSeconds === null ? "Time undecided" : `${node.researchSeconds}s`}</span>` : ""}<span class="decision ${node.decision}">${node.decision}</span></button>`;
}

function inspector(): string {
  if (inspectorMode === "addCivilization")
    return `<p class="eyebrow">EXPAND THE ROSTER</p><h2>Add civilization</h2><p>Copy an existing plan, then edit its unlocks and research independently.</p><form id="civ-form"><label>Name<input name="name" required maxlength="120" /></label><label>Copy from<select name="source">${plan.civilizations.map((c) => `<option value="${escape(c.id)}">${escape(c.name)}</option>`).join("")}</select></label><button class="primary">Create civilization</button></form>`;
  if (inspectorMode === "civilization")
    return `<p class="eyebrow">CIVILIZATION DESIGN</p><h2>${escape(civ().name)}</h2><form id="civ-form"><label>Name<input name="name" value="${escape(civ().name)}" required maxlength="120" /></label><label>Design notes<textarea name="notes" rows="10">${escape(civ().notes)}</textarea></label><button class="primary">Apply civilization edits</button></form><p class="inspector-hint">The civilization ID stays stable when its name changes.</p>`;
  const node = selectedNode();
  if (!node)
    return `<p class="eyebrow">NODE INSPECTOR</p><h2>Shape the next age</h2><p>Select a unit or research node to edit its name, age and prerequisite links.</p><div class="inspector-note"><b>Russian decisions captured</b><p>Stone Age excludes anti-cavalry infantry, heavy cavalry and ranged cavalry.</p><p>Bronze Age uses Spear Riders; ranged cavalry is absent, with no chariots.</p><p>Anti-cavalry starts in Bronze Age. Heavy cavalry starts in Early Medieval and peaks in Late Medieval.</p></div><p class="inspector-hint">Use Save changes to write the plan to the repository. Keep a JSON export when working away from the local development server.</p>`;
  const unit = "availability" in node;
  const prerequisiteCandidates = civ()
    .technologies.filter(
      (t) =>
        t.id !== node.id &&
        planAges().indexOf(t.age) <= planAges().indexOf(node.age),
    )
    .sort(
      (a, b) =>
        planAges().indexOf(a.age) - planAges().indexOf(b.age) ||
        a.order - b.order,
    );
  return `<p class="eyebrow">${unit ? ROLE_NAMES[node.role] : `${node.tree} RESEARCH`}</p><h2>${escape(node.name)}</h2><form id="node-form"><label>Name<input name="name" value="${escape(node.name)}" maxlength="120" required /></label><label>Age<select name="age">${options(planAges(), node.age, ageLabels())}</select></label>${
    unit
      ? `<label>Class<select name="role">${options(
          UNIT_ROLES,
          node.role,
          UNIT_ROLES.map((r) => ROLE_NAMES[r]),
        )}</select></label><label>Availability<select name="availability">${options(["available", "unavailable", "undecided"], node.availability)}</select></label>`
      : `<div class="field-pair"><label>Branch<select name="tree">${options(TREES, node.tree)}</select></label><label>Position<input name="order" type="number" min="0" step="1" value="${node.order}" required /></label></div><label>Research type<select name="researchKind">${options(["unlock", "upgrade", "capstone"], node.kind)}</select></label><div class="field-pair"><label>Gold cost<input name="gold" type="number" min="0" step="1" value="${node.gold ?? ""}" /></label><label>Research seconds<input name="researchSeconds" type="number" min="0" step="1" value="${node.researchSeconds ?? ""}" /></label></div><label>Description<textarea name="description" rows="3">${escape(node.description)}</textarea></label>`
  }<label>Decision status<select name="decision">${options(["baseline", "proposed", "confirmed"], node.decision)}</select></label><fieldset><legend>${unit ? "Unlocking technologies" : "Prerequisites"} <span>(all required)</span></legend><div class="prerequisite-list">${prerequisiteCandidates.map((t) => `<label><input type="checkbox" name="prerequisite" value="${escape(t.id)}" ${node.prerequisites.includes(t.id) ? "checked" : ""} /><span>${escape(t.name)}<small>${ageName(t.age)} · ${t.tree}</small></span></label>`).join("") || "<p>No candidate technologies.</p>"}</div></fieldset><p class="inspector-hint">Apply an age change first to refresh the prerequisite choices. Existing links are retained and validated.</p><label>Design notes<textarea name="notes" rows="4">${escape(node.notes)}</textarea></label><button class="primary">Apply node edits</button><button type="button" id="delete-node" class="danger">Delete ${unit ? "unit plan" : "research node"}</button></form><code class="stable-id">${escape(node.id)}</code>`;
}

function bind() {
  const on = (id: string, action: () => void) =>
    root.querySelector(`#${id}`)?.addEventListener("click", action);
  root.querySelectorAll<HTMLButtonElement>("[data-age]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!discardForm()) return;
      ageScope = button.dataset.age as typeof ageScope;
      formDirty = false;
      render();
    }),
  );
  on("edit-selected", () => {
    if (discardForm()) {
      showInspector = true;
      inspectorMode = "node";
      formDirty = false;
      render();
    }
  });
  on("close-inspector", () => {
    if (discardForm()) {
      showInspector = false;
      formDirty = false;
      render();
    }
  });
  on("clear-selection", () => {
    if (discardForm()) {
      selection = null;
      showInspector = false;
      inspectorMode = "node";
      formDirty = false;
      render();
    }
  });
  root.querySelectorAll<HTMLButtonElement>("[data-jump]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!discardForm()) return;
      selection = {
        kind: button.dataset.jumpKind as "unit" | "technology",
        id: button.dataset.jump!,
      };
      const node = selectedNode();
      if (!node) return;
      view = selection.kind === "unit" ? "units" : "research";
      ageScope = "all";
      inspectorMode = "node";
      showInspector = false;
      formDirty = false;
      render();
      requestAnimationFrame(() =>
        root
          .querySelector<HTMLElement>(`[data-node="${selection!.id}"]`)
          ?.scrollIntoView({ block: "center", inline: "nearest" }),
      );
    }),
  );
  root
    .querySelector<HTMLSelectElement>("#civilization")!
    .addEventListener("change", (event) => {
      if (!discardForm()) {
        (event.target as HTMLSelectElement).value = civId;
        return;
      }
      civId = (event.target as HTMLSelectElement).value;
      if (ageScope !== "all" && !planAges().includes(ageScope))
        ageScope = "all";
      selection = null;
      inspectorMode = "node";
      showInspector = false;
      formDirty = false;
      render();
    });
  root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!discardForm()) return;
      view = button.dataset.view as typeof view;
      selection = null;
      inspectorMode = "node";
      showInspector = false;
      formDirty = false;
      render();
    }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-node]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!discardForm()) return;
      selection = {
        kind: button.dataset.kind as "unit" | "technology",
        id: button.dataset.node!,
      };
      inspectorMode = "node";
      if (selection.kind === "unit") showInspector = true;
      formDirty = false;
      const scroll = root.querySelector(".graph-scroll")!.scrollLeft;
      const scrollTop = root.querySelector(".graph-scroll")!.scrollTop;
      render();
      root.querySelector(".graph-scroll")!.scrollLeft = scroll;
      root.querySelector(".graph-scroll")!.scrollTop = scrollTop;
    }),
  );
  root
    .querySelectorAll<HTMLButtonElement>("[data-empty-age]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        if (!discardForm()) return;
        const next = structuredClone(plan),
          current = next.civilizations.find((c) => c.id === civId)!;
        const id = `unit-${crypto.randomUUID()}`;
        current.units.push({
          id,
          name: ROLE_NAMES[button.dataset.emptyRole as keyof typeof ROLE_NAMES],
          age: button.dataset.emptyAge as Age,
          role: button.dataset.emptyRole as keyof typeof ROLE_NAMES,
          availability: "undecided",
          decision: "proposed",
          prerequisites: [],
          notes: "",
        });
        selection = { kind: "unit", id };
        inspectorMode = "node";
        showInspector = true;
        commit(
          next,
          "Unit plan added. Select its availability and unlocking technology.",
        );
      }),
    );
  on("add-civ", () => {
    if (discardForm()) {
      inspectorMode = "addCivilization";
      showInspector = true;
      formDirty = false;
      render();
    }
  });
  on("edit-civ", () => {
    if (discardForm()) {
      inspectorMode = "civilization";
      showInspector = true;
      formDirty = false;
      render();
    }
  });
  on("add-node", () => {
    if (!discardForm()) return;
    const next = structuredClone(plan),
      current = next.civilizations.find((c) => c.id === civId)!;
    const id = `research-${crypto.randomUUID()}`;
    const branch = view === "units" || view === "research" ? "warfare" : view;
    const age = ageScope === "all" ? "StoneAge" : ageScope;
    current.technologies.push({
      id,
      name: "New research",
      kind: "unlock",
      gold: null,
      researchSeconds: null,
      age,
      tree: branch,
      order:
        Math.max(
          0,
          ...current.technologies
            .filter((t) => t.age === age && t.tree === branch)
            .map((t) => t.order),
        ) + 1,
      prerequisites: [],
      description: "",
      notes: "",
      decision: "proposed",
    });
    selection = { kind: "technology", id };
    if (view !== "research") view = branch;
    inspectorMode = "node";
    showInspector = true;
    commit(
      next,
      "Research node added. Set its age and prerequisites in the inspector.",
    );
  });
  on("undo", () => {
    if (!discardForm()) return;
    const previous = undo.pop();
    if (previous) {
      redo.push(structuredClone(plan));
      plan = previous;
      civId = civ().id;
      dirty = JSON.stringify(plan) !== savedSnapshot;
      formDirty = false;
      selection = null;
      message = "Last change undone.";
      render();
    }
  });
  on("redo", () => {
    if (!discardForm()) return;
    const next = redo.pop();
    if (next) {
      undo.push(structuredClone(plan));
      plan = next;
      dirty = JSON.stringify(plan) !== savedSnapshot;
      formDirty = false;
      selection = null;
      message = "Change restored.";
      render();
    }
  });
  on("save", () => {
    void save();
  });
  on("reload", () => {
    if (
      (dirty || formDirty) &&
      !window.confirm("Discard unsaved changes and reload the repository plan?")
    )
      return;
    void load(true);
  });
  on("export", () => {
    if (formDirty)
      return setMessage("Apply inspector edits before exporting.", true);
    const errors = validatePlan(plan);
    if (errors.length) return setMessage(errors.join("\n"), true);
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "technology-plan.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("JSON exported. Repository saves are independent of exports.");
  });
  on("import", () => {
    root.querySelector<HTMLInputElement>("#import-file")!.click();
  });
  root
    .querySelector<HTMLInputElement>("#import-file")!
    .addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file || !discardForm()) return;
      if (file.size > 2_000_000)
        return setMessage("Import exceeds the 2 MB limit.", true);
      try {
        const imported = readTechnologyPlan(JSON.parse(await file.text()));
        const errors = validatePlan(imported);
        if (errors.length)
          return setMessage(errors.slice(0, 5).join("\n"), true);
        if (
          !window.confirm(
            "Replace the current draft with this imported plan? You can undo this change.",
          )
        )
          return;
        civId = (imported as TechnologyPlan).civilizations[0].id;
        selection = null;
        inspectorMode = "node";
        commit(
          imported as TechnologyPlan,
          "Plan imported as an unsaved draft. Save to write it to the repository.",
        );
      } catch {
        setMessage("Could not import a valid JSON plan.", true);
      }
    });
  const form = root.querySelector<HTMLFormElement>("#node-form, #civ-form");
  form?.addEventListener("input", () => {
    formDirty = true;
    setMessage(
      "Inspector edits are pending. Apply them before saving the plan.",
    );
  });
  form?.addEventListener("change", () => {
    formDirty = true;
  });
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form),
      next = structuredClone(plan),
      current = next.civilizations.find((c) => c.id === civId)!;
    const field = (key: string) => String(data.get(key) ?? "");
    if (inspectorMode === "addCivilization") {
      const source = next.civilizations.find((c) => c.id === field("source"))!;
      const id = `civ-${crypto.randomUUID()}`;
      next.civilizations.push(
        cloneCivilization(source, field("name").trim(), id),
      );
      if (
        commit(
          next,
          "Civilization added to the draft. Save changes to write the repository file.",
        )
      ) {
        civId = id;
        inspectorMode = "civilization";
        render();
      }
      return;
    } else if (inspectorMode === "civilization") {
      current.name = field("name").trim();
      current.notes = field("notes");
    } else {
      const node =
        selection?.kind === "unit"
          ? current.units.find((n) => n.id === selection!.id)!
          : current.technologies.find((n) => n.id === selection!.id)!;
      // Preserve parents excluded from the age-limited list until explicitly valid.
      const shown = new Set(
        Array.from(
          form.querySelectorAll<HTMLInputElement>("[name=prerequisite]"),
        ).map((input) => input.value),
      );
      node.prerequisites = [
        ...node.prerequisites.filter((id) => !shown.has(id)),
        ...data.getAll("prerequisite").map(String),
      ];
      node.name = field("name").trim();
      node.age = field("age") as Age;
      node.notes = field("notes");
      node.decision = field("decision") as typeof node.decision;
      if ("availability" in node) {
        node.role = field("role") as typeof node.role;
        node.availability = field("availability") as typeof node.availability;
      } else {
        node.tree = field("tree") as Tree;
        node.order = Number(field("order"));
        node.description = field("description");
        node.kind = field("researchKind") as typeof node.kind;
        node.gold = field("gold") === "" ? null : Number(field("gold"));
        node.researchSeconds =
          field("researchSeconds") === ""
            ? null
            : Number(field("researchSeconds"));
      }
    }
    commit(
      next,
      "Edits applied to the draft. Save changes to write the repository file.",
    );
  });
  on("delete-node", () => {
    const node = selectedNode();
    if (!node) return;
    const dependents = [...civ().technologies, ...civ().units].filter((n) =>
      n.prerequisites.includes(node.id),
    );
    if (selection?.kind === "technology" && dependents.length)
      return setMessage(
        `Remove prerequisite links from these nodes before deleting: ${dependents.map((n) => n.name).join(", ")}`,
        true,
      );
    if (!window.confirm(`Delete ${node.name} from this civilization's draft?`))
      return;
    const next = structuredClone(plan),
      current = next.civilizations.find((c) => c.id === civId)!;
    if (selection!.kind === "unit")
      current.units = current.units.filter((n) => n.id !== node.id);
    else
      current.technologies = current.technologies.filter(
        (n) => n.id !== node.id,
      );
    selection = null;
    commit(next, "Node deleted from the draft. Undo is available.");
  });
}

function drawConnections() {
  if (view === "units") return;
  const graph = root.querySelector<HTMLElement>(".graph");
  if (!graph) return;
  const svg = graph.querySelector<SVGSVGElement>("svg")!,
    group = svg.querySelector("g")!;
  const origin = graph.getBoundingClientRect();
  svg.setAttribute("width", String(graph.scrollWidth));
  svg.setAttribute("height", String(graph.scrollHeight));
  const cards = new Map(
    Array.from(graph.querySelectorAll<HTMLElement>("[data-node]")).map((el) => [
      el.dataset.node!,
      el,
    ]),
  );
  const { ancestors, descendants } = tracedRelations;
  const paths: string[] = [];
  for (const child of civ().technologies)
    for (const parentId of child.prerequisites) {
      const parentElement = cards.get(parentId),
        childElement = cards.get(child.id);
      if (!parentElement || !childElement) continue;
      const parent = parentElement.getBoundingClientRect(),
        target = childElement.getBoundingClientRect();
      const fromX = parent.left + parent.width / 2 - origin.left,
        fromY = parent.bottom - origin.top;
      const toX = target.left + target.width / 2 - origin.left,
        toY = target.top - origin.top;
      const parentTree = parentElement.closest<HTMLElement>("[data-branch]")!,
        childTree = childElement.closest<HTMLElement>("[data-branch]")!;
      const parentBand = parentElement.closest("[data-research-age]"),
        childBand = childElement.closest("[data-research-age]");
      let path: string;
      if (
        parentBand === childBand &&
        parentTree === childTree &&
        target.top - parent.bottom < 100
      ) {
        const middle = (fromY + toY) / 2;
        path = `M ${fromX} ${fromY} V ${middle} H ${toX} V ${toY - 3}`;
      } else {
        // Long edges use branch gutters instead of crossing intervening cards.
        // Distinct lanes keep multiple research paths individually traceable.
        const gutter =
          parentTree.getBoundingClientRect().right -
          origin.left +
          8 +
          (paths.length % 4) * 4;
        path = `M ${fromX} ${fromY} V ${fromY + 16} H ${gutter} V ${toY - 20} H ${toX} V ${toY - 3}`;
      }
      const selected =
        selection?.kind === "technology" ? selection.id : undefined;
      const relation = !selected
        ? ""
        : ancestors.has(parentId) &&
            (ancestors.has(child.id) || child.id === selected)
          ? "ancestor"
          : (parentId === selected || descendants.has(parentId)) &&
              descendants.has(child.id)
            ? "descendant"
            : "unrelated";
      const marker =
        relation === "ancestor"
          ? "arrow-ancestor"
          : relation === "descendant"
            ? "arrow-descendant"
            : "arrow";
      paths.push(
        `<path data-from="${escape(parentId)}" data-to="${escape(child.id)}" d="${path}" marker-end="url(#${marker})" class="${relation}" />`,
      );
    }
  group.innerHTML = paths
    .sort(
      (a, b) =>
        Number(/class="(ancestor|descendant)"/.test(a)) -
        Number(/class="(ancestor|descendant)"/.test(b)),
    )
    .join("");
}
async function load(reload = false) {
  if (saving)
    return setMessage(
      "Wait for the current save to finish before reloading.",
      true,
    );
  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Repository save service unavailable.");
    const result = await response.json();
    const errors = validatePlan(result.plan);
    if (errors.length) throw new Error(errors.join("\n"));
    plan = readTechnologyPlan(result.plan);
    savedSnapshot = JSON.stringify(plan);
    revision = result.revision;
    civId = civ().id;
    dirty = false;
    formDirty = false;
    undo.length = 0;
    redo.length = 0;
    selection = null;
    inspectorMode = "node";
    message = reload
      ? "Reloaded the saved repository plan."
      : "Repository plan loaded. Select a card to begin.";
    failed = false;
  } catch (error) {
    message = `${error instanceof Error ? error.message : "Unable to load plan."} ${revision ? "The current draft was retained." : "Using bundled plans; JSON import/export remain available."}`;
    failed = true;
  }
  if (!reload) {
    const requested = new URLSearchParams(location.search).get("node");
    if (requested && civ().technologies.some((t) => t.id === requested))
      selection = { kind: "technology", id: requested };
  }
  render();
}

async function save() {
  if (formDirty)
    return setMessage("Apply inspector edits before saving.", true);
  if (!revision)
    return setMessage(
      "Repository saves require the local development server. Export JSON to save this draft as a file.",
      true,
    );
  const errors = validatePlan(plan);
  if (errors.length) return setMessage(errors.join("\n"), true);
  const snapshot = JSON.stringify(plan);
  saving = true;
  const button = root.querySelector<HTMLButtonElement>("#save")!;
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": revision },
      body: snapshot,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Save failed.");
    revision = result.revision;
    savedSnapshot = snapshot;
    dirty = JSON.stringify(plan) !== savedSnapshot;
    message = dirty
      ? "Saved the submitted plan. Newer edits are still unsaved."
      : "Saved to skirmish/plans/technology-plan.json.";
    failed = false;
  } catch (error) {
    message = error instanceof Error ? error.message : "Save failed.";
    failed = true;
  }
  saving = false;
  // Keep any inspector edits entered while the request was in flight.
  if (formDirty) {
    const activeButton = root.querySelector<HTMLButtonElement>("#save")!;
    activeButton.disabled = false;
    activeButton.textContent = dirty ? "Save changes" : "Save plan";
    setMessage(message, failed);
  } else render();
}

window.addEventListener("beforeunload", (event) => {
  if (dirty || formDirty) event.preventDefault();
});
new ResizeObserver(drawConnections).observe(root);
render();
void load();
