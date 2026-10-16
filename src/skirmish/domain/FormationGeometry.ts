import {secondsToTicks} from '../Protocol';
import {TICKS_PER_SECOND} from '../Protocol';
import { formationProfile, frontageLayout, type ShapeProfile } from "./FormationProfiles";
import { minimumTravelAssignment } from './FormationSlotAssignment';
import { FIXED, type Squad } from "../Protocol";
import doctrines from "../content/formation-doctrines.json";
import { SOLDIER_SCALE, CAVALRY_SPACING, CAVALRY_SCALE, CAVALRY_PITCH } from '../content/SoldierScale';
export const FORMATION_SHAPES = [
  "mass",
  "shield-wall",
  "square",
  "line",
  "wedge",
  "modern-loose",
  "column",
] as const;
export type FormationShape = (typeof FORMATION_SHAPES)[number];
export const TURN = 65536;
export interface FormationState {
  /** Purchased trench anchors in the formation coordinate basis. */
  occupationSlots?: readonly {x:number;y:number;row:number}[];
  shape: FormationShape;
  frontage?: number;
  preferredFrontage?: number;
  autoFrontage?: boolean;
  shapeLock?: boolean;
  facing: number;
  mode: "deployed" | "travel";
  revision: number;
  layoutTroops?: number;
  blocked?: boolean;
  blockedSince?: number;
  settledSince?: number;
  /** Player intent survives temporary travel geometry. */
  deployedShape?: FormationShape;
  deploymentFacing?: number;
  automatic?: boolean;
  lastDeployTick?: number;
  retryTick?: number;
  /** World-axis offsets from the carrier, oldest to newest. Bounded route history. */
  trail?: readonly { x: number; y: number }[];
  transition?: {
    /** Position-preserving orientation reform; translation remains admitted. */
    reorientation?: boolean;
    occupationReform?: boolean;
    from: FormationShape;
    fromFrontage?:number;
    fromAutomatic?:boolean;
    fromAutoFrontage?:boolean;
    fromFacing: number;
    startTick: number;
    duration: number;
    fromSlots?: readonly { x: number; y: number; row: number }[];
  };
}
export interface FormationDoctrine {
  shapeProfiles?: Partial<Record<FormationShape, ShapeProfile>>;
  shapes: FormationShape[];
  defaultShape: FormationShape;
  shieldEquipment: boolean;
  mounted: boolean;
  hull: boolean;
  spacing: number;
  bodyWidth: number;
  bodyDepth: number;
  transitionTicks: number;
}
const fallback: FormationDoctrine = {
  shapes: ["mass"],
  defaultShape: "mass",
  shieldEquipment: false,
  mounted: false,
  hull: false,
  spacing: 128,
  bodyWidth: 128,
  bodyDepth: 128,
  transitionTicks: TICKS_PER_SECOND,
};
const scaledDoctrines = new WeakMap<FormationDoctrine, FormationDoctrine>();
export function formationDoctrine(id?: string): FormationDoctrine {
  const authored = (
    (doctrines.doctrines[id as keyof typeof doctrines.doctrines] as
      | FormationDoctrine
      | undefined) ?? fallback
  );
  if (authored.hull || SOLDIER_SCALE === 1 && (!authored.mounted || CAVALRY_SPACING === 1)) return authored;
  let scaled = scaledDoctrines.get(authored);
  if (!scaled) {
    scaled = {...authored, spacing: Math.round(authored.spacing * SOLDIER_SCALE * (authored.mounted?CAVALRY_SPACING:1)),
      bodyWidth: Math.round(authored.bodyWidth * SOLDIER_SCALE * (authored.mounted?CAVALRY_SCALE:1)),
      bodyDepth: Math.round(authored.bodyDepth * SOLDIER_SCALE * (authored.mounted?CAVALRY_SCALE:1))};
    scaledDoctrines.set(authored, scaled);
  }
  return scaled;
}
export function createFormation(id?: string): FormationState {
  const shape = formationDoctrine(id).defaultShape;
  return {
    shape,
    facing: 0,
    mode: shape === "column" ? "travel" : "deployed",
    revision: 0,
  };
}
export function radians(facing: number): number {
  return (facing * Math.PI * 2) / TURN;
}
export function facingOf(angle: number): number {
  return ((Math.round((angle * TURN) / (2 * Math.PI)) % TURN) + TURN) % TURN;
}
/** Change coordinate basis without rotating occupied member positions. The
 * destination receives nearest sources once, then interpolates local travel. */
