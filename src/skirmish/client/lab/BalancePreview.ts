import { CONTENT_HASH } from "../../content/Catalog";
import { UNIT, UNITS } from "../../content/Units";
import { cavalryRankCycleTicks } from "../../domain/CavalryMelee";
import type { UnitDefinition } from "../../domain/Definitions";
import { AGES, AGE_NAMES } from "../../domain/Definitions";
import {
  formationDoctrine,
  formationEnvelope,
  type FormationShape,
} from "../../domain/FormationGeometry";
import { eligibleShape } from "../../domain/FormationProfiles";
import { FIXED, TICKS_PER_SECOND, TICK_MS, type Command } from "../../Protocol";
import { canCharge, chargeStatus } from "../ChargeReadiness";
import { OrderGesture } from "../OrderGesture";
import { Renderer } from "../Renderer";
import { installTroopPresentation } from "../troops/TroopPresentation";
import {
  BALANCE_FILE_LIMIT,
  BALANCE_STORAGE_KEY,
  createBalanceDraft,
  editRecipe,
  experimentRecipes,
  parseBalanceDraft,
  recipeTunings,
  type RecipeDraft,
} from "./BalanceDraft";
import {
  EXPERIMENT_ID,
  EXPERIMENT_LABEL,
  EXPERIMENT_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  activeBalanceProfile,
  editExperiment,
  experimentDefinition,
  experimentDefinitions,
  newExperiment,
  readExperiment,
  saveExperiment,
  type BalanceProfile,
} from "./BalanceExperiment";
import "./BalancePreview.css";
import {
  BALANCE_SCENARIOS,
  makeBalanceScenario,
  scenarioArmyCost,
  type ScenarioControls,
} from "./BalanceScenarios";
import {
  BATTLE_BONUS_TAGS,
  BattleLabModel,
  battleDefinition,
  type BattleEntry,
  type BattleSide,
  type BattleTuning,
  type WeaponTuning,
} from "./BattleLabModel";

const orderGesture = new OrderGesture();
const root = document.querySelector<HTMLElement>("#balance-preview")!;
root.innerHTML = `
<header class="header"><div><span class="eyebrow">AGE OF FRONTS / BALANCE LAB</span><h1>Balance Preview Page</h1><p class="muted">Build two armies. Watch a matchup, or take command.</p></div><nav><a href="/skirmish/soldier-lab.html">Units &amp; presentation lab</a><a href="/skirmish/index.html">Skirmish</a></nav></header>
<section class="draft-bar" aria-label="Balance draft"><div><strong>Recipe balance draft</strong><small id="draft-status" role="status">Applied stats and battle setup autosave in this browser.</small></div><button id="save-draft">Save draft</button><button id="export-draft">Export JSON</button><button id="import-draft">Import JSON</button><input id="import-file" type="file" accept=".json,application/json" hidden></section>
<section class="scenario-bar" aria-label="Preview scenarios"><label>Balance profile<select id="balance-profile"><option value="premodern-rebalance-v1">Approved balance</option><option value="live">Live stats / existing drafts</option></select></label><label>Scenario to load<select id="scenario">${BALANCE_SCENARIOS.map((scenario) => `<option value="${scenario.id}" ${scenario.id === "contemporary-EarlyMedieval" ? "selected" : ""}>${scenario.name}</option>`).join("")}</select></label><label>Formation size<select id="scenario-variant"><option value="base">Base</option><option value="enlarged">Larger formation</option></select></label><label class="scenario-check"><input id="scenario-vehicles" type="checkbox"> Include artillery / vehicles</label><button id="load-scenario">Load scenario</button><p id="scenario-description">Choose a preset to replace both armies. Your recipe edits are retained.</p></section>
<div class="toolbar"><button id="play" class="primary">Start battle</button><button id="step">Step 1 tick</button><button id="reset">Reset battle</button><label>Speed<select id="speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option selected value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label>Mode<select id="control"><option value="0">Watch both sides</option><option value="1">Control Blue</option><option value="2">Control Red</option></select></label><span class="spacer"></span><label>Starting separation<input id="separation" type="number" min="4" max="32" value="8"> tiles</label><button id="duel">1 axeman vs 2 clubmen</button><button id="fit">Fit battle</button></div>
<div class="layout"><section class="arena"><div class="scores"><div id="blue-score" class="score blue"></div><strong id="clock">0.0s</strong><div id="red-score" class="score red"></div></div><div class="viewport"><canvas id="battle" tabindex="0" aria-label="Battlefield. Drag to select, right click to move or attack, middle drag to pan, wheel to zoom."></canvas></div><div class="instructions">Control a side to select its units. Left click / drag: select · Shift: add · Right click: move / attack · Double right click: charge bonus · Middle drag: pan · Wheel: zoom · Space: pause</div><div class="command-bar"><button id="select-all">Select side</button><button id="attack" title="Normal attack; melee cavalry use sustained assault. Move to disengage.">Attack nearest</button><button id="hold">Hold</button><button id="charge" title="Order a bonus charge; right-click a target. Move to withdraw.">Charge bonus</button><label>Formation<select id="command-shape"></select></label><button id="reform">Reform selected</button></div><div id="feedback" class="feedback" role="status"></div><div id="selection" class="selection"></div></section>
<aside class="sidebar"><section class="panel"><h2>Add to the fight</h2><div class="fields"><label>Side<select id="side"><option value="1">Blue</option><option value="2">Red</option></select></label><label>Age<select id="age"><option value="">All ages</option>${AGES.map((a) => `<option value="${a}">${AGE_NAMES[AGES.indexOf(a)]}</option>`).join("")}</select></label><label>Unit type<select id="type"><option value="">All types</option></select></label><label>Size<select id="variant"><option value="base">Base</option><option value="enlarged">Larger formation</option></select></label><label class="wide">Unit<select id="unit"></select></label><label>Formations<input id="count" type="number" min="1" max="24" value="1"></label><label id="soldier-label">Soldiers per formation<input id="soldiers" type="number" min="1" value="1"></label><label class="wide">Starting formation<select id="shape"></select></label></div><button id="add" class="primary">Add formation</button><p class="notice">Uses the active balance profile. Setup changes reset the battle. Up to 24 formations per side.</p></section>
<section class="panel blue"><h2>Blue roster</h2><div id="roster-1" class="roster"></div></section><section class="panel red"><h2>Red roster</h2><div id="roster-2" class="roster"></div></section><section id="editor" class="panel editor" hidden></section><section class="panel"><small>This arena runs the real land movement and combat simulation. Automatic sides receive attack orders, without economy or strategic AI. Recipe drafts apply to both sides and future copies. Export JSON to share your changes for implementation. Ranged siege that cannot target soldiers will not attack them.</small></section></aside></div>`;

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
const number = (id: string) => Number(el<HTMLInputElement>(id).value);
const rankTestPanel = document.createElement("details");
rankTestPanel.className = "rank-test-panel";
rankTestPanel.open = true;
rankTestPanel.innerHTML = `<summary>Cavalry comparisons</summary><div class="rank-test-controls"><label>Attack pattern<select id="cavalry-mode"><option value="assault">Default assault</option><option value="ranks">Rank prototype</option></select></label><label id="rank-spacing-label">Rank launch spacing<select id="rank-launch-spacing"><option value="1">100% · current</option><option value="0.75">75% · more overlap</option><option value="0.5">50%</option><option value="0.25" selected>25%</option><option value="0.1">10% · near simultaneous</option></select></label><label>Test matchup<select id="rank-test-matchup"><option value="heavy-mirror">Druzhina vs Druzhina</option><option value="light-mirror">Rus Lancers vs Rus Lancers</option><option value="light-spears">Rus Lancers vs Mail Spearmen</option></select></label><button id="load-rank-test">Load cavalry test</button><strong id="rank-cycle-summary"></strong></div><p>Ordinary cavalry attacks use sustained assault. Double right-click orders a bonus charge. The rank prototype remains here for comparison, using 25% launch spacing by default. Changing the pattern resets the battle.</p>`;
root.querySelector(".toolbar")!.after(rankTestPanel);
let profile = activeBalanceProfile(localStorage),
  experiment = newExperiment();
