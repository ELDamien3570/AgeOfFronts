import { layoutGrid } from "./FormationGeometry";
import type { GameMap } from "../../core/game/GameMap";
import { CONTACT, FACING } from "../content/TacticalRules";
import { FIXED, type Squad } from "../Protocol";
import { passableCell } from "../SquadGeometry";
import {
  columnLayout,
  formationDoctrine,
  formationEnvelope,
  formationSlots,
  physicalGeometryKey,
  radians,
} from "./FormationGeometry";
import { polygonSweepEntry } from "./ProjectileCollision";
import { withinShoreline } from "./ShorelineTolerance";

export type FormationBody = Pick<
  Squad,
  | "id"
  | "x"
  | "y"
  | "kind"
  | "troops"
  | "manpower"
  | "definitionId"
  | "formation"
  | "charge"
>;
export type Point = { x: number; y: number };
// Four fixed units (1/64 tile) cover integer rounding, never artwork drift.
export const CONTACT_TOLERANCE = CONTACT.enter;
const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of sorted) {
    while (
      lower.length > 1 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length > 1 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
const hulls = new WeakMap<object, Map<string, readonly Point[]>>();
/** Convex current body, not the bounding rectangle of a wedge or an endpoint union. */
function computeFormationFootprint(s: FormationBody, tick: number): Point[] {
  if (
    ((s.formation?.shape === "column" && !s.formation.transition) ||
      s.formation?.transition?.from === "column") &&
    !formationDoctrine(s.definitionId).hull
  )
    return convexHull(formationFootprints(s, tick).flat());
  const slots = formationSlots(s, tick),
    d = formationDoctrine(s.definitionId);
  const key = `${d.bodyWidth}:${d.bodyDepth}`;
  let cache = hulls.get(slots),
    local = cache?.get(key);
  if (!local) {
    local = convexHull(
      slots.flatMap((p) =>
        [-1, 1].flatMap((x) =>
          [-1, 1].map((y) => ({
            x: p.x + (x * d.bodyWidth) / 2,
            y: p.y + (y * d.bodyDepth) / 2,
          })),
        ),
      ),
    );
    if (!cache) {
      cache = new Map();
      hulls.set(slots, cache);
    }
    cache.set(key, local);
  }
  const angle = formationEnvelope(s, tick).angle,
    c = Math.cos(angle),
    sin = Math.sin(angle);
  return local.map((p) => ({
    x: s.x + p.x * c - p.y * sin,
    y: s.y + p.x * sin + p.y * c,
  }));
}
const travelHulls = new WeakMap<object, Map<string, readonly Point[][]>>();
/** Travel is a union of row envelopes: a bend's empty interior is not occupied. */
function computeFormationFootprints(s: FormationBody, tick: number): Point[][] {
  if (
    !(
      (s.formation?.shape === "column" && !s.formation.transition) ||
      s.formation?.transition?.from === "column"
    ) ||
    formationDoctrine(s.definitionId).hull
  )
    return [formationFootprint(s, tick)];
  const d = formationDoctrine(s.definitionId),
    angle = s.formation!.transition
      ? formationEnvelope(s, tick).angle
      : radians(s.formation!.facing),
    c = Math.cos(angle),
    sin = Math.sin(angle),
    slots = formationSlots(s, tick);
  const key = angle + ":" + d.mounted + ":" + d.bodyWidth;
  let cache = travelHulls.get(slots),
    local = cache?.get(key);
  if (!local) {
    const rows = new Map<number, Point[]>();
    for (const [index, slot] of slots.entries()) {
      const row = Math.floor(index / columnLayout(d).columns);
      const points = rows.get(row) ?? [],
        x = slot.x * c - slot.y * sin,
        y = slot.x * sin + slot.y * c;
      const radius = columnLayout(d).radius;
      // A capsule row stays inside the route planner's circular carrier clearance.
      points.push(
        ...Array.from({ length: 8 }, (_, i) => ({
          x: x + Math.cos((i * Math.PI) / 4) * radius,
          y: y + Math.sin((i * Math.PI) / 4) * radius,
        })),
      );
      rows.set(row, points);
    }
    local = [...rows.values()].map(convexHull);
    if (!cache) {
      cache = new Map();
      travelHulls.set(slots, cache);
    }
    if (cache.size >= 8) cache.delete(cache.keys().next().value!);
    cache.set(key, local);
  }
  return local.map((poly) => poly.map((p) => ({ x: s.x + p.x, y: s.y + p.y })));
}
export function formationPointContact(
  s: FormationBody,
  p: Point,
  tick: number,
) {
  return formationFootprints(s, tick)
    .map((body) => polygonContact([p], body))
    .reduce((a, b) => (b.gap < a.gap ? b : a));
}
export function formationSweepEntry(
  s: FormationBody,
  from: Point,
  to: Point,
  tick: number,
  radius = 0,
): number | null {
  let result: number | null = null;
  for (const body of formationFootprints(s, tick)) {
    const hit = polygonSweepEntry(from, to, body, radius);
    if (hit !== null && (result === null || hit < result)) result = hit;
  }
  return result;
}
function projection(poly: readonly Point[], axis: Point) {
  let min = Infinity,
    max = -Infinity;
  for (const p of poly) {
    const n = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return { min, max };
}
export function polygonsOverlap(
  a: readonly Point[],
  b: readonly Point[],
  skin = 0,
): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i],
        q = poly[(i + 1) % poly.length],
        length = Math.hypot(q.x - p.x, q.y - p.y);
      if (!length) continue;
      const axis = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length },
        pa = projection(a, axis),
        pb = projection(b, axis);
      if (pa.max <= pb.min + skin || pb.max <= pa.min + skin) return false;
    }
  return true;
}
function closest(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = dx * dx + dy * dy,
    t = n
      ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / n))
      : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export interface FormationContact {
  gap: number;
  source: Point;
  target: Point;
  normal: Point;
  frontage: number;
  facing: number;
}
function computeFormationContact(
  a: FormationBody,
  b: FormationBody,
  tick: number,
  apart=formationFootprints(a,tick),
  bpart=formationFootprints(b,tick),
  angle=formationEnvelope(a,tick).angle,
): FormationContact {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    n = Math.hypot(dx, dy);
  let normal = n ? { x: dx / n, y: dy / n } : { x: 0, y: 1 };
  let pair = {
    ap: apart[0],
    bp: bpart[0],
    ...polygonContact(apart[0], bpart[0]),
  };
  const bounds = (poly: readonly Point[]) => ({
    left: Math.min(...poly.map((p) => p.x)),
    right: Math.max(...poly.map((p) => p.x)),
    top: Math.min(...poly.map((p) => p.y)),
    bottom: Math.max(...poly.map((p) => p.y)),
  });
  const abounds = apart.map(bounds),
    bbounds = bpart.map(bounds);
  // AABB distance is a lower bound. Skip distant rows and stop at the first
  // overlap; neither can improve the exact closest pair or its stable tie order.
  search: for (let i = 0; i < apart.length; i++)
    for (let j = 0; j < bpart.length; j++) {
      if (pair.gap === 0) break search;
      const a = abounds[i],
        b = bbounds[j],
        dx = Math.max(0, a.left - b.right, b.left - a.right),
        dy = Math.max(0, a.top - b.bottom, b.top - a.bottom);
      if (dx * dx + dy * dy >= pair.gap * pair.gap) continue;
      const candidate = polygonContact(apart[i], bpart[j]);
      if (candidate.gap < pair.gap)
        pair = { ap: apart[i], bp: bpart[j], ...candidate };
    }
  const { source, target } = pair;
  if (pair.gap <= 1e-8 && (apart.length > 1 || bpart.length > 1)) {
    const centre = (poly: readonly Point[]) =>
      poly.reduce(
        (p, q) => ({ x: p.x + q.x / poly.length, y: p.y + q.y / poly.length }),
        { x: 0, y: 0 },
      );
    const ac = centre(pair.ap),
      bc = centre(pair.bp),
      length = Math.hypot(bc.x - ac.x, bc.y - ac.y);
    if (length > 1e-8)
      normal = { x: (bc.x - ac.x) / length, y: (bc.y - ac.y) / length };
  }
  if (pair.gap > 1e-8)
    normal = {
      x: (target.x - source.x) / pair.gap,
      y: (target.y - source.y) / pair.gap,
    };
  const tangent = { x: -normal.y, y: normal.x },
    ap = projection(pair.ap, tangent),
    bp = projection(pair.bp, tangent);
  return {
    gap: pair.gap,
    source,
    target,
    normal,
    frontage: Math.max(0, Math.min(ap.max, bp.max) - Math.max(ap.min, bp.min)),
    facing: -Math.sin(angle) * normal.x + Math.cos(angle) * normal.y,
  };
}
interface BodyFacts { convex?:Point[];parts?:Point[][] }
interface BodyEntry {key:string;seed:number;kind:Squad['kind'];x:number;y:number;tick:number;value:BodyFacts}
const bodyFacts=new WeakMap<object,BodyEntry[]>();
// Retain physically identical facts across immutable state replacement. Bounded
// by squad identities, not match lifetime; weak pair caches release evicted
// facts naturally. Numeric ownership avoids allocating a registry key per turn.
const physicalBodies=new Map<number,BodyEntry[]>();
function facts(s:FormationBody,tick:number):BodyFacts {
  if(!s.formation)return {};
  const key=physicalGeometryKey(s),seed=s.id%16,time=s.formation.transition?tick:0;
  let entries=bodyFacts.get(s.formation);
  if(!entries){
    entries=physicalBodies.get(s.id);
    if(!entries){entries=[];if(physicalBodies.size>=2048)physicalBodies.delete(physicalBodies.keys().next().value!);physicalBodies.set(s.id,entries);}
    bodyFacts.set(s.formation,entries);
  }
  // Current poses are newest; avoid scanning seven historical poses or
  // allocating a predicate for every repeated contact/footprint lookup.
  for(let i=entries.length-1;i>=0;i--){const e=entries[i];if(e.key===key && e.seed===seed && e.kind===s.kind && e.x===s.x && e.y===s.y && e.tick===time)return e.value;}
  const value={};if(entries.length>=8)entries.shift();entries.push({key,seed,kind:s.kind,x:s.x,y:s.y,tick:time,value});return value;
}
/** Shared immutable geometry facts; candidate poses and transition ticks remain distinct. */
export function formationFootprint(s:FormationBody,tick:number):Point[] {
  const cached=facts(s,tick);return cached.convex??(cached.convex=computeFormationFootprint(s,tick));
}
export function formationFootprints(s:FormationBody,tick:number):Point[][] {
  const cached=facts(s,tick);return cached.parts??(cached.parts=computeFormationFootprints(s,tick));
}
const contacts=new WeakMap<BodyFacts,WeakMap<BodyFacts,FormationContact>>();
/** Owned phase consumers resolve a body once, then use its exact contact facts.
 * Captured scalar coordinates prevent borrowed-record mutation from changing a
 * prepared pose. Formation/manpower containers follow the immutable domain contract.
 */
