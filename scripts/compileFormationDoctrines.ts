// The compiler itself is validateFormationDoctrineData in
// scripts/FormationDoctrineSchema.ts (validation only; data passes through).
import { readJsonFile, writeContentOutput } from "./content/ContentFiles";
import { compileDoctrinesStep } from "./content/ContentPipeline";

const output = compileDoctrinesStep(readJsonFile);
for (const warning of output.warnings) console.warn(warning);
writeContentOutput(output);