export function reorientedFormation(s:Squad,tick:number,facing:number):FormationState {
  const old=s.formation??createFormation(s.definitionId),angle=formationEnvelope(s,tick).angle-radians(facing),c=Math.cos(angle),sin=Math.sin(angle);
  const source=formationSlots(s,tick).map(p=>({...p,x:Math.round(p.x*c-p.y*sin),y:Math.round(p.x*sin+p.y*c)}));
  const formation={...old,facing,transition:undefined,revision:old.revision+1};
  const to=formationSlots({...s,formation},tick),assignment=minimumTravelAssignment(source,to);
  const distance=Math.max(0,...to.map((p,i)=>Math.hypot(p.x-source[assignment[i]].x,p.y-source[assignment[i]].y)));
  return {...formation,transition:{reorientation:true,from:formationEnvelope(s,tick).shape,fromFacing:facing,fromSlots:source,startTick:tick,duration:Math.min(secondsToTicks(10),Math.max(1,Math.ceil(distance*TICKS_PER_SECOND/(FIXED*2.5))))}};
}
export function geometryKey(
  s: Pick<
    Squad,
    "troops" | "manpower" | "formation" | "definitionId" | "charge"
  >,
): string {
  const f = s.formation;
  const cached=f?geometryKeys.get(f):undefined,t=f?.transition;
  if(cached && cached.definition===s.definitionId && cached.troops===s.troops && cached.capacity===s.manpower?.capacity && cached.variant===s.manpower?.variant && cached.charge===s.charge?.phase &&
    cached.revision===f!.revision && cached.shape===f!.shape && cached.facing===f!.facing && cached.frontage===f!.frontage && cached.mode===f!.mode && cached.trail===f!.trail && cached.transition===t && cached.from===t?.from && cached.fromFacing===t?.fromFacing && cached.fromFrontage===t?.fromFrontage && cached.start===t?.startTick && cached.duration===t?.duration && cached.slots===t?.fromSlots && cached.occupationSlots===f!.occupationSlots)return cached.key;
  const values = [
    s.definitionId,
    s.troops,
    s.manpower?.capacity,
    s.manpower?.variant,
    f?.revision,f?.shape,f?.facing,f?.frontage,f?.mode,
    f?.transition?.from,f?.transition?.fromFacing,f?.transition?.fromFrontage,
    f?.transition?.startTick,f?.transition?.duration,
    arrayGeometryKey(f?.trail),arrayGeometryKey(f?.transition?.fromSlots),arrayGeometryKey(f?.occupationSlots),
    s.charge?.phase,
  ];
  const key=values.join(':'),physicalKey=values.filter((_value,index)=>index!==4).join(':');
  if(f)geometryKeys.set(f,{key,physicalKey,definition:s.definitionId,troops:s.troops,capacity:s.manpower?.capacity,variant:s.manpower?.variant,charge:s.charge?.phase,revision:f.revision,shape:f.shape,facing:f.facing,frontage:f.frontage,mode:f.mode,trail:f.trail,transition:t,from:t?.from,fromFacing:t?.fromFacing,fromFrontage:t?.fromFrontage,start:t?.startTick,duration:t?.duration,slots:t?.fromSlots,occupationSlots:f.occupationSlots});
  return key;
}
interface GeometryKeyFacts {occupationSlots?:FormationState['occupationSlots'];key:string;physicalKey:string;definition?:string;troops:number;capacity?:number;variant?:string;charge?:string;revision:number;shape:FormationShape;facing:number;frontage?:number;mode:string;trail?:FormationState['trail'];transition?:FormationState['transition'];from?:FormationShape;fromFacing?:number;fromFrontage?:number;start?:number;duration?:number;slots?:NonNullable<FormationState['transition']>['fromSlots']}
const geometryKeys=new WeakMap<FormationState,GeometryKeyFacts>();
/** Physical cache identity excludes only the administrative revision counter.
 * The public geometry revision remains unchanged for replication and consumers. */
