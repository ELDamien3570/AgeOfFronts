import type { Age, ChargeState, RefitJob } from "./domain/Definitions";
import { AGES } from "./domain/Definitions";
import type {
  ArcherVolley,
  Building,
  Snapshot,
  SnapshotPacket,
} from "./Protocol";
import { MAX_SQUADS } from "./Protocol";
import { MAX_FACTION_SHIPS } from "./Rules";

/** Hot entity presentation fields. Float64 preserves JS numeric values exactly.
 * NaN denotes undefined; +Infinity denotes null in nullable fields. These are
 * buffer values, never JSON scalars. Variable ID lists use offset/count pairs.
 * Strings are interned once per packet, not repeated for every entity. */
export interface PackedSnapshotDetails {
  version: 1;
  strings: string[];
  squads?: Float64Array;
  buildings?: Float64Array;
  ships: Float64Array;
  volleys: Float64Array;
  ids: Float64Array;
}
export const DETAIL_STRIDES = {
  squad: 27,
  building: 7,
  ship: 22,
  volley: 9,
} as const;
const reasons = [
  "crowd",
  "yielding",
  "terrain",
  "restricted",
  "planning",
  "blocked",
] as const;
const phases = ["approach", "committed", "recovery"] as const;
const repairs = [
  "idle",
  "patrolling",
  "returning-to-dock",
  "waiting-for-dock",
  "repairing",
  "returning-to-patrol",
] as const;
const number = (value: number | undefined) => value ?? NaN;
const optional = (value: number): number | undefined =>
  Number.isNaN(value) ? undefined : value;
const nullable = (value: number | null | undefined) =>
  value === null ? Infinity : number(value);
const readNullable = (value: number) =>
  value === Infinity ? null : optional(value);
const boolean = (value: boolean | undefined) =>
  value === undefined ? NaN : Number(value);
const readBoolean = (value: number) =>
  Number.isNaN(value) ? undefined : !!value;

