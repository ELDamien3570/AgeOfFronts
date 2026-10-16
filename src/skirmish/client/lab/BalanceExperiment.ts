import { CONTENT_HASH } from "../../content/Catalog";
import { UNIT, UNITS } from "../../content/Units";
import { AGES, type UnitDefinition } from "../../domain/Definitions";
import legacyBaseline from "./BalanceExperimentBaseline.json";
import {
  BATTLE_BONUS_TAGS,
  battleDefinition,
  type BattleTuning,
} from "./BattleTuning";
import { validateDraft } from "./UnitLabModel";

export const EXPERIMENT_ID = "premodern-rebalance-v1";
export const EXPERIMENT_REVISION = 3;
export const EXPERIMENT_LABEL = "Approved balance";
export const APPROVED_RECIPE_IDS = Object.freeze(Object.keys(legacyBaseline));
export const EXPERIMENT_STORAGE_KEY = "ageoffronts-balance-experiment-v1";
export const PROFILE_STORAGE_KEY = "ageoffronts-balance-profile-v1";
export type BalanceProfile = "live" | typeof EXPERIMENT_ID;
export interface ExperimentState {
  schemaVersion: 1;
  profileId: typeof EXPERIMENT_ID;
  profileRevision: 1 | 2 | typeof EXPERIMENT_REVISION;
  contentHash: string;
  changes: Record<string, Record<string, number>>;
}
type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = StorageReader & Pick<Storage, "setItem">;

/** Historical October 15 proposal, retained for validating older exports.
 * Current defaults come directly from the promoted game catalogues. */
function premodernTuning(unit: UnitDefinition): BattleTuning {
  const age = AGES.indexOf(unit.age),
    role = unit.troopClass;
  if (unit.formationRecipe?.model !== "soldiers" || age > 5) return {};
  if (age === 5) {
    if (role === "frontline") return { speedPercent: 80 };
    if (role === "rangedInfantry") return { speedPercent: 70 };
    if (role === "antiCavalry") return { speedPercent: 75 };
    if (role === "lightCavalry") return { speedPercent: 130 };
    if (role === "rangedCavalry") return { speedPercent: 125 };
    if (role === "heavyCavalry")
      return { speedPercent: 120, melee: { damage: 100, rpm: 24 } };
    return {};
  }
  const infantrySpeed = [80, 81, 82, 84, 85][age];
  if (role === "frontline") {
    const damage = [10, 14, 18, 22, 28][age];
    return {
      speedPercent: infantrySpeed,
      meleeArmour: age * 4,
      rangedArmour: age,
      melee: {
        damage,
        rpm: age === 4 ? 50 : 60,
        bonuses: { infantry: damage, ranged: [20, 26, 30, 34, 40][age] },
      },
    };
  }
  if (role === "antiCavalry")
    return {
      speedPercent: infantrySpeed - 10,
      meleeArmour: age * 2,
      rangedArmour: age * 2,
      melee: {
        damage: [0, 9, 15, 20, 24][age],
        rpm: 60,
        bonuses: { mounted: [0, 43, 51, 75, 99][age] },
      },
    };
  if (role === "rangedInfantry")
    return {
      speedPercent: infantrySpeed - 5,
      ...(age === 0
        ? { meleeArmour: 0, rangedArmour: 0, melee: { rpm: 60 } }
        : {}),
    };
  if (role === "lightCavalry")
    return {
      speedPercent: [100, 110, 120, 130, 130][age],
      meleeArmour: [0, 2, 3, 4, 5][age],
      rangedArmour: age === 0 ? 0 : 1,
      melee: { damage: [23, 25, 27, 29, 31][age], rpm: 60 },
    };
  if (role === "rangedCavalry") return { speedPercent: age === 2 ? 115 : 125 };
  if (role === "heavyCavalry")
    return {
      speedPercent: age === 3 ? 110 : 115,
      melee: { damage: age === 3 ? 60 : 76, rpm: 60 },
    };
  return {};
}

