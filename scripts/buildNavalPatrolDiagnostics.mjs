import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
await mkdir("out",{recursive:true});
const common={bundle:true,platform:"node",format:"esm",target:"node24",entryPoints:["tests/skirmish/navalPatrolProfile.ts"],
  banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}};
await build({...common,outfile:"out/naval-patrol-lanes.mjs"});
await build({...common,entryPoints:["tests/skirmish/multiplayerReleaseProfile.ts"],outfile:"out/naval-full-profile.mjs"});
await build({...common,outfile:"out/naval-patrol-centerline.mjs",plugins:[{name:"centerline-control",setup(builder){
  builder.onLoad({filter:/[\\/]Simulation\.ts$/},async({path})=>({loader:"ts",contents:(await readFile(path,"utf8"))
    .replace(/const offsetX = spread \?[^;]+;/,"const offsetX = 0;")
    .replace(/const offsetY = spread \?[^;]+;/,"const offsetY = 0;")}));
}}]});