export function packSnapshotDetails(
  squads: readonly Snapshot["squads"][number][] | undefined,
  buildings: readonly Building[] | undefined,
  ships: readonly Snapshot["ships"][number][],
  volleys: readonly ArcherVolley[],
): PackedSnapshotDetails {
  const strings: string[] = [],
    stringIds = new Map<string, number>();
  const string = (value: string | undefined) => {
    if (value === undefined) return NaN;
    let id = stringIds.get(value);
    if (id === undefined) {
      id = strings.length;
      strings.push(value);
      stringIds.set(value, id);
    }
    return id;
  };
  let count = 0;
  for (const squad of squads ?? [])
    count += squad.movementStatus?.blockerIds.length ?? 0;
  for (const ship of ships)
    count += ship.waypoints.length;
  const ids = new Float64Array(count);
  let cursor = 0;
  const list = (values: readonly number[]) => {
    const start = cursor;
    for (const value of values) ids[cursor++] = value;
    return start;
  };
  const writeRefit = (
    buffer: Float64Array,
    at: number,
    refit: Readonly<RefitJob> | null | undefined,
  ) => {
    buffer[at] =
      refit === undefined
        ? NaN
        : refit === null
          ? Infinity
          : string(refit.targetId);
    buffer[at + 1] = number(refit?.remainingTicks);
    buffer[at + 2] = number(refit?.totalTicks);
  };
  const squadData =
    squads && new Float64Array(squads.length * DETAIL_STRIDES.squad);
  if (squadData)
    for (let row = 0; row < squads!.length; row++) {
      const s = squads![row],
        at = row * DETAIL_STRIDES.squad,
        b = squadData;
      b[at] = s.id;
      b[at + 1] = string(s.definitionId);
      b[at + 2] = number(s.xp);
      b[at + 3] = number(s.deploymentTicks);
      b[at + 4] = number(s.nextAttackTick);
      b[at + 5] = number(s.lastAttackTick);
      b[at + 6] = boolean(s.planningPaused);
      b[at + 7] = s.movementStatus
        ? reasons.indexOf(s.movementStatus.reason)
        : NaN;
      b[at + 8] = number(s.movementStatus?.since);
      b[at + 9] = list(s.movementStatus?.blockerIds ?? []);
      b[at + 10] = s.movementStatus?.blockerIds.length ?? 0;
      writeRefit(b, at + 11, s.refit);
      b[at + 14] =
        s.charge === undefined
          ? NaN
          : s.charge === null
            ? Infinity
            : phases.indexOf(s.charge.phase);
      b[at + 15] = number(s.charge?.x);
      b[at + 16] = number(s.charge?.y);
      b[at + 17] = number(s.charge?.startTick);
      b[at + 18] = number(s.charge?.committedTick);
      b[at + 19] = number(s.charge?.targetId);
      b[at + 20] = number(s.chargeReadyTick);
      b[at + 21] =
        s.structureTarget === undefined
          ? NaN
          : s.structureTarget === null
            ? Infinity
            : 1;
      b[at + 22] = number(s.structureTarget?.buildingId);
      b[at + 23] = number(s.structureTarget?.barrierId);
      // Afloat: hull, its maximum and the carrying vessel (NaN on land).
      b[at + 24] = s.afloat === undefined ? NaN : s.afloat === null ? Infinity : s.afloat.hull;
      b[at + 25] = number(s.afloat?.maxHull);
      b[at + 26] = string(s.afloat?.vesselId);
    }
  const buildingData =
    buildings && new Float64Array(buildings.length * DETAIL_STRIDES.building);
  if (buildingData)
    for (let row = 0; row < buildings!.length; row++) {
      const b = buildings![row],
        at = row * DETAIL_STRIDES.building,
        out = buildingData;
      out[at] = b.id;
      out[at + 1] = number(b.buildTicks);
      out[at + 2] = b.age === undefined ? NaN : AGES.indexOf(b.age);
      out[at + 3] = number(b.health);
      out[at + 4] = number(b.maxHealth);
      out[at + 5] = number(b.nextAttackTick);
      out[at + 6] = number(b.launchReadyTick);
    }
  const shipData = new Float64Array(ships.length * DETAIL_STRIDES.ship);
  for (let row = 0; row < ships.length; row++) {
    const s = ships[row],
      at = row * DETAIL_STRIDES.ship,
      b = shipData;
    b[at] = s.id;
    b[at + 1] = s.playerId;
    b[at + 2] = 0; // Hull class: warship is the only fleet vessel.
    b[at + 3] = s.x;
    b[at + 4] = s.y;
    b[at + 5] = s.health;
    b[at + 6] = nullable(s.destination);
    b[at + 7] = list(s.waypoints);
    b[at + 8] = s.waypoints.length;
    b[at + 9] = Number(s.fighting);
    b[at + 10] = string(s.definitionId);
    b[at + 11] = number(s.xp);
    b[at + 12] = boolean(s.planningPaused);
    writeRefit(b, at + 13, s.refit);
    b[at + 16] = nullable(s.attackTargetId);
    b[at + 17] = number(s.lastPlanTick);
    b[at + 18] = number(s.nextAttackTick);
    b[at + 19] = nullable(s.patrolTile);
    b[at + 20] = nullable(s.repairPortId);
    b[at + 21] =
      s.repairState === undefined ? NaN : repairs.indexOf(s.repairState);
  }
  const volleyData = new Float64Array(volleys.length * DETAIL_STRIDES.volley);
  for (let row = 0; row < volleys.length; row++) {
    const v = volleys[row],
      at = row * DETAIL_STRIDES.volley,
      b = volleyData;
    b[at] = v.id;
    b[at + 1] = v.tick;
    b[at + 2] = v.squadId;
    b[at + 3] = string(v.definitionId);
    b[at + 4] = v.playerId;
    b[at + 5] = v.fromX;
    b[at + 6] = v.fromY;
    b[at + 7] = v.toX;
    b[at + 8] = v.toY;
  }
  return {
    version: 1,
    strings,
    squads: squadData,
    buildings: buildingData,
    ships: shipData,
    volleys: volleyData,
    ids,
  };
}

