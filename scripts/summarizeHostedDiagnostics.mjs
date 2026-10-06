import fs from "node:fs";
const root = process.argv[2] ?? "out/local-diagnostics/hosted";
const rows = fs.readFileSync(`${root}/server.log`,"utf8").split(/\r?\n/).flatMap(line => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const coordinator = rows.filter(row => row.event === "coordinator-runtime-diagnostics");
const workers = coordinator.flatMap(row => row.matches ?? []).map(match => ({ ...match.worker, progress:match.progress, matchTiming:match.timings })).filter(worker => worker.tick !== undefined);
const last = workers.at(-1);
const report = {
  coordinatorSamples: coordinator.length, workerSamples: workers.length,
  lastTick: last?.tick, progress: last?.progress,
  connections: coordinator.at(-1)?.connections,
  processRss: { first:coordinator[0]?.processRss, last:coordinator.at(-1)?.processRss, peak:Math.max(0,...coordinator.map(row=>row.processRss)) },
  peakEntities: Object.fromEntries(["squads","ships","buildings","traders","projectiles"].map(key => [key,Math.max(0,...workers.map(row=>row.entities?.[key]??0))])),
  lifetimeTimings: last?.lifetimeTimings, recentTimings: last?.timings,
  lastMemory:last?.memory, replication:last?.replication,
  bufferedBytes: { peak:Math.max(0,...coordinator.map(row=>row.bufferedBytes??0)), last:coordinator.at(-1)?.bufferedBytes },
  memorySamples: workers.map(row=>({tick:row.tick, ...row.memory, treeBytes:(row.paths?.land?.hierarchy?.treeBytes??0)+(row.paths?.water?.hierarchy?.treeBytes??0), routesBytes:(row.paths?.land?.routeBytes??0)+(row.paths?.water?.routeBytes??0)})),
  limitations:"Cumulative worker histograms and sparse runtime observations; recent p95 is a rolling window, not whole-soak p95. Scheduler includes normal timer lateness and is not simulation duration. RSS is process-wide, includes workers and caches, and is not a leak proof. Credit starvation does not emulate WAN packet loss or kernel/socket buffer saturation.",
};
fs.writeFileSync(`${root}/diagnostics.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({ samples:report.workerSamples, tick:report.lastTick, progress:report.progress, connections:report.connections, peakEntities:report.peakEntities, rss:report.processRss, tickTiming:last?.timings?.tick, queue:last?.timings?.queue, bufferedBytes:report.bufferedBytes },null,2));
