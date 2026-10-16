import {validateAiWithdrawal} from "./domain/AiDiplomaticWithdrawal";
import { FormationSlotEncoder, FormationSlotDecoder, resolveFormationSlots, type FormationSlotChanges, type FormationSlotRead } from "./FormationSlotStream";
import type { FormationState } from "./domain/FormationGeometry";
import { validateOccupancy } from "./domain/TrenchOccupancy";
import { validateStance } from "./domain/SkirmishStance";
import { validateCombatFact } from './domain/CombatFact';
import { validateCavalryMelee } from './domain/CavalryMelee';
import { validateFormation } from "./domain/FormationGeometry";
import { validateWeaponState } from "./domain/WeaponTiming";
import { replicatedWeaponState } from "./domain/RangedPreparation";
import { validateMeleeStrike } from "./domain/MeleeStrike";
import { validateChargeImpact } from './domain/ChargeImpact';
import { validateCavalryEngagement } from './domain/CavalryEngagement';
import { validateManpower } from './domain/Manpower';
import { validateChargeStrength } from './domain/ChargeStrength';
import { validateTransportDamage } from './domain/NavalCombat';
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
  version: 1 | 2 | 3 | 4 | 5;
  formationSlots?: FormationSlotChanges;
  strings: string[];
  squads?: Float64Array;
  /** Optional squad-level motion extension; legacy 27-value rows stay readable. */
  squadMotion?: Float64Array;
  buildings?: Float64Array;
  ships: Float64Array;
  shipAirDefense?: Float64Array;
  shipNavalPriority?: Float64Array;
  squadTransportDamage?: Float64Array;
  volleys: Float64Array;
  volleyRoots?: Float64Array;
  ids: Float64Array;
}
export const DETAIL_STRIDES = {
  squad: 30,
  building: 7,
  ship: 22,
  volley: 15,
} as const;
const reasons = [
  "crowd",
  "yielding",
  "terrain",
  "restricted",
  "planning",
  "blocked",
] as const
const phases = ["approach", "committed", "recovery", "preparing"] as const
const repairs = [
  "idle",
  "patrolling",
  "returning-to-dock",
  "waiting-for-dock",
  "repairing",
  "returning-to-patrol",
] as const
const number = (value: number | undefined) => value ?? NaN
const optional = (value: number): number | undefined =>
  Number.isNaN(value) ? undefined : value
const nullable = (value: number | null | undefined) =>
  value === null ? Infinity : number(value)
const readNullable = (value: number) =>
  value === Infinity ? null : optional(value)
const boolean = (value: boolean | undefined) =>
  value === undefined ? NaN : Number(value)
const readBoolean = (value: number) =>
  Number.isNaN(value) ? undefined : !!value

/** Encoder-owned reuse. Owned nested domain values are immutable; scalar
 * records are not, so every serialized input is captured explicitly. */