try {
  experiment = readExperiment(localStorage);
} catch {
  /* Saved data remains untouched; exports remain available. */
}
let definitions: ReadonlyMap<string, UnitDefinition> =
  profile === EXPERIMENT_ID ? experimentDefinitions(experiment) : new Map();
const draftStorageKey = () =>
  profile === "live"
    ? BALANCE_STORAGE_KEY
    : "ageoffronts-balance-preview-premodern-v1";
const canvas = el<HTMLCanvasElement>("battle");
const renderer = new Renderer(canvas),
  actors = installTroopPresentation(renderer);
renderer.setGroundStyle("classic");
let entries: BattleEntry[] = [
  {
    side: 1,
    definitionId: "bronzeage-infantry",
    formations: 1,
    soldiers: 24,
    variant: "base",
    shape: "mass",
  },
  {
    side: 2,
    definitionId: "stoneage-infantry",
    formations: 1,
    soldiers: 24,
    variant: "base",
    shape: "mass",
  },
];
// Use the current authored capacities instead of assuming a catalogue size.
for (const entry of entries)
  entry.soldiers = UNIT.get(entry.definitionId)!.formationRecipe!.capacity;
let recipes: RecipeDraft[] = [];
const legacyEntries = structuredClone(entries);
let model: BattleLabModel,
  paused = true,
  accumulator = 0,
  lastFrame = performance.now(),
  chargeArmed = false,
  fitPending = true;
let editing = -1,
  editorTab = "combat",
  pendingTuning: BattleTuning = {};