export function physicalGeometryKey(s:Parameters<typeof geometryKey>[0]):string {
  const key=geometryKey(s);return s.formation?geometryKeys.get(s.formation)!.physicalKey:key;
}
// Trails and captured transition slots are immutable domain values. Their
// content keys are encoded once, and are stable across checkpoint restoration.
const arrayKeys=new WeakMap<object,string>();
function arrayGeometryKey(points:readonly {x:number;y:number;row?:number}[]|undefined):string {
  if(!points)return '';
  let key=arrayKeys.get(points);if(key===undefined){key=points.map(p=>`${p.x},${p.y},${p.row??''}`).join(';');arrayKeys.set(points,key);}return key;
}
/** Army layout caches exclude movement-facing changes, but include roster/shape changes. */
export function formationLayoutKey(
  s: Pick<Squad, "id" | "definitionId" | "troops" | "manpower" | "formation">,
): string {
  return JSON.stringify([
    s.id,
    s.definitionId,
    s.troops,
    s.manpower?.capacity,
    s.manpower?.variant,
    s.formation?.automatic || s.formation?.autoFrontage ? s.formation.deployedShape : s.formation?.shape,
    s.formation?.preferredFrontage ?? s.formation?.frontage,
    s.formation?.shapeLock,
  ]);
}
function shapeOf(
  s: Pick<Squad, "formation" | "definitionId" | "charge">,
): FormationShape {
  const d = formationDoctrine(s.definitionId);
  return s.formation?.shape ?? d.defaultShape;
}
/** Compact travel dimensions shared by templates, trail retention and certificates. */
export function columnLayout(d: FormationDoctrine) {
  const scale = d.hull ? 1 : SOLDIER_SCALE;
  return {
    columns: d.mounted ? 1 : 2,
    spacing: d.mounted ? Math.round(FIXED * scale * CAVALRY_PITCH) : Math.floor(FIXED * 0.375 * scale),
    radius: d.mounted ? Math.round(0.45 * FIXED * scale * CAVALRY_SCALE) : d.bodyWidth / 2 - 3 * scale,
  };
}
export function layoutGrid(count: number, shape: FormationShape, d: FormationDoctrine, frontage?:number) {
  const flexible=shape==="mass" && frontage===undefined ? undefined : frontageLayout(count,d,shape,frontage);
  if(flexible && !(shape==="mass" && frontage===undefined))return {pitch:flexible.pitch,rankPitch:flexible.rankPitch,columns:flexible.files,rows:flexible.ranks,width:flexible.width,depth:flexible.depth};
  const pitch =
    shape === "column"
      ? columnLayout(d).spacing
      : shape === "modern-loose"
        ? Math.round(d.spacing * 1.75)
        : d.spacing;
  const columns =
    shape === "column"
      ? d.hull
        ? 1
        : columnLayout(d).columns
      : Math.max(
          1,
          Math.min(
            count,
            shape === "line"
              ? Math.ceil(Math.sqrt(count * 4))
              : shape === "shield-wall"
                ? Math.ceil(count / 2)
                : shape === "wedge"
                  ? Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2)
                  : Math.ceil(Math.sqrt(count)),
          ),
        );
  const rows = Math.max(
    1,
    shape === "wedge" ? columns : Math.ceil(count / columns),
  );
  return {
    pitch,
    rankPitch:pitch,
    columns,
    rows,
    width: (columns - 1) * pitch + d.bodyWidth,
    depth: (rows - 1) * pitch + d.bodyDepth,
  };
}
/** Pure dimensions, without allocating member positions or consulting artwork. */
function computeFormationEnvelope(
  s: Pick<
    Squad,
    | "id"
    | "troops"
    | "manpower"
    | "formation"
    | "definitionId"
    | "charge"
    | "kind"
  >,
  tick: number,
) {
  const d = formationDoctrine(s.definitionId),
    f = s.formation ?? createFormation(s.definitionId),
    shape = shapeOf(s);
  const count = d.hull
    ? 1
    : Math.max(1, Math.min(s.troops, s.manpower?.capacity ?? 144));
  const to = template(count, shape, d, s.id, f.frontage),
    t = f.transition;
  const progress = t
    ? Math.max(0, Math.min(1, (tick - t.startTick) / t.duration))
    : 1;
  const from = t ? template(count, t.from, d, s.id,t.fromFrontage) : to;
  const slots = t || f.trail || f.occupationSlots ? formationSlots(s, tick) : undefined;
  const width =
      t || f.trail || f.occupationSlots
        ? Math.ceil(
            2 * Math.max(...slots!.map((p) => Math.abs(p.x))) + d.bodyWidth,
          )
        : to.width,
    depth =
      t || f.trail || f.occupationSlots
        ? Math.ceil(
            2 * Math.max(...slots!.map((p) => Math.abs(p.y))) + d.bodyDepth,
          )
        : to.depth;
  const sourceRadius = t?.fromSlots
    ? Math.max(
        ...t.fromSlots.map((p) =>
          Math.hypot(
            Math.abs(p.x) + d.bodyWidth / 2,
            Math.abs(p.y) + d.bodyDepth / 2,
          ),
        ),
      )
    : Math.hypot(from.width, from.depth) / 2;
  const fromAngle = t ? radians(t.fromFacing) : radians(f.facing),
    delta = Math.atan2(
      Math.sin(radians(f.facing) - fromAngle),
      Math.cos(radians(f.facing) - fromAngle),
    );
  const angle = fromAngle + delta * progress,
    c = Math.abs(Math.cos(angle)),
    sin = Math.abs(Math.sin(angle));
  return {
    shape,
    mode: f.mode,
    revision: geometryKey(s),
    width,
    depth,
    angle,
    progress,
    radius: Math.ceil(Math.hypot(width, depth) / 2),
    // Transitions reserve a conservative envelope, independent of render tick.
    broadRadius: Math.ceil(
      Math.max(
        sourceRadius,
        Math.hypot(to.width, to.depth) / 2,
        Math.hypot(width, depth) / 2,
      ),
    ),
    halfX: Math.ceil((width * c + depth * sin) / 2),
    halfY: Math.ceil((width * sin + depth * c) / 2),
    navigationRadius: Math.round(FIXED * (s.kind === "cavalry" ? 0.48 : 0.45) * (d.hull ? 1 : SOLDIER_SCALE) * (d.mounted ? CAVALRY_SCALE : 1)),
  };
}
interface EnvelopeEntry {key:string;seed:number;kind:Squad['kind'];tick:number;value:ReturnType<typeof computeFormationEnvelope>}
const envelopes=new WeakMap<FormationState,EnvelopeEntry[]>();
export function formationEnvelope(s:Parameters<typeof computeFormationEnvelope>[0],tick:number):ReturnType<typeof computeFormationEnvelope> {
  if(!s.formation)return computeFormationEnvelope(s,tick);
  const key=geometryKey(s),seed=s.id%16,time=s.formation.transition?tick:0;
  let entries=envelopes.get(s.formation);
  if(entries)for(let i=entries.length-1;i>=0;i--){const cached=entries[i];if(cached.key===key && cached.seed===seed && cached.kind===s.kind && cached.tick===time)return cached.value;}
  // Movement alternates current and next-tick poses. Keep both rather than
  // repeatedly evicting the current pose while certifying future occupancy.
  const value=computeFormationEnvelope(s,tick);
  if(!entries){entries=[];envelopes.set(s.formation,entries);}
  if(entries.length>=4)entries.shift();
  entries.push({key,seed,kind:s.kind,tick:time,value});return value;
}
function buildSlots(
  count: number,
  shape: FormationShape,
  d: FormationDoctrine,
  seed: number,
  frontage?:number,
) {
  const g = layoutGrid(count, shape, d, frontage),
    out: { x: number; y: number; row: number }[] = [];
  // The incomplete rank belongs at the rear (row 0, lowest y); the front is +y.
  const rearCount = count - (Math.ceil(count / g.columns) - 1) * g.columns;
  for (let i = 0; i < count; i++) {
    let row = Math.floor(i / g.columns),
      column = i % g.columns,
      rowCount = Math.min(g.columns, count - row * g.columns);
    if (shape !== "wedge" && shape !== "column") {
      if (i < rearCount) {
        row = 0;
        column = i;
        rowCount = rearCount;
      } else {
        const j = i - rearCount;
        row = 1 + Math.floor(j / g.columns);
        column = j % g.columns;
        rowCount = g.columns;
      }
    }
    if (shape === "wedge") {
      row = 0;
      let rest = i;
      while (rest > row) {
        rest -= ++row;
      }
      column = rest;
      rowCount = Math.min(row + 1, count - (row * (row + 1)) / 2);
    }
    let x =
        (column - ((shape === "column" ? g.columns : rowCount) - 1) / 2) *
        g.pitch,
      y =
        shape === "column"
          ? -row * g.pitch
          : (row - (g.rows - 1) / 2) * g.rankPitch;
    if (shape === "wedge") y = -y;
    if (shape === "mass" || shape === "modern-loose") {
      const hash = (seed * 1664525 + i * 1013904223) >>> 0;
      x += (((hash % 17) - 8) * g.pitch) / 80;
      y += ((((hash >>> 8) % 17) - 8) * g.pitch) / 80;
    }
    out.push({ x: Math.round(x), y: Math.round(y), row: Math.round(y) });
  }
  const cx = shape === "column" ? 0 : out.reduce((n, p) => n + p.x, 0) / count,
    cy = shape === "column" ? 0 : out.reduce((n, p) => n + p.y, 0) / count;
  const centered=out.map((p) => ({
    ...p,
    x: Math.round(p.x - cx),
    y: Math.round(p.y - cy),
  }));
  if(shape==="mass" && frontage===undefined){const rx=Math.max(...centered.map(p=>Math.abs(p.x))),ry=Math.max(...centered.map(p=>Math.abs(p.y))),ratio=(2*rx+d.bodyWidth)/(2*ry+d.bodyDepth),profile=formationProfile(d,shape);if(!profile || ratio>=profile.aspectBp.min/10000 && ratio<=profile.aspectBp.max/10000)return centered;}
  if(formationProfile(d,shape)) {
    const minX=Math.min(...centered.map(p=>p.x)),maxX=Math.max(...centered.map(p=>p.x)),minY=Math.min(...centered.map(p=>p.y)),maxY=Math.max(...centered.map(p=>p.y));
    const rx=(maxX-minX)/2,ry=(maxY-minY)/2,cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    const hx=(g.width-d.bodyWidth)/2,hy=(g.depth-d.bodyDepth)/2;
    // Keep all irregular offsets inside the approved real-body envelope.
    return centered.map(p=>({...p,x:rx?Math.trunc((p.x-cx)*hx/rx):0,y:ry?Math.trunc((p.y-cy)*hy/ry):0,row:ry?Math.trunc((p.y-cy)*hy/ry):0}));
  }
  return centered;
}
type Slots = readonly Readonly<{ x: number; y: number; row: number }>[];
interface SlotEntry { definition?: string; doctrine: FormationDoctrine; seed: number; count: number; shape: FormationShape; frontage?: number; progress: number; slots: Slots }
const slotCache = new WeakMap<FormationState, SlotEntry[]>();
export function formationSlots(
  s: Pick<
    Squad,
    | "id"
    | "troops"
    | "manpower"
    | "formation"
    | "definitionId"
    | "charge"
    | "kind"
  >,
  tick: number,
  doctrineOverride?: FormationDoctrine,
) {
  const d = doctrineOverride ?? formationDoctrine(s.definitionId),
    count = d.hull
      ? 1
      : Math.max(1, Math.min(s.troops, s.manpower?.capacity ?? 144)),
    f = s.formation ?? createFormation(s.definitionId),
    shape = shapeOf(s);
  const seed = s.id % 16, t = f.transition,
    p = t ? Math.max(0, Math.min(1, (tick - t.startTick) / t.duration)) : 1;
  let cache = slotCache.get(f);
  if (cache) for (let i = cache.length - 1; i >= 0; i--) {
    const entry = cache[i];
    if (entry.definition === s.definitionId && entry.doctrine === d && entry.seed === seed && entry.count === count &&
      entry.shape === shape && entry.frontage === f.frontage && entry.progress === p) return entry.slots;
  }
  if (!cache) { cache = []; slotCache.set(f, cache); }
  const remember = (result: Slots) => {
    if (cache!.length >= 8) cache!.shift();
    cache!.push({ definition: s.definitionId, doctrine: d, seed, count, shape, frontage: f.frontage, progress: p, slots: result });
    return result;
  };
  const base = f.occupationSlots ? f.occupationSlots.slice(0,count) : template(count, shape, d, s.id, f.frontage).slots;
  const to =
      shape === "column" && f.trail?.length
        ? trailSlots(base, f.trail, radians(f.facing))
        : base;
  const source =
    t?.fromSlots ?? (t ? template(count, t.from, d, s.id, t.fromFrontage).slots : to);
  const from=t?assignedTransitionSources(source,to,t.from==='column'?columnLayout(d).columns:1):source;
  if (p >= 1) return remember(to);
  if (p <= 0 && from.length === count) return remember(from);
  return remember(
    Object.freeze(
      to.map((slot, i) =>
        Object.freeze({
          ...slot,
          x: Math.round(
            (from[i] ?? slot).x + (slot.x - (from[i] ?? slot).x) * p,
          ),
          y: Math.round(
            (from[i] ?? slot).y + (slot.y - (from[i] ?? slot).y) * p,
          ),
        }),
      ),
    ),
  );
}
const transitionAssignments=new Map<string,Slots>();
const assignmentPairs = new WeakMap<object, WeakMap<object, Map<number, Slots>>>();
function assignedTransitionSources(source:readonly Readonly<{x:number;y:number;row:number}>[],to:readonly Readonly<{x:number;y:number;row:number}>[],groupSize:number) {
  let destinations = assignmentPairs.get(source);
  const known = destinations?.get(to)?.get(groupSize); if (known) return known;
  const rememberPair = (result: Slots) => {
    if (!destinations) { destinations = new WeakMap(); assignmentPairs.set(source, destinations); }
    let groups = destinations.get(to); if (!groups) { groups = new Map(); destinations.set(to, groups); }
    groups.set(groupSize, result); return result;
  };
  const key=`${groupSize}:${arrayGeometryKey(source)}|${arrayGeometryKey(to)}`;
  let result=transitionAssignments.get(key);if(result)return rememberPair(result);
  const sources=to.map((slot,i)=>source[i]??slot);
  if(groupSize===1)result=minimumTravelAssignment(sources,to).map(i=>sources[i]);
  else {
    // Column row capsules must retain their member grouping while unfolding;
    // matching individual soldiers across rows would fill a bend's empty interior.
    const groups=(points:typeof sources)=>Array.from({length:Math.ceil(points.length/groupSize)},(_,i)=>points.slice(i*groupSize,(i+1)*groupSize));
    const sg=groups(sources),tg=groups([...to]),center=(g:typeof sources)=>({x:g.reduce((n,p)=>n+p.x,0)/g.length,y:g.reduce((n,p)=>n+p.y,0)/g.length});
    // A trailing partial row must remain partial at the destination, otherwise
    // flattening the assignment changes the capsule membership boundaries.
    const complete=tg.filter(g=>g.length===groupSize).length;
    const assignment=minimumTravelAssignment(sg.slice(0,complete).map(center),tg.slice(0,complete).map(center));
    if(complete<tg.length)assignment.push(complete);
    result=assignment.flatMap((i,j)=>minimumTravelAssignment(sg[i],tg[j]).map(k=>sg[i][k]));
  }
  result=Object.freeze(result);
  if(transitionAssignments.size>=128)transitionAssignments.delete(transitionAssignments.keys().next().value!);transitionAssignments.set(key,result);return rememberPair(result);
}
export function validateFormation(
  value: FormationState | undefined,
  id?: string,
  troops?:number,
  validatedArrays?: WeakSet<object>,
): void {
  if (value === undefined) return;
  if (!value) throw new Error("Invalid formation state");
  const d = formationDoctrine(id),
    integer = (n: number, max = Number.MAX_SAFE_INTEGER) =>
      Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (
    !d.shapes.includes(value.shape) ||
    !integer(value.facing, TURN - 1) ||
    !integer(value.revision) ||
    value.mode !== (value.shape === "column" ? "travel" : "deployed")
  )
    throw new Error("Invalid formation state");
  if (
    (value.layoutTroops !== undefined &&
      (!integer(value.layoutTroops, 144) || !value.layoutTroops)) ||
    (value.blocked !== undefined && typeof value.blocked !== "boolean")
  )
    throw new Error("Invalid formation layout state");
  if (
    (value.deployedShape !== undefined &&
      (!d.shapes.includes(value.deployedShape) ||
        value.deployedShape === "column")) ||
    (value.deploymentFacing !== undefined &&
      !integer(value.deploymentFacing, TURN - 1)) ||
    (value.automatic !== undefined && typeof value.automatic !== "boolean") ||
    (value.automatic && value.shape !== "column") ||
    (value.blockedSince !== undefined &&
      (!integer(value.blockedSince) || !value.transition)) ||
    (value.settledSince !== undefined && !integer(value.settledSince)) ||
    (value.lastDeployTick !== undefined && !integer(value.lastDeployTick)) ||
    (value.retryTick !== undefined && !integer(value.retryTick)) ||
    (value.trail !== undefined &&
      (value.shape !== "column" ||
        !Array.isArray(value.trail) ||
        value.trail.length < 2 ||
        value.trail.length > 256 ||
        value.trail[value.trail.length - 1]?.x !== 0 ||
        value.trail[value.trail.length - 1]?.y !== 0 ||
        !validatedArrays?.has(value.trail) && value.trail.some(
          (p) =>
            !p ||
            !Number.isSafeInteger(p.x) ||
            !Number.isSafeInteger(p.y) ||
            Math.abs(p.x) > 128 * FIXED ||
            Math.abs(p.y) > 128 * FIXED,
        )))
  )
    throw new Error("Invalid formation travel state");
  for(const flag of [value.shapeLock,value.autoFrontage])if(flag!==undefined && typeof flag!=="boolean")throw new Error("Invalid formation frontage flag");
  for(const [width,shape] of [[value.frontage,value.shape],[value.preferredFrontage,value.deployedShape??value.shape]] as const) {
    if(width===undefined)continue;
    if(!Number.isSafeInteger(width)||width<=0||width>128*FIXED||!formationProfile(d,shape))throw new Error("Invalid formation frontage");
    const n=troops??value.layoutTroops;
    if(n!==undefined) {const layout=frontageLayout(n,d,shape,width);if(!layout||layout.width!==width)throw new Error(`Invalid formation frontage band: ${id??"default"}, ${shape}, ${n} troops, width ${width}, expected ${layout?.width??"unavailable"}`);}
  }
  const live=troops??value.layoutTroops;
  if(live!==undefined && formationProfile(d,value.shape) && !frontageLayout(live,d,value.shape))throw new Error("Unavailable formation at live count");
  if(value.occupationSlots!==undefined && (!Array.isArray(value.occupationSlots)||!value.occupationSlots.length||value.occupationSlots.length>144||!validatedArrays?.has(value.occupationSlots) && value.occupationSlots.some(p=>!p||![p.x,p.y,p.row].every(Number.isSafeInteger)||Math.abs(p.x)>128*FIXED||Math.abs(p.y)>128*FIXED)))throw new Error("Invalid trench formation anchors");
  const t = value.transition;
  if (value.transition !== undefined && !t)
    throw new Error("Invalid formation transition");
  if (
    t &&
    (!d.shapes.includes(t.from) ||
      (t.fromFrontage!==undefined && (!Number.isSafeInteger(t.fromFrontage)||t.fromFrontage<=0||t.fromFrontage>128*FIXED||!formationProfile(d,t.from))) ||
      [t.fromAutomatic,t.fromAutoFrontage,t.reorientation,t.occupationReform].some(v=>v!==undefined && typeof v!=="boolean") ||
      !integer(t.fromFacing, TURN - 1) ||
      !integer(t.startTick) ||
      !integer(t.duration, secondsToTicks(10)) ||
      !t.duration)
  )
    throw new Error("Invalid formation transition");
  if (
    t?.fromSlots !== undefined &&
    (!Array.isArray(t.fromSlots) ||
      !t.fromSlots.length ||
      t.fromSlots.length > 144 ||
      !validatedArrays?.has(t.fromSlots) && t.fromSlots.some(
        (p) =>
          !p ||
          !Number.isSafeInteger(p.x) ||
          !Number.isSafeInteger(p.y) ||
          !Number.isSafeInteger(p.row) ||
          Math.abs(p.x) > 128 * FIXED ||
          Math.abs(p.y) > 128 * FIXED,
      ))
  )
    throw new Error("Invalid formation transition slots");
}

