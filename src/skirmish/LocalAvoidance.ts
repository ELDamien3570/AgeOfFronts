import type { GameMap } from "../core/game/GameMap";
import { CrowdRecovery } from "./CrowdRecovery";
import { CrowdVelocity } from "./CrowdVelocity";
import {
  FIXED,
  type MovementBlockReason,
  type MovementStatus,
  type Squad,
} from "./Protocol";
import { SpatialGrid, type WorldPoint } from "./SpatialGrid";
import {
  COLLISION_SKIN,
  squadRadius,
  squadSeparation,
  traversable,
  type FactionHostility,
} from "./SquadGeometry";
import { restoreMap } from "./StateTransfer";

export interface MovementIntent {
  squad: Squad;
  goal: WorldPoint;
  speed: number;
  stopDistance?: number;
  revision?: number;
  // Only the army domain may authorize an arrived member to yield its slot.
  yieldOnly?: boolean;
}
type Velocity = WorldPoint;
interface Obstacle {
  id: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  initial: number;
  minimumSquared: number;
  comfortSquared: number;
  moving: boolean;
}
const ZERO: Velocity = { x: 0, y: 0 };
const HORIZON = 6;
// Prefer passing on the right. The small turn steps also give stable headings.
const TURNS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8].map((turn) => ({
  cos: Math.cos((turn * Math.PI) / 8),
  sin: Math.sin((turn * Math.PI) / 8),
}));

function closestDistanceSquared(
  dx: number,
  dy: number,
  vx: number,
  vy: number,
  horizon: number,
): number {
  const speed = vx * vx + vy * vy;
  const time = speed
    ? Math.max(0, Math.min(horizon, -(dx * vx + dy * vy) / speed))
    : 0;
  return (dx + vx * time) ** 2 + (dy + vy * time) ** 2;
}
function crossing(a: Squad, av: Velocity, b: Squad, bv: Velocity, hostile?: FactionHostility): boolean {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  const minimum = squadSeparation(a, b, hostile);
  if (!minimum) return false;
  const initial = dx * dx + dy * dy;
  // Invalid pre-existing overlaps may separate, never deepen or cross through.
  if (initial < minimum * minimum)
    return (
      dx * (av.x - bv.x) + dy * (av.y - bv.y) < 0 ||
      closestDistanceSquared(dx, dy, av.x - bv.x, av.y - bv.y, 1) <
        initial - 0.01
    );
  return (
    closestDistanceSquared(dx, dy, av.x - bv.x, av.y - bv.y, 1) <
    minimum * minimum
  );
}

// Reciprocal velocity avoidance plus an exact swept commit guard. Sampled
// headings handle terrain edges where the continuous velocity is impassable.
// Every proposal observes the same tick. A held squad moves only with an
// explicit yield-only intent from the army domain; manual Hold never supplies it.
export class LocalAvoidance {
  checkpoint() {
    return structuredClone({
      previous: this.previous,
      recovery: this.recovery.checkpoint(),
    });
  }
  restore(saved: ReturnType<LocalAvoidance["checkpoint"]>): void {
    const state = structuredClone(saved);
    restoreMap(this.previous, state.previous);
    // Historical friendly yield leases no longer constrain the overlap policy.
    this.recovery.restore();
  }

  private readonly previous = new Map<number, Velocity>();
  private readonly obstacles: Obstacle[] = [];
  private readonly crowd = new CrowdVelocity();
  private readonly recovery = new CrowdRecovery();
  constructor(private readonly map: GameMap, private readonly hostile?: FactionHostility) {}

