import type { GameMap } from "../../core/game/GameMap";
import {
  FormationPlanning,
  type FormationPlanningState,
} from "../FormationPlanning";
import type { LandPaths } from "../Pathfinding";
import { FIXED, MAX_SQUADS, type Squad } from "../Protocol";
import type { ExactRouteOutcome } from "../RoutePlanner";
import { limitedRouteRetry, ROUTE_CAPACITY_REASON } from "../RouteRetryPolicy";
import type { WorldPoint } from "../SpatialGrid";
import { distanceSquared, pointTile, tilePoint } from "../SquadGeometry";
import type {
  DomainRouteOwner,
  DomainRoutePorts,
  DomainRouteTask,
} from "./DomainRoutePorts";
interface Member {
  id: number;
  revision: number;
  destination?: WorldPoint;
  start?: number;
  path?: number[];
  requested: boolean;
  cursor: number;
  connector?: number;
  attempts: number;
  retryAt: number;
}
export interface CohortPlan {
  id: number;
  playerId: number;
  generation: number;
  revision: string;
  tile: number;
  members: Member[];
  formation: FormationPlanningState;
  phase: "formation" | "destinations" | "routes" | "connectors";
  cursor: number;
  created?: number;
}
export interface CohortPorts {
  map: GameMap;
  paths: LandPaths;
  squads(): readonly Squad[];
  squad(id: number): Squad | undefined;
  routes: DomainRoutePorts;
  blocked(playerId: number, plan: CohortPlan): (tile: number) => boolean;
  valid(plan: CohortPlan, squad: Squad): boolean;
  embarked?(plan: CohortPlan): boolean;
  commit(
    plan: CohortPlan,
    members: readonly {
      squad: Squad;
      point: WorldPoint;
      path: number[];
      index: number;
    }[],
  ): void | boolean;
  finished?(
    plan: CohortPlan,
    status: "executed" | "rejected" | "superseded",
    reason?: string,
  ): void;
}
/** One unpublished cohort owns no physical order or payment until its last live
 * check. Exact searches use the match arena; setup, copies and connectors yield.
 * The final atomic boundary is capped by the existing selected-unit envelope. */