/** Sample one shared route trail by row distance, never navigate individual members. */
function trailSlots(
  slots: readonly { x: number; y: number; row: number }[],
  trail: readonly { x: number; y: number }[],
  angle: number,
) {
  const c = Math.cos(angle),
    sin = Math.sin(angle);
  return slots.map((slot) => {
    let remaining = -slot.y,
      p = trail[trail.length - 1],
      dx = -sin,
      dy = c;
    for (let i = trail.length - 2; i >= 0; i--) {
      const a = trail[i],
        b = trail[i + 1],
        length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      dx = (b.x - a.x) / length;
      dy = (b.y - a.y) / length;
      if (remaining <= length) {
        p = { x: b.x - dx * remaining, y: b.y - dy * remaining };
        remaining = 0;
        break;
      }
      remaining -= length;
      p = a;
    }
    if (remaining > 0) p = { x: p.x - dx * remaining, y: p.y - dy * remaining };
    const wx = p.x + dy * slot.x,
      wy = p.y - dx * slot.x;
    return {
      x: Math.round(wx * c + wy * sin),
      y: Math.round(-wx * sin + wy * c),
      row: slot.row,
    };
  });
}

/** Route knots are relative to the current carrier; coalesce straight travel. */
export function advanceColumnTrail(
  s: Pick<Squad, "formation" | "definitionId" | "troops" | "manpower">,
  dx: number,
  dy: number,
): FormationState["trail"] {
  const f = s.formation!;
  const angle = radians(f.facing),
    d = formationDoctrine(s.definitionId);
  const count = Math.max(1, Math.min(144, s.manpower?.capacity ?? s.troops));
  const layout = columnLayout(d),
    keep = (Math.ceil(count / layout.columns) - 1) * layout.spacing + FIXED;
  const trail = (
    f.trail ?? [
      {
        x: Math.round(Math.sin(angle) * keep),
        y: Math.round(-Math.cos(angle) * keep),
      },
      { x: 0, y: 0 },
    ]
  ).map((p) => ({ x: Math.round(p.x - dx), y: Math.round(p.y - dy) }));
  if (dx || dy) {
    const a = trail[trail.length - 2],
      b = trail[trail.length - 1];
    if (
      a &&
      Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) < 2 &&
      (b.x - a.x) * dx + (b.y - a.y) * dy >= 0
    )
      trail[trail.length - 1] = { x: 0, y: 0 };
    else trail.push({ x: 0, y: 0 });
  }
  let length = 0;
  for (let i = trail.length - 2; i >= 0; i--) {
    const a = trail[i],
      b = trail[i + 1],
      segment = Math.hypot(b.x - a.x, b.y - a.y);
    if (length + segment > keep) {
      const t = (keep - length) / segment;
      trail[i] = {
        x: Math.round(b.x + (a.x - b.x) * t),
        y: Math.round(b.y + (a.y - b.y) * t),
      };
      trail.splice(0, i);
      break;
    }
    length += segment;
  }
  while (trail.length > 256) trail.shift();
  return trail;
}

