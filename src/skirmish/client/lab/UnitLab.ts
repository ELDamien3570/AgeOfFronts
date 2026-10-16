import { CONTENT_HASH } from "../../content/Catalog";
import { TECHNOLOGY } from "../../content/Technology";
import {
  AGES,
  AGE_NAMES,
  type AttackProfile,
  type TargetTag,
  type UnitDefinition,
} from "../../domain/Definitions";
import {
  FORMATION_SHAPES,
  createFormation,
  formationDoctrine,
  formationSlots,
  type FormationShape,
} from "../../domain/FormationGeometry";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import { EraArtwork, eraPortrait } from "../EraArtwork";
import { RUSSIAN_TROOP_ACTORS } from "../troops/RussianTroopCatalogue";
import {
  EXPERIMENT_ID,
  EXPERIMENT_LABEL,
  EXPERIMENT_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  activeBalanceProfile,
  editExperiment,
  experimentDefinitions,
  newExperiment,
  numericStats,
  readExperiment,
  saveExperiment,
  type BalanceProfile,
} from "./BalanceExperiment";
import {
  LAB_ENTITIES,
  draftRecruitmentCost,
  estimatedDps,
  makeDraft,
  validateDraft,
  type DpsTarget,
  type UnitDraft,
} from "./UnitLabModel";
import { installUnitLabSheet } from "./UnitLabSheet";

