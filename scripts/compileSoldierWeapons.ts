// The compiler itself is compileSoldierWeapons in
// scripts/content/FormationContentCompilers.ts.
import { readJsonFile, writeContentOutput } from "./content/ContentFiles";
import { compileWeaponsStep } from "./content/ContentPipeline";

writeContentOutput(compileWeaponsStep(readJsonFile));
