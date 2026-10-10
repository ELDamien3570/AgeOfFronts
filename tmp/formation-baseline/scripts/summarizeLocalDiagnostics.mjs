import fs from "node:fs";
import path from "node:path";

const root = "out/local-diagnostics";
const control = JSON.parse(fs.readFileSync(path.join(root, "hitches-control/summary.json")));
const profiled = JSON.parse(fs.readFileSync(path.join(root, "hitches-profile/summary.json")));
const cpu = JSON.parse(fs.readFileSync(path.join(root, "hitches-profile/simulation.cpuprofile")));
const heap = JSON.parse(fs.readFileSync(path.join(root, "hitches-profile/allocations.heapprofile")));
const groups = new Map(), names = new Map(cpu.nodes.map(n => [n.id, n.callFrame]));
for (const id of cpu.samples) {
  const f = names.get(id), key = `${f.url}:${f.functionName || "(anonymous)"}`;
  const row = groups.get(key) ?? { function: f.functionName || "(anonymous)", url: f.url, samples: 0 };
  row.samples++; groups.set(key, row);
}
const allocations = [], allocationGroups = new Map();
function visit(node, ancestors = []) {
  const f = node.callFrame, functionName = f.functionName || "(anonymous)";
  const stack = [...ancestors, `${functionName} (${f.url})`];
  if (node.selfSize) {
    allocations.push({ function: functionName, url: f.url, estimatedBytes: node.selfSize, stack: stack.slice(-8) });
    const key = `${f.url}:${functionName}`, row = allocationGroups.get(key) ?? { function: functionName, url: f.url, estimatedBytes: 0 };
    row.estimatedBytes += node.selfSize; allocationGroups.set(key, row);
  }
  for (const child of node.children ?? []) visit(child, stack);
}
visit(heap.head);
const totalAllocation = allocations.reduce((sum, row) => sum + row.estimatedBytes, 0);
const evidence = {
  hashesMatch: control.checkpointHash === profiled.checkpointHash && control.snapshotHash === profiled.snapshotHash,
  profilingStepOverheadPercent: 100 * (profiled.step.mean / control.step.mean - 1),
  control: { step: control.step, warm: control.warmAfter80, gc: control.gc, hitches: control.hitches },
  cpuSelf: [...groups.values()].sort((a,b) => b.samples-a.samples).slice(0,30).map(row => ({ ...row, percent: row.samples*100/cpu.samples.length })),
  estimatedAllocationBytes: totalAllocation,
  allocationSelf: [...allocationGroups.values()].sort((a,b) => b.estimatedBytes-a.estimatedBytes).slice(0,30).map(row => ({ ...row, percent: row.estimatedBytes*100/totalAllocation })),
  allocationCallSites: allocations.sort((a,b) => b.estimatedBytes-a.estimatedBytes).slice(0,30),
  limitations: "CPU self samples merged by function and source URL, not inclusive CPU. Allocation samples include collected objects and estimate transient JS allocation; not retained memory or a leak. Transformed TypeScript line numbers are not source locations. Profiler timing is diagnostic only; use control timings for performance claims.",
};
fs.writeFileSync(path.join(root,"analysis.json"),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({ hashesMatch:evidence.hashesMatch, overhead:evidence.profilingStepOverheadPercent, cpu:evidence.cpuSelf.slice(0,12), allocations:evidence.allocationSelf.slice(0,12), estimatedAllocationBytes:totalAllocation },null,2));