const SQUAD_DETAIL_KEYS = [
  "stance",
  "lastWithdrawTick",
  "occupancy",
  "chargeStrength",
  "manpower",
  "refitVariant",
  "weaponState",
  "formation",
  "meleeStrike",
  "combatFact",
  "chargeImpact",
  "cavalryEngagement",
  "cavalryMelee",
  "aiWithdrawal",
];
const SQUAD_DETAIL_PREFIXES = SQUAD_DETAIL_KEYS.map((key) => `"${key}":`);
export class SquadDetailCache {
  private readonly slots?: FormationSlotEncoder;
  constructor(readonly compactFormationSlots = false) { if (compactFormationSlots) this.slots = new FormationSlotEncoder(); }
  slotChanges(): FormationSlotChanges | undefined { return this.slots?.drain(); }
  slotBaseline(): FormationSlotChanges | undefined { return this.slots?.baseline(); }
  get retainedSlotEntries(): number { return this.slots?.retainedEntries ?? 0; }
  private readonly rows = new Map<
    number,
    { inputs: readonly unknown[]; parts: (string | undefined)[]; value: string }
  >();
  readonly diagnostics = { hits: 0, misses: 0, fieldHits: 0, fieldMisses: 0 };
  clear(): void {
    this.rows.clear();
    this.slots?.clear();
  }
  forget(id: number): void {
    this.rows.delete(id);
    this.slots?.forget(id);
  }
  retain(ids: ReadonlySet<number>): void {
    for (const id of this.rows.keys()) if (!ids.has(id)) this.forget(id);
  }
  /** `tick` is the packet tick; with it, expired released ranged history is
   * omitted from the row (N10, see replicatedWeaponState). */
  encode(s: Snapshot["squads"][number], tick?: number): string | undefined {
    if (
      !(
        s.aiWithdrawal ||
        s.stance ||
        s.occupancy ||
        s.manpower ||
        s.combatFact ||
        s.meleeStrike ||
        s.chargeImpact ||
        s.cavalryEngagement ||
        s.cavalryMelee ||
        s.charge?.strength !== undefined
      )
    ) { this.forget(s.id); return undefined; }
    const inputs = [
      s.stance,
      s.lastWithdrawTick,
      s.occupancy,
      s.charge?.strength,
      s.manpower,
      s.refit?.recipeVariant,
      replicatedWeaponState(s.weaponState, tick),
      s.formation,
      s.meleeStrike,
      s.combatFact,
      s.chargeImpact,
      s.cavalryEngagement,
      s.cavalryMelee,
      s.aiWithdrawal,
    ];
    const old = this.rows.get(s.id);
    if (old && inputs.every((value, i) => Object.is(value, old.inputs[i]))) {
      this.diagnostics.hits++;
      return old.value;
    }
    const parts = inputs.map((input, i) => {
      if (old && Object.is(input, old.inputs[i])) {
        this.diagnostics.fieldHits++;
        return old.parts[i];
      }
      this.diagnostics.fieldMisses++;
      return JSON.stringify(i === 7 && this.slots ? this.slots.encode(s.id, input as FormationState | undefined) : input);
    });
    let value = "{",
      separator = "";
    for (let i = 0; i < parts.length; i++)
      if (parts[i] !== undefined) {
        value += separator + SQUAD_DETAIL_PREFIXES[i] + parts[i];
        separator = ",";
      }
    value += "}";
    this.rows.set(s.id, { inputs, parts, value });
    this.diagnostics.misses++;
    return value;
  }
}
export function packSnapshotDetails(
  squads: readonly Snapshot["squads"][number][] | undefined,
  buildings: readonly Building[] | undefined,
  ships: readonly Snapshot["ships"][number][],
  volleys: readonly ArcherVolley[],
  cache?:SquadDetailCache,
  slotBaseline = false,
  tick?: number,
): PackedSnapshotDetails {
  const strings: string[] = [],
    stringIds = new Map<string, number>()
  const detailCache=cache??new SquadDetailCache();
  const string = (value: string | undefined) => {
    if (value === undefined) return NaN;
    let id = stringIds.get(value);
    if (id === undefined) {
      id = strings.length;
      strings.push(value);
      stringIds.set(value, id);
    }
    return id;
  }
  let count = 0
  for (const squad of squads ?? [])
    count += squad.movementStatus?.blockerIds.length ?? 0;
  for (const ship of ships)
    count += ship.waypoints.length;
  const ids = new Float64Array(count)
  let cursor = 0
  const list = (values: readonly number[]) => {
    const start = cursor;
    for (const value of values) ids[cursor++] = value;
    return start;
  }
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
  }
  const squadData =
    squads && new Float64Array(squads.length * DETAIL_STRIDES.squad)
  if (squadData)
    for (let row = 0; row < squads!.length; row++) {
      const s = squads![row],
        at = row * DETAIL_STRIDES.squad,
        b = squadData
    b[at] = s.id
      b[at + 1] = string(s.definitionId)
      b[at + 2] = number(s.xp)
      b[at + 3] = number(s.deploymentTicks)
      b[at + 4] = number(s.nextAttackTick)
      b[at + 5] = number(s.lastAttackTick)
      b[at + 27] = number(s.magazineShots);
      b[at + 28] = number(s.reloadStartedTick);
      b[at + 29] = string(detailCache.encode(s, tick));
      b[at + 6] = boolean(s.planningPaused)
      b[at + 7] = s.movementStatus
        ? reasons.indexOf(s.movementStatus.reason)
        : NaN
      b[at + 8] = number(s.movementStatus?.since)
      b[at + 9] = list(s.movementStatus?.blockerIds ?? [])
      b[at + 10] = s.movementStatus?.blockerIds.length ?? 0
      writeRefit(b, at + 11, s.refit)
      b[at + 14] =
        s.charge === undefined
          ? NaN
          : s.charge === null
            ? Infinity
            : phases.indexOf(s.charge.phase)
      b[at + 15] = number(s.charge?.x)
      b[at + 16] = number(s.charge?.y)
      b[at + 17] = number(s.charge?.startTick)
      b[at + 18] = number(s.charge?.committedTick)
      b[at + 19] = number(s.charge?.targetId)
      b[at + 20] = number(s.chargeReadyTick)
      b[at + 21] =
        s.structureTarget === undefined
          ? NaN
          : s.structureTarget === null
            ? Infinity
            : 1
      b[at + 22] = number(s.structureTarget?.buildingId)
      b[at + 23] = number(s.structureTarget?.barrierId)
      // Afloat: hull, its maximum and the carrying vessel (NaN on land).
      b[at + 24] = s.afloat === undefined ? NaN : s.afloat === null ? Infinity : s.afloat.hull
      b[at + 25] = number(s.afloat?.maxHull)
      b[at + 26] = string(s.afloat?.vesselId)
    }
  const buildingData =
    buildings && new Float64Array(buildings.length * DETAIL_STRIDES.building)
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
  const shipData = new Float64Array(ships.length * DETAIL_STRIDES.ship)
  for (let row = 0; row < ships.length; row++) {
    const s = ships[row],
      at = row * DETAIL_STRIDES.ship,
      b = shipData;
    b[at] = s.id;
    b[at + 1] = s.playerId;
    b[at + 2] = s.kind === 'carrier' ? 1 : 0;
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
  const volleyData = new Float64Array(volleys.length * DETAIL_STRIDES.volley)
  for (let row = 0; row < volleys.length; row++) {
    const v = volleys[row],
      at = row * DETAIL_STRIDES.volley,
      b = volleyData
    b[at] = v.id
    b[at + 1] = v.tick
    b[at + 2] = v.squadId
    b[at + 3] = string(v.definitionId)
    b[at + 4] = v.playerId
    b[at + 5] = v.fromX
    b[at + 6] = v.fromY
    b[at + 7] = v.toX
    b[at + 8] = v.toY
    b[at + 9] = v.targetId ?? -1;
    b[at + 10] = v.damage ?? 0;
    b[at + 11] = v.melee ? 1 : 0;
    b[at + 12] = v.sourceKind === "aircraft" ? 1 : 0;
    b[at + 13] = v.targetKind === "aircraft" ? 1 : 0;
    b[at + 14] = v.impact ? 1 : 0;
  }
  let squadMotion: Float64Array | undefined
  if (squads?.some((s) => s.locomotion)) {
    squadMotion = new Float64Array(squads.length * 4);
    for (let row = 0; row < squads.length; row++) {
      const s = squads[row], at = row * 4;
      squadMotion[at] = s.id;
      squadMotion[at + 1] = number(s.locomotion?.heading);
      squadMotion[at + 2] = number(s.locomotion?.targetHeading);
      squadMotion[at + 3] = number(s.locomotion?.speed);
    }
  }
  return {
    version: detailCache.compactFormationSlots ? 5 : 4,
    ...(detailCache.compactFormationSlots ? { formationSlots: slotBaseline ? detailCache.slotBaseline() : detailCache.slotChanges() } : {}),
    strings,
    squads: squadData,
    ...(squadMotion ? { squadMotion } : {}),
    buildings: buildingData,
    ships: shipData,
    ...(ships.some(s=>s.navalPriority!==undefined) ? { shipNavalPriority: new Float64Array(
      ships.filter(s=>s.navalPriority!==undefined).flatMap(s=>[s.id,s.navalPriority==='warships'?1:0])) } : {}),
    ...(squads?.some(s=>s.afloat?.passengerHealth!==undefined) ? { squadTransportDamage: new Float64Array(
      squads.filter(s=>s.afloat?.passengerHealth!==undefined).flatMap(s=>[s.id,s.afloat!.passengerHealth!,s.afloat!.passengerHullDamage??0])) } : {}),
    ...(ships.some((s) =>s.airDefenseTick!==undefined)
      ? {
  shipAirDefense: new Float64Array(
            ships
              .filter((s) =>s.airDefenseTick!==undefined)
              .flatMap((s) =>[s.id,s.airDefenseTick!]),
          ),
        }
      : {}),
    volleys: volleyData,
    ...(volleys.some(v=>v.combatRoots)?{volleyRoots:new Float64Array(volleys.filter(v=>v.combatRoots).flatMap(v=>
      [v.id,v.combatRoots!.sourceX,v.combatRoots!.sourceY,v.combatRoots!.targetX,v.combatRoots!.targetY]))}:{}),
    ids,
  };
}

