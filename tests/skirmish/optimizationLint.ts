/** Compare scoped lint to frozen originals without fixing unrelated code. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

interface LintResult {
  filePath: string;
  messages: {
    line: number;
    ruleId: string;
    message: string;
    severity: number;
  }[];
}
const root = process.cwd(),
  baseline = "6409654";
const changed = execFileSync("git", ["diff", "--name-only", "--", "*.ts"], {
  encoding: "utf8",
})
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean);
const added = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "--", "*.ts"],
  { encoding: "utf8" },
)
  .trim()
  .split(/\r?\n/u)
  .filter(Boolean);
const temporary: string[] = [],
  originals = new Map<string, string>();
function lint(files: string[]): LintResult[] {
  const result = spawnSync(
    process.execPath,
    ["node_modules/eslint/bin/eslint.js", "--format", "json", ...files],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0 && result.status !== 1)
    throw new Error(result.stderr || "ESLint failed to run");
  return JSON.parse(result.stdout);
}
function errors(results: LintResult[], original = false) {
  return results.flatMap((result) =>
    result.messages
      .filter((message) => message.severity === 2)
      .map((message) => {
        const file = relative(root, result.filePath)
          .replace(/\\/gu, "/")
          .replace(".optimization-lint-baseline.ts", ".ts");
        const source = original
          ? originals.get(file)!
          : readFileSync(result.filePath, "utf8");
        return {
          file,
          ruleId: message.ruleId,
          message: message.message,
          sourceLine: source.split(/\r?\n/u)[message.line - 1].trim(),
        };
      }),
  );
}
let report;
try {
  for (const file of changed) {
    const source = execFileSync("git", ["show", `${baseline}:${file}`], {
      encoding: "utf8",
    });
    originals.set(file, source);
    const path = join(
      root,
      file.replace(/\.ts$/u, ".optimization-lint-baseline.ts"),
    );
    if (existsSync(path)) throw new Error(`Refusing to replace ${path}`);
    writeFileSync(path, source, { flag: "wx" });
    temporary.push(path);
  }
  const baselineErrors = errors(lint(temporary), true),
    currentErrors = errors(lint([...changed, ...added]));
  const signatures = new Set(
    baselineErrors.map((error) => JSON.stringify(error)),
  );
  const introduced = currentErrors.filter(
    (error) => !signatures.has(JSON.stringify(error)),
  );
  report = {
    baseline,
    baselineErrors,
    currentErrors,
    introduced,
    scope:
      "new files and changed files compared to their frozen original source lines; full-file legacy errors stay open",
  };
  process.exitCode = introduced.length ? 1 : 0;
} finally {
  for (const file of temporary) unlinkSync(file);
}
writeFileSync(
  join(root, "Optimization Handoff/Evidence/1.2.1/lint-comparison.json"),
  JSON.stringify(report, null, 2),
);
process.stdout.write(JSON.stringify(report, null, 2));
