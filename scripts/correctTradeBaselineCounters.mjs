import { readFile, writeFile } from "node:fs/promises";
// Correct only diagnostic counter sampling in the frozen pre-change bundle.
// The baseline's simulation and trade implementation remain byte-for-byte intact.
const source=await readFile("out/trade-baseline.mjs","utf8");
const requests="requests += trade.diagnostics.routeRequests;", reads="reads += trade.diagnostics.marketReads;";
if(!source.includes(requests)||!source.includes(reads)) throw new Error("Unexpected baseline counter format");
await writeFile("out/trade-baseline-counters.mjs",source.replace(requests,"requests = trade.diagnostics.routeRequests;")
  .replace(reads,"reads = trade.diagnostics.marketReads;"));
