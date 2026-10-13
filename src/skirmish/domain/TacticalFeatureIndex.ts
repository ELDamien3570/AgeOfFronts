import type { LandPaths } from "../Pathfinding";
import { PassageTraffic } from '../PassageTraffic';
import { FIXED } from "../Protocol";
import { BUDGETS, POSITIONS } from "../content/TacticalRules";
import type { TacticalTerrain } from "./TacticalTerrain";
export interface HillFeature {
  id: number;
  tile: number;
  prominenceDm: number;
  plateauTiles: number;
  frontageTiles: number;
  facing: number;
  rearTile: number;
  rearAccess: boolean;
  component: number;
}
export interface ChokeFeature {
  id: number;
  axis: number;
  low: { x: number; y: number };
  high: { x: number; y: number };
}
const directions = Array.from({ length: 8 }, (_, i) => ({
  x: Math.round(Math.cos((i * Math.PI) / 4)),
  y: Math.round(Math.sin((i * Math.PI) / 4)),
  angle: (i * Math.PI) / 4,
}));
type Connectivity = Pick<LandPaths,'component'|'walkable'|'connected'>;
interface FeatureCheckpoint {
  sourceHash:number;rows:number;featureIndexHash:number|undefined;
  navigationRulesVersion?:2;
}
/** Legacy verification only: no search arenas, forest subscriptions or retained
 * routing caches are needed to validate the previous mountain connectivity. */
