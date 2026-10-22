import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {deserialize, serialize} from "node:v8";
import {join} from "node:path";
import {Skirmish} from "../src/skirmish/Simulation";
import {createSkirmishMap} from "../src/skirmish/Elevation";
import {loadServerMap} from "../src/skirmish/multiplayer/infrastructure/ServerMap";

/** Canonical state digest: explicit types, object keys sorted, Map/Set order
 * retained, typed-array element bytes only. Object aliasing/buffer offsets
 * are transport details and do not change simulation state. */
export function checkpointDigest(value: unknown): string {
  const hash = createHash("sha256");
  const visit = (row: any): void => {
    if (row === null) {hash.update("null;"); return;}
    if (typeof row !== "object") {
      const text = typeof row === "number" && Object.is(row, -0) ? "-0" : String(row);
      hash.update(`${typeof row}:${text.length}:${text};`); return;
    }
    if (ArrayBuffer.isView(row)) {
      hash.update(`typed:${row.constructor.name}:${row.byteLength}:`);
      hash.update(new Uint8Array(row.buffer, row.byteOffset, row.byteLength)); return;
    }
    if (row instanceof Map) {
      hash.update(`map:${row.size}{`); for (const [key, item] of row) {visit(key); visit(item);} hash.update("}"); return;
    }
    if (row instanceof Set) {
      hash.update(`set:${row.size}{`); for (const item of row) visit(item); hash.update("}"); return;
    }
    if (Array.isArray(row)) {
      hash.update(`array:${row.length}[`);
      for (let at = 0; at < row.length; at++) if (Object.hasOwn(row, at)) visit(row[at]); else hash.update("hole;");
      hash.update("]"); return;
    }
    const keys = Object.keys(row).sort(); hash.update(`object:${keys.length}{`);
    for (const key of keys) {visit(key); visit(row[key]);} hash.update("}");
  };
  visit(value); return hash.digest("hex");
}

export async function replayOracleSeaTradeProbe(directory: string, output: string) {
  const startBytes = readFileSync(join(directory, "worker-initial.v8")),
    startManifest = JSON.parse(readFileSync(join(directory, "worker-initial.v8.json"), "utf8")),
    endManifest = JSON.parse(readFileSync(join(directory, "worker-final.v8.json"), "utf8"));
  if (createHash("sha256").update(startBytes).digest("hex") !== startManifest.sha256) throw Error("Initial checkpoint hash mismatch");
  if (!startManifest.authoritativeServerCheckpoint || !endManifest.authoritativeServerCheckpoint || startManifest.source !== endManifest.source)
    throw Error("Authoritative checkpoint source mismatch");
  const start = deserialize(startBytes), loaded = await loadServerMap(start.settings, undefined, start.seed), m = loaded.map;
  const game = new Skirmish(createSkirmishMap(m.width, m.height, m.terrain.slice(), structuredClone(m.elevation),
    structuredClone(m.forest), structuredClone(m.resourceTerrain)), start.options);
  game.restore(start.checkpoint);
  const initial = checkpointDigest(start.checkpoint), restored = checkpointDigest(game.checkpoint());
  if (initial !== restored) throw Error(`Initial canonical restore mismatch: ${initial} != ${restored}`);
  delete start.checkpoint;
  const actions = readFileSync(join(directory, "actions-applied.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(row => JSON.parse(row))
    .filter(row => row.sequence >= start.actionSequence && row.sequence < endManifest.actionSequence).sort((a, b) => a.sequence - b.sequence);
  if (actions.length !== endManifest.actionSequence - start.actionSequence || actions.some((row, at) => row.sequence !== start.actionSequence + at))
    throw Error("Incomplete or duplicate action journal");
  let cursor = 0, commands = 0, controllers = 0, roadPublications = 0;
  const mismatches: unknown[] = [];
  const apply = () => {
    while (cursor < actions.length && actions[cursor].tick <= game.tick) {
      const action = actions[cursor++];
      if (action.tick !== game.tick) throw Error("Out-of-order action tick");
      if (action.type === "controller") {game.setAiController(action.playerId, action.ai); controllers++;}
      else if (action.type === "command") {
        commands++; const actual = game.commandApplications.apply(action.id, action.command), expected = action.result;
        if (actual.status !== expected.status || actual.reason !== expected.reason)
          mismatches.push({sequence: action.sequence, tick: game.tick, id: action.id, actual, expected});
      } else if (action.type === "road-publication") { game.expansion!.roads.packed(); roadPublications++; }
      else throw Error("Unknown replay action");
    }
  };
  while (game.tick < endManifest.tick) {apply(); game.step(); if ((game.tick - startManifest.tick) % 800 === 0) {
    console.log(JSON.stringify({tick: game.tick, target: endManifest.tick, actions: cursor, mismatches: mismatches.length}));
    await new Promise(resolve => setImmediate(resolve));
  }}
  apply();
  if (cursor !== actions.length) throw Error("Unapplied replay actions");
  const endBytes = readFileSync(join(directory, "worker-final.v8"));
  if (createHash("sha256").update(endBytes).digest("hex") !== endManifest.sha256) throw Error("Final checkpoint hash mismatch");
  const expectedState = deserialize(endBytes).checkpoint, actualState = game.checkpoint();
  const expected = checkpointDigest(expectedState), actual = checkpointDigest(actualState);
  const differentSections = Object.keys(expectedState).filter(key => checkpointDigest(expectedState[key]) !== checkpointDigest((actualState as any)[key]));
  if (expected !== actual) writeFileSync(`${output}.reconstructed.v8`, serialize({...start, checkpoint: actualState}));
  const result = {source: startManifest.source, initialTick: startManifest.tick, finalTick: game.tick,
    differentSections, actions: cursor, commands, controllers, roadPublications, immediateOutcomeMismatches: mismatches, initialCanonicalDigest: initial,
    expectedFinalCanonicalDigest: expected, actualFinalCanonicalDigest: actual, canonicalMatch: expected === actual,
    scope: "Full authoritative simulation checkpoint comparison; replay timing and memory are diagnostic, not online pace qualification."};
  writeFileSync(output, JSON.stringify(result, null, 2));
  if (mismatches.length || expected !== actual) throw Error("Authoritative replay did not match; inspect the saved result");
  return result;
}
if (process.argv[1]?.endsWith("replayOracleSeaTradeProbe.ts") || process.argv[1]?.endsWith("/replay.mjs") || process.argv[1]?.endsWith("\\replay.mjs")) {
  if (!process.argv[2] || !process.argv[3]) throw Error("Usage: replayOracleSeaTradeProbe.ts SERVER_DIRECTORY OUTPUT_JSON");
  console.log(JSON.stringify(await replayOracleSeaTradeProbe(process.argv[2], process.argv[3])));
}
