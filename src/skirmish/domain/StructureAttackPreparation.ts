import type { GameMap } from "../../core/game/GameMap";
import type { LandPaths } from "../Pathfinding";
import { FIXED, type Squad } from "../Protocol";
import type { WorldPoint } from "../SpatialGrid";
import { pointTile, squadRadius, standable, tilePoint } from "../SquadGeometry";
import type { Fortifications } from "./Fortifications";

// Finite scratch allowances. Exhaustion rejects pending preparation and leaves
// active orders intact. All profiles share one admission's scratch allowance.
export const STRUCTURE_PREPARATION_LIMITS = Object.freeze({
  footprint: 4096,
  visited: 16384,
  candidates: 8192,
  jobs: 16,
  quantum: 16,
  work: 2_000_000,
});
interface Ray {
  x: number;
  y: number;
  ex: number;
  ey: number;
  sx: number;
  sy: number;
  tx?: number;
  ty?: number;
  nx?: number;
  ny?: number;
  pending: { x: number; y: number }[];
}
interface Aim {
  from: WorldPoint;
  target: number;
  ray?: Ray;
  obstruction?: { tile: number; wall: number };
  result?: boolean;
}
interface Profile {
  range: number;
  kind: Squad["kind"];
  tiles: number[];
  seen: Set<number>;
  target: number;
  x?: number;
  y?: number;
  ready: boolean;
}
export interface StructureAttackPreparationState {
  target: NonNullable<Squad["structureTarget"]>;
  playerId: number;
  members: {
    id: number;
    kind: Squad["kind"];
    range: number;
    origin: WorldPoint;
  }[];
  points: Map<number, WorldPoint>;
  footprint: Set<number>;
  profiles: Map<string, Profile>;
  stage: "footprint" | "current" | "enumerate" | "choose" | "done" | "failed";
  member: number;
  footprintCursor: number;
  candidateCursor: number;
  sides: number[];
  centre?: WorldPoint;
  aim?: Aim;
  candidate?: number;
  best?: { tile: number; sideLoad: number; distance: number };
  reason?: string;
  consumed: number;
  visited: number;
  candidates: number;
  targetKey?: string;
  geometryRestarts?: number;
}

/** Serializable geometry continuation, serviced by MovementAdmission's budget
 * and fairness. No world references, closures, jobs or second scheduler survive
 * in this record. Live target/profile dependencies are checked by its owner. */
