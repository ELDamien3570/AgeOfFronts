import { readFileSync, writeFileSync } from "node:fs";
import { validateFormationDoctrineData } from "./FormationDoctrineSchema";
const input=JSON.parse(readFileSync("skirmish/plans/formation-doctrines.json","utf8"));
const recipes=JSON.parse(readFileSync("skirmish/plans/formation-recipes.json","utf8")).recipes;
const {data,warnings,mountedChecks}=validateFormationDoctrineData(input,recipes);
for(const warning of warnings)console.warn(warning);
writeFileSync("src/skirmish/content/formation-doctrines.json",JSON.stringify(data,null,2)+"\n");
console.log(`Compiled ${Object.keys(data.doctrines).length} doctrines; ${mountedChecks.length} mounted comparisons; ${warnings.length} availability warnings`);
