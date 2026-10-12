import type { FormationDoctrine, FormationShape } from "./FormationGeometry";
import authored from "../content/formation-doctrines.json";
import { FRONTAGE } from "../content/TacticalRules";
/** Authored profiles approved in the Stage 4 frontage review. */
export interface ShapeProfile {
  minRanks: number;
  aspectBp: { min: number; preferred: number; max: number };
  lateralPitchBp: { min: number; preferred: number; max: number };
  rankPitchBp: number;
}
export const SHAPE_PROFILES = authored.shapeProfiles as Partial<Record<FormationShape, ShapeProfile>>;
export function formationProfile(
  d: FormationDoctrine,
  shape: FormationShape,
): ShapeProfile | undefined {
  const p = d.shapeProfiles?.[shape] ?? SHAPE_PROFILES[shape];
  if (!p || !d.shapes.includes(shape) || d.hull) return undefined;
  return p;
}
export interface FrontageCandidate {
  files: number;
  ranks: number;
  depth: number;
  minWidth: number;
  preferredWidth: number;
  maxWidth: number;
}
const candidateCache=new WeakMap<FormationDoctrine,Map<string,FrontageCandidate[]>>();
export function frontageCandidates(
  n: number,
  d: FormationDoctrine,
  shape: FormationShape,
): FrontageCandidate[] {
  const p = formationProfile(d, shape);
  if (!p || !Number.isInteger(n) || n < 1 || n > 144) return [];
  let cache=candidateCache.get(d);if(!cache){cache=new Map();candidateCache.set(d,cache);}
  const key=n+":"+shape,cached=cache.get(key);if(cached)return cached;
  const rows: FrontageCandidate[] = [];
  for (let ranks = p.minRanks; ranks <= n; ranks++) {
    const files = Math.ceil(n / ranks);
    if (Math.ceil(n / files) !== ranks) continue;
    const depth =
      2 * Math.ceil(((ranks - 1) * d.spacing * p.rankPitchBp) / 20000) + d.bodyDepth;
    const minWidth = Math.ceil(
      Math.max(
        ((files - 1) * d.spacing * p.lateralPitchBp.min) / 10000 + d.bodyWidth,
        (depth * p.aspectBp.min) / 10000,
      ),
    );
    const maxWidth = Math.floor(
      Math.min(
        ((files - 1) * d.spacing * p.lateralPitchBp.max) / 10000 + d.bodyWidth,
        (depth * p.aspectBp.max) / 10000,
      ),
    );
    if (minWidth > maxWidth) continue;
    const preferredWidth = Math.round(
      Math.max(
        minWidth,
        Math.min(
          maxWidth,
          ((files - 1) * d.spacing * p.lateralPitchBp.preferred) / 10000 +
            d.bodyWidth,
        ),
      ),
    );
    rows.push({ files, ranks, depth, minWidth, preferredWidth, maxWidth });
  }
  cache.set(key,rows);
  return rows;
}
export function frontageSummary(
  n: number,
  d: FormationDoctrine,
  shape: FormationShape,
) {
  const p = formationProfile(d, shape),
    rows = frontageCandidates(n, d, shape);
  if (!p || !rows.length) return undefined;
  const narrow = [...rows].sort(
      (a, b) => a.minWidth - b.minWidth || a.files - b.files,
    )[0],
    wide = [...rows].sort(
      (a, b) => b.maxWidth - a.maxWidth || a.files - b.files,
    )[0];
  const preferred = [...rows].sort(
    (a, b) =>
      Math.abs(a.preferredWidth / a.depth - p.aspectBp.preferred / 10000) -
        Math.abs(b.preferredWidth / b.depth - p.aspectBp.preferred / 10000) ||
      a.files - b.files,
  )[0];
  return {
    narrow,
    preferred,
    wide,
    intervals: rows.map((r) => [r.minWidth, r.maxWidth]),
  };
}

/** Project into the interval union, with deterministic quantisation and tie breaking. */
export function frontageLayout(n: number, d: FormationDoctrine, shape: FormationShape, request?: number, ceiling=Infinity) {
  const summary = frontageSummary(n,d,shape);
  if(!summary) return undefined;
  const target = request ?? summary.preferred.preferredWidth;
  let best: (FrontageCandidate & {width:number; pitch:number; rankPitch:number}) | undefined;
  let score=Infinity;
  for(const row of frontageCandidates(n,d,shape)) {
    const maxWidth=Math.min(row.maxWidth,ceiling);
    if(row.minWidth>maxWidth)continue;
    const lo=Math.ceil(row.minWidth/FRONTAGE.quantum)*FRONTAGE.quantum;
    const hi=Math.floor(maxWidth/FRONTAGE.quantum)*FRONTAGE.quantum;
    // A casualty ceiling cannot turn an ordinarily quantized band into a
    // sub-quantum exception. Such a width would project differently when
    // decoded/restored without that ceiling. Try the next legal band instead.
    if(lo>hi && lo<=Math.floor(row.maxWidth/FRONTAGE.quantum)*FRONTAGE.quantum)continue;
    const width=lo<=hi?Math.max(lo,Math.min(hi,Math.round(target/FRONTAGE.quantum)*FRONTAGE.quantum)):Math.max(row.minWidth,Math.min(maxWidth,Math.round(target)));
    const error=Math.abs(width-target);
    if(error<score || error===score && row.files<(best?.files??Infinity)) {
      score=error; best={...row,width,pitch:row.files>1?(width-d.bodyWidth)/(row.files-1):0,rankPitch:row.ranks>1?(row.depth-d.bodyDepth)/(row.ranks-1):0};
    }
  }
  // Sub-quantum intervals still have a legal integer endpoint (e.g. a singleton).
  if(!best) {
    if(Number.isFinite(ceiling))return undefined;
    const row=summary.preferred,width=Math.max(row.minWidth,Math.min(row.maxWidth,Math.round(target)));
    return {...row,width,pitch:row.files>1?(width-d.bodyWidth)/(row.files-1):0,rankPitch:row.ranks>1?(row.depth-d.bodyDepth)/(row.ranks-1):0};
  }
  return best;
}
export function eligibleShape(n:number,d:FormationDoctrine,shape:FormationShape):FormationShape {
  if(d.shapes.includes(shape) && (!formationProfile(d,shape)||frontageLayout(n,d,shape)))return shape;
  for(const candidate of [d.defaultShape,"mass","modern-loose","column"] as FormationShape[])
    if(d.shapes.includes(candidate) && (!formationProfile(d,candidate)||frontageLayout(n,d,candidate)))return candidate;
  return d.defaultShape;
}
