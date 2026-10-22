// Audits the measurement math, including a stalled half-window that an
// advancing-only diagnostic ratio could otherwise hide.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const root = process.argv[2];
if (!root) throw Error("Unique output directory required");
mkdirSync(root, { recursive: false });
for (const stalled of [false, true]) {
  const dir = root + "/" + (stalled ? "stalled" : "one-x");
  mkdirSync(dir);
  const rows = [{ at: 1000, tick: 0 }],
    ticks = [];
  for (let tick = 1; tick <= (stalled ? 80 : 160); tick++) {
    rows.push({ at: 1000 + tick * 125, tick });
    ticks.push({ at: 1000 + tick * 125, tick, ms: 25, phases: { routing: 5 } });
  }
  writeFileSync(
    dir + "/advances.jsonl",
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  writeFileSync(
    dir + "/ticks.jsonl",
    ticks.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  writeFileSync(
    dir + "/result.json",
    JSON.stringify({
      source: "synthetic-only",
      startSample: {
        serverAt: 1000,
        diagnostics: { matches: [{ matchId: "same", tick: 0 }] },
      },
      endSample: {
        serverAt: 21000,
        diagnostics: {
          matches: [{ matchId: "same", tick: stalled ? 80 : 160 }],
        },
      },
      failures: [],
      byKind: { short: { unresolved: 1 } },
      peers: [],
      limitations: "Synthetic analyzer test, not game qualification",
    }),
  );
  execFileSync(process.execPath, [
    "scripts/analyzeOracleSeaTradeProbe.mjs",
    dir,
    dir,
    dir + "/analysis.json",
  ]);
  const result = JSON.parse(readFileSync(dir + "/analysis.json", "utf8"));
  assert.equal(result.qualification.completeWindows, 2);
  assert.equal(result.qualification.onPaceTimeFraction, stalled ? 0.5 : 1);
  assert.equal(result.window.overallSpeed, stalled ? 0.5 : 1);
  assert.equal(result.qualification.passesMoreThan90Percent, !stalled);
  assert.equal(result.movement.short.unresolved, 1);
  assert.equal(result.phaseMs.routing.mean, 5);
}
console.log(
  "PASS: exact 1x, wall-time stall detection, strict >90% gate, unresolved input retention",
);