function legacyTuning(unit: UnitDefinition, revision: 1 | 2): BattleTuning {
  const tuning = premodernTuning(unit);
  if (
    revision === 1 ||
    unit.formationRecipe?.model !== "soldiers" ||
    AGES.indexOf(unit.age) > 5
  )
    return tuning;
  const ratio =
    unit.troopClass === "heavyCavalry"
      ? 0.5
      : unit.troopClass === "lightCavalry"
        ? 0.25
        : unit.troopClass === "rangedCavalry"
          ? 0.1
          : 0;
  if (!ratio) return tuning;
  const channel = unit.troopClass === "rangedCavalry" ? "ranged" : "melee";
  const weapon = channel === "ranged" ? unit.rangedAttack : unit.meleeAttack;
  if (!weapon)
    throw Error(`Cavalry recipe is missing its ${channel} weapon: ${unit.id}`);
  const patch = tuning[channel];
  return {
    ...tuning,
    [channel]: {
      ...patch,
      bonuses: {
        ...patch?.bonuses,
        mounted: (patch?.damage ?? weapon.damage) * ratio,
      },
    },
  };
}

function baselineDefinition(
  unit: UnitDefinition,
  revision: ExperimentState["profileRevision"],
): UnitDefinition {
  return revision === EXPERIMENT_REVISION
    ? unit
    : battleDefinition(
        unit.id,
        (legacyBaseline as Record<string, BattleTuning>)[unit.id],
        unit,
      );
}

export function approvedTuning(
  unit: UnitDefinition,
  revision: ExperimentState["profileRevision"] = EXPERIMENT_REVISION,
): BattleTuning {
  return revision === EXPERIMENT_REVISION
    ? {}
    : legacyTuning(baselineDefinition(unit, revision), revision);
}

