import type { ProgressionState, ResearchJob, Tree } from "./domain/Definitions";

/** N5 / P12 wire form of one faction's progression. A running job carries the
 * tick it finishes instead of its per-tick countdown, so the record changes
 * only when research starts, finishes or the age changes. The decoder derives
 * `remainingTicks = endTick - packet.tick` for every faction each tick. */
export type WireResearchJob = Omit<ResearchJob, "remainingTicks"> & { endTick: number };
export interface WireProgressionState extends Omit<ProgressionState, "research" | "advancement"> {
  research: Partial<Record<Tree, WireResearchJob>>;
  advancement: (Omit<NonNullable<ProgressionState["advancement"]>, "remainingTicks"> & { endTick: number }) | null;
  /** Present on an eliminated faction's record: its jobs are frozen, so every
   * endTick is relative to this tick instead of the packet tick, and the
   * record stays byte-identical while the faction stays eliminated. */
  frozenAt?: number;
}
export type ProgressionWire = Record<number, WireProgressionState>;
/** Mode tag on packets carrying the endTick form. Absent: legacy full map
 * of ProgressionState records with remainingTicks, still accepted. */
export type ProgressionMode = "full" | "delta";

const hasJob = (state: ProgressionState) =>
  state.advancement !== null || Object.values(state.research).some(job => job !== undefined);

export function toWireProgression(state: ProgressionState, tick: number, frozen = false): WireProgressionState {
  if (frozen) return { ...toWireProgression(state, 0), frozenAt: 0 };
  const research: WireProgressionState["research"] = {};
  for (const [tree, job] of Object.entries(state.research) as [Tree, ResearchJob | undefined][])
    if (job) research[tree] = { technologyId: job.technologyId, endTick: tick + job.remainingTicks, totalTicks: job.totalTicks };
  return {
    cultureId: state.cultureId,
    age: state.age,
    completed: state.completed,
    research,
    advancement: state.advancement
      ? { target: state.advancement.target, endTick: tick + state.advancement.remainingTicks, totalTicks: state.advancement.totalTicks }
      : null,
  };
}

export function fromWireProgression(state: WireProgressionState, packetTick: number): ProgressionState {
  const tick = state.frozenAt ?? packetTick;
  const research: ProgressionState["research"] = {};
  for (const [tree, job] of Object.entries(state.research) as [Tree, WireResearchJob | undefined][])
    if (job) research[tree] = { technologyId: job.technologyId, remainingTicks: job.endTick - tick, totalTicks: job.totalTicks };
  return {
    cultureId: state.cultureId,
    age: state.age,
    completed: state.completed,
    research,
    advancement: state.advancement
      ? { target: state.advancement.target, remainingTicks: state.advancement.endTick - tick, totalTicks: state.advancement.totalTicks }
      : null,
  };
}

/** Encoder-owned per-faction cursor. A record is sent only when its wire form
 * differs from the last record sent on this stream (compared as JSON, so a
 * missed domain revision can never hide a change). Eliminated factions keep a
 * frozen countdown; their records use the frozen form, so they are sent once
 * rather than on every publication. */
export class ProgressionReplicationEncoder {
  private readonly sent = new Map<number, string>();
  private frozenKey = "";
  encode(
    states: Readonly<Record<number, ProgressionState>> | undefined,
    tick: number,
    full: boolean,
    revisionChanged: boolean,
    frozen: ReadonlySet<number> = new Set(),
  ): { mode: ProgressionMode; changes?: ProgressionWire } {
    if (!states) return { mode: full ? "full" : "delta" };
    if (full) this.sent.clear();
    const frozenKey = [...frozen].sort((a, b) => a - b).join(","), frozenChanged = frozenKey !== this.frozenKey;
    this.frozenKey = frozenKey;
    // A live running job's endTick is stable, but compare whenever one runs so
    // a missed revision cannot hide a change; frozen records never move.
    if (!full && !revisionChanged && !frozenChanged &&
      !Object.entries(states).some(([key, state]) => !frozen.has(Number(key)) && hasJob(state))) return { mode: "delta" };
    const changes: ProgressionWire = {};
    let changed = false;
    for (const [key, state] of Object.entries(states)) {
      const id = Number(key), wire = toWireProgression(state, tick, frozen.has(id)), json = JSON.stringify(wire);
      if (!full && this.sent.get(id) === json) continue;
      this.sent.set(id, json);
      changes[id] = wire;
      changed = true;
    }
    return { mode: full ? "full" : "delta", changes: full || changed ? changes : undefined };
  }
}

const isTick = (value: unknown) => Number.isSafeInteger(value);
function validateWire(state: WireProgressionState, packetTick: number): void {
  if (!state || typeof state !== "object" || !Array.isArray(state.completed) || typeof state.age !== "string" ||
    typeof state.cultureId !== "string" || !state.research || typeof state.research !== "object" ||
    (state.frozenAt !== undefined && !isTick(state.frozenAt)))
    throw new Error("Invalid progression record");
  const tick = state.frozenAt ?? packetTick;
  const jobs: { endTick: number; totalTicks: number }[] = Object.values(state.research).filter(job => job !== undefined) as WireResearchJob[];
  if (state.advancement !== null) jobs.push(state.advancement);
  for (const job of jobs)
    if (!job || !isTick(job.endTick) || !isTick(job.totalTicks) || job.totalTicks < 1 || job.endTick - tick < 1 || job.endTick - tick > job.totalTicks)
      throw new Error("Invalid progression job");
}

/** Decoder-owned endTick records. Materialises ProgressionState for each tick. */
export class ProgressionReplicationDecoder {
  private records?: Map<number, { wire: WireProgressionState; view?: ProgressionState }>;
  get active(): boolean { return this.records !== undefined; }
  clear(): void { this.records = undefined; }
  /** Validates without committing. */
  validate(mode: unknown, changes: unknown, tick: number, reset: boolean): void {
    if (mode !== "full" && mode !== "delta") throw new Error("Invalid progression mode");
    if (mode === "delta" && !reset && !this.records) throw new Error("Progression delta has no baseline");
    if (changes === undefined) return;
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Invalid progression changes");
    for (const [key, state] of Object.entries(changes)) {
      if (!Number.isSafeInteger(Number(key))) throw new Error("Invalid progression faction");
      validateWire(state as WireProgressionState, tick);
    }
  }
  apply(mode: ProgressionMode, changes: ProgressionWire | undefined, tick: number): Record<number, ProgressionState> {
    if (mode === "full" || !this.records) this.records = new Map();
    for (const [key, state] of Object.entries(changes ?? {}))
      this.records.set(Number(key), { wire: structuredClone(state) });
    const output: Record<number, ProgressionState> = {};
    for (const [id, record] of this.records) {
      // Idle and frozen records are stable; reuse their view. Running jobs count down.
      const idle = record.wire.frozenAt !== undefined ||
        record.wire.advancement === null && !Object.values(record.wire.research).some(job => job !== undefined);
      output[id] = idle ? (record.view ??= fromWireProgression(record.wire, tick)) : fromWireProgression(record.wire, tick);
    }
    return output;
  }
}
