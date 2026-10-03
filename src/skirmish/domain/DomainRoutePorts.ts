import type { MovementAdmissionEvent } from "../MovementAdmission";
import type { Squad } from "../Protocol";
import type { ExactRouteOutcome } from "../RoutePlanner";
import type { WorldPoint } from "../SpatialGrid";
export type DomainRouteOwner = "army" | "shore" | "trade" | "strategy";
export interface DomainRouteTask {
  kind: "domain";
  owner: DomainRouteOwner;
  playerId: number;
  admissionId: number;
  memberId: number;
  stage: string;
  generation: number;
  epoch?: number;
}
export function domainRouteKey(task: DomainRouteTask): string {
  return `domain:${task.owner}:${task.admissionId}:${task.memberId}:${task.stage}:${task.epoch ?? 0}`;
}
/** Existing domain owners stage their work; the match owns the one fair exact router. */
export interface DomainRoutePorts {
  hostile?(a: number, b: number): boolean;
  priority?(playerId:number):boolean;
  request(
    task: DomainRouteTask,
    start: number,
    goal: number,
    water?: boolean,
  ): boolean;
  cancel(task: DomainRouteTask): void;
  generation(playerId: number): number;
  tick(): number;
  orderRevision(squadId: number): number;
  revision(playerId?: number, owner?: DomainRouteOwner): string;
  clear(squad: Squad, end: WorldPoint): boolean;
  destinationValid(
    squad: Squad,
    point: WorldPoint,
    selected: ReadonlySet<number>,
  ): boolean;
  event(owner: DomainRouteOwner, event: MovementAdmissionEvent): void;
}
export interface DomainRouteConsumer {
  validRoute(task: DomainRouteTask): boolean;
  completedRoute(
    task: DomainRouteTask,
    outcome: ExactRouteOutcome,
    path: number[],
  ): void;
}
