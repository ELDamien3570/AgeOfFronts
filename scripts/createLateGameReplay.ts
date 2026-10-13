import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { deserialize } from "node:v8";
import type { Skirmish } from "../src/skirmish/Simulation";
import { serializeLateGameFixture } from "./LateGameFixture";

const [input, output, playerText] = process.argv.slice(2);
const playerId = Number(playerText);
if (!input || !output || !Number.isSafeInteger(playerId) || playerId < 1)
  throw new Error("Usage: createLateGameReplay.ts checkpoint.v8 replay.json playerId");
const checkpoint = deserialize(readFileSync(input)) as ReturnType<Skirmish["checkpoint"]>;
if (process.argv.includes("--autonomous-deadline")) checkpoint.options.autonomousRouteDeadlineTicks = 40;
if (process.argv.includes("--ai-decisions")) checkpoint.options.autonomousDecisionInterval = 30;
const player = checkpoint.players.find(p => p.id === playerId && !p.eliminated);
if (!player || !checkpoint.squads.some(s => s.playerId === playerId && s.troops > 0))
  throw new Error("Choose a surviving nation with field squads");
// The diagnostic copy hands this nation to the tester; the input is untouched.
player.ai = false;
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, serializeLateGameFixture({ version: 1, mapId: "migration", playerId, checkpoint }));
console.log(JSON.stringify({ output, tick: checkpoint.tick, playerId, squads: checkpoint.squads.length, ships: checkpoint.ships.length }));
