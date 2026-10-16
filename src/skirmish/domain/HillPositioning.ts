import { FIXED, type Player, type Squad } from "../Protocol";
import { tilePoint } from "../SquadGeometry";
import { BUDGETS, POSITIONS } from "../content/TacticalRules";
import { combatCohorts } from "./AiCombatPower";
import type { AiRouteQuotes } from "./AiRouteQuotes";
import type { Army } from "./Definitions";
import { effectiveRange, heightModifier } from "./ElevationAdvantage";
import type { Expansion } from "./Expansion";
import { engagementEstimate } from "./TacticalEstimate";
import { scorePosition } from "./TacticalFeatureIndex";
export interface HillState {
  phase: "select" | "move" | "hold";
  featureId?: number;
  score?: number;
  committed?: number;
  nextEvaluation: number;
  origin: number;
  objective: number;
  candidates: number[];
  cursor: number;
  bestId?: number;
  bestScore?: number;
  previousKind?: string;
}
export interface HillMission {
  id: string;
  playerId: number;
  phase?: string;
  targetTile?: number;
  purpose?: string;
  kind?: "combat" | "hold-position" | "hold-trench";
  hill?: HillState;
  reason: string;
  desiredSquads?: number;
  screenNeeded?: number;
}
export function validateHillState(
  state: HillState | undefined,
  kind?: string,
): void {
  if (kind !== undefined && !["combat", "hold-position", "hold-trench"].includes(kind))
    throw Error("Invalid army mission kind");
  if (!state) {
    if (kind === "hold-position") throw Error("Missing hill mission state");
    return;
  }
  if (
    !["select", "move", "hold"].includes(state.phase) ||
    !Array.isArray(state.candidates) ||
    state.candidates.length > POSITIONS.maxCandidates ||
    new Set(state.candidates).size !== state.candidates.length ||
    state.candidates.some((id) => !Number.isSafeInteger(id) || id < 0) ||
    !Number.isSafeInteger(state.cursor) ||
    state.cursor < 0 ||
    state.cursor > state.candidates.length ||
    [state.origin, state.objective, state.nextEvaluation].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    ) ||
    [state.featureId, state.bestId, state.committed].some(
      (n) => n !== undefined && (!Number.isSafeInteger(n) || n < 0),
    ) ||
    [state.score, state.bestScore].some(
      (n) => n !== undefined && !Number.isFinite(n),
    ) ||
    (state.phase !== "select" && state.featureId === undefined) ||
    (state.phase === "hold" && state.committed === undefined)
  )
    throw Error("Invalid hill mission state");
}
export function meanHeightContext(
  expansion: Expansion,
  own: readonly Squad[],
  enemy: readonly Squad[],
) {
  const t = expansion.terrain;
  if (!t.hasHeight || !own.length || !enemy.length) return {};
  const mean = (s: readonly Squad[]) =>
    Math.floor(s.reduce((n, p) => n + t.height(p), 0) / s.length);
  const delta = mean(own) - mean(enemy);
  return {
    elevationBpA: heightModifier(delta).damageBp,
    elevationBpB: heightModifier(-delta).damageBp,
  };
}
/** Uses existing mission turns and exact route quotes; never owns movement. */
export class HillPositioning {
  work = 0;
  private tick = -1;
  constructor(
    private readonly e: Expansion,
    private readonly routes: AiRouteQuotes,
  ) {}
  beginTick(tick = this.e.world.tick) {
    if (tick !== this.tick) {
      this.work = 0;
      this.tick = tick;
    }
  }
  release(plan: HillMission, army?: Army, reason?: string) {
    for (const id of plan.hill?.candidates ?? [])
      this.routes.release(`${plan.id}:hill:${id}`);
    if (army) this.e.armies.setTerrainPosition(army.id, false);
    plan.hill = undefined;
    plan.kind = "combat";
    if (reason) plan.reason = reason;
  }
  step(
    plan: HillMission,
    player: Player,
    army: Army,
    members: Squad[],
    doctrine: string,
    order: (order: import("./Definitions").ArmyOrder) => boolean,
  ): boolean {
    const { world, features } = this.e,
      ranged = members.filter(
        (s) =>
          this.e.unit(s).attack.channel === "ranged" &&
          this.e.unit(s).attack.perSoldier,
      );
    if (plan.phase === "recover") return false;
    if (!features.ready || plan.targetTile === undefined || !ranged.length)
      return false;
    const front = members.filter((s) => this.e.unit(s).role === "frontline");
    if (front.length < 2) {
      plan.screenNeeded = 2 - front.length;
      plan.desiredSquads = Math.min(
        this.e.armies.capacity(player.id),
        (plan.desiredSquads ?? members.length) + 2 - front.length,
      );
      if (plan.hill)
        this.release(
          plan,
          army,
          "Hill rejected: requires two frontline screens",
        );
      return false;
    }
    plan.screenNeeded = 0;
    const enemies = world
      .nearbyArmyEnemies(army, 24 * FIXED, player.id)
      .filter(
        (s) =>
          !this.e.operations.enabled(player) ||
          this.e.operations.canTarget(player.id, s.playerId),
      );
    const threat = enemies.length
      ? {
          x: Math.round(enemies.reduce((n, s) => n + s.x, 0) / enemies.length),
          y: Math.round(enemies.reduce((n, s) => n + s.y, 0) / enemies.length),
        }
      : tilePoint(world.map, plan.targetTile);
    let state = plan.hill;
    if (state?.featureId !== undefined) {
      const feature = features.hills.find((f) => f.id === state!.featureId);
      if (!feature) {
        this.release(plan, army, "Hill disappeared from the terrain index");
        return false;
      }
      const owner = world.owners[feature.rearTile];
      const flank = enemies.filter((s) => {
        const angle = Math.atan2(s.y - army.y, s.x - army.x) - army.facing;
        return (
          Math.cos(angle) < 0.5 &&
          (s.x - army.x) ** 2 + (s.y - army.y) ** 2 < (10 * FIXED) ** 2
        );
      });
      if (
        (owner && world.hostile(player.id, owner)) ||
        this.e.fortifications.blocked(feature.rearTile, player.id) ||
        (flank.length &&
          engagementEstimate(
            combatCohorts(this.e, members),
            combatCohorts(this.e, flank),
            meanHeightContext(this.e, members, flank),
          ).advantage < 0.8)
      ) {
        this.release(
          plan,
          army,
          "Hill released: rear access lost or dangerous flank",
        );
        plan.phase = "recover";
        order({ type: "regroup", tile: player.base });
        return true;
      }
      if (state.phase === "move") {
        if (army.state === "blocked") {
          this.release(plan, army, "Hill route blocked");
          plan.phase = "recover";
          order({ type: "regroup", tile: player.base });
          return true;
        }
        if (
          world.map.euclideanDistSquared(world.tileOf(army), feature.tile) <=
            4 &&
          members.every((s) => !s.moved)
        ) {
          const bearing = Math.atan2(threat.y - army.y, threat.x - army.x),
            delta = Math.atan2(
              Math.sin(bearing - feature.facing),
              Math.cos(bearing - feature.facing),
            );
          const facing =
            Math.abs(delta) <= Math.PI / 4 ? bearing : feature.facing;
          world.applyCommand({
            type: "army-posture",
            playerId: player.id,
            armyId: army.id,
            posture: "defend",
          });
          this.e.armies.setTerrainPosition(army.id, true);
          if (order({ type: "deploy", tile: feature.tile, facing })) {
            state.phase = "hold";
            state.committed = world.tick;
            state.nextEvaluation = world.tick + POSITIONS.minCommitTicks;
            plan.reason = "Holding screened ranged troops on the crest";
          }
        }
        return true;
      }
      if (state.phase === "hold" && world.tick < state.nextEvaluation)
        return true;
    }
    if (!state) {
      if (plan.purpose !== "defense" && plan.purpose !== "combat") return false;
      if (plan.purpose === "defense" && ranged.length / members.length < 0.25)
        return false;
      const candidates = features.near(
        plan.purpose === "defense" ? plan.targetTile : world.tileOf(army),
        plan.purpose === "defense" ? 24 : 12,
      );
      if (!candidates.length) return false;
      state = plan.hill = {
        phase: "select",
        nextEvaluation: world.tick,
        origin: world.tileOf(army),
        objective: plan.targetTile,
        candidates: candidates.map((f) => f.id),
        cursor: 0,
      };
    } else if (
      state.phase === "hold" &&
      state.cursor >= state.candidates.length
    ) {
      state.candidates = features.near(plan.targetTile).map((f) => f.id);
      state.cursor = 0;
      state.bestId = undefined;
      state.bestScore = undefined;
      state.origin = world.tileOf(army);
      state.objective = plan.targetTile;
    }
    const frontWidth = Math.max(
      FIXED,
      ...(army.slots ?? [])
        .filter((s) => s.role === "frontline")
        .map((s) => Math.abs(s.lateral) * 2 + s.width),
    );
    while (
      state.cursor < state.candidates.length &&
      this.work < BUDGETS.positionScore
    ) {
      const id = state.candidates[state.cursor],
        f = features.hills.find((f) => f.id === id);
      this.work++;
      if (!f) {
        state.cursor++;
        continue;
      }
      const rearOwner = world.owners[f.rearTile];
      if (
        (rearOwner && world.hostile(player.id, rearOwner)) ||
        this.e.fortifications.blocked(f.rearTile, player.id)
      ) {
        state.cursor++;
        continue;
      }
      const quote = this.routes.request(
        `${plan.id}:hill:${id}`,
        player.id,
        state.origin,
        f.tile,
      );
      if (quote.pending)
        return state.phase === "hold" || state.phase === "move";
      state.cursor++;
      const value = scorePosition(features, f, {
        objectiveTile: state.objective,
        threatCentroid: threat,
        threatStrength: enemies.length,
        army: {
          frontWidth,
          maxRangedRange: Math.max(
            ...ranged.map((s) => this.e.unit(s).attack.range),
          ),
          component: world.paths.component[state.origin],
        },
        ownTerritory: (t) => world.owners[t] === player.id,
        routeLength: () => quote.path?.length,
        rangeAt: (from, to) =>
          Math.max(
            ...ranged.map((s) =>
              effectiveRange(world, from, this.e.unit(s).attack, to),
            ),
          ),
      });
      if (!Number.isFinite(value)) continue;
      if (plan.purpose !== "defense" && state.phase === "select") {
        if (!enemies.length) continue;
        const current = engagementEstimate(
          combatCohorts(this.e, members),
          combatCohorts(this.e, enemies),
          meanHeightContext(this.e, members, enemies),
        );
        const shifted = members.map((s) => ({
          ...s,
          ...tilePoint(world.map, f.tile),
        }));
        const elevated = engagementEstimate(
          combatCohorts(this.e, shifted),
          combatCohorts(this.e, enemies),
          meanHeightContext(this.e, shifted, enemies),
        );
        if (elevated.advantage < current.advantage * POSITIONS.offensiveHillGain) continue;
      }
      const weighted = Math.round(
        value *
          (["warden", "builder", "scholar"].includes(doctrine)
            ? 1.5
            : ["conqueror", "rider"].includes(doctrine)
              ? 0.7
              : 1),
      );
      if (state.bestScore === undefined || weighted > state.bestScore) {
        state.bestId = id;
        state.bestScore = weighted;
      }
    }
    if (state.cursor < state.candidates.length) return state.phase === "hold";
    for (const id of state.candidates)
      this.routes.release(`${plan.id}:hill:${id}`);
    const best = features.hills.find((f) => f.id === state!.bestId);
    if (state.phase === "hold") {
      const bearing = Math.atan2(threat.y - army.y, threat.x - army.x),
        turned =
          Math.abs(
            Math.atan2(
              Math.sin(bearing - army.facing),
              Math.cos(bearing - army.facing),
            ),
          ) >
          Math.PI / 3;
      if (
        !best ||
        (!turned &&
          (best.id === state.featureId ||
            (state.bestScore ?? 0) <
              (state.score ?? 0) +
                Math.max(1, Math.abs(state.score ?? 0) * 0.25)))
      ) {
        state.nextEvaluation = world.tick + POSITIONS.reevaluateTicks;
        return true;
      }
    }
    if (!best) {
      this.release(
        plan,
        army,
        "No reachable, screened hill improves this objective",
      );
      return false;
    }
    if (order({ type: "move", tile: best.tile })) {
      state.featureId = best.id;
      state.score = state.bestScore;
      state.phase = "move";
      plan.kind = "hold-position";
      plan.reason = "Taking a certified hill position";
      return true;
    }
    this.release(plan, army, "Hill movement admission rejected");
    return false;
  }
}