export function approvedDefinition(
  id: string,
  revision: ExperimentState["profileRevision"] = EXPERIMENT_REVISION,
): UnitDefinition {
  const base = UNIT.get(id);
  if (!base) throw Error(`Unknown land recipe: ${id}`);
  const source = baselineDefinition(base, revision);
  return battleDefinition(
    id,
    revision === EXPERIMENT_REVISION ? {} : legacyTuning(source, revision),
    source,
  );
}
export function newExperiment(): ExperimentState {
  return {
    schemaVersion: 1,
    profileId: EXPERIMENT_ID,
    profileRevision: EXPERIMENT_REVISION,
    contentHash: CONTENT_HASH,
    changes: {},
  };
}
/** Canonical numeric paths omit attack's alias when explicit channels exist. */
export function numericStats(
  definition: UnitDefinition,
): Record<string, number> {
  const values: Record<string, number> = {};
  function collect(value: unknown, path: string) {
    if (typeof value === "number") {
      values[path] = value;
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (
        !path &&
        key === "attack" &&
        (definition.meleeAttack || definition.rangedAttack)
      )
        continue;
      collect(child, path ? `${path}.${key}` : key);
    }
  }
  collect(definition, "");
  for (const channel of ["meleeAttack", "rangedAttack", "attack"] as const) {
    const weapon = definition[channel];
    if (
      !weapon ||
      (channel === "attack" &&
        (definition.meleeAttack || definition.rangedAttack))
    )
      continue;
    for (const tag of BATTLE_BONUS_TAGS)
      values[`${channel}.bonuses.${tag}`] ??= 0;
    if (weapon.channel === "ranged") {
      values[`${channel}.accuracy.near`] ??= 100;
      values[`${channel}.accuracy.far`] ??= 100;
    }
  }
  return values;
}
function writeNumeric(unit: UnitDefinition, path: string, value: number) {
  const keys = path.split(".");
  let target = unit as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    target[key] ??= {};
    target = target[key] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]] = value;
}
export function experimentDefinition(
  state: ExperimentState,
  id: string,
  revision: ExperimentState["profileRevision"] = EXPERIMENT_REVISION,
): UnitDefinition {
  const unit = approvedDefinition(id, revision),
    allowed = numericStats(unit);
  for (const [path, value] of Object.entries(state.changes[id] ?? {})) {
    if (
      !Object.prototype.hasOwnProperty.call(allowed, path) ||
      !Number.isFinite(value) ||
      value < 0
    )
      throw Error(`Invalid experiment stat: ${id}.${path}`);
    writeNumeric(unit, path, value);
  }
  validateDraft(unit as unknown as Record<string, unknown>);
  if (unit.speedPercent < 1 || unit.speedPercent > 1000)
    throw Error("Movement speed must be between 1 and 1000 percent");
  return unit;
}
export function experimentDefinitions(
  state: ExperimentState,
): Map<string, UnitDefinition> {
  return new Map(
    UNITS.map((unit) => [unit.id, experimentDefinition(state, unit.id)]),
  );
}
export function editExperiment(
  state: ExperimentState,
  definition: UnitDefinition,
): ExperimentState {
  const baseline = numericStats(approvedDefinition(definition.id));
  const current = numericStats(definition),
    changes: Record<string, number> = {};
  for (const [path, value] of Object.entries(current)) {
    if (!Object.prototype.hasOwnProperty.call(baseline, path))
      throw Error(`Unknown experiment stat: ${path}`);
    if (value !== baseline[path]) changes[path] = value;
  }
  const next = structuredClone(state);
  next.profileRevision = EXPERIMENT_REVISION;
  if (Object.keys(changes).length) next.changes[definition.id] = changes;
  else delete next.changes[definition.id];
  experimentDefinition(next, definition.id);
  return next;
}
export function parseExperiment(value: unknown): ExperimentState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid balance experiment");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (key) =>
        ![
          "schemaVersion",
          "profileId",
          "profileRevision",
          "contentHash",
          "changes",
        ].includes(key),
    ) ||
    row.schemaVersion !== 1 ||
    row.profileId !== EXPERIMENT_ID ||
    (row.profileRevision !== undefined &&
      row.profileRevision !== 1 &&
      row.profileRevision !== 2 &&
      row.profileRevision !== EXPERIMENT_REVISION) ||
    typeof row.contentHash !== "string" ||
    !row.changes ||
    typeof row.changes !== "object" ||
    Array.isArray(row.changes)
  )
    throw Error("Unsupported balance experiment");
  if (Object.keys(row.changes).length > UNITS.length)
    throw Error("Too many experiment recipes");
  for (const [id, patch] of Object.entries(row.changes)) {
    if (
      !UNIT.has(id) ||
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      Object.keys(patch).length > 1000
    )
      throw Error(`Invalid experiment recipe: ${id}`);
    for (const value of Object.values(patch))
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw Error("Experiment stats must be finite, non-negative numbers");
  }
  const state = structuredClone(row) as unknown as ExperimentState;
  state.profileRevision ??= 1;
  for (const id of Object.keys(state.changes)) experimentDefinition(state, id);
  return state;
}
export function readExperiment(storage: StorageReader): ExperimentState {
  const json = storage.getItem(EXPERIMENT_STORAGE_KEY);
  return json
    ? {
        ...parseExperiment(JSON.parse(json)),
        profileRevision: EXPERIMENT_REVISION,
      }
    : newExperiment();
}
export function saveExperiment(
  storage: StorageWriter,
  state: ExperimentState,
): void {
  storage.setItem(
    EXPERIMENT_STORAGE_KEY,
    JSON.stringify({ ...state, profileRevision: EXPERIMENT_REVISION }),
  );
}
export function activeBalanceProfile(storage: StorageReader): BalanceProfile {
  try {
    return storage.getItem(PROFILE_STORAGE_KEY) === "live"
      ? "live"
      : EXPERIMENT_ID;
  } catch {
    return EXPERIMENT_ID;
  }
}
