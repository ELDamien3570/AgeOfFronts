// Explicit, lossless configuration migration for existing offline fixture
// envelopes. Unit, economy, ownership, terrain and job progress are preserved.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { deserialize, serialize } from "node:v8";
const [input, out] = process.argv.slice(2);
if (!input || !out)
  throw Error("input fixture and unique output directory required");
const bytes = readFileSync(input),
  original = deserialize(bytes),
  next = deserialize(bytes),
  hash = (b) => createHash("sha256").update(b).digest("hex");
if (
  ![6, 7, 8].includes(next.checkpoint.planning.scheduling.version) ||
  next.checkpoint.admission.policyVersion !== undefined
)
  throw Error("Expected an older movement checkpoint");
const groups = new Map();
for (const s of original.checkpoint.squads)
  if (
    s.playerId > 2 &&
    s.playerId <= 15 &&
    s.embarkedOn === null &&
    !s.refit &&
    !s.afloat &&
    !s.fighting
  ) {
    const a = groups.get(s.playerId) ?? [];
    a.push(s);
    groups.set(s.playerId, a);
  }
const spread = (a) => {
  const rows = [...a].sort((a, b) => a.id - b.id).slice(0, 60),
    first = rows[0];
  return rows.reduce(
    (sum, s) => sum + (s.x - first.x) ** 2 + (s.y - first.y) ** 2,
    0,
  );
};
const player = [...groups]
  .filter(([, a]) => a.length >= 60)
  .sort((a, b) => spread(b[1]) - spread(a[1]) || a[0] - b[0])[0]?.[0];
if (!player) throw Error("No existing sixty-squad faction");
next.checkpoint.planning.scheduling.version = 9;
next.checkpoint.admission.policyVersion = 2;
next.checkpoint.admission.families = [];
const land = next.checkpoint.squads.filter((s) => s.embarkedOn === null).length;
next.checkpoint.movementReadiness = {
  urgent: [],
  cursor: ((next.checkpoint.tick + 1) * 16) % land,
  lastPlayer: -1,
};
const reverted = structuredClone(next);
reverted.checkpoint.planning.scheduling.version =
  original.checkpoint.planning.scheduling.version;
delete reverted.checkpoint.admission.policyVersion;
delete reverted.checkpoint.admission.families;
delete reverted.checkpoint.movementReadiness;
if (!isDeepStrictEqual(reverted, original))
  throw Error("Unexpected fixture mutation");
const baseline = deserialize(bytes);
baseline.movementProbePlayer = next.movementProbePlayer = player;
mkdirSync(out, { recursive: false });
const baseBytes = serialize(baseline),
  candidateBytes = serialize(next);
writeFileSync(out + "/baseline.v8", baseBytes);
writeFileSync(out + "/responsive.v8", candidateBytes);
const manifest = {
  input,
  tick: next.checkpoint.tick,
  originalSha256: hash(bytes),
  baselineSha256: hash(baseBytes),
  responsiveSha256: hash(candidateBytes),
  movementProbePlayer: player,
  deepEqualAfterRevertingPolicy: true,
  changes: [
    "planner scheduling -> 9",
    "movement admission policy -> 2, empty route families",
    "empty urgent readiness, periodic cursor aligned to the next historical visit",
  ],
  sharedEnvelopeMetadata:
    "movementProbePlayer selects an existing faction for real multiplayer takeover; no units/resources are manufactured",
};
writeFileSync(out + "/manifest.json", JSON.stringify(manifest, null, 2));
console.log(manifest);