type ParsedSquadPayload = NonNullable<SnapshotPacket["squadDetails"]>[number] & { chargeStrength?: number; refitVariant?: "base" | "enlarged" };
export function validateSnapshotDetails(
  data: PackedSnapshotDetails,
  context?: { tick?: number; troops?: ReadonlyMap<number, number>; slots?: FormationSlotRead },
): Map<number, ParsedSquadPayload> {
  const payloads = new Map<number, ParsedSquadPayload>();
  const slots = data.version === 5 ? context?.slots ?? new FormationSlotDecoder().stage(data.formationSlots) : undefined;
  if (
    ![1,2,3,4,5].includes(data.version) ||
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
  }
  rows(
    data.squads,
    data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27, MAX_SQUADS * 255,
  );
  rows(data.squadMotion, 4, MAX_SQUADS * 255)
  rows(data.buildings, DETAIL_STRIDES.building, 1_000_000)
  rows(data.ships, DETAIL_STRIDES.ship, MAX_FACTION_SHIPS * 255, true)
  rows(data.shipAirDefense,2,MAX_FACTION_SHIPS*255)
  rows(data.shipNavalPriority,2,MAX_FACTION_SHIPS*255);
  if(data.shipNavalPriority)for(let at=0;at<data.shipNavalPriority.length;at+=2)
    if(![0,1].includes(data.shipNavalPriority[at+1]))throw new Error("Invalid naval priority");
  rows(data.squadTransportDamage,3,MAX_SQUADS*255);
  rows(data.volleyRoots,5,MAX_SQUADS*255);
  if(data.volleyRoots){
    const volleyIds=new Set<number>();
    for(let at=0;at<data.volleys.length;at+=data.version>=3?DETAIL_STRIDES.volley:9)volleyIds.add(data.volleys[at]);
    for(let at=0;at<data.volleyRoots.length;at+=5){
      if(!volleyIds.has(data.volleyRoots[at]) || Array.from(data.volleyRoots.subarray(at+1,at+5)).some(v=>!Number.isFinite(v)||Math.abs(v)>2147483647))throw Error('Invalid combat carrier roots');
    }
  }
  if(data.squadTransportDamage)for(let at=0;at<data.squadTransportDamage.length;at+=3)
    if(![data.squadTransportDamage[at+1],data.squadTransportDamage[at+2]].every(v=>Number.isFinite(v)&&v>=0))throw new Error("Invalid transport passenger damage");
  if(data.shipAirDefense)for(let at=0;at<data.shipAirDefense.length;at+=2)if(!Number.isSafeInteger(data.shipAirDefense[at+1])||data.shipAirDefense[at+1]<0)throw new Error("Invalid ship air defence tick");
  rows(
    data.volleys,
    data.version >= 3 ? DETAIL_STRIDES.volley : 9, MAX_SQUADS * 255,
    true,
  );
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
  }
  const string = (value: number, nullAllowed = false) => {
    if (Number.isNaN(value) || (nullAllowed && value === Infinity)) return;
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= data.strings.length
    )
      throw new Error("Invalid packed snapshot string");
  }
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
  }
  const finite = (buffer: Float64Array, start: number, count: number) => {
    for (let at = start; at < start + count; at++)
      if (!Number.isFinite(buffer[at]))
        throw new Error("Invalid packed snapshot number");
  }
  if ( data.squadMotion) {
    if (data.version < 2) throw new Error("Invalid packed snapshot motion version");
    if (
      !data.squads || data.squadMotion.length / 4 !== data.squads.length / (data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27)
    )
      throw new Error("Invalid packed snapshot motion rows");
    for (let at = 0; at < data.squadMotion.length; at += 4) {
      const b = data.squadMotion
      if (
        b[at] !==
        data.squads[(at / 4) * (data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27)]
      ) throw new Error("Invalid packed snapshot motion identity");
      if (Number.isNaN(b[at + 1])) {
        if (!Number.isNaN(b[at + 2]) || !Number.isNaN(b[at + 3])) throw new Error("Invalid packed snapshot motion");
      } else {
        finite(b, at + 1, 3);
        if (Math.abs(b[at + 1]) > Math.PI || Math.abs(b[at + 2]) > Math.PI || b[at + 3] < 0)
          throw new Error("Invalid packed snapshot motion");
      }
    }
  }
  for (const id of data.ids)
    if (!Number.isSafeInteger(id) || id < 0)
      throw new Error("Invalid packed snapshot list identity");
  if(data.version>=4 && data.squads)for(let at=0;at<data.squads.length;at+=DETAIL_STRIDES.squad){
    const index=data.squads[at+29];if(Number.isNaN(index))continue;
    if(!Number.isSafeInteger(index)||index<0||index>=data.strings.length||data.strings[index].length>20000)throw new Error('Invalid manpower detail');
    // One owned object per squad row, even when the string table deduplicated
    // identical JSON. Distinct units must not acquire aliased mutable details.
    const payload=JSON.parse(data.strings[index]) as ParsedSquadPayload;
    if (slots) resolveFormationSlots(payload.formation, slots);
    payloads.set(at,payload);
    validateAiWithdrawal(payload.aiWithdrawal,context?.tick);validateOccupancy(payload.occupancy);validateStance(payload.stance,payload.lastWithdrawTick);validateChargeStrength(payload.chargeStrength);validateManpower(payload.manpower,context?.troops?.get(data.squads[at]));validateWeaponState(payload.weaponState,context?.tick);validateFormation(payload.formation,data.strings[data.squads[at+1]],context?.troops?.get(data.squads[at]),slots?.validated);validateMeleeStrike(payload.meleeStrike,context?.tick);validateCombatFact(payload.combatFact,context?.tick);validateChargeImpact(payload.chargeImpact,context?.tick);validateCavalryEngagement(payload.cavalryEngagement,context?.tick);validateCavalryMelee(payload.cavalryMelee,context?.tick);
    if(payload.refitVariant!==undefined&&!['base','enlarged'].includes(payload.refitVariant))throw new Error('Invalid refit recipe variant');
  }
  if (data.squads)
    for (
      let at = 0; at < data.squads.length;
      at += data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27
    ) {
      const b = data.squads
      range(b[at + 9], b[at + 10], 8); string(b[at + 1]);
      string(b[at + 11], true)
      enumeration(b[at + 6], 2)
      enumeration(b[at + 7], reasons.length)
    enumeration(
      b[at + 14],
        data.version >= 2 ? phases.length : 3,
        true,
        true,
      );
      enumeration(b[at + 21], 2, true, true)
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
    enumeration(b[at + 2], 2, false);
    enumeration(b[at + 9], 2, false);
    string(b[at + 10]);
    string(b[at + 13], true);
    enumeration(b[at + 12], 2);
    enumeration(b[at + 21], repairs.length);
    if (Number.isFinite(b[at + 13])) finite(b, at + 14, 2);
  }
  for (
    let at = 0; at < data.volleys.length;
    at += data.version >= 3 ? DETAIL_STRIDES.volley : 9
  ) {
    string(data.volleys[at + 3])
    finite(data.volleys, at, 3)
    finite(data.volleys, at + 4, data.version >= 3 ? 11 : 5);
  }
  return payloads;
}