const templates = new Map<
  string,
  {
    slots: ReadonlyArray<Readonly<{ x: number; y: number; row: number }>>;
    width: number;
    depth: number;
  }
>();
let templateHits = 0, templateMisses = 0, templateSlots = 0;
export function formationTemplateDiagnostics() {
  return { hits: templateHits, misses: templateMisses, entries: templates.size, slots: templateSlots };
}
function template(
  count: number,
  shape: FormationShape,
  d: FormationDoctrine,
  seed: number,
  frontage?:number,
) {
  const key = [
    count,
    shape,
    d.spacing,
    d.mounted,
    d.bodyWidth,
    d.bodyDepth,
    seed % 16,
    frontage,
    doctrineTemplateId(d),
  ].join(':');
  let result = templates.get(key);
  if (!result) {
    templateMisses++;
    const slots = buildSlots(count, shape, d, seed % 16, frontage);
    const radiusX = Math.max(...slots.map((p) => Math.abs(p.x))),
      radiusY = Math.max(...slots.map((p) => Math.abs(p.y)));
    result = {
      slots: Object.freeze(
        slots
          .sort((a, b) => b.row - a.row || a.x - b.x)
          .map((slot) => Object.freeze(slot)),
      ),
      width: radiusX * 2 + d.bodyWidth,
      depth: radiusY * 2 + d.bodyDepth,
    };
    if (templates.size >= 512) {
      const oldest = templates.keys().next().value!;
      templateSlots -= templates.get(oldest)!.slots.length;
      templates.delete(oldest);
    }
    templates.set(key, result);
    templateSlots += result.slots.length;
  } else templateHits++;
  return result;
}
const doctrineTemplateIds=new WeakMap<FormationDoctrine,number>();let nextDoctrineTemplateId=0;
function doctrineTemplateId(d:FormationDoctrine):number {
  let id=doctrineTemplateIds.get(d);if(id===undefined){id=nextDoctrineTemplateId++;doctrineTemplateIds.set(d,id);}return id;
}
