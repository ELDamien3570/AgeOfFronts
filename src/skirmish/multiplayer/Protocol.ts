import { z } from "zod";
import {
  MAX_AI_OPPONENTS,
  MAX_HUMAN_PLAYERS,
  MAX_TRIBES,
} from "../FactionRules";
import type { MatchOptions, SpawnState } from "../Protocol";
import type { LobbySettings } from "../lobby/LobbyDirectory";
import { LOBBY_MAP_IDS } from "../lobby/LobbyRules";
import type { EncodedState } from "./StateCodec";
import type { CoordinatorState } from "./domain/RoomCoordinator";
export interface MatchManifest {
  id: string;
  settings: LobbySettings;
  options: MatchOptions;
  runtimeId: string;
  mapHash: string;
  playerId: number;
}
const profile = z
  .object({
    name: z.string().min(1).max(80),
    flagCode: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/u)
      .nullable(),
  })
  .strict();
const settings = z
  .object({
    mapId: z.enum(LOBBY_MAP_IDS),
    mode: z.literal("free-for-all"),
    slots: z.number().int().min(2).max(MAX_HUMAN_PLAYERS),
    minimumHumans: z.number().int().min(1).max(MAX_HUMAN_PLAYERS),
    countdownSeconds: z.number().int().min(15).max(300),
    worldSize: z.union([z.literal(250), z.literal(500), z.literal(1000)]),
    // Exact per-size ranges are enforced by validateLobbySettings.
    aiCount: z.number().int().min(0).max(MAX_AI_OPPONENTS),
    tribeCount: z.number().int().min(0).max(MAX_TRIBES),
    technologySpeed: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    resourceDensity: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(5),
    ]),
    resourceOutput: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(5),
    ]),
    alliances: z.boolean(),
    victory: z.enum(["solo", "allied"]),
  })
  .strict();
const requestId = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/u);
export const clientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("select-spawn"),
      requestId,
      matchId: z.string().max(80),
      tile: z.number().int().nonnegative().max(4_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("watch-match"),
      requestId,
      matchId: z.string().max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("match-ready"),
      requestId,
      matchId: z.string().max(80),
      runtimeId: z.string().max(80),
    })
    .strict(),
  z
    .object({
      type: z.literal("match-command"),
      requestId,
      matchId: z.string().max(80),
      command: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ type: z.literal("authenticate"), token: z.string().length(43) })
    .strict(),
  z.object({ type: z.literal("profile"), requestId, profile }).strict(),
  z
    .object({
      type: z.literal("create"),
      requestId,
      title: z.string().max(160),
      settings,
      willingToWait: z.boolean(),
    })
    .strict(),
  z
    .object({ type: z.literal("join"), requestId, roomId: z.string().max(80) })
    .strict(),
  z.object({ type: z.literal("leave"), requestId }).strict(),
  z
    .object({
      type: z.literal("voteStart"),
      requestId,
      roomId: z.string().max(80),
    })
    .strict(),
  z
    .object({ type: z.literal("close"), requestId, roomId: z.string().max(80) })
    .strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage =
  | { type: "match-spawn"; matchId: string; state: SpawnState }
  | { type: "match"; manifest: MatchManifest }
  | {
      type: "match-state";
      matchId: string;
      packet: EncodedState;
      tick: number;
      paused: boolean;
      disconnectedPlayerIds: number[];
      executor: "server";
    }
  | { type: "match-ended"; matchId: string; message: string }
  | { type: "directory"; guestId: string; now: number; state: CoordinatorState }
  | { type: "ack"; requestId: string; roomId?: string }
  | { type: "error"; requestId?: string; message: string };
