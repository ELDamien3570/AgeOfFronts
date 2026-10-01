import { createServer, type IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { DEFAULT_EMPIRE_PROFILE } from "../../lobby/EmpireProfile";
import { LiveMatch } from "../application/LiveMatch";
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
}

/** Transport adapter: credentials never appear in URLs or public directory messages. */
export function createCoordinatorServer(options: CoordinatorServerOptions) {
  const now = options.now ?? Date.now;
  // Tests may disable admission; the runnable server supplies its explicit ceiling.
  const capacity = options.matchCapacity ?? 0;
  const matches = new Map<string, LiveMatch>();
  const runtimeId = computeRuntimeBuild();
  let rooms = new RoomCoordinator(now(), capacity, options.store.read());
  const restored = rooms.snapshot();
  for (const room of [...restored.rooms, ...restored.reservations])
    for (const member of room.members) rooms.disconnect(member.guestId, now());
  options.store.write(rooms.snapshot());
  const sessions = new Map<
    WebSocket,
    { guestId: string; alive: boolean; count: number; windowAt: number }
  >();
  const attempts = new Map<string, { count: number; windowAt: number }>();
  const trustedOrigin = (req: IncomingMessage) =>
    typeof req.headers.origin === "string" &&
    options.origins.includes(req.headers.origin);
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
    if (!trustedOrigin(req)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin!);
    res.setHeader("Vary", "Origin");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST");
      res.writeHead(204).end();
      return;
    }
    if (req.url !== "/guest" || req.method !== "POST") {
      res.writeHead(404).end();
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
  });
  const ws = new WebSocketServer({
    noServer: true,
    maxPayload: 8_100_000,
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
          const restoredProfile = rooms
            .snapshot()
            .rooms.flatMap((room) => room.members)
            .find((member) => member.guestId === guestId)?.profile;
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
        if (++session.count > 30) {
          client.close(1008, "Too many requests");
          return;
        }
        if ("matchId" in message) {
          matchRequest = true;
          const match = matches.get(message.matchId);
          if (!match || !match.connected(session.guestId))
            throw new Error("This match is no longer available");
          switch (message.type) {
            case "watch-match":
              match.announce(session.guestId);
              break;
            case "match-ready":
              await match.qualify(
                session.guestId,
                message.runtimeId,
                message.tickP95Ms,
              );
              break;
            case "host-ready":
              match.hostReady(
                session.guestId,
                message.epoch,
                message.tick,
                message.hash,
              );
              break;
            case "match-command":
              match.command(
                session.guestId,
                `${session.guestId}-${message.requestId}`,
                message.command,
              );
              break;
            case "host-commit":
              await match.accept(
                session.guestId,
                message.epoch,
                message.proposal,
              );
              break;
          }
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
          const active = [...matches.values()].find((match) =>
            match.connected(session.guestId),
          );
          if (active) {
            await active.disconnect(session.guestId);
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
      const active = [...matches.values()].find((match) =>
        match.connected(session.guestId),
      );
      if (active?.isLoaded(session.guestId)) {
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
        new ReservedMatchWorker(),
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
