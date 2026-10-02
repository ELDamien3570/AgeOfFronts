import { lookup } from "mrmime";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join, normalize, resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { DEFAULT_EMPIRE_PROFILE } from "../../lobby/EmpireProfile";
import { LiveMatch, type LiveMatchOptions } from "../application/LiveMatch";
import type { MatchExecutor } from "../application/MatchExecutor";
import { RoomCoordinator } from "../domain/RoomCoordinator";
import { clientMessageSchema, type ServerMessage } from "../Protocol";
import { CoordinatorStore } from "./CoordinatorStore";
import { ReservedMatchWorker } from "./ReservedMatchWorker";
import { computeRuntimeBuild } from "./RuntimeBuild";

export interface CoordinatorServerOptions {
  store: CoordinatorStore;
  origins: readonly string[];
  now?: () => number;
  matchCapacity?: number;
  staticDir?: string;
  liveMatch?: LiveMatchOptions;
  /** Injectable executor for deterministic integration tests; production uses one reserved worker. */
  createExecutor?: () => MatchExecutor;
}

function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
): boolean {
  if (!existsSync(staticDir)) return false;
  const rawUrl = req.url?.split("?")[0] ?? "/";
  let pathname = normalize(decodeURIComponent(rawUrl)).replace(
    /^(\.\.[/\\])+/,
    "",
  );
  if (pathname === "/" || pathname === "\\" || pathname === "")
    pathname = "/index.html";
  let target = join(staticDir, pathname);
  try {
    if (!target.startsWith(staticDir)) return false;
    let stat = existsSync(target) ? statSync(target) : undefined;
    if (stat?.isDirectory()) {
      target = join(target, "index.html");
      stat = existsSync(target) ? statSync(target) : undefined;
    }
    if (!stat?.isFile()) return false;
    const mimeType = lookup(target) ?? "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    if (rawUrl.startsWith("/assets/")) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
    if (req.method === "HEAD") {
      res.writeHead(200).end();
      return true;
    }
    createReadStream(target).pipe(res);
    return true;
  } catch {
    return false;
  }
}