const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
const legacyStorageKey = "ageoffronts-unit-lab-v1";
const BONUS_TARGET_LABELS: Record<TargetTag, string> = {
  infantry: "Infantry",
  ranged: "Ranged infantry",
  mounted: "Cavalry",
  armoured: "Armoured (secondary tag)",
  vehicle: "Vehicles",
  siege: "Siege",
  ship: "Ships",
  aircraft: "Aircraft",
  structure: "Buildings",
  wall: "Walls",
};
export function installUnitLab(
  load: (id: string) => Promise<void>,
  actor: (
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    multiplier: number,
    time: number,
    pose: string,
    tileSize: number,
  ) => void,
) {
  const drafts = new Map<string, UnitDraft>();
  let profile = activeBalanceProfile(localStorage);
  let experiment = newExperiment();
  let sharedDefinitions = experimentDefinitions(experiment);
  const observedNumeric = new Map<string, string>();
  let staleCache = false;
  const primaryStorageKey = () =>
    profile === "live" ? legacyStorageKey : "ageoffronts-unit-lab-premodern-v1";
  const storageKey = () =>
    primaryStorageKey() + (staleCache ? `-${CONTENT_HASH}` : "");
  let current: UnitDraft;
  let revision = 0;
  let loading = false;
  let previewError = "";
  let lastPreviewKey = "";
  const era = new EraArtwork();
  const editor = el("catalog-editor");
  const previewSection = el("catalog-preview-section");
  const estimatePanel = el("catalog-dps");
  const cards = new Map<string, HTMLDetailsElement>();
  let expandedKey = "";
  const entityType = (entity: (typeof LAB_ENTITIES)[number]) =>
    String(
      entity.definition.troopClass ??
        entity.definition.role ??
        entity.definition.kind ??
        entity.category,
    );
  for (const [i, age] of AGES.entries())
    select("catalog-age").add(new Option(AGE_NAMES[i], age));
  for (const type of [...new Set(LAB_ENTITIES.map(entityType))].sort())
    select("catalog-type").add(new Option(type, type));
  // The shared target belongs above the grid so every card is comparable.
  const targetSection = el("target-fields").closest("section")!;
  const targetDetails = document.createElement("details");
  const targetSummary = document.createElement("summary");
  targetSummary.textContent =
    "Comparison target: armour, accuracy and target class";
  targetDetails.append(targetSummary, targetSection);
  el("catalog-filters").after(targetDetails);
  // Keep the selected unit's read-only estimates beside its editable stats.
  const previewHolder = previewSection.parentElement!;
  select("catalog-entity").parentElement!.hidden = true;
  const target: DpsTarget = {
    tag: "infantry",
    armourKind: "points",
    meleeArmour: 0,
    rangedArmour: 0,
    healthPercent: 100,
    accuracy: 100,
    distance: 6,
    cover: 0,
    soldiers: true,
  };
  const status = (message: string) => {
    el("catalog-status").textContent = message;
  };
  function loadDrafts() {
    drafts.clear();
    observedNumeric.clear();
    staleCache = false;
    select("catalog-profile").value = profile;
    el("catalog-scope").textContent =
      profile === "live"
        ? "Local content drafts. Your existing drafts are separate from the approved experiment. Export them for review and integration."
        : `${EXPERIMENT_LABEL}: land numeric edits are shared with the Balance Preview. Formation access and other entity types remain inspector previews. Existing drafts are kept separately.`;
    if (profile !== "live") {
      try {
        experiment = readExperiment(localStorage);
        sharedDefinitions = experimentDefinitions(experiment);
      } catch (error) {
        status(
          `Shared experiment could not be loaded; saved data was kept. ${String(error)}`,
        );
      }
    }
    try {
      let saved = JSON.parse(localStorage.getItem(storageKey()) ?? "null");
      if (saved && saved.contentHash !== CONTENT_HASH) {
        staleCache = true;
        saved = JSON.parse(localStorage.getItem(storageKey()) ?? "null");
        status(
          "Older drafts were kept in their original storage. This game version uses a separate draft cache.",
        );
      }
      if (saved?.contentHash === CONTENT_HASH && Array.isArray(saved.drafts))
        for (const row of saved.drafts) {
          const entity = LAB_ENTITIES.find((e) => e.key === row.key);
          if (!entity) continue;
          validateDraft(row.definition);
          if (
            !Array.isArray(row.shapes) ||
            row.shapes.some(
              (s: string) => !FORMATION_SHAPES.includes(s as FormationShape),
            )
          )
            continue;
          const draft = makeDraft(entity);
          draft.definition =
            profile !== "live" && entity.category === "unit"
              ? (structuredClone(
                  sharedDefinitions.get(entity.id)!,
                ) as unknown as Record<string, unknown>)
              : row.definition;
          draft.shapes = row.shapes;
          draft.defaultShape = row.defaultShape;
          drafts.set(entity.key, draft);
          if (profile !== "live" && entity.category === "unit")
            observedNumeric.set(
              entity.id,
              JSON.stringify(
                numericStats(draft.definition as unknown as UnitDefinition),
              ),
            );
        }
      else if (saved)
        status(
          "Saved drafts use older game content. They were not loaded; export or reset them before changing versions.",
        );
    } catch {
      staleCache = true;
      status(
        "Saved drafts could not be loaded and were kept. New edits use a separate cache.",
      );
    }
  }
  loadDrafts();
  function payload() {
    return {
      schemaVersion: 1,
      previewOnly: true,
      contentHash: CONTENT_HASH,
      target: { ...target },
      ...(profile !== "live" ? { experiment } : {}),
      drafts: [...drafts.values()].map((d) => ({
        key: d.entity.key,
        category: d.entity.category,
        definition: d.definition,
        shapes: d.shapes,
        defaultShape: d.defaultShape,
      })),
    };
  }
  function persist() {
    try {
      if (profile !== "live") {
        const changed = [...drafts.values()].filter(
          (draft) =>
            draft.entity.category === "unit" &&
            JSON.stringify(
              numericStats(draft.definition as unknown as UnitDefinition),
            ) !== observedNumeric.get(draft.entity.id),
        );
        if (changed.length) {
          let next = readExperiment(localStorage);
          for (const draft of changed)
            next = editExperiment(
              next,
              draft.definition as unknown as UnitDefinition,
            );
          saveExperiment(localStorage, next);
          experiment = next;
          sharedDefinitions = experimentDefinitions(next);
          for (const draft of changed)
            observedNumeric.set(
              draft.entity.id,
              JSON.stringify(
                numericStats(draft.definition as unknown as UnitDefinition),
              ),
            );
        }
      }
      localStorage.setItem(storageKey(), JSON.stringify(payload()));
    } catch {
      status("Browser storage unavailable; export your drafts to keep them.");
    }
  }
  function getDraft(key: string) {
    let d = drafts.get(key);
    if (!d) {
      d = makeDraft(LAB_ENTITIES.find((e) => e.key === key)!);
      if (profile !== "live" && d.entity.category === "unit") {
        d.definition = structuredClone(
          sharedDefinitions.get(d.entity.id)!,
        ) as unknown as Record<string, unknown>;
        observedNumeric.set(
          d.entity.id,
          JSON.stringify(
            numericStats(d.definition as unknown as UnitDefinition),
          ),
        );
      }
      drafts.set(key, d);
    }
    return d;
  }
  function options() {
    const previous = select("catalog-entity").value,
      query = el<HTMLInputElement>("catalog-search").value.toLowerCase(),
      category = select("catalog-category").value;
    const age = select("catalog-age").value,
      type = select("catalog-type").value,
      sort = select("catalog-sort").value;
    const score = (entity: (typeof LAB_ENTITIES)[number]) =>
      Math.max(
        0,
        ...estimatedDps(
          getDraft(entity.key),
          target,
          "base",
          getDraft(entity.key).defaultShape,
        ).map((p) => p.dps),
      );
    const health = (entity: (typeof LAB_ENTITIES)[number]) => {
      const d = getDraft(entity.key).definition as unknown as UnitDefinition & {
        health?: number;
      };
      return d.formationRecipe
        ? d.formationRecipe.capacity * d.formationRecipe.soldierHp
        : (d.health ?? 0);
    };
    const entities = LAB_ENTITIES.filter(
      (e) =>
        (!category || e.category === category) &&
        (!age || e.definition.age === age) &&
        (!type || entityType(e) === type) &&
        `${e.name} ${e.id} ${e.definition.age ?? ""}`
          .toLowerCase()
          .includes(query),
    ).sort((a, b) => {
      const result =
        sort === "dps"
          ? score(b) - score(a)
          : sort === "health"
            ? health(b) - health(a)
            : sort === "age"
              ? AGES.indexOf(a.definition.age as (typeof AGES)[number]) -
                AGES.indexOf(b.definition.age as (typeof AGES)[number])
              : 0;
      return result || a.name.localeCompare(b.name);
    });
    select("catalog-entity").replaceChildren(
      ...entities.map(
        (e) =>
          new Option(
            `${e.category} · ${e.definition.age ?? ""} · ${e.name}`,
            e.key,
          ),
      ),
    );
    if (entities.some((e) => e.key === previous))
      select("catalog-entity").value = previous;
    editor.hidden = true;
    el("unit-panel").append(editor);
    cards.clear();
    expandedKey = "";
    el("catalog-cards").replaceChildren();
    for (const entity of entities) {
      const card = document.createElement("details");
      card.className = "catalog-card";
      card.dataset.key = entity.key;
      card.append(document.createElement("summary"));
      card.addEventListener("toggle", () => {
        if (card.open) {
          for (const [key, other] of cards)
            if (key !== entity.key) other.open = false;
          expandedKey = entity.key;
          card.append(editor);
          editor.hidden = false;
          select("catalog-entity").value = entity.key;
          void choose();
        } else if (expandedKey === entity.key) {
          editor.hidden = true;
          expandedKey = "";
        }
      });
      cards.set(entity.key, card);
      el("catalog-cards").append(card);
    }
    el("catalog-count").textContent =
      `${entities.length} entries · eDPS uses the base recipe and its default formation · cards and spreadsheet edit the same drafts`;
    refreshCards();
    if (entities.length) choose();
    else {
      status("No catalogue entries match this search.");
    }
  }
  function refreshCards() {
    for (const [key, card] of cards) {
      const draft = getDraft(key),
        definition = draft.definition as unknown as UnitDefinition & {
          health?: number;
          speed?: number;
          capacity?: number;
        };
      const summary = card.querySelector("summary")!;
      summary.replaceChildren();
      const portrait = eraPortrait(draft.entity.artworkId);
      if (portrait) {
        const img = document.createElement("img");
        img.src = portrait;
        img.alt = "";
        img.loading = "lazy";
        summary.append(img);
      }
      const heading = document.createElement("h3");
      heading.textContent = draft.entity.name;
      summary.append(heading);
      const meta = document.createElement("p");
      meta.textContent = `${definition.age ? AGE_NAMES[AGES.indexOf(definition.age)] : draft.entity.category} · ${entityType(draft.entity)}`;
      summary.append(meta);
      const dl = document.createElement("dl");
      const add = (label: string, value: string) => {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        dl.append(dt, dd);
      };
      const recipe = definition.formationRecipe;
      if (recipe) {
        add(
          recipe.model === "soldiers"
            ? "Soldiers base → upgraded"
            : "Hull actors",
          `${recipe.capacity} → ${recipe.enlargedCapacity}`,
        );
        add(
          recipe.model === "soldiers" ? "HP / soldier" : "Hull HP",
          String(recipe.soldierHp),
        );
      } else if (definition.health !== undefined)
        add("Health", String(definition.health));
      add(
        "Movement",
        definition.speedPercent !== undefined
          ? `${definition.speedPercent}%`
          : definition.speed !== undefined
            ? `${((definition.speed * TICKS_PER_SECOND) / 256).toFixed(2)} tiles/s`
            : "—",
      );
      const profiles =
        definition.meleeAttack || definition.rangedAttack
          ? [definition.meleeAttack, definition.rangedAttack].filter(Boolean)
          : definition.attack
            ? [definition.attack]
            : [];
      for (const profile of profiles) {
        add(`${profile!.channel} damage`, String(profile!.damage));
        add(
          `${profile!.channel} range`,
          `${(profile!.range / FIXED).toFixed(2)} tiles`,
        );
      }
      if (definition.meleeArmour !== undefined)
        add(
          "Armour melee / ranged",
          `${definition.meleeArmour} / ${definition.rangedArmour}`,
        );
      const rows = estimatedDps(draft, target, "base", draft.defaultShape);
      if (!rows.length) add("eDPS", "0.00");
      for (const row of rows) add(`${row.channel} eDPS`, row.dps.toFixed(2));
      if (draft.shapes.length) add("Formations", draft.shapes.join(", "));
      summary.append(dl);
      const action = document.createElement("span");
      action.textContent = "Expand to edit ▾";
      summary.append(action);
    }
    renderSheet();
  }
  const sheet = installUnitLabSheet({
    target,
    save: persist,
    changed: () => {
      if (current) update();
    },
    status,
    open: (key) => {
      select("catalog-view").value = "cards";
      setView();
      const card = cards.get(key);
      if (card) {
        card.open = true;
        card.scrollIntoView({ block: "start" });
      }
    },
  });
  function renderSheet() {
    if (select("catalog-view").value === "sheet")
      sheet.render([...cards.keys()].map(getDraft));
  }
  function setView() {
    const spreadsheet = select("catalog-view").value === "sheet";
    el("catalog-cards").hidden = spreadsheet;
    el("catalog-sheet").hidden = !spreadsheet;
    el<HTMLButtonElement>("catalog-reset").disabled = spreadsheet;
    editor.hidden = spreadsheet || !expandedKey;
    renderSheet();
  }
  select("catalog-view").addEventListener("change", setView);
  select("sheet-columns").addEventListener("change", renderSheet);
  function numeric(
    parent: HTMLElement,
    labelText: string,
    value: number,
    onChange: (value: number, input: HTMLInputElement) => void,
    min = 0,
    step = "any",
  ) {
    const label = document.createElement("label");
    label.append(document.createTextNode(labelText));
    const input = document.createElement("input");
    input.type = "number";
    input.value = String(value);
    input.min = String(min);
    input.step = step;
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      if (input.value !== "" && input.checkValidity())
        onChange(input.valueAsNumber, input);
    });
    label.append(input);
    parent.append(label);
    return input;
  }
  function fields() {
    const container = el("catalog-fields");
    container.replaceChildren();
    const groups = new Map<
      string,
      { section: HTMLElement; fields: HTMLElement }
    >();
    const titles: Record<string, string> = {
      recipe: "Squad size & formations",
      health: "Health & defence",
      movement: "Movement",
      melee: "Melee weapon",
      ranged: "Ranged weapon",
      attack: "Weapon",
      charge: "Charge",
      cost: "Recruitment & materials",
      operations: "Flight & operational limits",
      other: "Other properties",
    };
    const group = (key: string) => {
      let entry = groups.get(key);
      if (!entry) {
        const section = document.createElement("section");
        section.className = "editor-group";
        section.dataset.group = key;
        const heading = document.createElement("h3");
        heading.textContent = titles[key];
        const fieldGrid = document.createElement("div");
        fieldGrid.className = "editor-fields";
        section.append(heading, fieldGrid);
        entry = { section, fields: fieldGrid };
        groups.set(key, entry);
      }
      return entry;
    };
    const groupFor = (path: string) =>
      path.startsWith("formationRecipe.")
        ? path.endsWith("soldierHp")
          ? "health"
          : "recipe"
        : path.startsWith("meleeAttack.")
          ? "melee"
          : path.startsWith("rangedAttack.")
            ? "ranged"
            : path.startsWith("attack.")
              ? "attack"
              : path.startsWith("charge")
                ? "charge"
                : path.startsWith("cost") ||
                    path === "gold" ||
                    path === "trainingSeconds" ||
                    path === "ticks"
                  ? "cost"
                  : /armour|health|bonusResistance/i.test(path)
                    ? "health"
                    : path === "speed" || path === "speedPercent"
                      ? "movement"
                      : /Seconds|fuel|Capacity|Sortie|warheads/.test(path)
                        ? "operations"
                        : "other";
    const displayName = (path: string) => {
      const unit = current.definition as unknown as UnitDefinition;
      const leaf = path.split(".").pop();
      if (leaf === "reloadMs") return "Reload duration";
      if (path.endsWith("accuracy.near")) return "Accuracy at contact (%)";
      if (path.endsWith("accuracy.far")) return "Accuracy at maximum range (%)";
      if (leaf === "shotsPerReload") return "Shots per reload";
      if (leaf === "movingReloadPercent")
        return path.startsWith("meleeAttack.")
          ? "Moving attack interval (%)"
          : "Moving reload interval (%)";
      if (leaf === "rpm")
        return path.startsWith("meleeAttack.")
          ? "Attacks per minute"
          : "Shots per minute";
      if (path === "formationRecipe.soldierHp")
        return unit.formationRecipe?.model === "hull"
          ? "Hull health"
          : "Health per soldier";
      if (
        unit.formationRecipe?.model === "hull" &&
        path === "formationRecipe.capacity"
      )
        return "Vehicle count";
      if (
        unit.formationRecipe?.model === "hull" &&
        path === "formationRecipe.enlargedCapacity"
      )
        return "Upgraded vehicle count";
      const names: Record<string, string> = {
        "formationRecipe.capacity": "Base soldier count",
        "formationRecipe.enlargedCapacity": "Upgraded soldier count",
        "formationRecipe.soldierHp": "Health per soldier / hull",
        speedPercent: "Movement speed (%)",
        speed: "Movement speed (tiles/s)",
        health: "Health",
        healthPercent: "Health modifier (%)",
        trainingSeconds: "Training time (seconds)",
        estimatedSortieSeconds: "Estimated sortie cycle (seconds)",
      };
      const native = path.split(".").slice(1).join(".") || path;
      return (
        names[path] ??
        native
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/\./g, " · ")
          .replace(/^./, (c) => c.toUpperCase())
      );
    };
    function walk(object: Record<string, unknown>, prefix = "") {
      for (const [key, value] of Object.entries(object)) {
        if (
          !prefix &&
          key === "attack" &&
          (object.meleeAttack || object.rangedAttack)
        )
          continue;
        const path = prefix ? `${prefix}.${key}` : key;
        if (
          key === "bonuses" &&
          (object.channel === "melee" || object.channel === "ranged")
        ) {
          const profile = object as unknown as AttackProfile;
          const fieldset = document.createElement("fieldset");
          fieldset.className = "editor-bonuses";
          const legend = document.createElement("legend");
          legend.textContent = "Damage bonuses by target class";
          fieldset.append(legend);
          const help = document.createElement("p");
          help.textContent =
            "Flat bonus damage, not a percentage. A bonus does not grant permission to attack that class. Soldier weapons use one primary class bonus; secondary armoured tags do not add another bonus.";
          fieldset.append(help);
          const grid = document.createElement("div");
          grid.className = "editor-fields";
          fieldset.append(grid);
          for (const [tag, label] of Object.entries(BONUS_TARGET_LABELS) as [
            TargetTag,
            string,
          ][]) {
            const input = numeric(
              grid,
              `Bonus vs ${label}`,
              profile.bonuses[tag] ?? 0,
              (n, input) => {
                const previous = profile.bonuses[tag];
                profile.bonuses[tag] = n;
                try {
                  validateDraft(current.definition);
                  persist();
                  update();
                } catch (error) {
                  if (previous === undefined) delete profile.bonuses[tag];
                  else profile.bonuses[tag] = previous;
                  input.setCustomValidity(String(error));
                  input.reportValidity();
                  status(String(error));
                }
              },
            );
            input.dataset.statPath = `${path}.${tag}`;
          }
          group(groupFor(path)).fields.append(fieldset);
          continue;
        }
        const hasRecipe = !!(current.definition as unknown as UnitDefinition)
          .formationRecipe;
        if (
          hasRecipe &&
          [
            "formationRecipe.reserveCost",
            "cost.reserves",
            "cost.items.horses",
          ].includes(path)
        )
          continue;
        if (key === "reloadTicks" && object.perSoldier) continue;
        if (
          object.channel === "melee" &&
          object.perSoldier &&
          (key === "shotsPerReload" || key === "reloadMs")
        )
          continue;
        if (typeof value === "number") {
          // Keep the native values lossless; unit suffixes explain their scale.
          const suffix =
            key === "range" ||
            key === "radius" ||
            key === "maximumDistance" ||
            key === "diameter" ||
            key === "blastRadius"
              ? " (fixed units; 256 / tile)"
              : key.endsWith("Ticks") || key === "ticks"
                ? ` (ticks; ${TICKS_PER_SECOND} / second)`
                : key === "reloadMs"
                  ? " (ms)"
                  : key.toLowerCase().includes("armour") ||
                      key === "penetration"
                    ? key === "penetration"
                      ? " (basis points)"
                      : (current.definition as unknown as UnitDefinition)
                            .armourKind === "points"
                        ? " (points)"
                        : " (basis points)"
                    : "";
          const conversion =
            key === "range" ||
            key === "radius" ||
            key === "maximumDistance" ||
            key === "diameter" ||
            key === "blastRadius" ||
            key === "speed"
              ? FIXED
              : key.endsWith("Ticks") || key === "ticks"
                ? TICKS_PER_SECOND
                : key === "reloadMs"
                  ? 1000
                  : 1;
          const factor =
            key === "speed" ? TICKS_PER_SECOND / conversion : 1 / conversion;
          const unitSuffix =
            conversion === FIXED
              ? key === "speed"
                ? " (tiles/s)"
                : " (tiles)"
              : key.endsWith("Ticks") || key === "ticks" || key === "reloadMs"
                ? " (seconds)"
                : suffix;
          const input = numeric(
            group(groupFor(path)).fields,
            displayName(path).replace(" (tiles/s)", "") + unitSuffix,
            value * factor,
            (n, input) => {
              const old = object[key];
              object[key] = conversion === 1 ? n : Math.round(n / factor);
              try {
                validateDraft(current.definition);
                input.setCustomValidity("");
                persist();
                update();
              } catch (error) {
                object[key] = old;
                input.setCustomValidity(String(error));
                input.reportValidity();
                status(String(error));
              }
            },
          );
          input.dataset.statPath = path;
          if (
            (path === "formationRecipe.capacity" ||
              path === "formationRecipe.enlargedCapacity") &&
            (current.definition as unknown as UnitDefinition).formationRecipe
              ?.model === "hull"
          )
            input.disabled = true;
        } else if (value && typeof value === "object" && !Array.isArray(value))
          walk(value as Record<string, unknown>, path);
      }
    }
    walk(current.definition);
    const recipeGroup = group("recipe");
    const costGroup = group("cost");
    const derived = document.createElement("div");
    derived.id = "catalog-derived-cost";
    derived.className = "derived-cost";
    costGroup.section.append(derived);
    const costNote = document.createElement("p");
    costNote.textContent =
      (current.definition as unknown as UnitDefinition).formationRecipe
        ?.model === "hull"
        ? "Vehicles keep their authored paid crew requirement. Gold and materials are shown for the selected recipe."
        : "Reserve and horse requirements follow the selected recipe size. Other material and gold costs use the game’s base/enlarged recipe scaling.";
    costGroup.section.append(costNote);
    recipeGroup.section.append(previewSection);
    previewHolder.remove();
    for (const key of [
      "recipe",
      "health",
      "movement",
      "melee",
      "ranged",
      "attack",
      "charge",
      "cost",
      "operations",
      "other",
    ]) {
      const entry = groups.get(key);
      if (entry) container.append(entry.section);
    }
    const estimateGroup = document.createElement("section");
    estimateGroup.className = "editor-group editor-estimate";
    const estimateHeading = document.createElement("h3");
    estimateHeading.textContent = "Damage estimate";
    estimateGroup.append(estimateHeading, estimatePanel);
    const afterWeapons =
      groups.get("charge") ?? groups.get("operations") ?? groups.get("cost");
    container.insertBefore(estimateGroup, afterWeapons?.section ?? null);
    el<HTMLTextAreaElement>("catalog-json").value = JSON.stringify(
      current.definition,
      null,
      2,
    );
  }
  function shapes() {
    const unit =
      current.entity.category === "unit"
        ? (current.definition as unknown as UnitDefinition)
        : undefined;
    const soldier = unit?.formationRecipe?.model === "soldiers";
    el("catalog-shapes").replaceChildren();
    const legend = document.createElement("legend");
    legend.textContent = "Allowed formations for this recipe";
    el("catalog-shapes").append(legend);
    if (soldier)
      for (const shape of FORMATION_SHAPES) {
        const label = document.createElement("label"),
          input = document.createElement("input");
        input.type = "checkbox";
        input.checked = current.shapes.includes(shape);
        input.addEventListener("change", () => {
          const candidate = input.checked
            ? [...current.shapes, shape]
            : current.shapes.filter((s) => s !== shape);
          if (!candidate.length) {
            input.checked = true;
            status("A soldier recipe must retain at least one formation.");
            return;
          }
          current.shapes = candidate;
          if (!candidate.includes(current.defaultShape))
            current.defaultShape = candidate[0];
          persist();
          shapeOptions();
          update();
        });
        label.append(input, document.createTextNode(shape));
        el("catalog-shapes").append(label);
      }
    el<HTMLSelectElement>("catalog-variant").disabled = !soldier;
    if (!soldier) select("catalog-variant").value = "base";
    shapeOptions();
  }
  function shapeOptions() {
    const old = select("catalog-shape").value;
    select("catalog-shape").replaceChildren(
      ...current.shapes.map((s) => new Option(s, s)),
    );
    if (current.shapes.includes(old as FormationShape))
      select("catalog-shape").value = old;
    else select("catalog-shape").value = current.defaultShape;
    select("catalog-shape").disabled = !current.shapes.length;
  }
  function update() {
    if (!current) return;
    const shape = (select("catalog-shape").value ||
      current.defaultShape) as FormationShape;
    const variant = select("catalog-variant").value as "base" | "enlarged";
    const cost = draftRecruitmentCost(current, variant);
    const derived = el("catalog-derived-cost");
    if (derived) {
      derived.replaceChildren();
      const data = cost
        ? [
            ["Reserves", cost.reserves ?? 0],
            ["Horses", cost.items?.horses ?? 0],
            ["Gold", cost.gold ?? 0],
          ]
        : [];
      for (const [title, value] of data) {
        const label = document.createElement("label");
        label.append(document.createTextNode(String(title)));
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.value = String(value);
        label.append(input);
        derived.append(label);
      }
      if (!cost)
        derived.textContent =
          "No squad recruitment recipe. Costs are specified in the fields above.";
    }
    const recipe = (current.definition as unknown as UnitDefinition)
      .formationRecipe;
    el("catalog-upgrade").textContent = recipe
      ? `${recipe.model === "soldiers" ? "Soldiers" : "Hull"}: ${recipe.capacity} base → ${recipe.enlargedCapacity} enlarged. Upgrade: ${recipe.technologyId ? (TECHNOLOGY.get(recipe.technologyId)?.name ?? recipe.technologyId) : "No larger formation upgrade"}`
      : "No soldier recipe; this entity is inspected as one hull or object.";
    const rows = estimatedDps(current, target, variant, shape);
    el("catalog-dps").replaceChildren();
    if (!rows.length)
      el("catalog-dps").textContent = "eDPS: 0 — no attack definition.";
    for (const row of rows) {
      const label = document.createElement("label");
      label.append(document.createTextNode(`${row.channel} eDPS`));
      const input = document.createElement("input");
      input.type = "text";
      input.readOnly = true;
      input.value = row.dps.toFixed(2);
      label.append(input);
      el("catalog-dps").append(label);
      const note = document.createElement("p");
      note.textContent = `${row.eligible ? "Eligible target" : "Cannot attack this target"} · ${row.contributors} contributor strength · ${row.damage.toFixed(2)} expected damage / cycle · ${row.cycleSeconds.toFixed(2)} s cycle`;
      el("catalog-dps").append(note);
    }
    el<HTMLTextAreaElement>("catalog-json").value = JSON.stringify(
      current.definition,
      null,
      2,
    );
    renderPreview();
    refreshCards();
  }
  async function choose() {
    current = getDraft(select("catalog-entity").value);
    const token = ++revision;
    el("catalog-title").textContent = current.entity.name;
    el("catalog-meta").textContent =
      `${current.entity.category} · ${current.entity.id} · numeric stats below; complete metadata, tags, flags and attack targets in the advanced definition.`;
    fields();
    shapes();
    previewError = "";
    loading = false;
    if (RUSSIAN_TROOP_ACTORS.has(current.entity.id)) {
      loading = true;
      update();
      try {
        await load(current.entity.id);
      } catch (error) {
        if (token === revision) previewError = String(error);
      }
      if (token !== revision) return;
      loading = false;
    } else era.preload(current.entity.artworkId, "idle");
    update();
  }
  function renderPreview() {
    if (!current || el("unit-panel").hidden || editor.hidden) return;
    const canvas = el<HTMLCanvasElement>("catalog-preview"),
      ctx = canvas.getContext("2d")!,
      width = canvas.clientWidth,
      height = canvas.clientHeight,
      dpr = devicePixelRatio || 1,
      zoom = Number(el<HTMLInputElement>("catalog-zoom").value);
    const previewKey = `${revision}:${width}:${height}:${dpr}:${zoom}:${select("catalog-variant").value}:${select("catalog-shape").value}:${current.shapes.join(",")}:${JSON.stringify(current.definition.formationRecipe)}:${loading}:${previewError}`;
    if (previewKey === lastPreviewKey) return;
    lastPreviewKey = previewKey;
    if (
      canvas.width !== Math.round(width * dpr) ||
      canvas.height !== Math.round(height * dpr)
    ) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#29382b";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#344734";
    for (let x = (width / 2) % zoom; x < width; x += zoom) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = (height / 2) % zoom; y < height; y += zoom) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    if (loading || previewError) {
      el("catalog-preview-status").textContent =
        previewError || "Loading runtime artwork…";
      return;
    }
    const unit =
      current.entity.category === "unit"
        ? (current.definition as unknown as UnitDefinition)
        : undefined;
    if (unit?.formationRecipe?.model === "soldiers") {
      const count =
        select("catalog-variant").value === "enlarged"
          ? unit.formationRecipe.enlargedCapacity
          : unit.formationRecipe.capacity;
      const shape = select("catalog-shape").value as FormationShape;
      const doctrine = {
        ...formationDoctrine(current.entity.id),
        shapes: [...current.shapes],
        defaultShape: current.defaultShape,
      };
      const slots = formationSlots(
        {
          id: 1,
          definitionId: current.entity.id,
          kind: unit.line,
          troops: count,
          manpower: {
            model: "soldiers",
            capacity: count,
            hp: unit.formationRecipe.soldierHp * 1000,
            wounds: 0,
            variant: "base",
            revision: 0,
            replenishRemainder: 0,
          },
          formation: { ...createFormation(current.entity.id), shape },
        },
        0,
        doctrine,
      );
      for (const slot of [...slots].sort((a, b) => a.y - b.y))
        actor(
          ctx,
          current.entity.id,
          width / 2 + (slot.x / FIXED) * zoom,
          height / 2 + (slot.y / FIXED) * zoom,
          1,
          0,
          "idle",
          zoom,
        );
      const w =
          (Math.max(...slots.map((s) => s.x)) -
            Math.min(...slots.map((s) => s.x)) +
            doctrine.bodyWidth) /
          FIXED,
        h =
          (Math.max(...slots.map((s) => s.y)) -
            Math.min(...slots.map((s) => s.y)) +
            doctrine.bodyDepth) /
          FIXED;
      el("catalog-preview-status").textContent =
        `${count} soldiers · ${shape} · ${w.toFixed(2)} × ${h.toFixed(2)} tiles${w * zoom > width || h * zoom > height ? " · reduce camera scale to fit" : ""}`;
    } else if (RUSSIAN_TROOP_ACTORS.has(current.entity.id)) {
      actor(ctx, current.entity.id, width / 2, height / 2, 1, 0, "idle", zoom);
      el("catalog-preview-status").textContent =
        "Single vehicle actor; soldier formations do not apply.";
    } else {
      const frame = era.get(current.entity.artworkId, "idle", 0);
      if (frame) {
        const size = Math.min(180, zoom * 3) * frame.extent;
        ctx.drawImage(
          frame.source,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          width / 2 - size / 2,
          height / 2 - size / 2,
          size,
          size,
        );
        el("catalog-preview-status").textContent =
          "Runtime artwork reference; single hull/object, not a soldier formation.";
      } else {
        lastPreviewKey = "";
        ctx.font = "16px system-ui";
        ctx.fillStyle = "#d3ddcd";
        ctx.fillText(current.entity.name, 20, height / 2);
        el("catalog-preview-status").textContent =
          "No runtime artwork mapped for this definition. All statistics remain available.";
      }
    }
  }
  for (const [key, title, value] of [
    ["meleeArmour", "Melee armour", 0],
    ["rangedArmour", "Ranged armour", 0],
    ["accuracy", "Estimated accuracy (%)", 100],
    ["distance", "Target distance (tiles)", 6],
    ["cover", "Cover (basis points)", 0],
    ["healthPercent", "Target health modifier (%)", 100],
  ] as const)
    numeric(el("target-fields"), title, value, (n, input) => {
      if (
        (key === "accuracy" && n > 100) ||
        (key === "cover" && n > 8000) ||
        (key === "healthPercent" && n <= 0)
      ) {
        input.setCustomValidity(
          "Accuracy 0–100; cover 0–8000; health modifier above zero.",
        );
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
      target[key] = n;
      update();
    });
  for (const id of ["target-tag", "target-armour", "target-soldiers"])
    el(id).addEventListener("change", () => {
      target.tag = select("target-tag").value as DpsTarget["tag"];
      target.armourKind = select("target-armour")
        .value as DpsTarget["armourKind"];
      target.soldiers = el<HTMLInputElement>("target-soldiers").checked;
      update();
    });
  for (const id of ["catalog-variant", "catalog-shape"])
    el(id).addEventListener("change", update);
  el("catalog-zoom").addEventListener("input", renderPreview);
  select("catalog-category").addEventListener("change", options);
  el("catalog-search").addEventListener("input", options);
  select("catalog-entity").addEventListener("change", () => void choose());
  for (const id of ["catalog-age", "catalog-type", "catalog-sort"])
    select(id).addEventListener("change", options);
  el("catalog-reset").addEventListener("click", () => {
    if (profile !== "live" && current.entity.category === "unit") {
      try {
        const next = readExperiment(localStorage);
        delete next.changes[current.entity.id];
        saveExperiment(localStorage, next);
        experiment = next;
        sharedDefinitions = experimentDefinitions(next);
      } catch (error) {
        status(String(error));
        return;
      }
    }
    drafts.delete(current.entity.key);
    persist();
    void choose();
    status(
      profile === "live"
        ? "Reset this draft to current game content."
        : "Reset this draft to the approved experiment.",
    );
  });
  el("catalog-apply").addEventListener("click", () => {
    try {
      const candidate = JSON.parse(
        el<HTMLTextAreaElement>("catalog-json").value,
      );
      if (
        !candidate ||
        Array.isArray(candidate) ||
        typeof candidate !== "object"
      )
        throw new Error("Definition must be an object.");
      validateDraft(candidate);
      if (candidate.id !== current.entity.id)
        throw new Error("Keep the entity id unchanged; drafts edit its stats.");
      if (current.entity.category === "unit" && !candidate.formationRecipe)
        throw new Error("Land units require their formation recipe.");
      current.definition = candidate;
      persist();
      fields();
      shapes();
      update();
      status("Applied validated definition to the local draft.");
    } catch (error) {
      status(String(error));
    }
  });
  el("catalog-export").addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload(), null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download =
      profile === "live"
        ? "unit-lab-drafts.json"
        : "unit-lab-premodern-drafts.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(
      "Exported all visited or edited definitions, recipe access and target settings.",
    );
  });
  for (const [button, panel] of [
    ["presentation-tab", "presentation-panel"],
    ["unit-tab", "unit-panel"],
  ])
    el(button).addEventListener("click", () => {
      for (const [other, otherPanel] of [
        ["presentation-tab", "presentation-panel"],
        ["unit-tab", "unit-panel"],
      ]) {
        const active = other === button;
        el(other).setAttribute("aria-selected", String(active));
        el(otherPanel).hidden = !active;
      }
      renderPreview();
    });
  window.addEventListener("resize", renderPreview);
  function switchProfile(next: BalanceProfile, publish = true) {
    profile = next;
    if (publish)
      try {
        localStorage.setItem(PROFILE_STORAGE_KEY, profile);
      } catch {
        /* Session-only selection. */
      }
    loadDrafts();
    options();
    status(
      profile === "live"
        ? "Live stats / existing local drafts."
        : `${EXPERIMENT_LABEL}. Land numeric edits also update the Balance Preview; older drafts remain separate.`,
    );
  }
  select("catalog-profile").addEventListener("change", () =>
    switchProfile(select("catalog-profile").value as BalanceProfile),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === PROFILE_STORAGE_KEY)
      switchProfile(activeBalanceProfile(localStorage), false);
    else if (
      event.key === EXPERIMENT_STORAGE_KEY &&
      profile === EXPERIMENT_ID
    ) {
      try {
        experiment = readExperiment(localStorage);
        sharedDefinitions = experimentDefinitions(experiment);
        for (const [key, draft] of drafts)
          if (draft.entity.category === "unit") drafts.delete(key);
        observedNumeric.clear();
        options();
        status("Shared experiment updated from the Balance Preview.");
      } catch (error) {
        status(`Shared update rejected: ${String(error)}`);
      }
    }
  });
  options();
  // Lazy era artwork loads asynchronously; only repaint this isolated preview
  // while the stats tab is visible. No geometry is changed in the live catalogue.
  return renderPreview;
}