export class CohortAdmission {
  private readonly pending = new Map<number, CohortPlan>();
  private nextId = 1;
  constructor(
    readonly owner: DomainRouteOwner,
    private readonly ports: CohortPorts,
  ) {}
  get pendingCount(): number {
    return this.pending.size;
  }
  plan(id: number): CohortPlan | undefined {
    return this.pending.get(id);
  }
  start(
    playerId: number,
    members: readonly Squad[],
    tile: number,
    preferred?: Map<number, WorldPoint>,
    radius = Infinity,
    additionalOrders?: Map<number, import("../Protocol").Order[]>,
  ): number | undefined {
    if (
      !members.length ||
      members.length > MAX_SQUADS ||
      this.pending.size >= 128
    )
      return undefined;
    const ids = new Set(members.map((s) => s.id));
    for (const plan of [...this.pending.values()])
      if (plan.members.some((m) => ids.has(m.id)))
        this.finish(plan, "superseded", "Replacement order");
    const id = this.nextId++,
      routes = this.ports.routes;
    const plan: CohortPlan = {
      id,
      playerId,
      generation: routes.generation(playerId),
      revision: routes.revision(),
      tile,
      members: members.map((s) => ({
        id: s.id,
        revision: routes.orderRevision(s.id),
        requested: false,
        cursor: 0,
        attempts: 0,
        retryAt: 0,
      })),
      formation: new FormationPlanning(
        this.ports.map,
        this.ports.paths,
        tile,
        members.map((squad) => ({ squad, origin: squad })),
        () => this.ports.squads(),
        radius,
        preferred,
        undefined,
        additionalOrders,
      ).state,
      phase: "formation",
      cursor: 0,
      created: routes.tick(),
    };
    this.pending.set(id, plan);
    routes.event(this.owner, {
      id,
      playerId,
      tick: routes.tick(),
      status: "deferred",
    });
    return id;
  }
  private task(plan: CohortPlan, member: Member): DomainRouteTask {
    return {
      kind: "domain",
      owner: this.owner,
      admissionId: plan.id,
      memberId: member.id,
      stage: "cohort",
      playerId: plan.playerId,
      generation: plan.generation,
    };
  }
  private live(plan: CohortPlan, member: Member): Squad | undefined {
    const squad = this.ports.squad(member.id),
      routes = this.ports.routes;
    return squad &&
      squad.playerId === plan.playerId &&
      squad.troops > 0 &&
      (squad.embarkedOn === null || this.ports.embarked?.(plan)) &&
      !squad.refit &&
      routes.generation(plan.playerId) === plan.generation &&
      routes.orderRevision(member.id) === member.revision &&
      this.ports.valid(plan, squad)
      ? squad
      : undefined;
  }
  validRoute(task: DomainRouteTask): boolean {
    const plan = this.pending.get(task.admissionId),
      member = plan?.members.find((m) => m.id === task.memberId);
    return (
      !!plan &&
      !!member &&
      task.stage === "cohort" &&
      task.generation === plan.generation &&
      !!this.live(plan, member)
    );
  }
  completedRoute(
    task: DomainRouteTask,
    outcome: ExactRouteOutcome,
    path: number[],
  ): void {
    const plan = this.pending.get(task.admissionId),
      member = plan?.members.find((m) => m.id === task.memberId);
    if (!plan || !member || !this.validRoute(task)) return;
    member.requested = false;
    if (outcome === "complete") {
      member.path = path;
      member.cursor = 0;
    } else if (outcome === "limited") {
      const retry = limitedRouteRetry(
        member.attempts,
        this.ports.routes.tick(),
        true,
      );
      member.attempts = retry.attempts;
      member.retryAt = retry.retryAt;
      if (retry.exhausted) this.finish(plan, "rejected", ROUTE_CAPACITY_REASON);
    } else if (outcome === "unreachable")
      this.finish(plan, "rejected", "A selected member has no legal route");
    else this.finish(plan, "superseded", "Route revisions changed");
  }
  cancel(id: number, reason = "Cohort changed"): void {
    const plan = this.pending.get(id);
    if (plan) this.finish(plan, "superseded", reason);
  }
  private finish(
    plan: CohortPlan,
    status: "executed" | "rejected" | "superseded",
    reason?: string,
  ): void {
    for (const member of plan.members)
      this.ports.routes.cancel(this.task(plan, member));
    this.pending.delete(plan.id);
    this.ports.finished?.(plan, status, reason);
    this.ports.routes.event(this.owner, {
      id: plan.id,
      playerId: plan.playerId,
      tick: this.ports.routes.tick(),
      status,
      reason,
    });
  }
  step(budget: number): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid cohort allowance");
    let work = 0,
      idle = 0;
    while (work < budget && this.pending.size) {
      const [id, plan] = this.pending.entries().next().value!;
      this.pending.delete(id);
      this.pending.set(id, plan);
      if (
        plan.created !== undefined &&
        this.ports.routes.tick() - plan.created >= 3000
      ) {
        this.finish(plan, "rejected", "Cohort admission deadline reached");
        work++;
        continue;
      }
      if (plan.revision !== this.ports.routes.revision()) {
        this.finish(plan, "superseded", "Obstacles or permission changed");
        work++;
        continue;
      }
      const member = plan.members[plan.cursor % plan.members.length];
      if (!this.live(plan, member)) {
        this.finish(
          plan,
          "superseded",
          "Selected units or their orders changed",
        );
        work++;
        continue;
      }
      if (plan.phase === "formation") {
        const formation = new FormationPlanning(
          this.ports.map,
          this.ports.paths,
          plan.tile,
          [],
          () => this.ports.squads(),
          Infinity,
          undefined,
          plan.formation,
        );
        work += formation.step(
          Math.min(16, budget - work),
          this.ports.blocked(plan.playerId, plan),
        );
        if (formation.state.phase === "failed")
          this.finish(plan, "rejected", "There is no legal formation space");
        else if (formation.state.phase === "done") {
          plan.phase = "destinations";
          plan.cursor = 0;
        }
        idle = 0;
        continue;
      }
      work++;
      if (plan.phase === "destinations") {
        member.destination = plan.formation.result.get(member.id)!;
        if (++plan.cursor === plan.members.length) {
          plan.cursor = 0;
          plan.phase = "routes";
        }
      } else if (plan.phase === "routes") {
        if (this.ports.embarked?.(plan)) {
          member.path = [];
          member.connector = 0;
          plan.cursor = (plan.cursor + 1) % plan.members.length;
          if (plan.members.every((m) => m.path !== undefined)) {
            plan.phase = "connectors";
            plan.cursor = 0;
          }
          continue;
        }
        if (
          !member.path &&
          !member.requested &&
          member.retryAt <= this.ports.routes.tick()
        ) {
          member.start = pointTile(this.ports.map, this.live(plan, member)!);
          member.requested = this.ports.routes.request(
            this.task(plan, member),
            member.start,
            pointTile(this.ports.map, member.destination!),
          );
        }
        plan.cursor = (plan.cursor + 1) % plan.members.length;
        if (plan.members.every((m) => m.path !== undefined)) {
          plan.phase = "connectors";
          plan.cursor = 0;
          idle = 0;
        } else if (++idle >= this.pending.size * plan.members.length) break;
      } else {
        const squad = this.live(plan, member)!;
        if (this.ports.embarked?.(plan)) {
          member.connector = 0;
          plan.cursor++;
        } else if (member.connector !== undefined) {
          plan.cursor++;
        } else if (member.cursor < member.path!.length) {
          const at = member.cursor++,
            point = tilePoint(this.ports.map, member.path![at]);
          if (
            distanceSquared(squad, point) <= (3 * FIXED) ** 2 &&
            this.ports.routes.clear(squad, point)
          ) {
            member.connector = at;
            plan.cursor++;
          }
        } else if (
          !member.path!.length &&
          this.ports.routes.clear(squad, member.destination!)
        ) {
          member.connector = 0;
          plan.cursor++;
        } else {
          member.path = undefined;
          member.connector = undefined;
          member.cursor = 0;
          plan.phase = "routes";
          plan.cursor = 0;
          continue;
        }
        if (plan.cursor === plan.members.length) {
          const selected = new Set(plan.members.map((m) => m.id)),
            accepted = [];
          let stale: Member | undefined;
          for (const m of plan.members) {
            const live = this.live(plan, m),
              point = m.path!.length
                ? tilePoint(this.ports.map, m.path![m.connector!])
                : m.destination!;
            if (
              !live ||
              (!this.ports.embarked?.(plan) &&
                !this.ports.routes.clear(live, point)) ||
              !this.ports.routes.destinationValid(
                live,
                m.destination!,
                selected,
              )
            ) {
              stale = m;
              break;
            }
            accepted.push({
              squad: live,
              point: m.destination!,
              path: m.path!,
              index: m.connector!,
            });
          }
          if (stale) {
            const members = plan.members.map((m) => this.live(plan, m));
            if (members.some((s) => !s)) {
              this.finish(plan, "superseded", "Selected cohort changed");
              continue;
            }
            const previous = plan.formation;
            plan.formation = new FormationPlanning(
              this.ports.map,
              this.ports.paths,
              plan.tile,
              members.map((squad) => ({ squad: squad!, origin: squad! })),
              () => this.ports.squads(),
              previous.maximumRadius ?? Infinity,
              previous.preferred,
              undefined,
              previous.additionalOrders,
            ).state;
            for (const m of plan.members) {
              this.ports.routes.cancel(this.task(plan, m));
              m.path = undefined;
              m.connector = undefined;
              m.cursor = 0;
              m.requested = false;
            }
            plan.phase = "formation";
            plan.cursor = 0;
          } else {
            const committed = this.ports.commit(plan, accepted);
            this.finish(
              plan,
              committed === false ? "rejected" : "executed",
              committed === false
                ? "Domain commit precondition changed"
                : undefined,
            );
          }
        }
      }
    }
    return work;
  }
  checkpoint() {
    return structuredClone({ pending: [...this.pending], nextId: this.nextId });
  }
  restore(saved?: ReturnType<CohortAdmission["checkpoint"]>): void {
    this.pending.clear();
    this.nextId = saved?.nextId ?? 1;
    if (saved && saved.pending.length > 128)
      throw new Error("Cohort checkpoint exceeds admission envelope");
    for (const [id, plan] of structuredClone(saved?.pending ?? [])) {
      if (
        !plan.members.length ||
        plan.members.length > MAX_SQUADS ||
        new Set(plan.members.map((m) => m.id)).size !== plan.members.length
      )
        throw new Error("Invalid cohort checkpoint");
      FormationPlanning.normalizeCheckpoint(plan.formation);
      this.pending.set(id, plan);
    }
  }
}