export class StructureAttackPreparation {
  static create(
    playerId: number,
    members: StructureAttackPreparationState["members"],
    target: StructureAttackPreparationState["target"],
  ): StructureAttackPreparationState {
    return {
      playerId,
      members,
      target: { ...target },
      points: new Map(),
      footprint: new Set(),
      profiles: new Map(),
      stage: "footprint",
      member: 0,
      footprintCursor: 0,
      candidateCursor: 0,
      sides: [0, 0, 0, 0],
      consumed: 0,
      visited: 0,
      candidates: 0,
    };
  }
  constructor(
    private readonly map: GameMap,
    private readonly paths: LandPaths,
    private readonly forts: Fortifications,
    private readonly targetTiles: readonly number[],
    readonly state: StructureAttackPreparationState,
  ) {}
  private fail(reason: string): void {
    this.state.stage = "failed";
    this.state.reason = reason;
  }
  private profile(): Profile {
    const s = this.state,
      member = s.members[s.member],
      key = `${member.kind}:${member.range}`;
    let profile = s.profiles.get(key);
    if (!profile)
      s.profiles.set(
        key,
        (profile = {
          range: member.range,
          kind: member.kind,
          tiles: [],
          seen: new Set(),
          target: 0,
          ready: false,
        }),
      );
    return profile;
  }
  private side(point: WorldPoint): number {
    const centre = this.state.centre!;
    return Math.min(
      3,
      Math.floor(
        ((Math.atan2(point.y - centre.y, point.x - centre.x) + Math.PI) * 2) /
          Math.PI,
      ),
    );
  }
  private assign(point: WorldPoint): void {
    const s = this.state;
    s.points.set(s.members[s.member].id, { ...point });
    s.sides[this.side(point)]++;
    s.member++;
    s.aim = undefined;
    s.candidate = undefined;
    s.best = undefined;
    s.candidateCursor = 0;
    s.stage = s.member === s.members.length ? "done" : "current";
  }
  private ray(from: WorldPoint, to: WorldPoint): Ray {
    const dx = to.x - from.x,
      dy = to.y - from.y,
      sx = Math.sign(dx),
      sy = Math.sign(dy);
    const x = Math.floor(from.x / FIXED),
      y = Math.floor(from.y / FIXED);
    return {
      x,
      y,
      ex: Math.floor(to.x / FIXED),
      ey: Math.floor(to.y / FIXED),
      sx,
      sy,
      tx: dx ? Math.abs(FIXED / dx) : undefined,
      ty: dy ? Math.abs(FIXED / dy) : undefined,
      nx: dx
        ? ((sx > 0 ? (x + 1) * FIXED : x * FIXED) - from.x) / dx
        : undefined,
      ny: dy
        ? ((sy > 0 ? (y + 1) * FIXED : y * FIXED) - from.y) / dy
        : undefined,
      pending: [{ x, y }],
    };
  }
  // One aim step inspects one target, one supercover cell or one overlapping
  // barrier. The bounded tower-owner predicate remains inside Fortifications.
  private stepAim(range: number): void {
    const s = this.state,
      aim = s.aim!;
    if (aim.obstruction) {
      const obstruction = aim.obstruction;
      const result = this.forts.blockedStep(
        obstruction.tile,
        s.playerId,
        obstruction.wall,
      );
      obstruction.wall = result.next;
      if (result.blocked) {
        aim.ray = undefined;
        aim.obstruction = undefined;
      } else if (result.done) aim.obstruction = undefined;
      return;
    }
    if (aim.ray) {
      const ray = aim.ray;
      if (!ray.pending.length) {
        if (ray.x === ray.ex && ray.y === ray.ey) {
          aim.result = true;
          return;
        }
        const nx = ray.nx ?? Infinity,
          ny = ray.ny ?? Infinity;
        if (nx === ny) {
          ray.pending.push(
            { x: ray.x + ray.sx, y: ray.y },
            { x: ray.x, y: ray.y + ray.sy },
          );
          ray.x += ray.sx;
          ray.y += ray.sy;
          ray.nx = nx + ray.tx!;
          ray.ny = ny + ray.ty!;
        } else if (nx < ny) {
          ray.x += ray.sx;
          ray.nx = nx + ray.tx!;
        } else {
          ray.y += ray.sy;
          ray.ny = ny + ray.ty!;
        }
        ray.pending.push({ x: ray.x, y: ray.y });
      }
      const cell = ray.pending.shift()!;
      if (this.map.isValidCoord(cell.x, cell.y)) {
        const tile = this.map.ref(cell.x, cell.y);
        if (!s.footprint.has(tile)) aim.obstruction = { tile, wall: -1 };
      }
      return;
    }
    const tile = this.targetTiles[aim.target++];
    if (tile === undefined) {
      aim.result = false;
      return;
    }
    const point = tilePoint(this.map, tile);
    if ((point.x - aim.from.x) ** 2 + (point.y - aim.from.y) ** 2 <= range ** 2)
      aim.ray = this.ray(aim.from, point);
  }
  step(budget: number): number {
    if (!Number.isInteger(budget) || budget < 0)
      throw new Error("Invalid structure preparation budget");
    const s = this.state;
    let used = 0;
    while (used < budget && s.stage !== "done" && s.stage !== "failed") {
      used++;
      s.consumed++;
      if (s.consumed > STRUCTURE_PREPARATION_LIMITS.work) {
        this.fail("Structure preparation exceeded its total work allowance");
        continue;
      }
      if (s.stage === "footprint") {
        if (this.targetTiles.length > STRUCTURE_PREPARATION_LIMITS.footprint) {
          this.fail("Structure footprint exceeds preparation capacity");
          continue;
        }
        const tile = this.targetTiles[s.footprintCursor++];
        if (tile === undefined) {
          if (!s.footprint.size) {
            this.fail("Structure has no attackable footprint");
            continue;
          }
          s.centre = tilePoint(
            this.map,
            this.targetTiles[Math.floor(this.targetTiles.length / 2)],
          );
          s.stage = "current";
        } else s.footprint.add(tile);
        continue;
      }
      const member = s.members[s.member],
        profile = this.profile();
      if (s.stage === "current") {
        s.aim ??= { from: { ...member.origin }, target: 0 };
        this.stepAim(member.range);
        if (s.aim.result === true) this.assign(member.origin);
        else if (s.aim.result === false) {
          s.aim = undefined;
          s.stage = profile.ready ? "choose" : "enumerate";
        }
        continue;
      }
      if (s.stage === "enumerate") {
        if (s.aim) {
          this.stepAim(profile.range);
          if (s.aim.result !== undefined) {
            if (s.aim.result) {
              if (s.candidates >= STRUCTURE_PREPARATION_LIMITS.candidates) {
                this.fail("Structure candidate workspace is full");
                continue;
              }
              profile.tiles.push(s.candidate!);
              s.candidates++;
            }
            s.aim = undefined;
            s.candidate = undefined;
          }
          continue;
        }
        if (s.candidate !== undefined) {
          const result = this.forts.blockedStep(
            s.candidate,
            s.playerId,
            s.candidateCursor,
          );
          s.candidateCursor = result.next;
          if (result.blocked) s.candidate = undefined;
          else if (result.done)
            s.aim = { from: tilePoint(this.map, s.candidate), target: 0 };
          continue;
        }
        const target = this.targetTiles[profile.target];
        if (target === undefined) {
          profile.ready = true;
          s.stage = "choose";
          s.candidateCursor = 0;
          continue;
        }
        const extent = Math.ceil(profile.range / FIXED),
          cx = this.map.x(target),
          cy = this.map.y(target);
        profile.x ??= Math.max(0, cx - extent);
        profile.y ??= Math.max(0, cy - extent);
        const tile = this.map.ref(profile.x, profile.y);
        if (++profile.x > Math.min(this.map.width() - 1, cx + extent)) {
          profile.x = Math.max(0, cx - extent);
          if (++profile.y > Math.min(this.map.height() - 1, cy + extent)) {
            profile.target++;
            profile.x = profile.y = undefined;
          }
        }
        if (profile.seen.has(tile)) continue;
        if (s.visited >= STRUCTURE_PREPARATION_LIMITS.visited) {
          this.fail("Structure enumeration workspace is full");
          continue;
        }
        profile.seen.add(tile);
        s.visited++;
        if (
          this.paths.walkable(tile) &&
          standable(
            this.map,
            tilePoint(this.map, tile),
            squadRadius(member.kind),
          )
        ) {
          s.candidate = tile;
          s.candidateCursor = -1;
        }
        continue;
      }
      const tile = profile.tiles[s.candidateCursor++];
      if (tile === undefined) {
        if (s.best) this.assign(tilePoint(this.map, s.best.tile));
        else this.fail("No free firing position around this structure");
        continue;
      }
      const origin = pointTile(this.map, member.origin);
      if (!this.paths.connected(origin, tile)) continue;
      const sideLoad = s.sides[this.side(tilePoint(this.map, tile))],
        distance = this.map.euclideanDistSquared(tile, origin),
        best = s.best;
      if (
        !best ||
        sideLoad < best.sideLoad ||
        (sideLoad === best.sideLoad &&
          (distance < best.distance ||
            (distance === best.distance && tile < best.tile)))
      )
        s.best = { tile, sideLoad, distance };
    }
    return used;
  }
}
