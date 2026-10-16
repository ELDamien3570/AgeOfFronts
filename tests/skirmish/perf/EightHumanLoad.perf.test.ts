/**
 * Roadmap Next #1 load gate (opt-in; about 10 minutes per run, four runs).
 * Skipped unless SKIRMISH_EIGHT_HUMAN=1. Run it on a quiet host only:
 *
 *   SKIRMISH_EIGHT_HUMAN=1 npx vitest run --config vite.skirmish.config.ts tests/skirmish/perf/EightHumanLoad.perf.test.ts
 *
 * EIGHT_HUMAN_MAPS=med,mig selects maps; EIGHT_HUMAN_OUTDIR keeps the JSON.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const enabled = process.env.SKIRMISH_EIGHT_HUMAN === "1";
const maps = (process.env.EIGHT_HUMAN_MAPS ?? "med,mig").split(",").filter(Boolean);
const outdir = process.env.EIGHT_HUMAN_OUTDIR ?? mkdtempSync(path.join(tmpdir(), "eight-human-"));

function run(map: string, mode: "humans" | "idle") {
  execFileSync(process.execPath, ["--import", "tsx", "tests/skirmish/perf/EightHumanLoad.ts", map, mode], {
    env: { ...process.env, OUTDIR: outdir }, stdio: "inherit", timeout: 40 * 60_000,
  });
  const read = (suffix: string) => JSON.parse(readFileSync(path.join(outdir, `out-${map}-${mode}${suffix}`), "utf8"));
  return { full: read(".json"), summary: read(".summary.json") };
}

describe.runIf(enabled)("eight-human load gate (Next #1)", () => {
  for (const map of maps)
    it(`${map} 500: routing gate against the idle control`, () => {
      const idle = run(map, "idle"), humans = run(map, "humans");
      const windows: { plannerPending: { mean: number }; admissions: { mean: number } }[] = humans.full.windows;
      const report = {
        tickMean: humans.full.tickAll.mean, idleTickMean: idle.full.tickAll.mean,
        plannerWindowMeanMax: Math.max(...windows.map(w => w.plannerPending.mean)),
        admissionWindowMeanMax: Math.max(...windows.map(w => w.admissions.mean)),
        moveCommitP95: humans.full.byKind?.move?.outcome?.p95,
        routingMax: humans.full.summaryPhases?.routing?.max,
        exceptions: humans.summary.exceptions.length + idle.summary.exceptions.length,
      };
      console.log(map, JSON.stringify(report));
      expect(report.exceptions).toBe(0);
      expect(report.tickMean).toBeLessThanOrEqual(1.15 * report.idleTickMean);
      expect(report.plannerWindowMeanMax).toBeLessThan(100);
      expect(report.admissionWindowMeanMax).toBeLessThan(150);
      expect(report.moveCommitP95).toBeLessThan(16);
      expect(report.routingMax ?? 0).toBeLessThan(250);
    }, 90 * 60_000);
});
