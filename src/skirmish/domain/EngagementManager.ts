import { meanHeightContext } from "./HillPositioning";
import { effectiveRange } from "./ElevationAdvantage";
import { FIXED, type Squad } from "../Protocol";
import type { ExactRouteOutcome } from "../RoutePlanner";
import { distanceSquared, pointTile, tilePoint } from "../SquadGeometry";
import { AI_BATTLE, BUDGETS, ENGAGEMENT } from "../content/TacticalRules";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import { combatCohorts } from "./AiCombatPower";
import { flankCandidate } from "./AiTacticalRoutes";
import { attackContributors, damageAmount, defenceOf } from "./Combat";
import type { Army, ArmySlotRecord } from "./Definitions";
import type { DomainRouteTask } from "./DomainRoutePorts";
import type { Expansion } from "./Expansion";
import { formationContact } from "./FormationContact";
import { facingArc } from "./FormationFacing";
import { formationEnvelope } from "./FormationGeometry";
import { HEALTH_SCALE, remainingHealth } from "./Manpower";
import { engagementEstimate } from "./TacticalEstimate";

export interface Engagement {
  id: number;
  armyIds: number[];
  looseSquadIds: number[];
  axis: { x: number; y: number };
  centre: { x: number; y: number };
  revision: number;
  plannedRevision: number;
  nextPlanTick: number;
  createdTick: number;
  lastContactTick: number;
  soldiers: number;
  slotSignature: string;
}
export interface EngagementPlan {
  engagementId: number;
  armyId: number;
  revision: number;
  assignments: {
    squadId: number;
    targetId: number | null;
    leashTiles: number;
  }[];
  reserveCommit?: { squadId: number; slotIndex: number };
  posture: "advance" | "hold" | "withdraw";
}
export interface WingPlan {
  armyId: number;
  playerId: number;
  side: "left" | "right";
  phase: "hold" | "route" | "strike";
  targetId?: number;
  via?: number;
  path?: number[];
  requested: boolean;
  candidate: number;
  failures: number;
  initialHealth: number;
  generation: number;
  obstacles: string;
  leaderId: number;
  start: number;
  tick: number;
  epoch: number;
}
interface PlanningJob {
  axis: { x: number; y: number };
  engagementId: number;
  revision: number;
  armyIds: number[];
  armyCursor: number;
  squadCursor: number;
  candidateCursor: number;
  enemyIds: number[];
  projections: number[];
  memberIds: number[];
  assignments: EngagementPlan["assignments"];
  weakest?: { slotIndex: number; advantage: number; lateral: number };
  candidates: number[];
  best?: { id: number; score: number; distance: number };
  usage: [number, number][];
}
interface PostureState {
  posture: EngagementPlan["posture"];
  since: number;
  weakPlans: number;
  /** Latest local strength estimate (own / enemy). */
  advantage?: number;
}
const legal = (s: Squad | undefined): s is Squad =>
  !!s && s.troops > 0 && s.embarkedOn === null && !s.afloat;
const roleLeash = (s: ArmySlotRecord) =>
  s.role === "frontline"
    ? ENGAGEMENT.frontLeash
    : s.role === "ranged"
      ? ENGAGEMENT.rangedLeash
      : 0;
