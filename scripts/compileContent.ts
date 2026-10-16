// `npm run compile:content`: rebuild every runtime content file from
// skirmish/plans/ in dependency order (Rus recruitment, formation recipes,
// soldier weapons, formation doctrines). Every compiler runs before anything
// is written, so a rejected plan leaves all content files untouched.
import { readJsonFile, writeContentOutput } from "./content/ContentFiles";
import { compileContent } from "./content/ContentPipeline";

const outputs = compileContent(readJsonFile);
for (const output of outputs) {
  for (const warning of (output as { warnings?: readonly string[] }).warnings ?? [])
    console.warn(warning);
  writeContentOutput(output);
}
