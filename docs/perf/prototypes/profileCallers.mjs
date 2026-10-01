// eslint-disable
// Prototype measurement script (see docs/OptimizationFixPlan.md). Not shipped; run from the repo root with: node --import tsx docs/perf/prototypes/<file>
import fs from "node:fs";
const [file, fn] = process.argv.slice(2);
const prof = JSON.parse(fs.readFileSync(file, "utf8"));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();
for (let i = 0; i < prof.samples.length; i++) self.set(prof.samples[i], (self.get(prof.samples[i]) ?? 0) + prof.timeDeltas[i]);
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const nm = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber + 1}`;
const by = new Map(); let total = 0;
for (const [id, t] of self) {
  const chain = []; for (let c = id; c !== undefined; c = parent.get(c)) chain.push(byId.get(c));
  const at = chain.findIndex((n) => n.callFrame.functionName === fn);
  if (at < 0) continue;
  total += t;
  // first caller outside Pathfinding.ts/HierarchicalPaths/PathTopology
  const caller = chain.slice(at + 1).find((n) => !/Pathfinding|HierarchicalPaths|PathTopology|GameMap/.test(n.callFrame.url));
  const parentFn = chain.slice(at + 1).find((n) => !/Pathfinding\.ts/.test(n.callFrame.url) || n.callFrame.functionName !== "find");
  const key = nm(caller ?? chain[at]) ;
  by.set(key, (by.get(key) ?? 0) + t);
}
console.log(fn, "total", (total / 1000).toFixed(0), "ms; by external caller:");
console.log([...by].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(6)} ms  ${k}`).join("\n"));
