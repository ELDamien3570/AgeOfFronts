import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** The client bundle and coordinator must execute the same simulation and content. */
export function computeRuntimeBuild(root = process.cwd()): string {
  const files: string[] = [];
  const visit = (directory: string, recursive = true) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && recursive) visit(path);
      else if (entry.isFile() && /\.(ts|json)$/u.test(entry.name))
        files.push(path);
    }
  };
  visit(join(root, "src/skirmish"), false);
  visit(join(root, "src/skirmish/domain"));
  visit(join(root, "src/skirmish/content"));
  visit(join(root, "src/skirmish/multiplayer/application"));
  files.push(join(root, "src/skirmish/multiplayer/StateCodec.ts"));
  files.push(join(root, "src/skirmish/multiplayer/StateLimits.ts"));
  files.push(join(root, "src/skirmish/multiplayer/Protocol.ts"));
  files.push(join(root, "src/skirmish/multiplayer/CommandSchema.ts"));
  visit(join(root, "src/core"));
  const hash = createHash("sha256");
  const normalized = (file: string) => relative(root, file).replace(/\\/g, "/");
  for (const file of files.sort((a, b) =>
    normalized(a) < normalized(b) ? -1 : normalized(a) > normalized(b) ? 1 : 0,
  )) {
    hash.update(relative(root, file).replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}
