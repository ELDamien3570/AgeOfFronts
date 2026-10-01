// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
import fs from "node:fs";
const file = process.argv[2];
const prof = JSON.parse(fs.readFileSync(file, "utf8"));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = prof.timeDeltas;
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + dt[i]);
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const total = [...self.values()].reduce((a, b) => a + b, 0);
const key = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
const selfBy = new Map(), inclBy = new Map();
for (const [id, t] of self) {
  const n = byId.get(id);
  selfBy.set(key(n), (selfBy.get(key(n)) ?? 0) + t);
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const k = key(byId.get(cur));
    if (seen.has(k)) continue;
    seen.add(k);
    inclBy.set(k, (inclBy.get(k) ?? 0) + t);
  }
}
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
console.log("TOTAL ms", (total / 1000).toFixed(0));
console.log("--- inclusive (skirmish src only) ---");
console.log(top(new Map([...inclBy].filter(([k]) => /skirmish\//.test(k))), 32).join("\n"));
console.log("--- self ---");
console.log(top(selfBy, 18).join("\n"));