export function unpackSnapshotDetails(
  data: PackedSnapshotDetails,
  payloads?: ReadonlyMap<number, ParsedSquadPayload>,
): Pick<
  SnapshotPacket,
  "squadDetails" | "buildingDetails" | "ships" | "volleys"
> {
  if (data.version === 5 && !payloads) payloads = validateSnapshotDetails(data);
  const string = (id: number) =>
    Number.isNaN(id) ? undefined : data.strings[id]
  const refit = (b: Float64Array, at: number): RefitJob | null | undefined =>
    Number.isNaN(b[at])
      ? undefined
      : b[at] === Infinity
        ? null
        : {
            targetId: string(b[at])!,
            remainingTicks: b[at + 1],
            totalTicks: b[at + 2],
          }
  const list = (offset: number, count: number) =>
    Array.from(data.ids.subarray(offset, offset + count))
  const squadDetails: SnapshotPacket["squadDetails"] = data.squads
    ? []
    : undefined
  if (data.squads)
    for (
      let at = 0; at < data.squads.length;
      at += data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27
    ) {
      const b = data.squads
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
            }
      const payload=data.version>=4&&!Number.isNaN(b[at+29])?(payloads?.get(at) ?? JSON.parse(data.strings[b[at+29]])):undefined;
      validateChargeStrength(payload?.chargeStrength);
      if(charge && payload?.chargeStrength!==undefined)charge.strength=payload.chargeStrength;
      const landRefit=refit(b,at+11);
      squadDetails!.push({
        ...(payload?{aiWithdrawal:payload.aiWithdrawal,stance:payload.stance,lastWithdrawTick:payload.lastWithdrawTick,occupancy:payload.occupancy,manpower:payload.manpower,weaponState:payload.weaponState,formation:payload.formation,meleeStrike:payload.meleeStrike,combatFact:payload.combatFact,chargeImpact:payload.chargeImpact,cavalryEngagement:payload.cavalryEngagement,cavalryMelee:payload.cavalryMelee}:{}),
      id: b[at],
        definitionId: string(b[at + 1]),
        xp: optional(b[at + 2]),
        deploymentTicks: optional(b[at + 3]),
        nextAttackTick: optional(b[at + 4]),
        lastAttackTick: optional(b[at + 5]),
        ...(data.version >= 3
          ? {
              magazineShots: optional(b[at + 27]),
              reloadStartedTick: optional(b[at + 28]),
            }
          : {}),
        planningPaused: readBoolean(b[at + 6]),
        movementStatus: Number.isNaN(b[at + 7])
          ? undefined
          : {
              reason: reasons[b[at + 7]],
              since: b[at + 8],
              blockerIds: list(b[at + 9], b[at + 10]),
            },
        refit: landRefit ? {...landRefit,...(payload?.refitVariant?{recipeVariant:payload.refitVariant}:{})} : landRefit,
        charge,
        chargeReadyTick: optional(b[at + 20]),
        locomotion: data.squadMotion &&
          !Number.isNaN( data.squadMotion[
              (at / (data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27)) * 4 + 1
            ],
          )
            ? {
                heading: data.squadMotion[
                    (at / (data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27)) *
                      4 +
                      1
                  ],
            targetHeading: data.squadMotion[
                    (at / (data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27)) *
                      4 +
                      2
                  ],
            speed: data.squadMotion[
                    (at / (data.version >= 4 ? DETAIL_STRIDES.squad : data.version === 3 ? 29 : 27)) *
                      4 +
                      3
                  ],
              }
            : undefined,
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
  if(data.squadTransportDamage && squadDetails) {
    const damage = new Map<number,{passengerHealth:number;passengerHullDamage:number}>();
    for(let at=0;at<data.squadTransportDamage.length;at+=3)damage.set(data.squadTransportDamage[at],{
      passengerHealth:data.squadTransportDamage[at+1],passengerHullDamage:data.squadTransportDamage[at+2]});
    for(let i=0;i<squadDetails.length;i++) {
      const s=squadDetails[i], accounting=damage.get(s.id);
      if(accounting && s.afloat) {
        const afloat={...s.afloat,...accounting}; validateTransportDamage(afloat);
        squadDetails[i]={...s,afloat};
      }
    }
  }
  const buildingDetails: SnapshotPacket["buildingDetails"] = data.buildings
    ? []
    : undefined
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
  const ships: Snapshot["ships"] = []
  for (let at = 0; at < data.ships.length; at += DETAIL_STRIDES.ship) {
    const b = data.ships;
    ships.push({
      id: b[at],
      playerId: b[at + 1],
      kind: b[at + 2] === 1 ? "carrier" : "warship",
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
  if(data.shipAirDefense) {
    const cooldown=new Map<number,number>();for(let at=0;at<data.shipAirDefense.length;at+=2)cooldown.set(data.shipAirDefense[at],data.shipAirDefense[at+1]);
    for(let i=0;i<ships.length;i++)if(cooldown.has(ships[i].id))ships[i]={...ships[i],airDefenseTick:cooldown.get(ships[i].id)};
  }
  if(data.shipNavalPriority) {
    const priorities=new Map<number,"transports"|"warships">();
    for(let at=0;at<data.shipNavalPriority.length;at+=2)priorities.set(data.shipNavalPriority[at],data.shipNavalPriority[at+1]===1?'warships':'transports');
    for(let i=0;i<ships.length;i++)if(priorities.has(ships[i].id))ships[i]={...ships[i],navalPriority:priorities.get(ships[i].id)};
  }
  const volleys: ArcherVolley[] = []
  const roots=new Map<number,NonNullable<ArcherVolley['combatRoots']>>();
  if(data.volleyRoots)for(let at=0;at<data.volleyRoots.length;at+=5)roots.set(data.volleyRoots[at],{
    sourceX:data.volleyRoots[at+1],sourceY:data.volleyRoots[at+2],targetX:data.volleyRoots[at+3],targetY:data.volleyRoots[at+4]});
  for (
    let at = 0; at < data.volleys.length;
    at += data.version >= 3 ? DETAIL_STRIDES.volley : 9
  ) {
    const b = data.volleys
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
      ...(roots.has(b[at])?{combatRoots:roots.get(b[at])}:{}),
      ...(data.version >= 3 && b[at + 9] >= 0 ? { targetId: b[at + 9] } : {}),
      ...(data.version >= 3 && b[at + 10] > 0 ? { damage: b[at + 10] } : {}),
      ...(data.version >= 3 && b[at + 11] ? { melee: true } : {}),
      ...(data.version >= 3 && b[at + 12]
        ? { sourceKind: "aircraft" as const }
        : {}),
      ...(data.version >= 3 && b[at + 13]
        ? { targetKind: "aircraft" as const }
        : {}),
      ...(data.version >= 3 && b[at + 14] ? { impact: true } : {}),
    });
  }
  return { squadDetails, buildingDetails, ships, volleys };
}
