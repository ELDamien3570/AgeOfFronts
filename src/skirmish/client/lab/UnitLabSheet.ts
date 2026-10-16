import type { AttackProfile, UnitDefinition } from "../../domain/Definitions";
import { FIXED, TICKS_PER_SECOND } from "../../Protocol";
import {
  draftRecruitmentCost,
  estimatedDps,
  validateDraft,
  type DpsTarget,
  type UnitDraft,
} from "./UnitLabModel";

export const SHEET_GROUPS = [
  "Squad",
  "Defence",
  "Movement",
  "Charge",
  "Recruitment",
  "Melee weapons",
  "Ranged weapons",
  "Bonuses",
  "Derived costs",
] as const;
type SheetGroup = (typeof SHEET_GROUPS)[number];
export interface SheetColumn {
  path: string;
  title: string;
  group: SheetGroup;
  factor: number;
  readonly?: boolean;
  value?: (draft: UnitDraft) => number | undefined;
  collapsedCount?: number;
}
const tags = [
  "infantry",
  "ranged",
  "mounted",
  "armoured",
  "vehicle",
  "siege",
  "ship",
  "aircraft",
  "structure",
  "wall",
];
// Primary-only weapons share the melee/ranged columns, while edits still write
// to their original definition path. Dual-channel units retain explicit paths.
function sourcePath(draft: UnitDraft, path: string) {
  const [profile, ...keys] = path.split(".");
  if (
    (profile === "meleeAttack" || profile === "rangedAttack") &&
    !draft.definition.meleeAttack &&
    !draft.definition.rangedAttack &&
    (draft.definition.attack as AttackProfile | undefined)?.channel ===
      (profile === "meleeAttack" ? "melee" : "ranged")
  )
    return ["attack", ...keys].join(".");
  return path;
}
export function readSheetStat(draft: UnitDraft, path: string): unknown {
  return sourcePath(draft, path)
    .split(".")
    .reduce<unknown>(
      (o, k) =>
        o && typeof o === "object"
          ? (o as Record<string, unknown>)[k]
          : undefined,
      draft.definition,
    );
}
export function writeSheetStat(draft: UnitDraft, path: string, value: number) {
  const keys = sourcePath(draft, path).split(".");
  let object = draft.definition;
  for (const key of keys.slice(0, -1)) {
    if (!object[key]) object[key] = {};
    object = object[key] as Record<string, unknown>;
  }
  object[keys[keys.length - 1]] = value;
}
function factor(key: string) {
  return key === "speed"
    ? TICKS_PER_SECOND / FIXED
    : [
          "range",
          "radius",
          "maximumDistance",
          "diameter",
          "blastRadius",
        ].includes(key)
      ? 1 / FIXED
      : key.endsWith("Ticks") || key === "ticks"
        ? 1 / TICKS_PER_SECOND
        : key === "reloadMs"
          ? 1 / 1000
          : 1;
}
function title(path: string) {
  if (path.endsWith("accuracy.near")) return "Accuracy at contact (%)";
  if (path.endsWith("accuracy.far")) return "Accuracy at maximum range (%)";
  const names: Record<string, string> = {
    "formationRecipe.capacity": "Base soldiers",
    "formationRecipe.enlargedCapacity": "Upgraded soldiers",
    "formationRecipe.soldierHp": "HP / soldier or hull",
    speedPercent: "Speed (%)",
    speed: "Speed (tiles/s)",
    meleeArmour: "Melee armour",
    rangedArmour: "Ranged armour",
    health: "HP / hull",
    healthPercent: "Health (%)",
    trainingSeconds: "Training time (s)",
    chargeMultiplier: "Charge damage multiplier",
    "cost.gold": "Base gold",
  };
  if (names[path]) return names[path];
  if (path.includes(".bonuses."))
    return `${path.startsWith("meleeAttack.") ? "Melee" : "Ranged"} vs ${path.split(".").pop()}`;
  const parts = path.split("."),
    key = parts[parts.length - 1];
  const label = (parts.length > 1 ? parts.slice(1) : parts)
    .join(" · ")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${label || key}${factor(key) !== 1 ? (key === "speed" ? " (tiles/s)" : factor(key) === 1 / FIXED ? " (tiles)" : " (s)") : ""}`;
}
function fieldGroup(path: string): SheetGroup {
  return path.includes(".bonuses.")
    ? "Bonuses"
    : path.startsWith("meleeAttack.")
      ? "Melee weapons"
      : path.startsWith("rangedAttack.")
        ? "Ranged weapons"
        : /armour|Resistance/i.test(path)
          ? "Defence"
          : /^charge[.A-Z]/.test(path)
            ? "Charge"
            : /speed|movement|turnRate|maximumDistance/i.test(path)
              ? "Movement"
              : path.startsWith("cost.") ||
                  ["gold", "trainingSeconds"].includes(path)
                ? "Recruitment"
                : "Squad";
}

/** A stable group order independent of entity enumeration or the chosen filter. */
export function unitSheetColumns(
  rows: readonly UnitDraft[],
  mode: string,
): SheetColumn[] {
  const paths = new Set<string>();
  function collect(object: Record<string, unknown>, prefix = "") {
    for (const [key, value] of Object.entries(object)) {
      if (
        !prefix &&
        key === "attack" &&
        (object.meleeAttack || object.rangedAttack)
      )
        continue;
      const path =
        !prefix && key === "attack"
          ? (value as AttackProfile).channel === "melee"
            ? "meleeAttack"
            : "rangedAttack"
          : prefix
            ? `${prefix}.${key}`
            : key;
      if (
        [
          "cost.reserves",
          "cost.items.horses",
          "formationRecipe.reserveCost",
        ].includes(path)
      )
        continue;
      if (key === "reloadTicks" && object.perSoldier) continue;
      if (typeof value === "number") paths.add(path);
      else if (value && typeof value === "object" && !Array.isArray(value))
        collect(value as Record<string, unknown>, path);
    }
  }
  rows.forEach((draft) => collect(draft.definition));
  for (const profile of ["meleeAttack", "rangedAttack"])
    if (rows.some((draft) => readSheetStat(draft, profile)))
      for (const tag of tags) paths.add(`${profile}.bonuses.${tag}`);
  const core = [
    "formationRecipe.capacity",
    "formationRecipe.enlargedCapacity",
    "formationRecipe.soldierHp",
    "health",
    "healthPercent",
    "meleeArmour",
    "rangedArmour",
    "speedPercent",
    "speed",
    "cost.gold",
    "gold",
    "trainingSeconds",
    "capacity",
  ];
  const sorted = [...paths]
    .filter(
      (path) =>
        mode === "all" ||
        (mode === "core" && core.includes(path)) ||
        (mode === "bonuses" && fieldGroup(path) === "Bonuses") ||
        (mode === "melee" && fieldGroup(path) === "Melee weapons") ||
        (mode === "ranged" && fieldGroup(path) === "Ranged weapons"),
    )
    .sort((a, b) => {
      const group =
        SHEET_GROUPS.indexOf(fieldGroup(a)) -
        SHEET_GROUPS.indexOf(fieldGroup(b));
      if (group) return group;
      const weaponStats = [
        "damage",
        "rpm",
        "range",
        "reloadMs",
        "reloadTicks",
        "accuracy.near",
        "accuracy.far",
        "penetration",
        "movingReloadPercent",
      ];
      const priority = (path: string) => {
        if (core.includes(path)) return core.indexOf(path);
        const key = path.split(".").slice(1).join(".");
        return weaponStats.includes(key)
          ? core.length + weaponStats.indexOf(key)
          : core.length + weaponStats.length;
      };
      return priority(a) - priority(b) || a.localeCompare(b);
    });
  const columns: SheetColumn[] = sorted.map((path) => ({
    path,
    title: title(path),
    group: fieldGroup(path),
    factor: factor(path.split(".").pop()!),
  }));
  columns.push(
    ...(["base", "enlarged"] as const).flatMap((variant): SheetColumn[] => [
      {
        path: `derived.${variant}.reserves`,
        title: `${variant} reserves`,
        group: "Derived costs",
        factor: 1,
        readonly: true,
        value: (d) => draftRecruitmentCost(d, variant)?.reserves,
      },
      {
        path: `derived.${variant}.horses`,
        title: `${variant} horses`,
        group: "Derived costs",
        factor: 1,
        readonly: true,
        value: (d) =>
          draftRecruitmentCost(d, variant)?.items?.horses ??
          (draftRecruitmentCost(d, variant) ? 0 : undefined),
      },
    ]),
  );
  return columns;
}

export function visibleSheetColumns(
  columns: readonly SheetColumn[],
  collapsed: ReadonlySet<string>,
): SheetColumn[] {
  const visible: SheetColumn[] = [];
  for (const group of SHEET_GROUPS) {
    const members = columns.filter((column) => column.group === group);
    if (!members.length) continue;
    if (collapsed.has(group))
      visible.push({
        path: `collapsed.${group}`,
        title: `${members.length} hidden`,
        group,
        factor: 1,
        readonly: true,
        collapsedCount: members.length,
      });
    else visible.push(...members);
  }
  return visible;
}
export function installUnitLabSheet(deps: {
  target: DpsTarget;
  save: () => void;
  changed: () => void;
  status: (message: string) => void;
  open: (key: string) => void;
}) {
  const table = document.getElementById("unit-sheet") as HTMLTableElement;
  const collapseStorageKey = "ageoffronts-unit-sheet-groups-v1";
  let collapsed = new Set<string>();
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(collapseStorageKey) ?? "null",
    );
    if (Array.isArray(saved))
      collapsed = new Set(
        saved.filter((group) => SHEET_GROUPS.includes(group)),
      );
  } catch {
    /* Column visibility does not depend on browser storage. */
  }
  let rows: UnitDraft[] = [],
    columns: SheetColumn[] = [];
  const inputAt = (r: number, c: number) =>
    table.querySelector<HTMLInputElement>(
      `input[data-row="${r}"][data-col="${c}"]`,
    );
  function focus(r: number, c: number) {
    const input = inputAt(r, c);
    if (input) {
      input.focus();
      input.select();
    }
  }
  function commit(edits: { row: number; col: number; text: string }[]) {
    const candidates = new Map<number, UnitDraft>();
    for (const edit of edits) {
      const column = columns[edit.col],
        draft = rows[edit.row];
      if (
        !column ||
        !draft ||
        column.readonly ||
        inputAt(edit.row, edit.col)?.readOnly ||
        !inputAt(edit.row, edit.col) ||
        !edit.text.trim()
      )
        throw new Error(
          "Paste must contain only editable numeric cells within the table.",
        );
      const number = Number(edit.text);
      if (!Number.isFinite(number) || number < 0)
        throw new Error("Stat values must be finite and non-negative.");
      let candidate = candidates.get(edit.row);
      if (!candidate) {
        candidate = { ...draft, definition: structuredClone(draft.definition) };
        candidates.set(edit.row, candidate);
      }
      writeSheetStat(
        candidate,
        column.path,
        column.factor === 1 ? number : Math.round(number / column.factor),
      );
    }
    for (const candidate of candidates.values())
      validateDraft(candidate.definition);
    for (const [row, candidate] of candidates)
      rows[row].definition = candidate.definition;
    deps.save();
    deps.changed();
    deps.status(
      `Saved ${edits.length} cell${edits.length === 1 ? "" : "s"} to local drafts.`,
    );
    render(rows);
  }
  function render(drafts: UnitDraft[]) {
    rows = drafts;
    const mode = (document.getElementById("sheet-columns") as HTMLSelectElement)
      .value;
    columns = visibleSheetColumns(unitSheetColumns(rows, mode), collapsed);
    table.replaceChildren();
    const caption = table.createCaption();
    caption.textContent = `${rows.length} units · ${mode} columns`;
    const head = table.createTHead(),
      groups = head.insertRow(),
      titles = head.insertRow();
    const fixed = document.createElement("th");
    fixed.textContent = "Unit / eDPS / age / type";
    fixed.rowSpan = 2;
    fixed.scope = "col";
    fixed.className = "sheet-unit";
    groups.append(fixed);
    for (let c = 0; c < columns.length; ) {
      const name = columns[c].group;
      let end = c + 1;
      while (end < columns.length && columns[end].group === name) end++;
      const th = document.createElement("th");
      th.colSpan = end - c;
      th.scope = "colgroup";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sheet-group-toggle";
      toggle.dataset.group = name;
      toggle.setAttribute("aria-expanded", String(!collapsed.has(name)));
      toggle.setAttribute(
        "aria-label",
        `${collapsed.has(name) ? "Expand" : "Collapse"} ${name} columns`,
      );
      toggle.textContent = `${collapsed.has(name) ? "▸" : "▾"} ${name}`;
      toggle.addEventListener("click", () => {
        if (collapsed.has(name)) collapsed.delete(name);
        else collapsed.add(name);
        try {
          localStorage.setItem(
            collapseStorageKey,
            JSON.stringify([...collapsed]),
          );
        } catch {
          /* Keep the in-session preference. */
        }
        render(rows);
        table
          .querySelector<HTMLButtonElement>(`button[data-group="${name}"]`)
          ?.focus({ preventScroll: true });
      });
      th.append(toggle);
      if (collapsed.has(name)) th.className = "sheet-collapsed";
      groups.append(th);
      c = end;
    }
    for (const column of columns) {
      const th = document.createElement("th");
      th.textContent = column.title;
      th.scope = "col";
      if (column.collapsedCount) th.className = "sheet-collapsed";
      titles.append(th);
    }
    const body = table.createTBody();
    rows.forEach((draft, r) => {
      const tr = body.insertRow(),
        heading = document.createElement("th");
      heading.scope = "row";
      heading.className = "sheet-unit";
      const button = document.createElement("button");
      button.textContent = draft.entity.name;
      button.addEventListener("click", () => deps.open(draft.entity.key));
      const identity = document.createElement("div");
      identity.className = "sheet-identity";
      identity.append(button);
      const estimates = estimatedDps(
        draft,
        deps.target,
        "base",
        draft.defaultShape,
      );
      const dps = document.createElement("span");
      dps.className = "sheet-edps";
      const label = document.createElement("span");
      label.textContent = "eDPS";
      dps.append(label);
      for (const estimate of estimates) {
        const value = document.createElement("span");
        const channel = estimate.channel === "melee" ? "Melee" : "Ranged";
        value.textContent = `${channel} ${Number(estimate.dps.toFixed(1))}`;
        value.setAttribute(
          "aria-label",
          `${draft.entity.name}: ${channel} eDPS ${Number(estimate.dps.toFixed(1))}`,
        );
        value.title = `${channel} estimated damage per second against the comparison target, using the base recipe and default formation`;
        dps.append(value);
      }
      if (!estimates.length) dps.append(document.createTextNode("—"));
      identity.append(dps);
      heading.append(identity);
      const meta = document.createElement("small");
      meta.textContent = `${draft.definition.age ?? ""} · ${draft.definition.troopClass ?? draft.definition.kind ?? draft.entity.category}`;
      heading.append(meta);
      tr.append(heading);
      columns.forEach((column, c) => {
        const cell = tr.insertCell();
        if (column.collapsedCount) {
          cell.className = "sheet-collapsed";
          return;
        }
        let value = column.value
          ? column.value(draft)
          : readSheetStat(draft, column.path);
        if (column.path.includes(".bonuses.")) {
          const profile = column.path.split(".")[0];
          if (readSheetStat(draft, profile)) value = value ?? 0;
        }
        if (typeof value !== "number") {
          cell.textContent = "—";
          cell.className = "sheet-na";
          return;
        }
        const hull =
          (draft.definition as unknown as UnitDefinition).formationRecipe
            ?.model === "hull";
        const readonly =
          column.readonly ||
          (hull &&
            [
              "formationRecipe.capacity",
              "formationRecipe.enlargedCapacity",
            ].includes(column.path));
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "decimal";
        input.readOnly = !!readonly;
        input.value = String(Number((value * column.factor).toFixed(4)));
        input.dataset.row = String(r);
        input.dataset.col = String(c);
        input.dataset.path = column.path;
        input.setAttribute(
          "aria-label",
          `${draft.entity.name}: ${column.title}`,
        );
        cell.append(input);
        if (readonly) cell.className = "sheet-derived";
        input.addEventListener("change", () => {
          if (readonly) return;
          try {
            commit([{ row: r, col: c, text: input.value }]);
            focus(r, c);
          } catch (error) {
            input.setCustomValidity(String(error));
            input.reportValidity();
            deps.status(String(error));
          }
        });
        input.addEventListener("input", () => input.setCustomValidity(""));
        input.addEventListener("keydown", (event) => {
          if (!["Tab", "Enter", "ArrowUp", "ArrowDown"].includes(event.key))
            return;
          event.preventDefault();
          if (
            !readonly &&
            input.value !==
              String(Number(((value as number) * column.factor).toFixed(4)))
          ) {
            try {
              commit([{ row: r, col: c, text: input.value }]);
            } catch (error) {
              deps.status(String(error));
              return;
            }
          }
          const step = event.key === "ArrowUp" || event.shiftKey ? -1 : 1;
          if (event.key === "Tab") {
            let index = r * columns.length + c + step;
            while (
              index >= 0 &&
              index < rows.length * columns.length &&
              !inputAt(
                Math.floor(index / columns.length),
                index % columns.length,
              )
            )
              index += step;
            if (index >= 0 && index < rows.length * columns.length)
              focus(Math.floor(index / columns.length), index % columns.length);
            else
              (
                document.getElementById("catalog-view") as HTMLSelectElement
              ).focus();
            return;
          }
          let row = r + step;
          while (row >= 0 && row < rows.length && !inputAt(row, c)) row += step;
          focus(row, c);
        });
        input.addEventListener("paste", (event) => {
          const text = event.clipboardData?.getData("text/plain");
          if (!text || !/[\t\r\n]/.test(text)) return;
          event.preventDefault();
          const edits = text
            .replace(/\r/g, "")
            .replace(/\n$/, "")
            .split("\n")
            .flatMap((line, dr) =>
              line
                .split("\t")
                .map((text, dc) => ({ row: r + dr, col: c + dc, text })),
            );
          try {
            commit(edits);
            focus(r, c);
          } catch (error) {
            deps.status(`Paste cancelled: ${String(error)}`);
          }
        });
      });
    });
  }
  return { render };
}