export function validateSnapshotDetails(data: PackedSnapshotDetails): void {
  if (
    data.version !== 1 ||
    !Array.isArray(data.strings) ||
    data.strings.some((s) => typeof s !== "string") ||
    !(data.ids instanceof Float64Array)
  )
    throw new Error("Invalid packed snapshot details");
  const rows = (
    buffer: Float64Array | undefined,
    stride: number,
    maximum: number,
    required = false,
  ) => {
    if (buffer === undefined && !required) return;
    if (
      !(buffer instanceof Float64Array) ||
      buffer.length % stride ||
      buffer.length / stride > maximum
    )
      throw new Error("Invalid packed snapshot detail rows");
    const seen = new Set<number>();
    for (let at = 0; at < buffer.length; at += stride) {
      if (
        !Number.isSafeInteger(buffer[at]) ||
        buffer[at] < 0 ||
        seen.has(buffer[at])
      )
        throw new Error("Invalid packed snapshot identity");
      seen.add(buffer[at]);
    }
  };
  rows(data.squads, DETAIL_STRIDES.squad, MAX_SQUADS * 255);
  rows(data.buildings, DETAIL_STRIDES.building, 1_000_000);
  rows(data.ships, DETAIL_STRIDES.ship, MAX_FACTION_SHIPS * 255, true);
  rows(data.volleys, DETAIL_STRIDES.volley, MAX_SQUADS * 255, true);
  const range = (offset: number, count: number, maximum: number) => {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(count) ||
      offset < 0 ||
      count < 0 ||
      count > maximum ||
      offset + count > data.ids.length
    )
      throw new Error("Invalid packed snapshot list range");
  };
  const string = (value: number, nullAllowed = false) => {
    if (Number.isNaN(value) || (nullAllowed && value === Infinity)) return;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= data.strings.length
    )
      throw new Error("Invalid packed snapshot string");
  };
  const enumeration = (
    value: number,
    count: number,
    optional = true,
    nullAllowed = false,
  ) => {
    if (
      (optional && Number.isNaN(value)) ||
      (nullAllowed && value === Infinity)
    )
      return;
    if (!Number.isSafeInteger(value) || value < 0 || value >= count)
      throw new Error("Invalid packed snapshot enum");
  };
  const finite = (buffer: Float64Array, start: number, count: number) => {
    for (let at = start; at < start + count; at++)
      if (!Number.isFinite(buffer[at]))
        throw new Error("Invalid packed snapshot number");
  };
  for (const id of data.ids)
    if (!Number.isSafeInteger(id) || id < 0)
      throw new Error("Invalid packed snapshot list identity");
  if (data.squads)
    for (let at = 0; at < data.squads.length; at += DETAIL_STRIDES.squad) {
      const b = data.squads;
      range(b[at + 9], b[at + 10], 8);
      string(b[at + 1]);
      string(b[at + 11], true);
      enumeration(b[at + 6], 2);
      enumeration(b[at + 7], reasons.length);
      enumeration(b[at + 14], phases.length, true, true);
      enumeration(b[at + 21], 2, true, true);
      if (Number.isFinite(b[at + 11])) finite(b, at + 12, 2);
      if (Number.isFinite(b[at + 14])) finite(b, at + 15, 4);
      if (Number.isFinite(b[at + 7])) finite(b, at + 8, 1);
      if (Number.isFinite(b[at + 24])) {
        finite(b, at + 25, 1);
        string(b[at + 26]);
      } else if (!Number.isNaN(b[at + 24]) && b[at + 24] !== Infinity)
        throw new Error("Invalid packed snapshot number");
    }
  if (data.buildings)
    for (let at = 0; at < data.buildings.length; at += DETAIL_STRIDES.building)
      enumeration(data.buildings[at + 2], AGES.length);
  for (let at = 0; at < data.ships.length; at += DETAIL_STRIDES.ship) {
    const b = data.ships;
    range(b[at + 7], b[at + 8], 100_000);
    finite(b, at + 1, 5);
    enumeration(b[at + 2], 1, false);
    enumeration(b[at + 9], 2, false);
    string(b[at + 10]);
    string(b[at + 13], true);
    enumeration(b[at + 12], 2);
    enumeration(b[at + 21], repairs.length);
    if (Number.isFinite(b[at + 13])) finite(b, at + 14, 2);
  }
  for (let at = 0; at < data.volleys.length; at += DETAIL_STRIDES.volley) {
    string(data.volleys[at + 3]);
    finite(data.volleys, at, 3);
    finite(data.volleys, at + 4, 5);
  }
}

export function unpackSnapshotDetails(
  data: PackedSnapshotDetails,
): Pick<
  SnapshotPacket,
  "squadDetails" | "buildingDetails" | "ships" | "volleys"
