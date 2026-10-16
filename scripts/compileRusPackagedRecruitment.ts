// Deliberate build step: planner edits never silently change a running match.
// The compiler itself is scripts/content/RusPackagedRecruitmentCompiler.ts.
import { readJsonFile, writeContentOutput } from "./content/ContentFiles";
import { compileRecruitmentStep } from "./content/ContentPipeline";

writeContentOutput(compileRecruitmentStep(readJsonFile));
