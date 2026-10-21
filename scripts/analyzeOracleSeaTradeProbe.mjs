import { readFileSync, writeFileSync } from "node:fs";
const [serverDir, clientDir, output] = process.argv.slice(2);
if (!serverDir || !clientDir || !output)
  throw Error(
    "Usage: node analyzeOracleSeaTradeProbe.mjs server-evidence client-evidence result.json",
  );
const load = (p) => JSON.parse(readFileSync(p, "utf8")),
  lines = (p) =>
    readFileSync(p, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((s) => JSON.parse(s));
const client = load(clientDir + "/result.json"),
  start = client.startSample?.serverAt,
  end = client.endSample?.serverAt;
if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
  throw Error("Incomplete measured window; cannot qualify pace");
const advances = lines(serverDir + "/advances.jsonl"),
  ticks = lines(serverDir + "/ticks.jsonl"),
  windows = [];
for (let at = start; at + 10000 <= end; at += 10000) {
  const done = advances.filter((r) => r.at > at && r.at <= at + 10000);
  let count = 0,
    prev = advances.findLast((r) => r.at <= at)?.tick;
  for (const row of done) {
    if (prev === undefined) throw Error("Missing boundary predecessor");
    if (row.tick < prev) throw Error("Nonmonotonic tick");
    count += row.tick - prev;
    prev = row.tick;
  }
  windows.push({
    start: at,
    end: at + 10000,
    ticks: count,
    speed: (count * 125) / 10000,
    onPace: count >= 79,
    strictOneX: count >= 80,
  });
}
if (!windows.length) throw Error("No complete windows");
const stats = (values) => {
  const a = values.sort((a, b) => a - b);
  return {
    count: a.length,
    mean: a.reduce((x, y) => x + y, 0) / a.length,
    p50: a[Math.ceil(a.length * 0.5) - 1],
    p95: a[Math.ceil(a.length * 0.95) - 1],
    p99: a[Math.ceil(a.length * 0.99) - 1],
    max: a.at(-1),
  };
};
const a = client.startSample.diagnostics.matches[0],
  b = client.endSample.diagnostics.matches[0];
if (!a || !b || a.matchId !== b.matchId) throw Error("Match ended or changed");
const simulatedMs = (b.tick - a.tick) * 125,
  wallMs = end - start,
  measured = ticks.filter((r) => r.at > start && r.at <= end);
const result = {
  source: client.source,
  window: {
    start,
    end,
    wallMs,
    initialTick: a.tick,
    finalTick: b.tick,
    simulatedMs,
    overallSpeed: simulatedMs / wallMs,
  },
  qualification: {
    definition:
      "Complete nonoverlapping ten-second wall windows; on pace >=79 ticks (9.875 game seconds), strict >=80 ticks; pauses/stalls inside measurement count against wall time",
    completeWindows: windows.length,
    onPaceWindows: windows.filter((r) => r.onPace).length,
    onPaceTimeFraction: windows.filter((r) => r.onPace).length / windows.length,
    strictOneXTimeFraction:
      windows.filter((r) => r.strictOneX).length / windows.length,
    passesMoreThan90Percent:
      windows.filter((r) => r.onPace).length / windows.length > 0.9,
    uncoveredTailMs: (end - start) % 10000,
  },
  speed: stats(windows.map((r) => r.speed)),
  tickMs: stats(measured.map((r) => r.ms)),
  over125ms: measured.filter((r) => r.ms > 125).length,
  crashesOrClientFailures: client.failures,
  sampling: client.sampling,
  comparedFrames: client.comparedFrames,
  movement: client.byKind,
  movementBySelectionSize: client.bySelectionSize,
  peers: client.peers,
  windows,
  limitations: client.limitations,
};
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      qualification: result.qualification,
      window: result.window,
      tickMs: result.tickMs,
      movement: result.movement,
      failures: result.crashesOrClientFailures,
    },
    null,
    2,
  ),
);