export class PreparedFormationBody {
  readonly body:FormationBody;
  readonly envelope:ReturnType<typeof formationEnvelope>;
  private readonly cached:BodyFacts;
  constructor(s:FormationBody,private readonly tick:number,envelope=formationEnvelope(s,tick)) {
    this.body={id:s.id,x:s.x,y:s.y,kind:s.kind,troops:s.troops,manpower:s.manpower,
      definitionId:s.definitionId,formation:s.formation,charge:s.charge};
    this.envelope=envelope;this.cached=facts(s,tick);
  }
  private parts():Point[][] {
    return this.cached.parts??(this.cached.parts=computeFormationFootprints(this.body,this.tick));
  }
  contact(other:PreparedFormationBody):FormationContact {
    // Settled bodies are clock-independent and may survive a phase boundary.
    if(this.tick!==other.tick && this.body.formation?.transition && other.body.formation?.transition)
      throw Error('Animated prepared combat geometry belongs to different ticks');
    let rows=contacts.get(this.cached);if(!rows){rows=new WeakMap();contacts.set(this.cached,rows);}
    let result=rows.get(other.cached);
    if(!result){result=computeFormationContact(this.body,other.body,this.tick,this.parts(),other.parts(),this.envelope.angle);rows.set(other.cached,result);}
    return result;
  }
}
export function formationContact(a:FormationBody,b:FormationBody,tick:number):FormationContact {
  const af=facts(a,tick),bf=facts(b,tick);let rows=contacts.get(af);if(!rows){rows=new WeakMap();contacts.set(af,rows);}
  let result=rows.get(bf);if(!result){result=computeFormationContact(a,b,tick);rows.set(bf,result);}return result;
}
/** Conservative rejection only: passing still requires the exact contact test. */
export function formationWithinReach(a:FormationBody,b:FormationBody,tick:number,reach:number):boolean {
  const ae=formationEnvelope(a,tick),be=formationEnvelope(b,tick),dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
  if(dx>ae.halfX+be.halfX+reach || dy>ae.halfY+be.halfY+reach)return false;
  const radius=ae.broadRadius+be.broadRadius+reach;
  return dx*dx+dy*dy<=radius*radius;
}
/** Squared lower bound on exact body separation, suitable for nearest searches. */
export function formationSeparationLowerBound(a:FormationBody,b:FormationBody,tick:number):number {
  const ae=formationEnvelope(a,tick),be=formationEnvelope(b,tick);
  const dx=Math.max(0,Math.abs(b.x-a.x)-ae.halfX-be.halfX),dy=Math.max(0,Math.abs(b.y-a.y)-ae.halfY-be.halfY);
  return dx*dx+dy*dy;
}
export function polygonContact(
  pa: readonly Point[],
  pb: readonly Point[],
): { gap: number; source: Point; target: Point } {
  const contains = (poly: readonly Point[], p: Point) =>
    poly.length >= 3 &&
    poly.every((a, i) => cross(a, poly[(i + 1) % poly.length], p) >= -1e-8);
  const shared =
    pa.find((p) => contains(pb, p)) ?? pb.find((p) => contains(pa, p));
  if (shared) return { gap: 0, source: shared, target: shared };
  let source = pa[0],
    target = pb[0],
    best = Infinity;
  for (let i = 0; i < pa.length; i++)
    for (let j = 0; j < pb.length; j++) {
      const ae = pa[(i + 1) % pa.length],
        be = pb[(j + 1) % pb.length];
      const ax = ae.x - pa[i].x,
        ay = ae.y - pa[i].y,
        bx = be.x - pb[j].x,
        by = be.y - pb[j].y,
        det = ax * by - ay * bx;
      if (Math.abs(det) > 1e-8) {
        const vx = pb[j].x - pa[i].x,
          vy = pb[j].y - pa[i].y,
          t = (vx * by - vy * bx) / det,
          u = (vx * ay - vy * ax) / det;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
          source = { x: pa[i].x + t * ax, y: pa[i].y + t * ay };
          target = source;
          best = 0;
          return { gap: 0, source, target };
        }
      }
      // Preserve source/target tie order, but allocate only a winning anchor.
      const bl=bx*bx+by*by,bt=bl?Math.max(0,Math.min(1,((pa[i].x-pb[j].x)*bx+(pa[i].y-pb[j].y)*by)/bl)):0;
      const qx=pb[j].x+bt*bx,qy=pb[j].y+bt*by,dq=(pa[i].x-qx)**2+(pa[i].y-qy)**2;
      if(dq<best){best=dq;source=pa[i];target={x:qx,y:qy};}
      const al=ax*ax+ay*ay,at=al?Math.max(0,Math.min(1,((pb[j].x-pa[i].x)*ax+(pb[j].y-pa[i].y)*ay)/al)):0;
      const px=pa[i].x+at*ax,py=pa[i].y+at*ay,dp=(px-pb[j].x)**2+(py-pb[j].y)**2;
      if(dp<best){best=dp;source={x:px,y:py};target=pb[j];}
    }
  const overlapping = polygonsOverlap(pa, pb);
  if (overlapping) {
    const mid = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
    source = mid;
    target = mid;
  }
  return { gap: overlapping ? 0 : Math.sqrt(best), source, target };
}
function computeContactParticipants(
  s: FormationBody,
  target: FormationBody,
  tick: number,
  ranks = 2,
  contact = formationContact(s, target, tick),
  edgeCombat = false,
): number {
  if (contact.facing < FACING.participantCos && !edgeCombat) return 0;
  const d=formationDoctrine(s.definitionId),layout=layoutGrid(s.troops,formationEnvelope(s,tick).shape,d,s.formation?.frontage);
  const angle=formationEnvelope(s,tick).angle,side=Math.abs(Math.cos(angle)*contact.normal.x+Math.sin(angle)*contact.normal.y)>Math.abs(contact.facing);
  const spacing=Math.max(side?d.bodyDepth:d.bodyWidth,side?layout.rankPitch:layout.pitch);
  const activeRanks =
    s.formation?.transition || formationEnvelope(s,tick).shape==='modern-loose' || (!edgeCombat && contact.facing < FACING.fullRanksCos) ? 1 : ranks;
  return Math.min(
    s.troops,
    Math.min(side?layout.rows:layout.columns, Math.max(1, Math.ceil(contact.frontage / spacing))) * Math.min(side?layout.columns:layout.rows,activeRanks),
  );
}
const participantFacts=new WeakMap<BodyFacts,WeakMap<FormationContact,Map<number,number>>>();
/** Contact identity already captures both current bodies; ranks remain profile-specific. */
export function contactParticipants(s:FormationBody,target:FormationBody,tick:number,ranks=2,contact=formationContact(s,target,tick),edgeCombat=false):number {
  const body=facts(s,tick);let contacts=participantFacts.get(body);
  if(!contacts){contacts=new WeakMap();participantFacts.set(body,contacts);}
  let values=contacts.get(contact);if(!values){values=new Map();contacts.set(contact,values);}
  const key=ranks*2+Number(edgeCombat),cached=values.get(key);if(cached!==undefined)return cached;
  const value=computeContactParticipants(s,target,tick,ranks,contact,edgeCombat);values.set(key,value);return value;
}
/** Bounded radial approach, solved against the same current boundaries as combat. */
export function formationApproach(
  s: FormationBody,
  target: FormationBody,
  tick: number,
  reach: number,
  angle = Math.atan2(s.y - target.y, s.x - target.x),
): Point {
  // A travel carrier leads its trail; do not steer a rigid convex hull through
  // a bend or fill the target column's empty interior during approach planning.
  const sourcePart =
    s.formation?.shape === "column" && !s.formation.transition
      ? formationFootprints(s, tick)[0]
      : formationFootprint(s, tick);
  const source = sourcePart.map((p) => ({ x: p.x - s.x, y: p.y - s.y }));
  const u = { x: Math.cos(angle), y: Math.sin(angle) },
    r = Math.max(0, reach - 1);
  const far =
    formationEnvelope(s, tick).broadRadius +
    formationEnvelope(target, tick).broadRadius +
    reach +
    FIXED;
  let distance = 0;
  for (const part of formationFootprints(target, tick)) {
    const body = part.map((p) => ({ x: p.x - target.x, y: p.y - target.y }));
    const poly = convexHull(
      body.flatMap((b) => source.map((a) => ({ x: b.x - a.x, y: b.y - a.y }))),
    );
    const entry = polygonSweepEntry(
      { x: u.x * far, y: u.y * far },
      { x: 0, y: 0 },
      poly,
    );
    let candidate = entry === null ? 0 : far * (1 - entry);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      const along = a.x * u.x + a.y * u.y,
        perp = a.x * u.y - a.y * u.x;
      if (Math.abs(perp) <= r)
        candidate = Math.max(
          candidate,
          along + Math.sqrt(Math.max(0, r * r - perp * perp)),
        );
      const normal = { x: -dy / length, y: dx / length },
        den = u.x * normal.x + u.y * normal.y;
      if (Math.abs(den) < 1e-10) continue;
      for (const sign of [-1, 1]) {
        const hit = (a.x * normal.x + a.y * normal.y + sign * r) / den;
        const t =
          ((u.x * hit - a.x) * dx + (u.y * hit - a.y) * dy) / (length * length);
        if (hit >= 0 && t >= 0 && t <= 1) candidate = Math.max(candidate, hit);
      }
    }
    distance = Math.max(distance, candidate);
  }
  return {
    x: Math.round(target.x + u.x * distance),
    y: Math.round(target.y + u.y * distance),
  };
}
/** Test occupied cells of one convex envelope; a hard cap prevents unbounded scans. */
export function certifyFootprint(
  map: GameMap,
  polygon: readonly Point[],
  blocked: (tile: number) => boolean,
  amphibious = false,
  softDepth = 0,
): boolean {
  if (!polygon.length) return false;
  const x0 = Math.floor(Math.min(...polygon.map((p) => p.x)) / FIXED),
    x1 = Math.floor(Math.max(...polygon.map((p) => p.x)) / FIXED),
    y0 = Math.floor(Math.min(...polygon.map((p) => p.y)) / FIXED),
    y1 = Math.floor(Math.max(...polygon.map((p) => p.y)) / FIXED);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return false;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const valid = map.isValidCoord(x, y);
      const ref = valid ? map.ref(x, y) : 0;
      if (valid && passableCell(map, ref, amphibious) && !blocked(ref))
        continue;
      const tile = [
        { x: x * FIXED, y: y * FIXED },
        { x: (x + 1) * FIXED, y: y * FIXED },
        { x: (x + 1) * FIXED, y: (y + 1) * FIXED },
        { x: x * FIXED, y: (y + 1) * FIXED },
      ];
      if (!polygonsOverlap(polygon, tile, 0.01)) continue;
      if (
        valid &&
        !map.isLand(ref) &&
        !map.isImpassable(ref) &&
        !blocked(ref) &&
        withinShoreline(map, polygon, x, y, softDepth)
      )
        continue;
      return false;
    }
  return true;
}
export function transitionFootprint(
  s: FormationBody,
  start: number,
  end: number,
): Point[] {
  const completed = s.formation?.transition
    ? formationFootprint(
        { ...s, formation: { ...s.formation, transition: undefined } },
        end,
      )
    : [];
  // With a fixed facing, every member follows a straight segment. Endpoint
  // hulls plus rounding skin contain the entire sweep without per-tick sampling.
  if (s.formation?.transition?.fromFacing === s.formation?.facing) {
    return convexHull(
      [
        ...formationFootprint(s, start),
        ...formationFootprint(s, end),
        ...completed,
      ].flatMap((p) =>
        [-1, 1].flatMap((x) =>
          [-1, 1].map((y) => ({ x: p.x + 2 * x, y: p.y + 2 * y })),
        ),
      ),
    );
  }
  const points: Point[] = [...completed];
  // Canonical transitions are at most 200 ticks. Each adjacent convex hull
  // conservatively reserves member travel between authoritative poses.
  for (let tick = start; tick <= end; tick++)
    points.push(...formationFootprint(s, tick));
  const transition = s.formation?.transition;
  const angle = transition
    ? Math.abs(
        Math.atan2(
          Math.sin(
            formationEnvelope(s, end).angle - formationEnvelope(s, start).angle,
          ),
          Math.cos(
            formationEnvelope(s, end).angle - formationEnvelope(s, start).angle,
          ),
        ),
      ) / Math.max(1, end - start)
    : 0;
  const radius = formationEnvelope(s, start).broadRadius;
  const skin =
    Math.ceil(
      radius * (1 - Math.cos(angle / 2)) + (radius * angle * angle) / 4,
    ) + 2;
  return convexHull(
    convexHull(points).flatMap((p) =>
      [-1, 1].flatMap((x) =>
        [-1, 1].map((y) => ({ x: p.x + x * skin, y: p.y + y * skin })),
      ),
    ),
  );
}