/** Transport adapter: credentials never appear in URLs or public directory messages. */
export function createCoordinatorServer(options: CoordinatorServerOptions) {
  const now = options.now ?? Date.now;
  // Tests may disable admission; the runnable server supplies its explicit ceiling.
  const capacity = options.matchCapacity ?? 0;
  const staticDir = options.staticDir ?? resolve("build/skirmish");
  const matches = new Map<string, LiveMatch>();
  const runtimeId = computeRuntimeBuild();
  let rooms = new RoomCoordinator(now(), capacity, options.store.read());
  const restored = rooms.snapshot();
  for (const room of [...restored.rooms, ...restored.reservations])
    for (const member of room.members) rooms.disconnect(member.guestId, now());
  // Workers are memory-only; never advertise or reserve capacity for stale DB matches.
  for (const reservation of restored.reservations)
    rooms.releaseMatch(reservation.id);
  options.store.write(rooms.snapshot());
  const sessions = new Map<
    WebSocket,
    { guestId: string; alive: boolean; count: number; windowAt: number }
  >();
  const attempts = new Map<string, { count: number; windowAt: number }>();
  const trustedOrigin = (req: IncomingMessage) => {
    if (!req.headers.origin) return true;
    try {
      const originUrl = new URL(req.headers.origin);
      const host = req.headers.host;
      if (host && (originUrl.host === host || originUrl.hostname === host)) {
        return true;
      }
    } catch {
      /* ignore invalid URL */
    }
    return options.origins.includes(req.headers.origin);
  };
  const http = createServer((req, res) => {
    if (req.url === "/healthz" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          matchAdmission: capacity > 0 ? "open" : "closed",
          activeMatches: rooms.snapshot().reservations.length,
        }),
      );
      return;
    }
    if (req.url === "/guest") {
      if (!trustedOrigin(req)) {
        res.writeHead(403).end();
        return;
      }
      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "POST");
        res.writeHead(204).end();
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const key = req.socket.remoteAddress ?? "unknown";
      let attempt = attempts.get(key);
      if (!attempt || now() - attempt.windowAt > 60_000) {
        attempt = { count: 0, windowAt: now() };
        attempts.set(key, attempt);
      }
      if (++attempt.count > 20) {
        res.writeHead(429).end();
        return;
      }
      try {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(options.store.createGuest()));
      } catch {
        res.writeHead(503).end();
      }
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      if (serveStatic(req, res, staticDir)) return;
    }
    res.writeHead(404).end();
  });
  const ws = new WebSocketServer({
    noServer: true,
    // Clients send orders only; large simulation proposals no longer exist.
    maxPayload: 512_000,
    perMessageDeflate: false,
  });
  http.on("upgrade", (req, socket, head) => {
    if (req.url !== "/socket" || !trustedOrigin(req)) {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(req, socket, head, (client) =>
      ws.emit("connection", client),
    );
  });
  const send = (client: WebSocket, message: ServerMessage) => {
    if (client.bufferedAmount > 512_000) {
      client.close(1013, "Connection too slow");
      return;
    }
    if (client.readyState === WebSocket.OPEN)
      client.send(JSON.stringify(message));
  };
  const publish = () => {
    const state = rooms.snapshot();
    for (const [client, session] of sessions)
      send(client, {
        type: "directory",
        guestId: session.guestId,
        now: now(),
        state,
        activeMatches: [...matches.values()].flatMap((match) => {
          const summary = match.summary(session.guestId);
          return summary ? [summary] : [];
        }),
      });
  };
  const sendGuest = (guest: string, message: ServerMessage) => {
    for (const [client, session] of sessions)
      if (session.guestId === guest) send(client, message);
  };
  ws.on("connection", (client) => {
    const authenticationDeadline = setTimeout(
      () => client.close(1008, "Authentication required"),
      5000,
    );
    client.on("pong", () => {
      const session = sessions.get(client);
      if (session) session.alive = true;
    });
    client.on("message", async (data) => {
      let requestId: string | undefined;
      let matchRequest = false;
      let previousState = rooms.snapshot();
      try {
        const message = clientMessageSchema.parse(JSON.parse(data.toString()));
        requestId = "requestId" in message ? message.requestId : undefined;
        if (message.type === "authenticate") {
          if (sessions.has(client)) throw new Error("Already authenticated.");
          const guestId = options.store.authenticate(message.token);
          if (!guestId) {
            client.close(1008, "Invalid guest session");
            return;
          }
          // Keep a live controller or pending admission safe from duplicate tabs.
          // A disconnected remembered guest can explicitly rejoin its stable seat.
          if (
            [...matches.values()].some(
              (match) =>
                (match.connected(guestId) && match.isLoaded(guestId)) ||
                match.isAdmitting(guestId),
            )
          ) {
            client.close(4001, "Match already open");
            return;
          }
          // One controlling socket per remembered guest, including duplicate browser tabs.
          for (const [other, session] of sessions)
            if (session.guestId === guestId) {
              sessions.delete(other);
              other.close(4001, "Opened in another tab");
            }
          sessions.set(client, {
            guestId,
            alive: true,
            count: 0,
            windowAt: now(),
          });
          clearTimeout(authenticationDeadline);
          rooms.reconnect(guestId);
          options.store.write(rooms.snapshot());
          publish();
          return;
        }
        const session = sessions.get(client);
        if (!session) {
          client.close(1008, "Authenticate first");
          return;
        }
        if (now() - session.windowAt > 1000) {
          session.windowAt = now();
          session.count = 0;
        }
        if (++session.count > 50) {
          if (session.count > 100) {
            client.close(1008, "Too many requests");
          }
          return;
        }
        if ("matchId" in message) {
          matchRequest = true;
          const match = matches.get(message.matchId);
          if (!match) throw new Error("This match is no longer available");
          if (
            [...matches.values()].some(
              (other) =>
                other !== match &&
                (other.connected(session.guestId) ||
                  other.isAdmitting(session.guestId)),
            )
          )
            throw new Error("Leave your other match before joining this one");
          switch (message.type) {
            case "watch-match":
              match.watch(
                session.guestId,
                options.store.profile(session.guestId) ??
                  DEFAULT_EMPIRE_PROFILE,
                message.playerId,
              );
              break;
            case "match-ready":
              await match.qualify(session.guestId, message.runtimeId);
              break;
            case "match-sync-applied":
              match.acknowledge(
                session.guestId,
                message.syncId,
                message.publicationSequence,
              );
              options.store.write(rooms.snapshot());
              publish();
              break;
            case "match-command":
              match.command(
                session.guestId,
                `${session.guestId}-${message.requestId}`,
                message.command,
              );
              break;
            case "select-spawn":
              await match.selectSpawn(session.guestId, message.tile);
              break;
          }
          if (sessions.get(client) === session)
            send(client, { type: "ack", requestId: message.requestId });
          return;
        }
        const previous = options.store.reply(
          session.guestId,
          message.requestId,
        );
        if (previous) {
          send(client, previous);
          return;
        }
        let roomId: string | undefined;
        const profile =
          options.store.profile(session.guestId) ?? DEFAULT_EMPIRE_PROFILE;
        if (
          message.type === "leave" ||
          message.type === "join" ||
          message.type === "create"
        ) {
          const active = [...matches.values()].find(
            (match) =>
              match.connected(session.guestId) ||
              match.isAdmitting(session.guestId),
          );
          if (active) {
            await active.disconnect(session.guestId);
            if (sessions.get(client) !== session) return;
            previousState = rooms.snapshot();
            options.store.write(previousState);
          }
        }
        switch (message.type) {
          case "profile":
            rooms.updateProfile(session.guestId, message.profile);
            break;
          case "create":
            roomId = rooms.create(
              session.guestId,
              profile,
              message.title,
              message.settings,
              message.willingToWait,
              now(),
            ).id;
            break;
          case "join":
            rooms.join(message.roomId, session.guestId, profile, now());
            roomId = message.roomId;
            break;
          case "leave":
            rooms.leave(session.guestId, now());
            break;
          case "voteStart":
            rooms.voteToStart(message.roomId, session.guestId);
            break;
          case "close":
            rooms.close(message.roomId, session.guestId);
            break;
        }
        const reply: ServerMessage = {
          type: "ack",
          requestId: message.requestId,
          roomId,
        };
        options.store.write(rooms.snapshot(), {
          guestId: session.guestId,
          requestId: message.requestId,
          reply,
          profile: message.type === "profile" ? message.profile : undefined,
        });
        publish();
        send(client, reply);
      } catch (error) {
        if (!matchRequest)
          rooms = new RoomCoordinator(now(), capacity, previousState);
        send(client, {
          type: "error",
          requestId,
          message:
            error instanceof Error && error.name !== "ZodError"
              ? error.message
              : "Invalid request.",
        });
      }
    });
    client.on("close", () => {
      clearTimeout(authenticationDeadline);
      const session = sessions.get(client);
      if (!session) return;
      sessions.delete(client);
      const active = [...matches.values()].find(
        (match) =>
          match.connected(session.guestId) ||
          match.isAdmitting(session.guestId),
      );
      if (
        active &&
        (active.isLoaded(session.guestId) ||
          active.isAdmitting(session.guestId))
      ) {
        rooms.disconnect(session.guestId, now());
        void active.disconnect(session.guestId);
      } else if (!active) rooms.disconnect(session.guestId, now());
      options.store.write(rooms.snapshot());
      publish();
    });
    client.on("error", () => client.terminate());
  });
  const clock = setInterval(() => {
    const before = JSON.stringify(rooms.snapshot());
    const starts = rooms.advance(now());
    for (const reservation of starts) {
      const match = new LiveMatch(
        reservation,
        options.createExecutor?.() ?? new ReservedMatchWorker(),
        runtimeId,
        sendGuest,
        () => {
          matches.delete(reservation.id);
          rooms.releaseMatch(reservation.id);
          options.store.write(rooms.snapshot());
          publish();
        },
        now,
        (guest) => rooms.disconnect(guest, now()),
        (guest, _playerId, profile) =>
          rooms.claimMatchSeat(reservation.id, guest, profile, now()),
        options.liveMatch,
      );
      matches.set(reservation.id, match);
      void match.initialize().catch(async (error) => {
        for (const member of reservation.members)
          sendGuest(member.guestId, {
            type: "error",
            message: (error as Error).message,
          });
        await match.end("Unable to initialize match");
      });
    }
    for (const match of matches.values())
      void match.advance().catch((error) => {
        void match.end(`Match stopped: ${(error as Error).message}`);
      });
    if (JSON.stringify(rooms.snapshot()) !== before) {
      options.store.write(rooms.snapshot());
      publish();
    }
  }, 50);
  // Public summaries are runtime-derived and cheap; no per-tick SQLite writes.
  const directoryClock = setInterval(publish, 1_000);
  const heartbeat = setInterval(() => {
    for (const [client, session] of sessions) {
      if (!session.alive) client.terminate();
      else {
        session.alive = false;
        client.ping();
      }
    }
    for (const [key, attempt] of attempts)
      if (now() - attempt.windowAt > 60_000) attempts.delete(key);
  }, 5000);
  return {
    http,
    get rooms() {
      return rooms;
    },
    async close() {
      clearInterval(clock);
      clearInterval(directoryClock);
      clearInterval(heartbeat);
      await Promise.all(
        [...matches.values()].map((match) =>
          match.end("Server is shutting down"),
        ),
      );
      for (const client of ws.clients) client.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      if (http.listening)
        await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
