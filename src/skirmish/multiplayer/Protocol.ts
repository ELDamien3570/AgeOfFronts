import { z } from "zod";
import type { MatchOptions } from "../Protocol";
import type { LobbySettings } from "../lobby/LobbyDirectory";
import type { EncodedState } from "./StateCodec";
import type { HostBatch } from "./application/HostedRuntime";
import type { CoordinatorState } from "./domain/RoomCoordinator";
export interface MatchManifest {
  id: string;
  settings: LobbySettings;
  options: MatchOptions;
  runtimeId: string;
  mapHash: string;
  playerId: number;
}
const encoded = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    payload: z.string().max(8_000_000),
  })
  .strict();

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
    mapId: z.enum(["heightmap-test1", "africa", "amazon-river"]),
    mode: z.literal("free-for-all"),
    slots: z.number().int().min(2).max(20),
    minimumHumans: z.number().int().min(1).max(20),
    countdownSeconds: z.number().int().min(15).max(300),
    fillVacanciesWithAi: z.boolean(),
    worldSize: z.union([z.literal(250), z.literal(500), z.literal(1000)]),
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
      tickP95Ms: z.number().nonnegative().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal("host-ready"),
      requestId,
      matchId: z.string().max(80),
      epoch: z.number().int(),
      tick: z.number().int(),
      hash: z.string().length(64),
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
    .object({
      type: z.literal("host-commit"),
      requestId,
      matchId: z.string().max(80),
      epoch: z.number().int(),
      proposal: z
        .object({
          previousTick: z.number().int(),
          tick: z.number().int(),
          checkpoint: encoded,
          worldEconomy: z
            .array(
              z.object({
                playerId: z.number().int(),
                gold: z.number().int().safe(),
                reserves: z.number().int().safe(),
              }),
            )
            .max(20),
          rejectedCommands: z
            .array(
              z.object({
                id: z.string().max(80),
                message: z.string().max(1000),
              }),
            )
            .max(100),
          computeMs: z.number().nonnegative().finite(),
        })
        .strict(),
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
    .object({ type: z.literal("close"), requestId, roomId: z.string().max(80) })
    .strict(),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage =
  | { type: "match"; manifest: MatchManifest }
  | {
      type: "host-restore";
      matchId: string;
      epoch: number;
      checkpoint: EncodedState;
    }
  | { type: "host-batch"; matchId: string; epoch: number; batch: HostBatch }
  | {
      type: "match-state";
      matchId: string;
      packet: EncodedState;
      tick: number;
      paused: boolean;
      disconnectedPlayerIds: number[];
      executor: string | null;
    }
  | { type: "match-ended"; matchId: string; message: string }
  | { type: "directory"; guestId: string; now: number; state: CoordinatorState }
  | { type: "ack"; requestId: string; roomId?: string }
  | { type: "error"; requestId?: string; message: string };
