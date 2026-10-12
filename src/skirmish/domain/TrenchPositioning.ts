import { type Player, type Squad } from "../Protocol";
import { BUDGETS, POSITIONS } from "../content/TacticalRules";
import type { Army } from "./Definitions";
import type { Expansion } from "./Expansion";
export interface TrenchMissionState {
  segments: string[];
  objective: number;
  committed: number;
  cursor: number;
  phase: "occupy" | "hold";
}
export interface TrenchMission {
  kind?: "combat" | "hold-position" | "hold-trench";
  hill?: unknown;
  trench?: TrenchMissionState;
  purpose?: string;
  targetTile?: number;
  reason: string;
  phase: string;
}
export function validateTrenchMission(
  value: TrenchMissionState | undefined,
): void {
  if (value === undefined) return;
  if (
    !value ||
    !Array.isArray(value.segments) ||
    value.segments.length > 32 ||
    new Set(value.segments).size !== value.segments.length ||
    value.segments.some(
      (k) => typeof k !== "string" || !/^b:\d+$|^r:\d+:\d+$/.test(k),
    ) ||
    ![value.objective, value.committed, value.cursor].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    !["occupy", "hold"].includes(value.phase)
  )
    throw new Error("Invalid trench mission");
}
/** Defence missions reuse real trenches and the same whole-squad admission. */
export class TrenchPositioning {
  constructor(private readonly e: Expansion) {}
  release(plan: TrenchMission, members: Squad[]): void {
    if (!plan.trench) return;
    for (const s of members) this.e.trenches.leave(s.id);
    plan.trench = undefined;
    plan.kind = "combat";
  }
  step(
    plan: TrenchMission,
    player: Player,
    army: Army,
    members: Squad[],
  ): boolean {
    const e = this.e,
      w = e.world;
    if (
      player.kind === "tribe" ||
      plan.purpose !== "defense" ||
      plan.targetTile === undefined
    )
      return false;
    e.trenches.rebuild();
    let state = plan.trench;
    if (state) {
      if (
        state.segments.some(
          (k) => e.trenches.segments.get(k)?.ownerId !== player.id,
        )
      ) {
        this.release(plan, members);
        plan.phase = "recover";
        plan.reason = "Trench lost; regrouping survivors";
        return false;
      }
      if (
        w.tick - state.committed >= POSITIONS.minCommitTicks &&
        w.map.euclideanDistSquared(state.objective, plan.targetTile) > 16 ** 2
      ) {
        this.release(plan, members);
        return false;
      }
    } else {
      const segments = [...e.trenches.segments.values()]
        .filter(
          (s) =>
            s.ownerId === player.id &&
            s.tiles.some(
              (t) => w.map.euclideanDistSquared(t, plan.targetTile!) <= 16 ** 2,
            ),
        )
        .sort(
          (a, b) =>
            w.map.euclideanDistSquared(a.tiles[0], plan.targetTile!) -
              w.map.euclideanDistSquared(b.tiles[0], plan.targetTile!) ||
            a.key.localeCompare(b.key),
        )
        .slice(0, 32);
      if (!segments.length) return false;
      if (
        !members.some(
          (s) =>
            e.trenches.eligible(s) &&
            segments.some((segment) => e.trenches.canFit(s, segment.tiles[0])),
        )
      )
        return false;
      state = plan.trench = {
        segments: segments.map((s) => s.key),
        objective: plan.targetTile,
        committed: w.tick,
        cursor: 0,
        phase: "occupy",
      };
      plan.kind = "hold-trench";
      army.posture = "defend";
    }
    const eligible = members.filter(
      (s) => e.trenches.eligible(s) || e.trenches.occupants.has(s.id),
    );
    for (
      let work = 0;
      work < Math.min(BUDGETS.trenchAdmission, eligible.length);
      work++
    ) {
      const s = eligible[state.cursor++ % eligible.length];
      if (e.trenches.occupants.has(s.id)) continue;
      const segment = state.segments
        .map((k) => e.trenches.segments.get(k)!)
        .find((segment) => e.trenches.canFit(s, segment.tiles[0]));
      if (segment)
        w.applyCommand({
          type: "occupy",
          playerId: player.id,
          squadIds: [s.id],
          tile: segment.tiles[0],
        });
    }
    const occupied = members.filter(
      (s) => e.trenches.occupants.get(s.id)?.phase === "occupying",
    ).length;
    state.phase = occupied ? "hold" : "occupy";
    plan.phase = "engage";
    plan.reason = `Holding trenches: ${occupied}/${members.length} formations occupying`;
    return true;
  }
}