renderer.unitDefinition = (squad) => model?.game.unitDefinition(squad);
function feedback(message: string, error = false) {
  el("feedback").textContent = message;
  el("feedback").classList.toggle("error", error);
}
function draftStatus(message: string, error = false) {
  el("draft-status").textContent = message;
  el("draft-status").classList.toggle("error", error);
}
function draftSummary(prefix: string) {
  if (profile === EXPERIMENT_ID)
    return `${prefix} · ${EXPERIMENT_LABEL} · ${Object.keys(experiment.changes).length} customised recipes${experiment.contentHash !== CONTENT_HASH ? " · Saved edits began on older game content." : ""}`;
  const older = recipes.some(
    (recipe) => recipe.baseContentHash !== CONTENT_HASH,
  );
  return `${prefix} · ${recipes.length} edited recipe${recipes.length === 1 ? "" : "s"}${older ? " · Some edits started on older game content; original values are retained in the export." : ""}`;
}
function balanceDraft() {
  return createBalanceDraft(
    entries,
    number("separation"),
    profile === EXPERIMENT_ID ? experimentRecipes(experiment) : recipes,
    profile === EXPERIMENT_ID ? experiment : undefined,
    scenarioControls(),
    number("rank-launch-spacing"),
    select("cavalry-mode").value as "assault" | "ranks",
  );
}
function scenarioControls(): ScenarioControls {
  return {
    id: select("scenario").value,
    variant: select("scenario-variant").value as "base" | "enlarged",
    includeVehicles: el<HTMLInputElement>("scenario-vehicles").checked,
  };
}
function restoreRankLaunchSpacing(spacing = 0.25) {
  const input = select("rank-launch-spacing"),
    value = String(spacing);
  if (![...input.options].some((option) => option.value === value))
    input.add(new Option(`${spacing * 100}% · imported`, value));
  input.value = value;
}
function restoreScenarioControls(controls?: ScenarioControls) {
  select("scenario").value = controls?.id ?? "contemporary-EarlyMedieval";
  select("scenario-variant").value = controls?.variant ?? "base";
  el<HTMLInputElement>("scenario-vehicles").checked =
    controls?.includeVehicles ?? false;
}
function restoredScenarioDescription() {
  const counts = ([1, 2] as const).map((side) =>
    entries
      .filter((entry) => entry.side === side)
      .reduce((n, entry) => n + entry.formations, 0),
  );
  el("scenario-description").textContent =
    `Saved setup restored: ${counts[0]} Blue / ${counts[1]} Red formations. Choose a preset and Load scenario to replace both armies; recipe edits are retained.`;
}
function persistDraft(): boolean {
  try {
    localStorage.setItem(draftStorageKey(), JSON.stringify(balanceDraft()));
    draftStatus(draftSummary("Saved in this browser"));
    return true;
  } catch (error) {
    draftStatus(
      `Could not save locally. Export JSON to keep your edits. ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
    return false;
  }
}
function publish() {
  const snapshot = model.game.snapshot();
  snapshot.localPlayerId = model.controlledSide ?? 1;
  renderer.update(snapshot);
  actors.update(snapshot);
}
function rebuild(
  message = "Battle reset. Ready to start.",
  save = true,
): boolean {
  try {
    const next = new BattleLabModel(
      entries,
      number("separation"),
      recipeTunings(recipes),
      definitions,
      number("rank-launch-spacing"),
      select("cavalry-mode").value as "assault" | "ranks",
    );
    next.controlledSide =
      (Number(select("control").value) as BattleSide) || null;
    model = next;
    el("rank-spacing-label").hidden = model.cavalryMode !== "ranks";
    el("rank-cycle-summary").textContent =
      model.cavalryMode === "ranks"
        ? `${(cavalryRankCycleTicks(model.rankLaunchSpacing) / TICKS_PER_SECOND).toFixed(2)}s minimum repeat cycle`
        : "Sustained assault · normal weapon cadence";
    paused = true;
    accumulator = 0;
    chargeArmed = false;
    orderGesture.cancel();
    actors.reset();
    renderer.setMap(model.game.map);
    publish();
    fitPending = true;
    roster();
    feedback(message);
    if (save) persistDraft();
    return true;
  } catch (error) {
    feedback(error instanceof Error ? error.message : String(error), true);
    return false;
  }
}
function roster() {
  for (const side of [1, 2] as const) {
    const holder = el(`roster-${side}`);
    holder.replaceChildren();
    entries.forEach((entry, index) => {
      if (entry.side !== side) return;
      const row = document.createElement("div");
      row.className = "roster-row";
      const text = document.createElement("div");
      text.textContent = `${entry.formations} × ${UNIT.get(entry.definitionId)!.name}`;
      const description = document.createElement("span");
      const edited = recipes.some(
        (recipe) => recipe.definitionId === entry.definitionId,
      );
      description.textContent = `${entry.soldiers} ${UNIT.get(entry.definitionId)!.formationRecipe!.model === "hull" ? "vehicles" : "soldiers"} each · ${entry.shape}${profile === EXPERIMENT_ID ? " · experiment" : edited ? " · recipe edited" : ""}`;
      if (edited) description.className = "edited";
      text.append(description);
      const edit = document.createElement("button");
      edit.textContent = "Edit";
      edit.onclick = () => openEditor(index);
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = "Remove from battle";
      remove.onclick = () => {
        const before = entries;
        entries = entries.filter((_, i) => i !== index);
        if (!rebuild()) entries = before;
        closeEditor();
      };
      row.append(text, edit, remove);
      holder.append(row);
    });
    if (!holder.childElementCount)
      holder.innerHTML = '<p class="empty">Add a unit to this side.</p>';
  }
}
const TYPES: Record<string, string> = {
  frontline: "Mainline infantry",
  antiCavalry: "Anti-cavalry",
  rangedInfantry: "Ranged infantry",
  lightCavalry: "Light cavalry",
  heavyCavalry: "Heavy cavalry",
  rangedCavalry: "Ranged cavalry",
  siege: "Siege",
  artillery: "Artillery",
  "anti-air": "Anti-air",
  launcher: "Launchers",
  mounted: "Mounted",
  ranged: "Ranged",
};
for (const key of [...new Set(UNITS.map((u) => u.troopClass ?? u.role))])
  select("type").add(new Option(TYPES[key] ?? key, key));
function unitOptions() {
  const previous = select("unit").value;
  const units = UNITS.filter(
    (u) =>
      (!select("age").value || u.age === select("age").value) &&
      (!select("type").value ||
        (u.troopClass ?? u.role) === select("type").value),
  );
  select("unit").replaceChildren(
    ...units.map(
      (u) => new Option(`${u.name} · ${AGE_NAMES[AGES.indexOf(u.age)]}`, u.id),
    ),
  );
  if (units.some((u) => u.id === previous)) select("unit").value = previous;
  el<HTMLButtonElement>("add").disabled = !units.length;
  unitSize();
}
function unitSize() {
  const unit =
    definitions.get(select("unit").value) ?? UNIT.get(select("unit").value);
  if (!unit) return;
  const recipe = unit.formationRecipe!,
    capacity =
      select("variant").value === "base"
        ? recipe.capacity
        : recipe.enlargedCapacity;
  el<HTMLInputElement>("soldiers").max = String(capacity);
  el<HTMLInputElement>("soldiers").value = String(capacity);
  shapes();
}
function shapes() {
  const unit = UNIT.get(select("unit").value);
  if (!unit) return;
  const doctrine = formationDoctrine(unit.id),
    previous = select("shape").value;
  const shapes = doctrine.shapes.filter(
    (shape) => eligibleShape(number("soldiers"), doctrine, shape) === shape,
  );
  select("shape").replaceChildren(
    ...shapes.map((shape) => new Option(shape, shape)),
  );
  select("shape").value = shapes.includes(previous as FormationShape)
    ? previous
    : shapes[0];
}
select("age").onchange = unitOptions;
select("type").onchange = unitOptions;
select("unit").onchange = unitSize;
select("variant").onchange = unitSize;
el("soldiers").onchange = shapes;
el("add").onclick = () => {
  const before = entries;
  entries = [
    ...entries,
    {
      side: number("side") as BattleSide,
      definitionId: select("unit").value,
      formations: number("count"),
      soldiers: number("soldiers"),
      variant: select("variant").value as "base" | "enlarged",
      shape: select("shape").value as FormationShape,
    },
  ];
  if (!rebuild("Unit added. Battle reset.")) entries = before;
};

function closeEditor() {
  editing = -1;
  el("editor").hidden = true;
}
function openEditor(index: number) {
  editing = index;
  pendingTuning =
    profile === EXPERIMENT_ID
      ? {}
      : structuredClone(
          recipes.find(
            (recipe) => recipe.definitionId === entries[index].definitionId,
          )?.tuning ?? {},
        );
  editorTab = "combat";
  drawEditor();
  el("editor").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function drawEditor() {
  const entry = entries[editing];
  if (!entry) {
    closeEditor();
    return;
  }
  const unit = battleDefinition(
      entry.definitionId,
      pendingTuning,
      definitions.get(entry.definitionId),
    ),
    holder = el("editor");
  holder.hidden = false;
  const copies = entries
    .filter((row) => row.definitionId === entry.definitionId)
    .reduce((sum, row) => sum + row.formations, 0);
  holder.innerHTML = `<div class="editor-title"><div><h2></h2><small>Shared recipe · ${copies} formation${copies === 1 ? "" : "s"} across both sides</small></div><button id="close-editor" aria-label="Close editor">×</button></div><div class="tabs" role="tablist" aria-label="Stat category">${["combat", "defence", "movement"].map((tab) => `<button role="tab" aria-selected="${editorTab === tab}" data-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}</div><div id="stat-fields" role="tabpanel"></div><div class="apply"><button id="apply-stats" class="primary">Apply to recipe</button><button id="live-stats">Restore live stats</button></div><p class="notice">Applies to every copy of this recipe on both sides, including units added later. Applying resets the fight and autosaves the draft.</p>`;
  holder.querySelector("h2")!.textContent = unit.name;
  el("live-stats").textContent =
    profile === EXPERIMENT_ID
      ? "Restore experiment stats"
      : "Restore live stats";
  el("close-editor").onclick = closeEditor;
  for (const button of holder.querySelectorAll<HTMLButtonElement>("[data-tab]"))
    button.onclick = () => {
      editorTab = button.dataset.tab!;
      drawEditor();
    };
  const fields = el("stat-fields");
  function field(
    parent: HTMLElement,
    label: string,
    value: number,
    min: number,
    max: number,
    change: (value: number) => void,
    step: number | "any" = "any",
  ) {
    const wrap = document.createElement("label");
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(Math.round(value * 1000) / 1000);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.oninput = () => {
      if (input.value !== "" && input.checkValidity())
        change(Number(input.value));
    };
    input.onchange = () => {
      input.reportValidity();
    };
    wrap.append(input);
    parent.append(wrap);
  }
  if (editorTab === "defence") {
    fields.className = "fields";
    const scale = unit.armourKind === "percentage" ? 100 : 1;
    field(
      fields,
      unit.formationRecipe!.model === "hull" ? "Vehicle HP" : "HP per soldier",
      unit.formationRecipe!.soldierHp,
      1,
      100000,
      (v) => (pendingTuning.hp = v),
    );
    field(
      fields,
      `Melee armour${scale === 100 ? " (%)" : " (points)"}`,
      unit.meleeArmour / scale,
      0,
      10000 / scale,
      (v) => (pendingTuning.meleeArmour = v * scale),
    );
    field(
      fields,
      `Ranged armour${scale === 100 ? " (%)" : " (points)"}`,
      unit.rangedArmour / scale,
      0,
      10000 / scale,
      (v) => (pendingTuning.rangedArmour = v * scale),
    );
  } else if (editorTab === "movement") {
    fields.className = "fields";
    field(
      fields,
      "Movement speed (%)",
      unit.speedPercent,
      1,
      1000,
      (v) => (pendingTuning.speedPercent = v),
    );
    if (unit.charge)
      field(
        fields,
        "Charge damage multiplier",
        unit.chargeMultiplier ?? 1,
        1,
        10,
        (v) => (pendingTuning.chargeMultiplier = v),
      );
    if (unit.charge?.bonusDurationTicks !== undefined)
      field(
        fields,
        "Charge bonus duration (seconds)",
        unit.charge.bonusDurationTicks / TICKS_PER_SECOND,
        0,
        120,
        (v) => (pendingTuning.chargeBonusSeconds = v),
      );
  } else {
    const channels: ("melee" | "ranged" | "attack")[] =
      unit.meleeAttack || unit.rangedAttack ? ["melee", "ranged"] : ["attack"];
    for (const channel of channels) {
      const profile =
        channel === "attack"
          ? unit.attack
          : channel === "melee"
            ? unit.meleeAttack
            : unit.rangedAttack;
      if (!profile) continue;
      const section = document.createElement("section");
      section.className = "stat-group";
      const title = document.createElement("h3");
      title.textContent =
        channel === "attack"
          ? "Primary weapon"
          : `${channel === "melee" ? "Melee" : "Ranged"} weapon`;
      section.append(title);
      const grid = document.createElement("div");
      grid.className = "fields";
      section.append(grid);
      fields.append(section);
      const patch = (key: keyof WeaponTuning, value: number) => {
        pendingTuning[channel] ??= {};
        Object.assign(pendingTuning[channel]!, { [key]: value });
      };
      field(grid, "Base damage", profile.damage, 0, 100000, (v) =>
        patch("damage", v),
      );
      field(
        grid,
        "Attacks / minute",
        profile.rpm ?? (60 * TICKS_PER_SECOND) / profile.reloadTicks,
        1,
        1200,
        (v) => patch("rpm", v),
      );
      field(grid, "Range (tiles)", profile.range / FIXED, 0.05, 64, (v) =>
        patch("rangeTiles", v),
      );
      if (profile.perSoldier && channel !== "melee")
        field(
          grid,
          "Reload (seconds)",
          (profile.reloadMs ?? 0) / 1000,
          0,
          120,
          (v) => patch("reloadSeconds", v),
        );
      if (channel !== "melee") {
        field(
          grid,
          "Accuracy at contact (%)",
          profile.accuracy?.near ?? 100,
          0,
          100,
          (v) => patch("accuracyNear", v),
        );
        field(
          grid,
          "Accuracy at max range (%)",
          profile.accuracy?.far ?? 100,
          0,
          100,
          (v) => patch("accuracyFar", v),
        );
      }
      for (const tag of BATTLE_BONUS_TAGS)
        field(
          grid,
          `Bonus vs ${tag}`,
          profile.bonuses[tag] ?? 0,
          0,
          100000,
          (v) => {
            pendingTuning[channel] ??= {};
            pendingTuning[channel]!.bonuses ??= {};
            pendingTuning[channel]!.bonuses![tag] = v;
          },
        );
    }
  }
  el("apply-stats").onclick = () => {
    applyEditor();
  };
  el("live-stats").onclick = () => {
    if (profile === EXPERIMENT_ID) {
      const next = structuredClone(experiment);
      delete next.changes[entry.definitionId];
      if (applySharedExperiment(next, "Approved experiment stats restored.")) {
        pendingTuning = {};
        drawEditor();
      }
      return;
    }
    const before = recipes;
    recipes = recipes.filter(
      (recipe) => recipe.definitionId !== entry.definitionId,
    );
    if (rebuild("Live stats restored for every copy of this recipe.")) {
      pendingTuning = {};
      drawEditor();
    } else recipes = before;
  };
}

function applyEditor(): boolean {
  const entry = entries[editing];
  if (!entry) return true;
  if (
    [...el("stat-fields").querySelectorAll("input")].some(
      (input) => !input.reportValidity(),
    )
  )
    return false;
  const current =
    recipes.find((recipe) => recipe.definitionId === entry.definitionId)
      ?.tuning ?? {};
  if (JSON.stringify(current) === JSON.stringify(pendingTuning)) return true;
  const before = recipes;
  try {
    if (profile === EXPERIMENT_ID) {
      if (!Object.keys(pendingTuning).length) return true;
      const latest = readExperiment(localStorage);
      const unit = battleDefinition(
        entry.definitionId,
        pendingTuning,
        experimentDefinition(latest, entry.definitionId),
      );
      if (
        !applySharedExperiment(
          editExperiment(latest, unit),
          "Shared recipe stats applied. Both previews updated; battle reset.",
        )
      )
        return false;
      pendingTuning = {};
      drawEditor();
      return true;
    }
    recipes = editRecipe(recipes, entry.definitionId, pendingTuning);
    if (
      !rebuild(
        "Recipe stats applied to both sides and future copies. Battle reset.",
      )
    ) {
      recipes = before;
      return false;
    }
    drawEditor();
    return true;
  } catch (error) {
    recipes = before;
    feedback(error instanceof Error ? error.message : String(error), true);
    return false;
  }
}
function applySharedExperiment(
  next: typeof experiment,
  message: string,
): boolean {
  const before = experiment,
    previousDefinitions = definitions;
  experiment = next;
  definitions = experimentDefinitions(next);
  if (!rebuild(message)) {
    experiment = before;
    definitions = previousDefinitions;
    return false;
  }
  try {
    saveExperiment(localStorage, next);
  } catch {
    draftStatus(
      "Shared browser storage is unavailable. Export JSON to keep your current experiment.",
      true,
    );
  }
  return true;
}

el("save-draft").onclick = () => {
  if (applyEditor()) persistDraft();
};
el("export-draft").onclick = () => {
  if (!applyEditor()) return;
  try {
    const draft = balanceDraft();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "balance-preview-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    draftStatus(draftSummary("Exported balance-preview-draft.json"));
  } catch (error) {
    draftStatus(error instanceof Error ? error.message : String(error), true);
  }
};
el("import-draft").onclick = () => el<HTMLInputElement>("import-file").click();
el<HTMLInputElement>("import-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > BALANCE_FILE_LIMIT)
      throw Error("Balance draft exceeds 2 MB");
    const draft = parseBalanceDraft(await file.text());
    const before = {
      entries,
      recipes,
      profile,
      experiment,
      definitions,
      separation: el<HTMLInputElement>("separation").value,
      controls: scenarioControls(),
      rankLaunchSpacing: select("rank-launch-spacing").value,
      cavalryMode: select("cavalry-mode").value,
    };
    entries = draft.scenario.entries;
    profile = draft.experiment ? EXPERIMENT_ID : "live";
    if (draft.experiment) experiment = draft.experiment;
    definitions = draft.experiment
      ? experimentDefinitions(experiment)
      : new Map();
    recipes = draft.experiment ? [] : draft.recipes;
    el<HTMLInputElement>("separation").value = String(
      draft.scenario.separation,
    );
    restoreScenarioControls(draft.scenario.controls);
    restoreRankLaunchSpacing(draft.scenario.rankLaunchSpacing);
    select("cavalry-mode").value = draft.scenario.cavalryMode ?? "assault";
    if (rebuild("Imported recipe stats and battle setup. Ready to test.")) {
      select("balance-profile").value = profile;
      restoredScenarioDescription();
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, profile);
        if (draft.experiment) saveExperiment(localStorage, experiment);
      } catch {
        draftStatus(
          "Imported for this session; browser storage is unavailable. Export JSON to keep the draft.",
          true,
        );
      }
      closeEditor();
    } else {
      entries = before.entries;
      recipes = before.recipes;
      profile = before.profile;
      experiment = before.experiment;
      definitions = before.definitions;
      el<HTMLInputElement>("separation").value = before.separation;
      restoreScenarioControls(before.controls);
      restoreRankLaunchSpacing(Number(before.rankLaunchSpacing));
      select("cavalry-mode").value = before.cavalryMode;
    }
  } catch (error) {
    draftStatus(
      `Import failed; current draft kept. ${error instanceof Error ? error.message : String(error)}`,
      true,
    );
  } finally {
    input.value = "";
  }
};

function selected() {
  return [...renderer.selected].filter(
    (id) => model.game.squad(id)?.playerId === model.controlledSide,
  );
}
function issue(command: Command, success = "Order issued.") {
  const error = model.command(command);
  feedback(error ?? success, !!error);
  publish();
  chargeArmed = false;
}
function play() {
  if (model.finished) {
    feedback("Battle finished. Reset to run it again.");
    return;
  }
  try {
    if (!model.started) model.start();
    paused = !paused;
    accumulator = 0;
    publish();
  } catch (error) {
    feedback(String(error), true);
  }
}
el("play").onclick = play;
el("step").onclick = () => {
  try {
    if (!model.started) model.start();
    paused = true;
    model.step();
    publish();
  } catch (error) {
    feedback(String(error), true);
  }
};
el("reset").onclick = () => rebuild();
el("separation").onchange = () => rebuild();
select("control").onchange = () => {
  model.controlledSide =
    (Number(select("control").value) as BattleSide) || null;
  renderer.selected.clear();
  chargeArmed = false;
  orderGesture.cancel();
  publish();
  feedback(
    model.controlledSide
      ? `Controlling ${model.controlledSide === 1 ? "Blue" : "Red"}. Select units, then issue an order.`
      : "Watching both sides. Both armies receive automatic attack orders.",
  );
};
el("select-all").onclick = () => {
  orderGesture.cancel();
  renderer.selected.clear();
  for (const s of model.game.squads)
    if (s.playerId === model.controlledSide) renderer.selected.add(s.id);
};
el("attack").onclick = () => {
  if (model.controlledSide)
    model.attackNearest(model.controlledSide, selected());
  publish();
};
el("hold").onclick = () => {
  if (model.controlledSide && selected().length)
    issue({
      type: "order",
      playerId: model.controlledSide,
      squadIds: selected(),
      order: { type: "hold" },
    });
};
el("charge").onclick = () => {
  orderGesture.cancel();
  if (selected().length) {
    chargeArmed = true;
    feedback("Charge armed: right-click an enemy. Escape cancels.");
  }
};
el("reform").onclick = () => {
  if (model.controlledSide && selected().length)
    issue({
      type: "formation",
      playerId: model.controlledSide,
      squadIds: selected(),
      shape: select("command-shape").value as FormationShape,
    });
};
for (const shape of [
  "mass",
  "line",
  "shield-wall",
  "square",
  "wedge",
  "column",
  "modern-loose",
])
  select("command-shape").add(new Option(shape, shape));
el("duel").onclick = () => {
  entries = [
    {
      side: 1,
      definitionId: "bronzeage-infantry",
      formations: 1,
      soldiers: 1,
      variant: "base",
      shape: "mass",
    },
    {
      side: 2,
      definitionId: "stoneage-infantry",
      formations: 1,
      soldiers: 2,
      variant: "base",
      shape: "mass",
    },
  ];
  closeEditor();
  rebuild("One axeman against two clubmen. Ready to start.");
};
el("fit").onclick = () => (fitPending = true);
function position(event: MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
let drag:
  | {
      x: number;
      y: number;
      lastX: number;
      lastY: number;
      button: number;
      shift: boolean;
      moved: boolean;
    }
  | undefined;
canvas.oncontextmenu = (event) => event.preventDefault();
canvas.onpointerdown = (event) => {
  event.preventDefault();
  canvas.focus();
  if (event.button !== 2) orderGesture.cancel();
  canvas.setPointerCapture(event.pointerId);
  const p = position(event);
  drag = {
    ...p,
    lastX: p.x,
    lastY: p.y,
    button: event.button,
    shift: event.shiftKey,
    moved: false,
  };
};
canvas.onpointermove = (event) => {
  const p = position(event);
  renderer.hoveredSquadId = renderer.squadAt(p.x, p.y)?.id ?? null;
  if (!drag) return;
  drag.moved ||= Math.hypot(p.x - drag.x, p.y - drag.y) > 5;
  if (drag.button === 1) renderer.pan(p.x - drag.lastX, p.y - drag.lastY);
  if (drag.button === 0 && drag.moved)
    renderer.selectionBox = { x1: drag.x, y1: drag.y, x2: p.x, y2: p.y };
  drag.lastX = p.x;
  drag.lastY = p.y;
};
canvas.onpointerup = (event) => {
  if (!drag) return;
  const start = drag,
    p = position(event);
  drag = undefined;
  renderer.selectionBox = undefined;
  const side = model.controlledSide;
  if (start.button === 0) {
    if (!start.shift) renderer.selected.clear();
    if (start.moved && side) {
      for (const s of model.game.squads)
        if (
          s.playerId === side &&
          renderer.squadIntersectsBox(s, start.x, start.y, p.x, p.y)
        )
          renderer.selected.add(s.id);
    } else {
      const hit = renderer.squadAt(p.x, p.y);
      renderer.inspectedSquadId = hit?.id ?? null;
      if (hit?.playerId === side) renderer.selected.add(hit.id);
    }
  } else if (start.button === 2 && side && selected().length) {
    const target = renderer.squadAt(p.x, p.y),
      tile = renderer.tileAt(p.x, p.y);
    if (tile === null) return;
    const ids = selected(),
      world = renderer.world(p.x, p.y);
    const x = Math.round(world.x * FIXED),
      y = Math.round(world.y * FIXED);
    const charge = () => {
      const chargers = ids.filter((id) => {
        const squad = model.game.squad(id);
        return squad && canCharge(squad, model.game.tick, x, y);
      });
      if (!chargers.length) {
        chargeArmed = false;
        feedback(
          "No selected unit can charge here. Select charge-capable cavalry and a target within charge range.",
          true,
        );
        return;
      }
      issue(
        {
          type: "charge",
          playerId: side,
          squadIds: chargers,
          x,
          y,
          ...(target && target.playerId !== side
            ? { targetId: target.id }
            : {}),
        },
        `Charge / assault ordered for ${chargers.length} formation${chargers.length === 1 ? "" : "s"}.`,
      );
    };
    if (chargeArmed) {
      orderGesture.cancel();
      charge();
    } else
      orderGesture.submit(
        {
          time: performance.now(),
          ...p,
          context: `${side}:${ids.sort((a, b) => a - b).join(",")}`,
          single: () =>
            issue({
              type: "order",
              playerId: side,
              squadIds: ids,
              order:
                target && target.playerId !== side
                  ? { type: "attack", targetId: target.id }
                  : { type: "move", tile },
              append: start.shift,
            }),
        },
        start.shift ? undefined : charge,
      );
  }
};
canvas.onpointercancel = () => {
  orderGesture.cancel();
  drag = undefined;
  renderer.selectionBox = undefined;
};
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const p = position(event);
    renderer.zoom(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
  },
  { passive: false },
);
canvas.onkeydown = (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    play();
  }
  if (event.code === "Escape") {
    orderGesture.cancel();
    chargeArmed = false;
    feedback("Charge cancelled.");
  }
};
unitOptions();
function loadProfileState(next: BalanceProfile) {
  profile = next;
  select("balance-profile").value = profile;
  restoreScenarioControls();
  restoreRankLaunchSpacing();
  select("cavalry-mode").value = "assault";
  recipes = [];
  let restoredMessage = "Battle reset. Ready to start.";
  try {
    experiment = readExperiment(localStorage);
  } catch (error) {
    draftStatus(`Saved experiment was kept untouched. ${String(error)}`, true);
  }
  definitions =
    profile === EXPERIMENT_ID ? experimentDefinitions(experiment) : new Map();
  const initial =
    profile === EXPERIMENT_ID
      ? makeBalanceScenario(
          "contemporary-EarlyMedieval",
          "base",
          false,
          definitions,
        )
      : null;
  entries = initial?.entries ?? structuredClone(legacyEntries);
  el<HTMLInputElement>("separation").value = String(initial?.separation ?? 8);
  el("scenario-description").textContent =
    initial?.description ??
    "Choose a scenario to replace both armies. Existing recipe edits are retained.";
  try {
    const saved = localStorage.getItem(draftStorageKey());
    if (saved) {
      const draft = parseBalanceDraft(saved);
      entries = draft.scenario.entries;
      restoreScenarioControls(draft.scenario.controls);
      restoreRankLaunchSpacing(draft.scenario.rankLaunchSpacing);
      select("cavalry-mode").value = draft.scenario.cavalryMode ?? "assault";
      restoredScenarioDescription();
      if (profile === "live") recipes = draft.recipes;
      else if (
        !localStorage.getItem(EXPERIMENT_STORAGE_KEY) &&
        draft.experiment
      ) {
        experiment = draft.experiment;
        definitions = experimentDefinitions(experiment);
      }
      el<HTMLInputElement>("separation").value = String(
        draft.scenario.separation,
      );
      restoredMessage =
        "Saved recipe draft and battle setup restored. Ready to test.";
      draftStatus(draftSummary("Restored from this browser"));
    } else draftStatus(draftSummary("Preview ready"));
  } catch (error) {
    draftStatus(
      `Saved draft could not be loaded and was left untouched. ${String(error)}`,
      true,
    );
  }
  closeEditor();
  unitSize();
  if (!rebuild(restoredMessage, false)) {
    const fallback =
      profile === EXPERIMENT_ID
        ? makeBalanceScenario(
            "contemporary-EarlyMedieval",
            "base",
            false,
            definitions,
          )
        : null;
    entries = fallback?.entries ?? structuredClone(legacyEntries);
    restoreScenarioControls();
    el("scenario-description").textContent =
      fallback?.description ??
      "Default duel loaded. Choose a preset to replace both armies.";
    el<HTMLInputElement>("separation").value = String(
      fallback?.separation ?? 8,
    );
    rebuild(
      "Saved setup no longer fits the current stats. A default setup is loaded; the saved draft was kept.",
      false,
    );
  }
}
select("balance-profile").onchange = () => {
  const next = select("balance-profile").value as BalanceProfile;
  if (!applyEditor()) {
    select("balance-profile").value = profile;
    return;
  }
  loadProfileState(next);
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, profile);
  } catch {
    /* Session-only profile. */
  }
};
el("load-scenario").onclick = () => {
  if (!applyEditor()) return;
  try {
    const scenario = makeBalanceScenario(
      select("scenario").value,
      select("scenario-variant").value as "base" | "enlarged",
      el<HTMLInputElement>("scenario-vehicles").checked,
      definitions,
    );
    const before = entries,
      separation = el<HTMLInputElement>("separation").value;
    entries = scenario.entries;
    el<HTMLInputElement>("separation").value = String(scenario.separation);
    if (
      rebuild(
        "Scenario loaded. Press Start battle to observe, or take control of a side.",
      )
    ) {
      closeEditor();
      el("scenario-description").textContent =
        `${scenario.description} ${scenarioArmyCost(entries, definitions)} gold per army.`;
    } else {
      entries = before;
      el<HTMLInputElement>("separation").value = separation;
    }
  } catch (error) {
    feedback(String(error), true);
  }
};
select("rank-launch-spacing").onchange = () => {
  const previous = String(model.rankLaunchSpacing);
  if (
    !applyEditor() ||
    !rebuild(
      "Rank launch spacing changed. Rider movement speed is unchanged. Ready to compare.",
    )
  )
    select("rank-launch-spacing").value = previous;
};
select("cavalry-mode").onchange = () => {
  const previous = model.cavalryMode;
  if (
    !applyEditor() ||
    !rebuild("Cavalry attack pattern changed. Ready to compare.")
  )
    select("cavalry-mode").value = previous;
};
el("load-rank-test").onclick = () => {
  if (!applyEditor()) return;
  const matchup = select("rank-test-matchup").value;
  const roles =
    matchup === "heavy-mirror"
      ? ["heavyCavalry", "heavyCavalry"]
      : matchup === "light-mirror"
        ? ["lightCavalry", "lightCavalry"]
        : ["lightCavalry", "antiCavalry"];
  const units = roles.map(
    (role) =>
      UNITS.find(
        (unit) => unit.age === "EarlyMedieval" && unit.troopClass === role,
      )!,
  );
  const before = entries,
    separation = el<HTMLInputElement>("separation").value;
  entries = units.map((base, index) => {
    const unit = definitions.get(base.id) ?? base;
    return {
      side: (index + 1) as BattleSide,
      definitionId: unit.id,
      formations: 1,
      soldiers: Math.min(12, unit.formationRecipe!.capacity),
      variant: "base",
      shape: eligibleShape(
        Math.min(12, unit.formationRecipe!.capacity),
        formationDoctrine(unit.id),
        formationDoctrine(unit.id).defaultShape,
      ),
    };
  });
  el<HTMLInputElement>("separation").value = "4";
  if (
    rebuild(
      "Cavalry test loaded. Start the battle, then compare another launch spacing.",
    )
  ) {
    closeEditor();
    el("scenario-description").textContent =
      `${units[0].name} vs ${units[1].name} · ${entries[0].soldiers} vs ${entries[1].soldiers} soldiers. Ordinary attacks use the selected pattern; double right-click orders charge. The chosen formation is preserved.`;
  } else {
    entries = before;
    el<HTMLInputElement>("separation").value = separation;
  }
};
window.addEventListener("storage", (event) => {
  if (event.key === PROFILE_STORAGE_KEY)
    loadProfileState(activeBalanceProfile(localStorage));
  else if (event.key === EXPERIMENT_STORAGE_KEY && profile === EXPERIMENT_ID) {
    try {
      const next = readExperiment(localStorage),
        nextDefinitions = experimentDefinitions(next);
      experiment = next;
      definitions = nextDefinitions;
      if (
        !rebuild(
          "Shared numeric stats updated from the soldier lab. Battle reset.",
          false,
        )
      ) {
        paused = true;
        accumulator = 0;
        closeEditor();
        unitSize();
        feedback(
          "Shared stats changed the recipe capacity. Reload a scenario to use its new squad sizes.",
          true,
        );
      } else {
        closeEditor();
        unitSize();
        draftStatus(draftSummary("Shared experiment updated"));
      }
    } catch (error) {
      feedback(`Shared update rejected: ${String(error)}`, true);
    }
  }
});
loadProfileState(profile);
let lastStats = 0;
function frame(now: number) {
  const speed = number("speed");
  if (!paused && !model.finished) {
    accumulator += Math.min(200, now - lastFrame) * speed;
    let steps = 0;
    while (accumulator >= TICK_MS && steps++ < 16 && !model.finished) {
      model.step();
      accumulator -= TICK_MS;
    }
    if (steps) publish();
  }
  lastFrame = now;
  if (
    model.finished &&
    !paused &&
    (renderer.combatFrame(now, speed, false)?.tick ?? model.game.tick) >=
      model.game.tick
  ) {
    paused = true;
    const winner = model.summary(1).formations
      ? "Blue"
      : model.summary(2).formations
        ? "Red"
        : "Neither side";
    feedback(`${winner} wins. Reset to repeat the matchup.`);
  }
  actors.beginFrame(now, speed, paused);
  renderer.draw(now, speed, paused);
  actors.endFrame(now, 0);
  if (fitPending) {
    fitPending = false;
    const bodies = model.game.squads.map((s) => ({
      s,
      e: formationEnvelope(s, model.game.tick),
    }));
    const left = Math.min(
      ...bodies.map(({ s, e }) => (s.x - e.halfX) / FIXED),
      46,
    );
    const right = Math.max(
      ...bodies.map(({ s, e }) => (s.x + e.halfX) / FIXED),
      50,
    );
    const top = Math.min(
      ...bodies.map(({ s, e }) => (s.y - e.halfY) / FIXED),
      46,
    );
    const bottom = Math.max(
      ...bodies.map(({ s, e }) => (s.y + e.halfY) / FIXED),
      50,
    );
    renderer.home();
    renderer.zoom(
      Math.min(
        canvas.clientWidth / (right - left + 3),
        canvas.clientHeight / (bottom - top + 3),
      ) / renderer.pixelsPerCell,
      canvas.clientWidth / 2,
      canvas.clientHeight / 2,
    );
    const center = renderer.screen((left + right) / 2, (top + bottom) / 2);
    renderer.pan(
      canvas.clientWidth / 2 - center.x,
      canvas.clientHeight / 2 - center.y,
    );
  }
  if (now - lastStats > 150) {
    lastStats = now;
    const presented = renderer.combatFrame(now, speed, paused);
    for (const side of [1, 2] as const) {
      const s = model.summary(side, presented?.snapshot.squads);
      el(side === 1 ? "blue-score" : "red-score").innerHTML =
        `<strong>${side === 1 ? "Blue" : "Red"} · ${s.formations} formations</strong><small>${s.troops} remaining · ${s.losses} lost · ${Math.round(s.hp)} HP</small>`;
    }
    el("clock").textContent =
      `${((presented?.tick ?? model.game.tick) / TICKS_PER_SECOND).toFixed(1)}s`;
    el("play").textContent = model.finished
      ? "Battle finished"
      : !model.started
        ? "Start battle"
        : paused
          ? "Resume"
          : "Pause";
    el<HTMLButtonElement>("play").disabled = model.finished;
    el<HTMLButtonElement>("step").disabled = model.finished;
    for (const id of ["select-all", "attack", "hold", "charge", "reform"])
      el<HTMLButtonElement>(id).disabled = !model.controlledSide;
    const inspected = model.game.squad(
        renderer.inspectedSquadId ?? selected()[0] ?? -1,
      ),
      definition = inspected && model.game.expansion!.unit(inspected);
    el("selection").textContent =
      inspected && definition
        ? `${definition.name} · ${inspected.troops} remaining · ${definition.meleeArmour} melee armour · ${definition.rangedArmour} ranged armour · ${definition.speedPercent}% speed${chargeStatus(inspected, presented?.tick ?? model.game.tick) ? ` · ${chargeStatus(inspected, presented?.tick ?? model.game.tick)}` : ""} · ${selected().length} selected`
        : "Click a formation to inspect it. Edit roster entries in the sidebar.";
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
