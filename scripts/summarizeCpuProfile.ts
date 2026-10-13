import { readFileSync } from "node:fs";
const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const nodes = new Map<number, any>(profile.nodes.map((node: any) => [node.id, node]));
const parent = new Map<number, number>();
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
const costs = new Map<string, { self: number; inclusive: number }>();
for (let i = 0; i < profile.samples.length; i++) {
  let id: number | undefined = profile.samples[i];
  const time = (profile.timeDeltas[i] ?? 0) / 1000, seen = new Set<string>();
  let first = true;
  while (id !== undefined) {
    const frame = nodes.get(id).callFrame;
    const key = `${frame.functionName || "<anonymous>"} ${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
    const row = costs.get(key) ?? { self: 0, inclusive: 0 }; costs.set(key, row);
    if (first) row.self += time;
    if (!seen.has(key)) row.inclusive += time;
    seen.add(key); first = false; id = parent.get(id);
  }
}
for (const kind of ["self", "inclusive"] as const)
  console.log(JSON.stringify({ kind, rows: [...costs].sort((a, b) => b[1][kind] - a[1][kind]).slice(0, 25) }));
if (process.argv[3]) {
  const sources = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const hits = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) hits.set(profile.samples[i], (hits.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i] / 1000);
  for (const [id, ms] of [...hits].sort((a,b)=>b[1]-a[1]).slice(0,30)) {
    const frame=nodes.get(id).callFrame, source=sources[frame.scriptId]?.source;
    if (!source) continue;
    const line=source.split("\n")[frame.lineNumber];
    console.log(JSON.stringify({ms,name:frame.functionName,url:frame.url,code:line.slice(Math.max(0,frame.columnNumber-40),frame.columnNumber+300)}));
  }
}