function legacyConnectivity(map:TacticalTerrain['map']):Connectivity {
  const size=map.width()*map.height(),component=new Int32Array(size),queue=new Int32Array(size),neighbors:number[]=[];
  const walkable=(tile:number)=>Number.isInteger(tile)&&tile>=0&&tile<size&&map.isLand(tile)&&!map.isImpassable(tile);
  let id=0;
  for(let tile=0;tile<size;tile++){
    if(component[tile]||!walkable(tile))continue;
    component[tile]=++id;queue[0]=tile;let head=0,tail=1;
    while(head<tail){
      const count=map.neighbors4(queue[head++],neighbors);
      for(let i=0;i<count;i++){const next=neighbors[i];if(component[next]||!walkable(next))continue;component[next]=id;queue[tail++]=next;}
    }
  }
  return {component,walkable,connected:(a,b)=>component[a]>0&&component[a]===component[b]};
}
/** Static terrain derivation, incrementally published only when complete. */
export class TacticalFeatureIndex {
  readonly hills: HillFeature[] = [];
  readonly chokes: ChokeFeature[] = [];
  private readonly buckets = new Map<number, HillFeature[]>();
  private row = 0;
  private hash = 2166136261;
  private chokeHash = 0;
  readonly sourceHash: number;
  readonly diagnostics = { rows: 0, cells: 0 };
  constructor(
    readonly terrain: TacticalTerrain,
    private readonly paths: Connectivity,
  ) {
    let hash = 2166136261;
    for (let t = 0; t < terrain.map.width() * terrain.map.height(); t++) {
      hash = Math.imul(hash ^ terrain.heightAt(t), 16777619);
      hash = Math.imul(hash ^ paths.component[t], 16777619);
    }
    this.sourceHash = hash >>> 0;
  }
  get ready() {
    return this.row >= this.terrain.map.height();
  }
  checkpoint():FeatureCheckpoint {
    return {
      sourceHash: this.sourceHash,
      navigationRulesVersion:2,
      rows: this.row,
      featureIndexHash: this.ready
        ? (this.hash ^ this.chokeHash) >>> 0
        : undefined,
    };
  }
  restore(state: ReturnType<TacticalFeatureIndex["checkpoint"]>) {
    let migrated=false;
    if(state.navigationRulesVersion===undefined && state.sourceHash!==this.sourceHash){
      const connectivity=legacyConnectivity(this.terrain.map),legacy=new TacticalFeatureIndex(this.terrain,connectivity);
      legacy.setChokes(new PassageTraffic(this.terrain.map,connectivity).staticFeatures());
      if(legacy.sourceHash!==state.sourceHash)throw Error("Tactical terrain index mismatch");
      // Verify the old terrain fingerprint and feature state before rebuilding.
      legacy.restore(state);migrated=true;
    }
    if (
      (!migrated && state.sourceHash !== this.sourceHash) ||
      (state.navigationRulesVersion!==undefined && state.navigationRulesVersion!==2) ||
      !Number.isInteger(state.rows) ||
      state.rows < 0 ||
      state.rows > this.terrain.map.height() ||
      (state.rows % 8 !== 0 && state.rows !== this.terrain.map.height())
    )
      throw Error("Tactical terrain index mismatch");
    this.hills.length = 0;
    this.buckets.clear();
    this.row = 0;
    this.hash = 2166136261;
    this.step(state.rows);
    if (
      !migrated && state.featureIndexHash !== undefined &&
      (!this.ready ||
        state.featureIndexHash !== (this.hash ^ this.chokeHash) >>> 0)
    )
      throw Error("Tactical feature hash mismatch");
  }
  setChokes(chokes: readonly ChokeFeature[]) {
    this.chokes.splice(
      0,
      this.chokes.length,
      ...chokes
        .map((c) => ({ ...c, low: { ...c.low }, high: { ...c.high } }))
        .sort((a, b) => a.id - b.id),
    );
    let hash = 0;
    for (const c of this.chokes)
      for (const value of [c.id, c.axis, c.low.x, c.low.y, c.high.x, c.high.y])
        hash = Math.imul(hash ^ Math.round(value), 16777619);
    this.chokeHash = hash >>> 0;
  }
  step(rows: number = BUDGETS.featureRows): number {
    const map = this.terrain.map,
      start = this.row;
    const end =
      this.row + rows >= map.height()
        ? map.height()
        : this.row + Math.floor(rows / 8) * 8;
    while (this.row < end) {
      if (this.terrain.hasHeight)
        for (let x = 0; x < map.width(); x += POSITIONS.cell) {
          this.diagnostics.cells++;
          this.cell(x, this.row);
        }
      this.row = Math.min(map.height(), this.row + POSITIONS.cell);
    }
    this.diagnostics.rows = this.row - start;
    return this.diagnostics.rows;
  }
  private cell(x: number, y: number) {
    const map = this.terrain.map;
    let peak = -1;
    for (let dy = y; dy < Math.min(y + 8, map.height()); dy++)
      for (let dx = x; dx < Math.min(x + 8, map.width()); dx++) {
        const tile = map.ref(dx, dy);
        if (
          this.paths.walkable(tile) &&
          (peak < 0 ||
            this.terrain.heightAt(tile) > this.terrain.heightAt(peak))
        )
          peak = tile;
      }
    if (peak < 0) return;
    const px = map.x(peak),
      py = map.y(peak),
      height = this.terrain.heightAt(peak);
    const at = (dx: number, dy: number) =>
      map.isValidCoord(px + dx, py + dy) ? map.ref(px + dx, py + dy) : -1;
    const plateau = (dx: number, dy: number) => {
      const t = at(dx, dy);
      return (
        t >= 0 &&
        this.paths.walkable(t) &&
        this.paths.connected(peak, t) &&
        this.terrain.heightAt(t) >= height - 30
      );
    };
    let sum = 0,
      n = 0,
      plateauTiles = 0,
      frontageTiles = 0,
      facing = 0,
      bestSlope = -Infinity;
    // Constant-size perimeter and deployment samples per eight-tile cell.
    for (let dx = -10; dx <= 10; dx++)
      for (const dy of [-10, 10]) {
        const t = at(dx, dy);
        if (t >= 0 && this.paths.walkable(t)) {
          sum += this.terrain.heightAt(t);
          n++;
        }
      }
    for (let dy = -9; dy <= 9; dy++)
      for (const dx of [-10, 10]) {
        const t = at(dx, dy);
        if (t >= 0 && this.paths.walkable(t)) {
          sum += this.terrain.heightAt(t);
          n++;
        }
      }
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -4; dy <= 4; dy++)
        if (dx * dx + dy * dy <= 16 && plateau(dx, dy)) plateauTiles++;
    for (const d of directions) {
      let width = 1;
      for (const sign of [-1, 1])
        for (let i = 1; i <= 4; i++) {
          if (!plateau(-d.y * i * sign, d.x * i * sign)) break;
          width++;
        }
      frontageTiles = Math.max(frontageTiles, width);
      let total = 0,
        count = 0;
      for (let i = 1; i <= 6; i++) {
        const t = at(d.x * i, d.y * i);
        if (t >= 0 && this.paths.walkable(t)) {
          total += this.terrain.heightAt(t);
          count++;
        }
      }
      const slope = count ? height - Math.floor(total / count) : -Infinity;
      if (slope > bestSlope) {
        bestSlope = slope;
        facing = d.angle;
      }
    }
    const d = directions[Math.round(facing / (Math.PI / 4)) % 8],
      rearTile = at(-d.x * 8, -d.y * 8);
    const prominenceDm = n ? height - Math.floor(sum / n) : 0;
    if (
      prominenceDm < POSITIONS.minProminenceDm ||
      plateauTiles < 24 ||
      frontageTiles < 4 ||
      rearTile < 0 ||
      !this.paths.connected(peak, rearTile)
    )
      return;
    const f: HillFeature = {
      id: Math.floor(y / 8) * Math.ceil(map.width() / 8) + Math.floor(x / 8),
      tile: peak,
      prominenceDm,
      plateauTiles,
      frontageTiles,
      facing: Math.atan2(Math.sin(facing), Math.cos(facing)),
      rearTile,
      rearAccess: true,
      component: this.paths.component[peak],
    };
    this.hills.push(f);
    for (const value of [
      f.id,
      f.tile,
      f.prominenceDm,
      f.plateauTiles,
      f.frontageTiles,
      Math.round(f.facing * 100000),
      f.rearTile,
      f.component,
    ])
      this.hash = Math.imul(this.hash ^ value, 16777619);
    const key =
        Math.floor(py / 32) * Math.ceil(map.width() / 32) + Math.floor(px / 32),
      bucket = this.buckets.get(key) ?? [];
    bucket.push(f);
    this.buckets.set(key, bucket);
  }
  near(
    tile: number,
    radius: number = POSITIONS.maxObjectiveTiles,
  ): HillFeature[] {
    if (!this.ready) return [];
    const map = this.terrain.map,
      x = map.x(tile),
      y = map.y(tile),
      found: HillFeature[] = [];
    for (
      let by = Math.max(0, Math.floor((y - radius) / 32));
      by <=
      Math.min(Math.ceil(map.height() / 32) - 1, Math.floor((y + radius) / 32));
      by++
    )
      for (
        let bx = Math.max(0, Math.floor((x - radius) / 32));
        bx <=
        Math.min(
          Math.ceil(map.width() / 32) - 1,
          Math.floor((x + radius) / 32),
        );
        bx++
      )
        for (const f of this.buckets.get(
          by * Math.ceil(map.width() / 32) + bx,
        ) ?? [])
          if (map.euclideanDistSquared(tile, f.tile) <= radius * radius)
            found.push(f);
    return found
      .sort((a, b) => b.prominenceDm - a.prominenceDm || a.id - b.id)
      .slice(0, POSITIONS.maxCandidates);
  }
}
export interface PositionContext {
  objectiveTile: number;
  threatCentroid?: { x: number; y: number };
  threatStrength: number;
  army: { frontWidth: number; maxRangedRange: number; component: number };
  ownTerritory: (tile: number) => boolean;
  routeLength: (tile: number) => number | undefined;
  rangeAt?: (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => number;
}
export function scorePosition(
  index: TacticalFeatureIndex,
  f: HillFeature,
  ctx: PositionContext,
): number {
  const map = index.terrain.map,
    route = ctx.routeLength(f.tile),
    distance = Math.sqrt(map.euclideanDistSquared(f.tile, ctx.objectiveTile));
  if (
    f.component !== ctx.army.component ||
    route === undefined ||
    !f.rearAccess ||
    f.frontageTiles * FIXED < ctx.army.frontWidth * 0.6 ||
    distance > POSITIONS.maxObjectiveTiles
  )
    return -Infinity;
  const p = {
      x: (map.x(f.tile) + 0.5) * FIXED,
      y: (map.y(f.tile) + 0.5) * FIXED,
    },
    objective = {
      x: (map.x(ctx.objectiveTile) + 0.5) * FIXED,
      y: (map.y(ctx.objectiveTile) + 0.5) * FIXED,
    };
  const threat = ctx.threatCentroid ?? objective,
    w = POSITIONS.weights;
  let coverage = 0;
  for (let i = 0; i < 8; i++) {
    const t = {
        x: threat.x + ((objective.x - threat.x) * i) / 7,
        y: threat.y + ((objective.y - threat.y) * i) / 7,
      },
      range = ctx.rangeAt?.(p, t) ?? ctx.army.maxRangedRange;
    if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 <= range ** 2) coverage++;
  }
  const bearing = Math.atan2(threat.y - p.y, threat.x - p.x);
  return Math.round(
    Math.min(400, f.prominenceDm) * w.prominence +
      (coverage * w.coverage) / 8 +
      Math.cos(bearing - f.facing) * w.facing -
      distance * w.objectiveDistance -
      route * w.routeLength +
      (ctx.ownTerritory(f.tile) ? w.territory : 0),
  );
}