> {
  const string = (id: number) =>
    Number.isNaN(id) ? undefined : data.strings[id];
  const refit = (b: Float64Array, at: number): RefitJob | null | undefined =>
    Number.isNaN(b[at])
      ? undefined
      : b[at] === Infinity
        ? null
        : {
            targetId: string(b[at])!,
            remainingTicks: b[at + 1],
            totalTicks: b[at + 2],
          };
  const list = (offset: number, count: number) =>
    Array.from(data.ids.subarray(offset, offset + count));
  const squadDetails: SnapshotPacket["squadDetails"] = data.squads
    ? []
    : undefined;
  if (data.squads)
    for (let at = 0; at < data.squads.length; at += DETAIL_STRIDES.squad) {
      const b = data.squads;
      const charge: ChargeState | null | undefined = Number.isNaN(b[at + 14])
        ? undefined
        : b[at + 14] === Infinity
          ? null
          : {
              phase: phases[b[at + 14]],
              x: b[at + 15],
              y: b[at + 16],
              startTick: b[at + 17],
              committedTick: b[at + 18],
              targetId: optional(b[at + 19]),
            };
      squadDetails!.push({
        id: b[at],
        definitionId: string(b[at + 1]),
        xp: optional(b[at + 2]),
        deploymentTicks: optional(b[at + 3]),
        nextAttackTick: optional(b[at + 4]),
        lastAttackTick: optional(b[at + 5]),
        planningPaused: readBoolean(b[at + 6]),
        movementStatus: Number.isNaN(b[at + 7])
          ? undefined
          : {
              reason: reasons[b[at + 7]],
              since: b[at + 8],
              blockerIds: list(b[at + 9], b[at + 10]),
            },
        refit: refit(b, at + 11),
        charge,
        chargeReadyTick: optional(b[at + 20]),
        structureTarget: Number.isNaN(b[at + 21])
          ? undefined
          : b[at + 21] === Infinity
            ? null
            : {
                buildingId: optional(b[at + 22]),
                barrierId: optional(b[at + 23]),
              },
        afloat: Number.isNaN(b[at + 24])
          ? undefined
          : b[at + 24] === Infinity
            ? null
            : { hull: b[at + 24], maxHull: b[at + 25], vesselId: string(b[at + 26])! },
      });
    }
  const buildingDetails: SnapshotPacket["buildingDetails"] = data.buildings
    ? []
    : undefined;
  if (data.buildings)
    for (
      let at = 0;
      at < data.buildings.length;
      at += DETAIL_STRIDES.building
    ) {
      const b = data.buildings;
      buildingDetails!.push({
        id: b[at],
        buildTicks: optional(b[at + 1]),
        age: Number.isNaN(b[at + 2]) ? undefined : (AGES[b[at + 2]] as Age),
        health: optional(b[at + 3]),
        maxHealth: optional(b[at + 4]),
        nextAttackTick: optional(b[at + 5]),
        launchReadyTick: optional(b[at + 6]),
      });
    }
  const ships: Snapshot["ships"] = [];
  for (let at = 0; at < data.ships.length; at += DETAIL_STRIDES.ship) {
    const b = data.ships;
    ships.push({
      id: b[at],
      playerId: b[at + 1],
      kind: "warship",
      x: b[at + 3],
      y: b[at + 4],
      health: b[at + 5],
      destination: readNullable(b[at + 6])!,
      waypoints: list(b[at + 7], b[at + 8]),
      fighting: !!b[at + 9],
      definitionId: string(b[at + 10]),
      xp: optional(b[at + 11]),
      planningPaused: readBoolean(b[at + 12]),
      refit: refit(b, at + 13),
      attackTargetId: readNullable(b[at + 16]),
      lastPlanTick: optional(b[at + 17]),
      nextAttackTick: optional(b[at + 18]),
      patrolTile: readNullable(b[at + 19]),
      repairPortId: readNullable(b[at + 20]),
      repairState: Number.isNaN(b[at + 21]) ? undefined : repairs[b[at + 21]],
    });
  }
  const volleys: ArcherVolley[] = [];
  for (let at = 0; at < data.volleys.length; at += DETAIL_STRIDES.volley) {
    const b = data.volleys;
    volleys.push({
      id: b[at],
      tick: b[at + 1],
      squadId: b[at + 2],
      definitionId: string(b[at + 3]),
      playerId: b[at + 4],
      fromX: b[at + 5],
      fromY: b[at + 6],
      toX: b[at + 7],
      toY: b[at + 8],
    });
  }
  return { squadDetails, buildingDetails, ships, volleys };
}
