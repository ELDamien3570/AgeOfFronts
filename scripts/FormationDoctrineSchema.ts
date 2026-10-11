import { z } from "zod";
import { frontageSummary } from "../src/skirmish/domain/FormationProfiles";
import { FRONTAGE } from "../src/skirmish/content/TacticalRules";
const shape = z.enum([
  "mass",
  "shield-wall",
  "square",
  "line",
  "wedge",
  "modern-loose",
  "column",
]);
const positive = z.number().int().positive();
const band=z.object({min:positive,preferred:positive,max:positive}).strict().refine(b=>b.min<=b.preferred && b.preferred<=b.max);
const profile=z.object({minRanks:positive.max(144),aspectBp:band,lateralPitchBp:band,rankPitchBp:positive}).strict();
const profiles=z.object({mass:profile.optional(),line:profile.optional(),"shield-wall":profile.optional(),"modern-loose":profile.optional()}).strict();
export const formationDoctrineSchema = z
  .object({
    schemaVersion: z.literal(1),
    rulesVersion: z.literal(7),
    shapeProfiles: profiles,
    doctrines: z.record(
      z.string(),
      z
        .object({
          shapeProfiles: profiles.optional(),
          shapes: z.array(shape).min(1),
          defaultShape: shape,
          shieldEquipment: z.boolean(),
          mounted: z.boolean(),
          hull: z.boolean(),
          spacing: positive.max(1024),
          bodyWidth: positive.max(2048),
          bodyDepth: positive.max(2048),
          transitionTicks: positive.max(200),
        })
        .strict(),
    ),
  })
  .strict();

export function validateFormationDoctrineData(input:unknown,recipes:Record<string,{model:string;capacity:number;enlargedCapacity:number}>) {
  const data=formationDoctrineSchema.parse(input),warnings:string[]=[],mountedChecks:unknown[]=[];
  if(Object.keys(recipes).length!==Object.keys(data.doctrines).length)throw new Error("Formation doctrine coverage mismatch");
  const resolved=Object.fromEntries(Object.entries(data.doctrines).map(([id,d])=>[id,{...d,shapeProfiles:{...data.shapeProfiles,...d.shapeProfiles}}]));
  for(const [id,d] of Object.entries(resolved)) {
    if(!recipes[id]||d.hull!==(recipes[id].model==="hull")||new Set(d.shapes).size!==d.shapes.length||!d.shapes.includes(d.defaultShape)||(d.shapes.includes("shield-wall")&&!d.shieldEquipment)||(!d.hull&&!d.shapes.includes("column")))throw new Error("Invalid formation doctrine "+id);
    for(const shape of d.shapes)if(["line","shield-wall","mass","modern-loose"].includes(shape)&&!d.hull) {
      const p=d.shapeProfiles[shape as keyof typeof d.shapeProfiles];if(!p)throw new Error("Missing flexible profile "+id+":"+shape);
      if(["line","shield-wall"].includes(shape)&&p.minRanks<2)throw new Error("Melee profiles need at least two ranks");
      for(const n of [recipes[id].capacity,recipes[id].enlargedCapacity])if(!frontageSummary(n,d,shape))warnings.push(id+":"+shape+" unavailable at "+n);
    }
    if(d.mounted&&!d.hull)for(const variant of ["capacity","enlargedCapacity"] as const){
      const cavalry=frontageSummary(recipes[id][variant],d,"line");if(!cavalry)continue;
      const era=id.split("-")[0],infantry=Object.entries(resolved).filter(([other,dd])=>other.startsWith(era+"-")&&!dd.mounted&&!dd.hull).map(([other,dd])=>frontageSummary(recipes[other][variant],dd,"line")?.wide.maxWidth??0);
      const max=Math.max(0,...infantry),ratio=max?cavalry.wide.maxWidth/max:Infinity;
      if(ratio>FRONTAGE.mountedWidthRatioMax)throw new Error("Mounted frontage exceeds infantry ratio: "+id+" "+variant+" "+ratio);
      mountedChecks.push({id,variant,ratio});
    }
  }
  return {data,warnings,mountedChecks};
}
