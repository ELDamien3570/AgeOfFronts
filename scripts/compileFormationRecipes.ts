// The compiler itself is compileFormationRecipes in
// scripts/content/FormationContentCompilers.ts.
import { readJsonFile, writeContentOutput } from "./content/ContentFiles";
import { CONTENT_PATHS, compileRecipesStep } from "./content/ContentPipeline";

writeContentOutput(
  compileRecipesStep(readJsonFile, readJsonFile(CONTENT_PATHS.recruitment) as any),
);