/** Reserve a turn's swept body, including intermediate angles of a half-turn. */
function computeRotationFootprint(
  s: FormationBody,
  tick: number,
  facing: number,
): Point[] {
  const current = formationEnvelope(s, tick).angle,
    to = (facing * Math.PI * 2) / 65536,
    delta = Math.atan2(Math.sin(to - current), Math.cos(to - current));
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 36))),
    points: Point[] = [];
  for (let i = 0; i <= steps; i++)
    points.push(
      ...formationFootprint(
        {
          ...s,
          formation: {
            ...s.formation!,
            facing:
              ((Math.round(
                ((current + (delta * i) / steps) * 65536) / (2 * Math.PI),
              ) %
                65536) +
                65536) %
              65536,
            transition: undefined,
          },
        },
        tick,
      ),
    );
  const skin =
    Math.ceil(
      formationEnvelope(s, tick).broadRadius *
        (1 - Math.cos(delta / steps / 2)),
    ) + 2;
  return convexHull(
    convexHull(points).flatMap((p) =>
      [-1, 1].flatMap((x) =>
        [-1, 1].map((y) => ({ x: p.x + x * skin, y: p.y + y * skin })),
      ),
    ),
  );
}
const rotationFacts=new WeakMap<BodyFacts,Map<number,Point[]>>();
/** A stalled turn reuses its sweep; a changed body or root gets a new facts identity. */
export function rotationFootprint(s:FormationBody,tick:number,facing:number):Point[] {
  const body=facts(s,tick);let values=rotationFacts.get(body);
  if(!values){values=new Map();rotationFacts.set(body,values);}
  let value=values.get(facing);if(value)return value;
  value=computeRotationFootprint(s,tick,facing);
  if(values.size>=8)values.delete(values.keys().next().value!);values.set(facing,value);return value;
}
