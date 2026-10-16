import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { renderContentJson, type ContentOutput } from "./ContentPipeline";

export const readJsonFile = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));

/** Writes through a temporary file so a crash never leaves half a content file. */
export function writeContentOutput(output: ContentOutput): void {
  writeFileSync(output.path + ".tmp", renderContentJson(output.data));
  renameSync(output.path + ".tmp", output.path);
  console.log(output.summary);
}