  step(
    squads: readonly Squad[],
    intents: MovementIntent[],
    grid: SpatialGrid<Squad>,
    apply: (
      id: number,
      changes: Pick<Squad, "x" | "y" | "moved"> & {
        movementStatus?: MovementStatus;
      },
    ) => void,
    tick = 0,
    restrictions?: (squad: Squad, end: WorldPoint) => boolean,
    idleReason?: (squad: Squad) => MovementBlockReason,
  ): void {
    const allowed = (squad: Squad, end: WorldPoint) =>
      traversable(this.map, squad, end, squadRadius(squad.kind)) &&
      (!restrictions || restrictions(squad, end));
    const active = squads
      .filter((squad) => squad.embarkedOn === null)
      .sort((a, b) => a.id - b.id);
    const byId = new Map(intents.map((intent) => [intent.squad.id, intent]));
    const preferred = new Map<number, Velocity>();
    for (const intent of intents) {
      if (intent.yieldOnly) {
        preferred.set(intent.squad.id, ZERO);
        continue;
      }
      const dx = intent.goal.x - intent.squad.x,
        dy = intent.goal.y - intent.squad.y;
      const distance = Math.hypot(dx, dy);
      const travel = Math.min(
        intent.speed,
        Math.max(0, distance - (intent.stopDistance ?? 0)),
      );
      preferred.set(
        intent.squad.id,
        distance
          ? {
              x: Math.round((dx * travel) / distance),
              y: Math.round((dy * travel) / distance),
            }
          : ZERO,
      );
    }
    const blocked = new Map<number, Set<number>>();
    const addBlocker = (a: number, b: number) => {
      let ids = blocked.get(a);
      if (!ids) blocked.set(a, (ids = new Set()));
      if (ids.size < 8) ids.add(b);
    };
    const proposed = new Map<number, Velocity>();
    const forecasts = new Map<
      number,
      { x: number; y: number; length: number; moving: boolean }
    >();
    let maximumForecast = 0;
    for (const squad of active) {
      const desired = preferred.get(squad.id);
      const moving = !!desired && !!(desired.x || desired.y);
      const velocity = moving
        ? (this.previous.get(squad.id) ?? desired!)
        : ZERO;
      const length = Math.sqrt(
        velocity.x * velocity.x + velocity.y * velocity.y,
      );
      forecasts.set(squad.id, { x: velocity.x, y: velocity.y, length, moving });
      maximumForecast = Math.max(maximumForecast, length);
    }
    const neighbors: Squad[] = [];
    const obstacles = this.obstacles;
    const end: WorldPoint = { x: 0, y: 0 };
    for (const squad of active) {
      let desired = preferred.get(squad.id) ?? ZERO;
      if (!desired.x && !desired.y) {
        proposed.set(squad.id, ZERO);
        continue;
      }
      // Grid cell order is deterministic; each bucket is populated in ID order.
      // Sorting every neighborhood would repeat the same work for every unit.
      const last = this.previous.get(squad.id) ?? desired;
      const intent = byId.get(squad.id)!;
      // Friendly bodies are a bounded soft steering preference, not hard
      // obstacles. Terrain failure falls back to the original trajectory;
      // hostile trajectories still pass the exact swept guard below.
      grid.sample(squad.x,squad.y,1.15*FIXED,neighbors,other=>other.id!==squad.id && squadSeparation(squad,other,this.hostile)===0,8,64);
      let pushX=0,pushY=0,read=0;
      for(const other of neighbors) {
        if(other.id===squad.id || squadSeparation(squad,other,this.hostile)!==0)continue;
        const dx=squad.x-other.x,dy=squad.y-other.y,distance=Math.hypot(dx,dy);
        if(distance>=1.15*FIXED)continue;
        const strength=(1-distance/(1.15*FIXED))*intent.speed*0.3;
        pushX+=(distance ? dx/distance : squad.id<other.id ? -1 : 1)*strength;
        pushY+=(distance ? dy/distance : squad.id<other.id ? 0.5 : -0.5)*strength;
        if(++read>=8)break;
      }
      if(read) {
        const x=desired.x+pushX,y=desired.y+pushY,length=Math.hypot(x,y),scale=Math.min(1,intent.speed/Math.max(1,length));
        const steering={x:Math.round(x*scale),y:Math.round(y*scale)};
        if(steering.x*desired.x+steering.y*desired.y>0 && allowed(squad,{x:squad.x+steering.x,y:squad.y+steering.y}))desired=steering;
      }
      const horizon = Math.min(
        HORIZON,
        Math.max(
          1,
          (Math.hypot(intent.goal.x - squad.x, intent.goal.y - squad.y) -
            (intent.stopDistance ?? 0)) /
            intent.speed,
        ),
      );
      let obstacleCount = 0;
      const maximumTravel =
        Math.sqrt(desired.x * desired.x + desired.y * desired.y) + 2;
      const maximumClearance = Math.max(
        FIXED * 1.15,
        2 * squadRadius("cavalry") + COLLISION_SKIN,
      );
      grid.query(
        squad.x,
        squad.y,
        maximumClearance + horizon * (maximumTravel + maximumForecast),
        neighbors,
        squad.playerId,
      );
      // Neighbor forecasts and pair clearance are constant across all velocity
      // samples. Cull only pairs that cannot reach even the comfort boundary.
      for (const other of neighbors) {
        if (other.id === squad.id) continue;
        const otherVelocity = forecasts.get(other.id)!;
        const dx = squad.x - other.x,
          dy = squad.y - other.y,
          initial = dx * dx + dy * dy;
        const minimum = squadSeparation(squad, other, this.hostile);
        if (!minimum) continue;
        const comfort =
          squad.playerId === other.playerId ? FIXED * 1.15 : minimum;
        const reach =
          Math.max(minimum, comfort) +
          horizon * (maximumTravel + otherVelocity.length);
        if (initial > reach * reach) continue;
        const obstacle =
          obstacles[obstacleCount] ??
          (obstacles[obstacleCount] = {
            id: other.id,
            dx: 0,
            dy: 0,
            vx: 0,
            vy: 0,
            initial: 0,
            minimumSquared: 0,
            comfortSquared: 0,
            moving: false,
          });
        obstacleCount++;
        obstacle.id = other.id;
        obstacle.dx = dx;
        obstacle.dy = dy;
        obstacle.vx = otherVelocity.x;
        obstacle.vy = otherVelocity.y;
        obstacle.initial = initial;
        obstacle.minimumSquared = minimum * minimum;
        obstacle.comfortSquared = comfort * comfort;
        obstacle.moving = otherVelocity.moving;
      }
      // Free marching needs no half-plane solve. Test the requested trajectory
      // against the same neighbor forecasts first; terrain and the exact swept
      // commit guard still apply even when the preferred velocity is accepted.
      let free = true;
      for (let i = 0; i < obstacleCount; i++) {
        const other = obstacles[i];
        if (
          closestDistanceSquared(
            other.dx,
            other.dy,
            desired.x - other.vx,
            desired.y - other.vy,
            horizon,
          ) <=
          other.minimumSquared + 4
        ) {
          free = false;
          break;
        }
      }
      if (free) {
        end.x = squad.x + desired.x;
        end.y = squad.y + desired.y;
        if (allowed(squad, end)) {
          proposed.set(squad.id, desired);
          continue;
        }
      }
      const recordConstraints = () => {
        for (let i = 0; i < obstacleCount; i++) {
          const other = obstacles[i];
          if (
            closestDistanceSquared(
              other.dx,
              other.dy,
              desired.x - other.vx,
              desired.y - other.vy,
              horizon,
            ) <=
            other.minimumSquared + 4
          )
            addBlocker(squad.id, other.id);
        }
      };
      const reciprocal = this.crowd.solve(
        desired,
        last,
        obstacles,
        obstacleCount,
        horizon,
      );
      if (reciprocal) {
        end.x = squad.x + reciprocal.x;
        end.y = squad.y + reciprocal.y;
        if (allowed(squad, end)) {
          if (!reciprocal.x && !reciprocal.y) recordConstraints();
          proposed.set(squad.id, reciprocal);
          continue;
        }
      }
      let bestX = 0,
        bestY = 0,
        bestScore = Infinity;
      for (const fraction of [1, 0.5, 0]) {
        for (const turn of TURNS) {
          if (!fraction && turn !== TURNS[0]) continue;
          const vx = Math.round(
              (desired.x * turn.cos - desired.y * turn.sin) * fraction,
            ),
            vy = Math.round(
              (desired.x * turn.sin + desired.y * turn.cos) * fraction,
            );
          let score =
            (vx - desired.x) ** 2 +
            (vy - desired.y) ** 2 +
            0.15 * ((vx - last.x) ** 2 + (vy - last.y) ** 2);
          // All remaining penalties are nonnegative. Most marching squads can
          // accept their preferred velocity without testing every alternative.
          if (score >= bestScore) continue;
          end.x = squad.x + vx;
          end.y = squad.y + vy;
          if (!allowed(squad, end)) continue;
          for (let index = 0; index < obstacleCount; index++) {
            const other = obstacles[index];
            const distance = closestDistanceSquared(
              other.dx,
              other.dy,
              vx - other.vx,
              vy - other.vy,
              horizon,
            );
            if (
              distance <
              Math.min(other.initial, other.minimumSquared) - 0.01
            ) {
              score = Infinity;
              break;
            }
            // Comfort spacing is soft, so narrow passages can still be used.
            // Scale preference to travel speed, not world-distance squared.
            // Close endpoints and one-cell queues must remain reachable.
            score +=
              Math.max(0, 1 - distance / other.comfortSquared) *
              (desired.x * desired.x + desired.y * desired.y) *
              0.03;
          }
          if (score < bestScore) {
            bestX = vx;
            bestY = vy;
            bestScore = score;
          }
        }
      }
      if (!bestX && !bestY) recordConstraints();
      proposed.set(squad.id, bestX || bestY ? { x: bestX, y: bestY } : ZERO);
    }
    // Friendly squads can overlap, so friendly jam leases require no solver work.
    // Cancel conflicting trajectories simultaneously. A stopped squad may block
    // another proposal: propagate those cancellations before committing anyone.
    const stopped: Squad[] = [];
    let maximumMotion = 0;
    for (const velocity of proposed.values())
      maximumMotion = Math.max(
        maximumMotion,
        Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y),
      );
    const guardRadius =
      2 * squadRadius("cavalry") + COLLISION_SKIN + 2 * maximumMotion;
    const cancel = (squad: Squad) => {
      const velocity = proposed.get(squad.id)!;
      if (velocity.x || velocity.y) {
        proposed.set(squad.id, ZERO);
        stopped.push(squad);
      }
    };
    for (const squad of active) {
      grid.query(squad.x, squad.y, guardRadius, neighbors, squad.playerId);
      for (const other of neighbors)
        if (
          other.id > squad.id &&
          crossing(
            squad,
            proposed.get(squad.id)!,
            other,
            proposed.get(other.id)!,
            this.hostile,
          )
        ) {
          addBlocker(squad.id, other.id);
          addBlocker(other.id, squad.id);
          cancel(squad);
          cancel(other);
        }
    }
    for (let i = 0; i < stopped.length; i++) {
      const squad = stopped[i];
      grid.query(squad.x, squad.y, guardRadius, neighbors, squad.playerId);
      for (const other of neighbors)
        if (
          other.id !== squad.id &&
          crossing(squad, ZERO, other, proposed.get(other.id)!, this.hostile)
        ) {
          addBlocker(other.id, squad.id);
          cancel(other);
        }
    }
    const live = new Set<number>();
    for (const squad of active) {
      const velocity = proposed.get(squad.id)!;
      const moved = velocity.x !== 0 || velocity.y !== 0;
      const desired = preferred.get(squad.id),
        ids = [...(blocked.get(squad.id) ?? [])].sort((a, b) => a - b);
      let reason: MovementBlockReason | undefined;
      if (!moved && desired && (desired.x || desired.y)) {
        if (ids.length) reason = "crowd";
        else {
          const end = { x: squad.x + desired.x, y: squad.y + desired.y };
          reason = !traversable(this.map, squad, end, squadRadius(squad.kind))
            ? "terrain"
            : restrictions && !restrictions(squad, end)
              ? "restricted"
              : "blocked";
        }
      } else if (
        !moved &&
        !desired &&
        (squad.order.type === "move" || squad.order.type === "board")
      )
        reason = idleReason?.(squad) ?? "blocked";
      const previous = squad.movementStatus;
      const movementStatus = reason
        ? {
            reason,
            since: previous?.reason === reason ? previous.since : tick,
            blockerIds: ids,
          }
        : undefined;
      // Preserve the status object unless its meaning changed; waiting time is
      // derived from snapshot.tick, not replicated as a counter every tick.
      const same =
        previous?.reason === movementStatus?.reason &&
        previous?.since === movementStatus?.since &&
        (previous?.blockerIds.length ?? 0) ===
          (movementStatus?.blockerIds.length ?? 0) &&
        (previous?.blockerIds ?? []).every(
          (id, at) => id === movementStatus?.blockerIds[at],
        );
      apply(squad.id, {
        x: squad.x + velocity.x,
        y: squad.y + velocity.y,
        moved,
        ...(same ? {} : { movementStatus }),
      });
      this.previous.set(squad.id, velocity);
      live.add(squad.id);
    }
    for (const id of this.previous.keys())
      if (!live.has(id)) this.previous.delete(id);
  }
}