/** L3 publishes plans only. Armies owns commands and the shared router owns path work. */
export class EngagementManager {
  readonly engagements = new Map<number, Engagement>();
  private readonly plans = new Map<number, EngagementPlan>();
  private readonly jobs = new Map<number, PlanningJob>();
  private readonly wings = new Map<string, WingPlan>();
  private readonly postures = new Map<number, PostureState>();
  private readonly membership = new Map<number, number>();
  private nextId = 1;
  private detectCursor = 0;
  readonly diagnostics = { detected: 0, planned: 0, completed: 0 };
  constructor(private readonly expansion: Expansion) {}
  checkpoint() {
    return structuredClone({
      engagements: [...this.engagements],
      plans: [...this.plans],
      jobs: [...this.jobs],
      wings: [...this.wings],
      postures: [...this.postures],
      nextId: this.nextId,
      detectCursor: this.detectCursor,
    });
  }
  restore(saved: ReturnType<EngagementManager["checkpoint"]>): void {
    if (
      !saved ||
      !Number.isSafeInteger(saved.nextId) ||
      saved.nextId < 1 ||
      !Number.isSafeInteger(saved.detectCursor) ||
      saved.detectCursor < 0
    )
      throw Error("Invalid engagement checkpoint");
    for (const [id, e] of saved.engagements) {
      if (
        id !== e.id ||
        !Number.isSafeInteger(id) ||
        id < 1 ||
        e.armyIds.length > ENGAGEMENT.maxArmies ||
        new Set(e.armyIds).size !== e.armyIds.length ||
        e.looseSquadIds.length > ENGAGEMENT.maxLooseSquads ||
        [
          ...e.armyIds,
          ...e.looseSquadIds,
          e.revision,
          e.plannedRevision,
          e.nextPlanTick,
          e.createdTick,
          e.lastContactTick,
        ].some((n) => !Number.isSafeInteger(n) || n < 0) ||
        [e.axis.x, e.axis.y, e.centre.x, e.centre.y, e.soldiers].some(
          (n) => !Number.isFinite(n),
        )
      )
        throw Error("Invalid engagement record");
    }
    for (const [id, p] of saved.plans)
      if (
        id !== p.armyId ||
        p.assignments.length > 60 ||
        !["advance", "hold", "withdraw"].includes(p.posture) ||
        p.assignments.some(
          (a) =>
            !Number.isSafeInteger(a.squadId) ||
            a.squadId < 0 ||
            (a.targetId !== null &&
              (!Number.isSafeInteger(a.targetId) || a.targetId < 0)) ||
            !Number.isFinite(a.leashTiles) ||
            a.leashTiles < 0 ||
            a.leashTiles > 16,
        )
      )
        throw Error("Invalid engagement plan");
    for (const [, j] of saved.jobs)
      if (
        j.armyIds.length > ENGAGEMENT.maxArmies ||
        j.enemyIds.length >
          ENGAGEMENT.maxArmies * 60 + ENGAGEMENT.maxLooseSquads ||
        j.memberIds.length > 60 ||
        j.candidates.length > 12 ||
        [j.axis.x, j.axis.y].some((n) => !Number.isFinite(n)) ||
        j.projections.length !== j.enemyIds.length ||
        j.projections.some((p) => !Number.isSafeInteger(p)) ||
        [j.armyCursor, j.squadCursor, j.candidateCursor].some(
          (n) => !Number.isSafeInteger(n) || n < 0,
        )
      )
        throw Error("Invalid engagement planning cursor");
    for (const [, w] of saved.wings)
      if (
        !["hold", "route", "strike"].includes(w.phase) ||
        !["left", "right"].includes(w.side) ||
        w.candidate < 0 ||
        w.candidate > ENGAGEMENT.wingCandidates ||
        w.failures < 0 ||
        w.failures > 2 ||
        (w.path &&
          w.path.some(
            (t) =>
              !Number.isSafeInteger(t) ||
              t < 0 ||
              t >=
                this.expansion.world.map.width() *
                  this.expansion.world.map.height(),
          ))
      )
        throw Error("Invalid engagement wing");
    for (const [id, p] of saved.postures)
      if (
        !Number.isSafeInteger(id) ||
        id < 1 ||
        !["advance", "hold", "withdraw"].includes(p.posture) ||
        [p.since, p.weakPlans].some((n) => !Number.isSafeInteger(n) || n < 0) ||
        (p.advantage !== undefined && (!Number.isFinite(p.advantage) || p.advantage < 0))
      )
        throw Error("Invalid engagement posture");
    for (const [target, rows] of [
      [this.engagements, saved.engagements],
      [this.plans, saved.plans],
      [this.jobs, saved.jobs],
      [this.wings, saved.wings],
      [this.postures, saved.postures],
    ] as const) {
      target.clear();
      for (const [id, row] of structuredClone(rows))
        (target as Map<unknown, unknown>).set(id, row);
    }
    this.nextId = saved.nextId;
    this.detectCursor = saved.detectCursor;
    this.reindex();
  }
  private reindex() {
    this.membership.clear();
    for (const e of this.engagements.values())
      for (const id of e.armyIds) this.membership.set(id, e.id);
  }
  /** Latest local strength estimate for an army, if it is in an engagement. */
  advantageFor(id: number): number | undefined {
    return this.postures.get(id)?.advantage;
  }
  planFor(id: number): EngagementPlan | undefined {
    const p = this.plans.get(id),
      e = p && this.engagements.get(p.engagementId);
    return e && p!.revision >= e.revision - 1 ? p : undefined;
  }
  wingFor(id: number, side: "left" | "right") {
    return this.wings.get(`${id}:${side}`);
  }
  invalidate(id: number) {
    const e = this.engagements.get(this.membership.get(id) ?? -1);
    if (e) {
      e.revision++;
      e.nextPlanTick = Math.min(e.nextPlanTick, this.expansion.world.tick);
      this.jobs.delete(e.id);
    }
  }
  private army(id: number) {
    return this.expansion.armies.armies.find((a) => a.id === id);
  }
  private members(a: Army) {
    return a.memberIds
      .map((id) => this.expansion.world.squad(id))
      .filter(legal);
  }
  slotPoint(a: Army, r: ArmySlotRecord) {
    const occupant=this.expansion.world.squad(r.squadId);if(occupant?.occupancy?.phase==='occupying')return {x:occupant.x,y:occupant.y};
    return {
      x: Math.round(
        a.x + Math.cos(a.facing) * r.depth - Math.sin(a.facing) * r.lateral,
      ),
      y: Math.round(
        a.y + Math.sin(a.facing) * r.depth + Math.cos(a.facing) * r.lateral,
      ),
    };
  }
  private detect(a: Army): void {
    const { world, armies } = this.expansion,
      members = this.members(a);
    if (!members.length) return;
    const radius = Math.max(
      ...members.map(
        (s) =>
          Math.sqrt(distanceSquared(a, s)) +
          formationEnvelope(s, world.tick).broadRadius,
      ),
    );
    const nearby = world
      .nearbyArmyEnemies(a, ENGAGEMENT.joinTiles * FIXED + radius, a.playerId)
      .filter(legal);
    // Conservative army broad phase; exact slot contact is checked only by budgeted matching.
    const hostile = nearby.filter(
      (s) =>
        distanceSquared(a, s) <=
        (radius +
          ENGAGEMENT.joinTiles * FIXED +
          formationEnvelope(s, world.tick).broadRadius) **
          2,
    );
    if (!hostile.length) return;
    const ids = [
      ...new Set([
        a.id,
        ...hostile
          .map((s) => armies.armyOf(s.id)?.id)
          .filter((id): id is number => id !== undefined),
      ]),
    ].sort((x, y) => x - y);
    const matches = [...this.engagements.values()]
      .map((e) => ({
        e,
        shared: e.armyIds.filter((id) => ids.includes(id)).length,
      }))
      .filter((m) => m.shared > 0)
      .sort((x, y) => y.shared - x.shared || x.e.id - y.e.id);
    let e =
      matches.find((m) => m.e.armyIds.includes(a.id))?.e ??
      matches.find((m) => m.e.armyIds.length < ENGAGEMENT.maxArmies)?.e;
    if (!e) {
      e = {
        id: this.nextId++,
        armyIds: [],
        looseSquadIds: [],
        axis: { x: 1, y: 0 },
        centre: { x: a.x, y: a.y },
        revision: 0,
        plannedRevision: 0,
        nextPlanTick: world.tick,
        createdTick: world.tick,
        lastContactTick: world.tick,
        soldiers: 0,
        slotSignature: "",
      };
      this.engagements.set(e.id, e);
    }
    // Connected components retain the strongest overlap's identity. Cap before merging.
    const joined = [
      ...new Set([
        ...e.armyIds,
        a.id,
        ...ids.filter(
          (id) => !this.membership.has(id) || this.membership.get(id) === e!.id,
        ),
      ]),
    ]
      .filter((id) => !!this.army(id))
      .slice(0, ENGAGEMENT.maxArmies);
    for (const { e: other } of matches.filter((m) => m.e.id !== e!.id)) {
      // Records can outlive disbanded armies. Reconcile the merge source too,
      // before capacity checks or publishing membership for geometry/planning.
      const liveIds = other.armyIds.filter((id) => !!this.army(id));
      if (
        [...new Set([...joined, ...liveIds])].length <=
        ENGAGEMENT.maxArmies
      ) {
        joined.push(...liveIds.filter((id) => !joined.includes(id)));
        this.engagements.delete(other.id);
        this.jobs.delete(other.id);
      }
    }
    joined.sort((x, y) => x - y);
    const loose = [
      ...new Set([
        ...e.looseSquadIds,
        ...hostile.filter((s) => !armies.armyOf(s.id)).map((s) => s.id),
      ]),
    ]
      .filter((id) => {
        const s = world.squad(id);
        return (
          legal(s) &&
          distanceSquared(a, s) <=
            (radius +
              ENGAGEMENT.joinTiles * FIXED +
              formationEnvelope(s, world.tick).broadRadius) **
              2
        );
      })
      .sort((x, y) => x - y)
      .slice(0, ENGAGEMENT.maxLooseSquads);
    const changed =
      joined.join() !== e.armyIds.join() ||
      loose.join() !== e.looseSquadIds.join();
    e.armyIds = joined;
    e.looseSquadIds = loose;
    e.lastContactTick = world.tick;
    const bodies = joined.map((id) => this.army(id)!),
      side = bodies.filter((b) => !world.hostile(a.playerId, b.playerId)),
      other = bodies.filter((b) => world.hostile(a.playerId, b.playerId));
    const centroid = (rows: Army[]) => ({
        x: rows.reduce((n, b) => n + b.x, 0) / Math.max(1, rows.length),
        y: rows.reduce((n, b) => n + b.y, 0) / Math.max(1, rows.length),
      }),
      left = centroid(side),
      right = other.length ? centroid(other) : hostile[0];
    const dx = right.x - left.x,
      dy = right.y - left.y,
      length = Math.hypot(dx, dy) || 1;
    // Stable canonical side prevents detection from reversing the same axis.
    const sign = side.some((b) => b.id === Math.min(...joined)) ? 1 : -1;
    e.axis = {
      x: (Math.round((dx / length) * 1024) * sign) / 1024,
      y: (Math.round((dy / length) * 1024) * sign) / 1024,
    };
    e.centre = {
      x: Math.round((left.x + right.x) / 2),
      y: Math.round((left.y + right.y) / 2),
    };
    const soldiers = bodies.reduce(
        (n, b) => n + this.members(b).reduce((sum, s) => sum + s.troops, 0),
        0,
      ),
      signature = bodies.map((b) => `${b.id}:${b.slotRevision ?? 0}`).join(";");
    if (
      changed ||
      signature !== e.slotSignature ||
      (e.soldiers > 0 &&
        soldiers <= e.soldiers * (1 - ENGAGEMENT.replanLossPct))
    ) {
      e.revision++;
      e.nextPlanTick = world.tick;
      this.jobs.delete(e.id);
      e.soldiers = soldiers;
      e.slotSignature = signature;
    }
    this.reindex();
  }
  step(): number {
    const { world, armies } = this.expansion;
    this.diagnostics.detected = this.diagnostics.planned = 0;
    const all = armies.armies;
    for (let n = 0; n < Math.min(BUDGETS.engagementDetect, all.length); n++) {
      this.detect(all[this.detectCursor++ % all.length]);
      this.diagnostics.detected++;
    }
    const live = new Set(all.map((a) => a.id));
    for (const e of [...this.engagements.values()])
      if (
        world.tick - e.lastContactTick > ENGAGEMENT.idleTicks ||
        e.armyIds.every((id) => !live.has(id))
      ) {
        this.engagements.delete(e.id);
        this.jobs.delete(e.id);
        for (const id of e.armyIds) this.plans.delete(id);
      }
    for (const id of this.plans.keys())
      if (
        !live.has(id) ||
        !this.engagements.has(this.plans.get(id)!.engagementId)
      )
        this.plans.delete(id);
    for (const id of this.postures.keys())
      if (!live.has(id)) this.postures.delete(id);
    for (const [key, w] of [...this.wings])
      if (!live.has(w.armyId) || !this.membership.has(w.armyId)) {
        this.cancelWing(w);
        this.wings.delete(key);
      }
    const priority = (e: Engagement) =>
      Number(
        e.armyIds.some(
          (id) =>
            !world.players.find((p) => p.id === this.army(id)?.playerId)?.ai,
        ),
      ) *
        4 +
      Math.min(3, Math.floor(Math.log2(Math.max(1, e.armyIds.length))));
    const due = [...this.engagements.values()]
      .filter(
        (e) =>
          e.nextPlanTick <= world.tick &&
          (e.revision !== e.plannedRevision ||
            world.tick - e.nextPlanTick >= 0 ||
            this.jobs.has(e.id)),
      )
      .sort(
        (a, b) =>
          a.nextPlanTick - b.nextPlanTick ||
          priority(b) - priority(a) ||
          a.id - b.id,
      );
    for (const e of due) {
      if (this.diagnostics.planned >= BUDGETS.engagementPlan) break;
      const limit = Math.min(
        ENGAGEMENT.quantum,
        BUDGETS.engagementPlan - this.diagnostics.planned,
      );
      let used = 0;
      while (used < limit) {
        used++;
        if (this.planQuantum(e)) break;
      }
      this.diagnostics.planned += used;
      if (this.jobs.has(e.id)) e.nextPlanTick = world.tick + 1;
    }
    this.reindex();
    return this.diagnostics.detected + this.diagnostics.planned;
  }
  private startArmy(j: PlanningJob, a: Army, e: Engagement) {
    const { world } = this.expansion;
    j.memberIds = (a.slots ?? [])
      .filter((s) => s.role === "frontline" || s.role === "ranged")
      .sort((x, y) => x.lateral - y.lateral || x.index - y.index)
      .map((s) => s.squadId);
    j.enemyIds = [
      ...new Set([
        ...e.armyIds.flatMap((id) => {
          const b = this.army(id);
          return b && world.hostile(a.playerId, b.playerId) ? b.memberIds : [];
        }),
        ...e.looseSquadIds,
      ]),
    ]
      .filter((id) => {
        const s = world.squad(id);
        return (
          legal(s) &&
          world.hostile(a.playerId, s.playerId) &&
          (world.armyTargetAllowed?.(a.playerId, s.playerId) ?? true)
        );
      })
      .sort((x, y) => {
        const p = world.squad(x)!,
          q = world.squad(y)!;
        return (
          Math.round(
            ((p.x - q.x) * -j.axis.y + (p.y - q.y) * j.axis.x) * 1024,
          ) || x - y
        );
      });
    j.projections = j.enemyIds.map((id) => {
      const s = world.squad(id)!;
      return Math.round((s.x * -j.axis.y + s.y * j.axis.x) * 1024);
    });
    j.squadCursor = j.candidateCursor = 0;
    j.assignments = [];
    j.candidates = [];
    j.best = undefined;
    j.usage = [];
    j.weakest = undefined;
  }
  private planQuantum(e: Engagement): boolean {
    const { world } = this.expansion;
    let j = this.jobs.get(e.id);
    if (!j || j.revision !== e.revision) {
      j = {
        engagementId: e.id,
        revision: e.revision,
        axis: { ...e.axis },
        armyIds: [...e.armyIds],
        armyCursor: 0,
        squadCursor: 0,
        candidateCursor: 0,
        enemyIds: [],
        projections: [],
        memberIds: [],
        assignments: [],
        candidates: [],
        usage: [],
      };
      this.jobs.set(e.id, j);
    }
    const a = this.army(j.armyIds[j.armyCursor]);
    if (!a) {
      j.armyCursor++;
      if (j.armyCursor >= j.armyIds.length) return this.finishJob(e);
      return false;
    }
    if (!j.memberIds.length && !j.enemyIds.length) this.startArmy(j, a, e);
    if (j.squadCursor >= j.memberIds.length) {
      const enemies = j.enemyIds.map((id) => world.squad(id)).filter(legal),
        own = this.members(a),
        allies = e.armyIds.flatMap((id) => {
          const b = this.army(id);
          return b && !world.hostile(a.playerId, b.playerId)
            ? this.members(b)
            : [];
        }),
        estimate = engagementEstimate(
          combatCohorts(this.expansion, allies),
          combatCohorts(this.expansion, enemies),
          meanHeightContext(this.expansion,allies,enemies),
        );
      const previous = this.postures.get(a.id) ?? {
        posture: "hold" as const,
        since: world.tick,
        weakPlans: 0,
      };
      previous.weakPlans =
        estimate.advantage < ENGAGEMENT.withdrawBelow
          ? previous.weakPlans + 1
          : 0;
      const owner = world.players.find((p) => p.id === a.playerId), ai = !!owner?.ai;
      previous.advantage = Number.isFinite(estimate.advantage) ? estimate.advantage : 0;
      // T-b: a depleted AI army that is clearly winning keeps fighting.
      const collapse =
        own.reduce((n, s) => n + s.troops, 0) < (a.initialTroops ?? 1) * 0.55 &&
        !(ai && estimate.advantage >= AI_BATTLE.pressOnAdvantage);
      const advanceAbove = ai && owner ? AI_DOCTRINES[personalityOf(owner).id].advanceAbove : ENGAGEMENT.advanceAbove;
      if (
        world.tick - previous.since >= ENGAGEMENT.minPostureTicks ||
        collapse
      ) {
        const posture =
          ai && (previous.weakPlans >= 2 || collapse)
            ? "withdraw"
            : estimate.advantage >= advanceAbove &&
                a.posture !== "defend"
              ? "advance"
              : "hold";
        if (posture !== previous.posture) {
          previous.posture = posture;
          previous.since = world.tick;
        }
      }
      this.postures.set(a.id, previous);
      const reserve =
        j.weakest && j.weakest.advantage < 0.7
          ? (a.slots ?? [])
              .filter(
                (r) => r.role === "reserve" && legal(world.squad(r.squadId)),
              )
              .sort(
                (x, y) =>
                  Math.abs(x.lateral - j!.weakest!.lateral) -
                    Math.abs(y.lateral - j!.weakest!.lateral) ||
                  x.index - y.index,
              )[0]
          : undefined;
      this.plans.set(a.id, {
        engagementId: e.id,
        armyId: a.id,
        revision: e.revision,
        assignments: j.assignments,
        reserveCommit: reserve
          ? { squadId: reserve.squadId, slotIndex: j.weakest!.slotIndex }
          : undefined,
        posture: previous.posture,
      });
      this.planWings(a, enemies);
      j.armyCursor++;
      j.memberIds = [];
      j.enemyIds = [];
      if (j.armyCursor >= j.armyIds.length) return this.finishJob(e);
      return false;
    }
    const r = a.slots?.find((s) => s.squadId === j!.memberIds[j!.squadCursor]),
      s = r && world.squad(r.squadId);
    if (!r || !legal(s)) {
      j.squadCursor++;
      j.candidates = [];
      j.best = undefined;
      j.candidateCursor = 0;
      return false;
    }
    const slot = this.slotPoint(a, r),
      unit = this.expansion.unit(s),
      profile = unit.attack;
    if (!j.candidates.length) {
      const tangent = (p: { x: number; y: number }) =>
          Math.round((p.x * -j.axis.y + p.y * j.axis.x) * 1024),
        projection = tangent(slot);
      let lo = 0,
        hi = j.enemyIds.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (j.projections[mid] < projection) lo = mid + 1;
        else hi = mid;
      }
      // The shortlist is bounded before expensive geometry/damage tests.
      j.candidates = j.enemyIds.slice(
        Math.max(0, lo - 6),
        Math.min(j.enemyIds.length, lo + 6),
      );
      j.candidateCursor = 0;
      j.best = undefined;
      if (!j.candidates.length) {
        j.assignments.push({
          squadId: s.id,
          targetId: null,
          leashTiles: s.occupancy?.phase==='occupying'?0:roleLeash(r),
        });
        j.squadCursor++;
        return false;
      }
    }
    // One planning unit assigns one squad using at most twelve contact comparisons.
    while (j.candidateCursor < j.candidates.length) {
      const target = world.squad(j.candidates[j.candidateCursor++]);
      if (
        legal(target) &&
        profile.targets.some((t) =>
          this.expansion.unit(target).tags.includes(t),
        )
      ) {
        const used = new Map(j.usage),
          count = used.get(target.id) ?? 0,
          contact = formationContact({ ...s, ...slot }, target, world.tick),
          leash = s.occupancy?.phase==='occupying'?0:roleLeash(r);
        if (
          (r.role !== "frontline" || count < ENGAGEMENT.maxPerTarget) &&
          contact.gap <= effectiveRange(world,{...s,...slot},profile,target) + leash * FIXED
        ) {
          const targetUnit = this.expansion.unit(target),
            distance = Math.round(distanceSquared(slot, target)),
            side = Math.round(
              Math.abs(
                (slot.x - target.x) * -j.axis.y +
                  (slot.y - target.y) * j.axis.x,
              ),
            );
          const counter = targetUnit.tags.includes("mounted")
            ? (profile.bonuses.mounted ?? 0)
            : 0;
          const score =
            r.role === "ranged"
              ? Math.round(
                  (damageAmount(
                    profile,
                    defenceOf(targetUnit),
                    attackContributors(s, profile),
                    s.xp,
                  ) *
                    1024) /
                    Math.max(1, remainingHealth(target) / HEALTH_SCALE),
                )
              : Math.round((contact.frontage + counter * FIXED - side) * 1024);
          if (
            !j.best ||
            score > j.best.score ||
            (score === j.best.score &&
              (distance < j.best.distance ||
                (distance === j.best.distance && target.id < j.best.id)))
          )
            j.best = { id: target.id, score, distance };
        }
      }
    }
    if (j.candidateCursor >= j.candidates.length) {
      const id = j.best?.id ?? null;
      j.assignments.push({
        squadId: s.id,
        targetId: id,
        leashTiles: roleLeash(r),
      });
      if (id !== null && r.role === "frontline") {
        const opponent = world.squad(id);
        if (legal(opponent)) {
          const advantage = engagementEstimate(
            combatCohorts(this.expansion, [s]),
            combatCohorts(this.expansion, [opponent]),
            meanHeightContext(this.expansion,[s],[opponent]),
          ).advantage;
          if (!j.weakest || advantage < j.weakest.advantage)
            j.weakest = { slotIndex: r.index, advantage, lateral: r.lateral };
        }
        const used = new Map(j.usage);
        used.set(id, (used.get(id) ?? 0) + 1);
        j.usage = [...used];
      }
      j.squadCursor++;
      j.candidates = [];
      j.best = undefined;
      j.candidateCursor = 0;
    }
    return false;
  }
  private finishJob(e: Engagement) {
    this.jobs.delete(e.id);
    e.plannedRevision = e.revision;
    e.nextPlanTick = this.expansion.world.tick + ENGAGEMENT.refreshTicks;
    this.diagnostics.completed++;
    return true;
  }
  private planWings(a: Army, enemies: Squad[]): void {
    const { world } = this.expansion;
    for (const side of (a.wingPreference === "right"
      ? ["right", "left"]
      : ["left", "right"]) as ("left" | "right")[]) {
      const ids = (a.slots ?? [])
          .filter((r) => r.role === `mounted-${side}`)
          .map((r) => r.squadId),
        members = ids.map((id) => world.squad(id)).filter(legal);
      if (!members.length) continue;
      const health = members.reduce(
          (n, s) => n + remainingHealth(s) / HEALTH_SCALE,
          0,
        ),
        key = `${a.id}:${side}`;
      let w = this.wings.get(key);
      if (!w) {
        const leader = members[0];
        w = {
          armyId: a.id,
          playerId: a.playerId,
          side,
          phase: "hold",
          candidate: 0,
          failures: 0,
          initialHealth: health,
          generation: world.domainRoutes?.generation(a.playerId) ?? 0,
          obstacles: world.domainRoutes?.revision(a.playerId, "army") ?? "",
          leaderId: leader.id,
          start: pointTile(world.map, leader),
          tick: world.tick,
          epoch: 0,
          requested: false,
        };
        this.wings.set(key, w);
      }
      if (
        health < w.initialHealth * 0.6 ||
        enemies
          .filter(
            (s) =>
              this.expansion.unit(s).tags.includes("mounted") &&
              members.some((m) => distanceSquared(m, s) < (8 * FIXED) ** 2),
          )
          .reduce((n, s) => n + remainingHealth(s) / HEALTH_SCALE, 0) >= health
      ) {
        this.cancelWing(w);
        w.phase = "hold";
        w.failures = 2;
        continue;
      }
      const fronts = (a.slots ?? [])
          .filter((r) => r.role === "frontline")
          .map((r) => world.squad(r.squadId))
          .filter(legal),
        inContact =
          fronts.filter((s) => s.fighting).length >=
          Math.max(1, Math.ceil(fronts.length * 0.5));
      const projection = (s: Squad) =>
        Math.round(
          (s.x * -Math.sin(a.facing) + s.y * Math.cos(a.facing)) * 1024,
        );
      const target = enemies
        .filter((s) => !this.expansion.unit(s).tags.includes("mounted"))
        .sort(
          (x, y) =>
            (side === "left" ? 1 : -1) * (projection(x) - projection(y)) ||
            x.id - y.id,
        )[0];
      if (!target) continue;
      if (
        w.requested &&
        world.domainRoutes &&
        (w.generation !== world.domainRoutes.generation(a.playerId) ||
          w.obstacles !== world.domainRoutes.revision(a.playerId, "army") ||
          !ids.includes(w.leaderId))
      ) {
        this.cancelWing(w);
        w.leaderId = members[0].id;
        w.start = pointTile(world.map, members[0]);
      }
      const leader = world.squad(w.leaderId) ?? members[0],
        close = Math.sqrt(distanceSquared(leader, target)) / FIXED;
      const reload =
        target.weaponState?.ranged?.reloadStartedTick !== undefined &&
        target.weaponState.ranged.nextTick > world.tick;
      if (
        (w.phase === "route" &&
          w.via !== undefined &&
          distanceSquared(leader, tilePoint(world.map, w.via)) <=
            (4 * FIXED) ** 2 &&
          facingArc(target, leader, world.tick) !== "front") ||
        (close <= 6 && (target.formation?.shape === "column" || reload))
      ) {
        this.cancelWing(w);
        w.phase = "strike";
        w.targetId = target.id;
        continue;
      }
      if (w.phase === "strike") {
        if (!legal(world.squad(w.targetId ?? -1))) {
          w.phase = "hold";
          w.candidate = 0;
          w.failures = 0;
        }
        continue;
      }
      if (
        w.phase === "hold" &&
        (inContact ||
          !enemies.some((s) =>
            this.expansion.unit(s).tags.includes("mounted"),
          )) &&
        w.failures < 2
      ) {
        w.phase = "route";
        w.targetId = target.id;
        w.start = pointTile(world.map, leader);
        w.tick = world.tick;
      }
      if (
        w.phase === "route" &&
        !w.requested &&
        !w.path &&
        w.candidate < ENGAGEMENT.wingCandidates
      ) {
        const tile = flankCandidate(
          world.map,
          leader,
          target,
          w.candidate++,
          side === "left" ? -1 : 1,
        );
        if (
          tile === undefined ||
          world.armyBlocked(tile, a.playerId) ||
          !world.squadPaths(a.playerId).walkable(tile)
        )
          continue;
        w.via = tile;
        const routes = world.domainRoutes;
        if (routes) {
          w.generation = routes.generation(a.playerId);
          w.obstacles = routes.revision(a.playerId, "army");
          w.epoch++;
          w.requested = routes.request(this.wingTask(w), w.start, tile);
        } else {
          const path = world
            .squadPaths(a.playerId)
            .find(w.start, tile, (t) => world.armyBlocked(t, a.playerId));
          if (path) w.path = path;
        }
      }
      if (w.candidate >= ENGAGEMENT.wingCandidates && !w.path && !w.requested) {
        w.failures++;
        w.candidate = 0;
        w.phase = "hold";
      }
    }
  }
  private wingTask(w: WingPlan): DomainRouteTask {
    return {
      kind: "domain",
      owner: "army",
      playerId: w.playerId,
      admissionId: w.armyId,
      memberId: w.leaderId,
      stage: `engagement-wing-${w.side}`,
      generation: w.generation,
      epoch: w.epoch,
    };
  }
  private cancelWing(w: WingPlan) {
    if (w.requested)
      this.expansion.world.domainRoutes?.cancel(this.wingTask(w));
    w.requested = false;
    w.path = undefined;
  }
  validRoute(t: DomainRouteTask) {
    const w = this.wings.get(
        `${t.admissionId}:${t.stage.endsWith("left") ? "left" : "right"}`,
      ),
      a = w && this.army(w.armyId),
      routes = this.expansion.world.domainRoutes;
    return (
      !!w &&
      !!a &&
      !!routes &&
      w.requested &&
      w.phase === "route" &&
      w.epoch === t.epoch &&
      routes.generation(a.playerId) === w.generation &&
      routes.revision(a.playerId, "army") === w.obstacles &&
      a.memberIds.includes(t.memberId)
    );
  }
  completedRoute(
    t: DomainRouteTask,
    outcome: ExactRouteOutcome,
    path: number[],
  ) {
    if (!this.validRoute(t)) return;
    const w = this.wings.get(
      `${t.admissionId}:${t.stage.endsWith("left") ? "left" : "right"}`,
    )!;
    w.requested = false;
    if (outcome === "complete") {
      w.path = path;
      this.invalidate(w.armyId);
    } else {
      w.path = undefined;
      if (outcome !== "limited") w.failures++;
      if (w.failures >= 2) w.phase = "hold";
    }
  }
}
