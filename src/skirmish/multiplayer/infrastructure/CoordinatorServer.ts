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
import {
  MATCH_INITIALIZATION_FAILED_MESSAGE,
  publicInitializationMessage,
  publicStopMessage,
} from "../application/TerminalMessages";
import type { MatchExecutor } from "../application/MatchExecutor";
import { RoomCoordinator, type CoordinatorState } from "../domain/RoomCoordinator";
import { clientMessageSchema, type ServerMessage } from "../Protocol";
import { CoordinatorStore } from "./CoordinatorStore";
import { ReservedMatchWorker } from "./ReservedMatchWorker";
import { computeRuntimeBuild } from "./RuntimeBuild";
import { RuntimeDiagnostics } from "../../RuntimeDiagnostics";
import { encodeSnapshotFrame, textSnapshotPacket } from "../SnapshotWireCodec";

export interface CoordinatorServerOptions {
  store: CoordinatorStore;
  origins: readonly string[];
  now?: () => number;
  matchCapacity?: number;
  staticDir?: string;
  liveMatch?: LiveMatchOptions;
  /** Injectable executor for deterministic integration tests; production uses one reserved worker. */
  createExecutor?: () => MatchExecutor;
  /** Heartbeat ping interval (default 5000 ms). Two missed pongs are tolerated. */
  heartbeatMs?: number;
  /** Concurrent WebSockets per client address; 0 (default) disables the cap.
   * Behind a reverse proxy, enable `trustProxy` or every player shares one address. */
  maxSocketsPerAddress?: number;
  /** Use the last X-Forwarded-For hop (appended by the trusted proxy) as the client address. */
  trustProxy?: boolean;
}

/** Transport ceiling. The largest legal command (10,000 building ids) is about
 * 100 KB; `ws` closes larger frames (1009) before any message event. */
export const MAX_FRAME_BYTES = 128_000;
/** Frames before authentication only carry a token and an optional match id. */
export const MAX_UNAUTHENTICATED_FRAME_BYTES = 4_096;
const MAX_UNAUTHENTICATED_FRAMES = 8;
/** Frames above this size count against the per-second byte budget. */
const BUDGETED_FRAME_BYTES = 2_048;
const SESSION_BYTES_PER_SECOND = 512_000;
/** Pre-parse frame ceiling per second, receipts included (the 50/s request
 * limit applies after parsing and exempts receipts). */
const SESSION_FRAMES_PER_SECOND = 200;
const SESSION_REQUESTS_PER_SECOND = 50;
/** Consecutive over-limit one-second windows that close the socket. */
const RATE_STRIKES_TO_CLOSE = 3;
const MISSED_PONGS_TOLERATED = 2;

interface Session {
  guestId: string;
  missedPongs: number;
  count: number;
  frames: number;
  bytes: number;
  windowAt: number;
  overLimit: boolean;
  strikes: number;
  binarySnapshots: boolean;
}
const frameBytes = (data: Buffer | ArrayBuffer | Buffer[]): number =>
  Array.isArray(data) ? data.reduce((sum, part) => sum + part.length, 0) : data.byteLength;

function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
): boolean {
  if (!existsSync(staticDir)) return false;
  const rawUrl = req.url?.split("?")[0] ?? "/";
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawUrl);
  } catch {
    // Invalid escapes/UTF-8 are request errors, never coordinator failures.
    // Letting URIError escape the HTTP listener loses every live match.
    res.setHeader("Cache-Control", "no-store");
    res.writeHead(400).end();
    return true;
  }
  let pathname = normalize(decodedPath).replace(
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
  const diagnostics = new RuntimeDiagnostics();
  let rooms = new RoomCoordinator(now(), capacity, options.store.read());
  const restored = rooms.snapshot();
  for (const room of [...restored.rooms, ...restored.reservations])
    for (const member of room.members) rooms.disconnect(member.guestId, now());
  // Workers are memory-only; never advertise or reserve capacity for stale DB matches.
  for (const reservation of restored.reservations)
    rooms.releaseMatch(reservation.id);
  options.store.write(rooms.snapshot());
  const authenticationClaims=new Set<string>();
  const sessions = new Map<WebSocket, Session>();
  const socketsByAddress = new Map<string, number>();
  const maxSocketsPerAddress = options.maxSocketsPerAddress ?? 0;
  const clientAddress = (req: IncomingMessage): string => {
    if (options.trustProxy) {
      const forwarded = req.headers["x-forwarded-for"];
      const hops = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "")
        .split(",").map((hop) => hop.trim()).filter(Boolean);
      if (hops.length) return hops[hops.length - 1];
    }
    return req.socket.remoteAddress ?? "unknown";
  };
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
          // Liveness is distinct from advancing match workers; expose only
          // aggregate status here, not internal memory or per-player details.
          matchProgress: {
            running: [...matches.values()].filter(m => m.progress().state === "running").length,
            stalled: [...matches.values()].filter(m => m.progress().state === "stalled").length,
            preparing: [...matches.values()].filter(m => m.progress().state === "preparing").length,
          },
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
      const key = clientAddress(req);
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
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
  });
  http.on("upgrade", (req, socket, head) => {
    if (req.url !== "/socket" || !trustedOrigin(req)) {
      socket.destroy();
      return;
    }
    if (maxSocketsPerAddress > 0) {
      const address = clientAddress(req), open = socketsByAddress.get(address) ?? 0;
      if (open >= maxSocketsPerAddress) {
        socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      socketsByAddress.set(address, open + 1);
      // The raw socket closes for failed handshakes and finished connections alike.
      socket.once("close", () => {
        const remaining = (socketsByAddress.get(address) ?? 1) - 1;
        if (remaining > 0) socketsByAddress.set(address, remaining);
        else socketsByAddress.delete(address);
      });
    }
    ws.handleUpgrade(req, socket, head, (client) =>
      ws.emit("connection", client),
    );
  });
  const send = (client: WebSocket, message: ServerMessage) => {
    if (client.bufferedAmount > 8 * 1024 * 1024) {
      client.close(1013, "Connection too slow");
      return;
    }
    if (client.readyState === WebSocket.OPEN) {
      if (message.type === "match-state" && message.packet.binary) {
        if (sessions.get(client)?.binarySnapshots) {
          const state = message;
          const frame = diagnostics.measure("transport", () => encodeSnapshotFrame(state));
          diagnostics.measure("socket", () => client.send(frame));
          return;
        }
        message = { ...message, packet: textSnapshotPacket(message.packet) };
      }
      const text = diagnostics.measure("json", () => JSON.stringify(message));
      diagnostics.measure("socket", () => client.send(text));
    }
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
    diagnostics.measure("fanout", () => {
    for (const [client, session] of sessions)
      if (session.guestId === guest) send(client, message);
    });
  };
  const disconnectSession = async (session: Session) => {
    rooms.disconnect(session.guestId, now());
    await Promise.allSettled([...matches.values()].map(match=>match.disconnect(session.guestId)));
    if([...sessions.values()].some(s=>s.guestId===session.guestId))return;
    options.store.write(rooms.snapshot());
    publish();
  };
  ws.on("connection", (client) => {
    const authenticationDeadline = setTimeout(
      () => client.close(1008, "Authentication required"),
      5000,
    );
    client.on("pong", () => {
      const session = sessions.get(client);
      if (session) session.missedPongs = 0;
    });
    let unauthenticatedFrames = 0;
    /** Mark this window over its limit; close after consecutive violations. */
    const violate = (session: Session): boolean => {
      session.overLimit = true;
      if (session.strikes + 1 < RATE_STRIKES_TO_CLOSE) return false;
      sessions.delete(client);
      client.close(1008, "Rate limit exceeded");
      void disconnectSession(session);
      return true;
    };
    client.on("message", async (data) => {
      // Admission by size and frequency happens before any parsing or
      // validation, so oversized or flooding frames cost only a length check.
      const bytes = frameBytes(data);
      const admitted = sessions.get(client);
      if (!admitted) {
        if (bytes > MAX_UNAUTHENTICATED_FRAME_BYTES || ++unauthenticatedFrames > MAX_UNAUTHENTICATED_FRAMES) {
          client.close(1008, "Authenticate first");
          return;
        }
      } else {
        if (now() - admitted.windowAt > 1000) {
          // A quiet window between violations resets the streak.
          admitted.strikes = admitted.overLimit && now() - admitted.windowAt <= 2000 ? admitted.strikes + 1 : 0;
          admitted.overLimit = false;
          admitted.windowAt = now();
          admitted.count = 0;
          admitted.frames = 0;
          admitted.bytes = 0;
        }
        admitted.bytes += bytes;
        if (++admitted.frames > SESSION_FRAMES_PER_SECOND ||
          (bytes > BUDGETED_FRAME_BYTES && admitted.bytes > SESSION_BYTES_PER_SECOND)) {
          if (!violate(admitted))
            send(client, { type: "error", message: "Request rate exceeded. This action was not accepted; retry after one second." });
          return;
        }
      }
      let requestId: string | undefined;
      let matchRequest = false;
      // Captured lazily, immediately before the first room mutation.
      let previousState: CoordinatorState | undefined;
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
          const active=[...matches.entries()].filter(([,match])=>match.connected(guestId)||match.isAdmitting(guestId));
          if(active.length && (!message.matchId||active.some(([id])=>id!==message.matchId))){
            client.close(4001,"Match already open");return;
          }
          if(authenticationClaims.has(guestId)){client.close(4001,"Connection handoff in progress");return;}
          authenticationClaims.add(guestId);
          try {
            // An explicit match route may replace the same guest's old socket.
            // Release its admissions and seat before the replacement watches.
            for(const [other,session] of sessions)if(session.guestId===guestId){
              sessions.delete(other);other.close(4001,"Opened in another tab");
            }
            if(active.length)matchRequest=true;
            await Promise.all(active.map(([,match])=>match.disconnect(guestId)));
            if(client.readyState!==WebSocket.OPEN)return;
          previousState = rooms.snapshot();
          rooms.disconnect(guestId,now());
          // One controlling socket per remembered guest, including duplicate browser tabs.
          for (const [other, session] of sessions)
            if (session.guestId === guestId) {
              sessions.delete(other);
              other.close(4001, "Opened in another tab");
            }
          sessions.set(client, {
            guestId,
            binarySnapshots: message.snapshotTransport === "binary-v1",
            missedPongs: 0,
            count: 0,
            frames: 0,
            bytes: 0,
            windowAt: now(),
            overLimit: false,
            strikes: 0,
          });
          clearTimeout(authenticationDeadline);
          // Presence is restored only by an explicit join request.
          options.store.write(rooms.snapshot());
          publish();
          } finally { authenticationClaims.delete(guestId); }
          return;
        }
        const session = sessions.get(client);
        if (!session) {
          client.close(1008, "Authenticate first");
          return;
        }
        // State receipts release publication/backpressure; player action bursts
        // must not consume their budget or prevent the client staying current.
        const stateReceipt = message.type === "match-state-applied" ||
          message.type === "match-sync-applied";
        if (!stateReceipt && ++session.count > SESSION_REQUESTS_PER_SECOND) {
          if (!violate(session))
            send(client,{type:"error",requestId:message.requestId,message:"Request rate exceeded. This action was not accepted; retry after one second."});
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
              await match.qualify(session.guestId, message.runtimeId,message.flowControl);
              break;
            case "match-state-applied":
              match.stateApplied(session.guestId,message.publicationSequence,message.flowEpoch);
              break;
            case "match-state-resync":
              match.resync(session.guestId);break;
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
          const active=[...matches.values()].filter(match=>match.connected(session.guestId)||match.isAdmitting(session.guestId));
          if(active.length){
            await Promise.all(active.map(match=>match.disconnect(session.guestId)));
            if(sessions.get(client)!==session)return;
            previousState=rooms.snapshot();options.store.write(previousState);
          }
        }
        previousState ??= rooms.snapshot();
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
        if (!matchRequest && previousState)
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
    client.on("close", async () => {
      clearTimeout(authenticationDeadline);
      const session = sessions.get(client);
      if (!session) return;
      sessions.delete(client);
      await disconnectSession(session);
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
        // The match never started: put its current members (live state, not
        // the start-time copy) back in their room before releasing capacity.
        const message = publicInitializationMessage(error);
        for (const guest of rooms.abandonReservation(reservation.id, now()))
          sendGuest(guest, { type: "error", message });
        options.store.write(rooms.snapshot());
        publish();
        await match.end(MATCH_INITIALIZATION_FAILED_MESSAGE);
      });
    }
    for (const match of matches.values())
      void match.advance().catch((error) => {
        void match.endAfterFailure(error);
      });
    if (JSON.stringify(rooms.snapshot()) !== before) {
      options.store.write(rooms.snapshot());
      publish();
    }
  }, 50);
  // Public summaries are runtime-derived and cheap; no per-tick SQLite writes.
  const directoryClock = setInterval(publish, 1_000);
  const heartbeat = setInterval(() => {
    // A ping can queue behind large state frames or a brief network blip.
    // Tolerate two unanswered pings; terminate when a third goes unanswered.
    for (const [client, session] of sessions) {
      if (session.missedPongs > MISSED_PONGS_TOLERATED) client.terminate();
      else {
        session.missedPongs++;
        client.ping();
      }
    }
    for (const [key, attempt] of attempts)
      if (now() - attempt.windowAt > 60_000) attempts.delete(key);
  }, options.heartbeatMs ?? 5000);
  const diagnosticClock = setInterval(() => {
    if (!matches.size) return;
    console.info(JSON.stringify({ event: "coordinator-runtime-diagnostics", source: process.env.GIT_COMMIT ?? "unknown",
      runtime: process.version, runtimeId, processRss: process.memoryUsage().rss,
      timings: diagnostics.snapshot(), retainedBytes: diagnostics.retainedBytes,
      connections: sessions.size, bufferedBytes: [...ws.clients].reduce((sum, client) => sum + client.bufferedAmount, 0),
      matches: [...matches.values()].map(match => match.runtimeDiagnostics()) }));
  }, 30_000);
  diagnosticClock.unref();
  return {
    http,
    runtimeDiagnostics: () => ({ runtimeId, timings: diagnostics.snapshot(), retainedBytes: diagnostics.retainedBytes,
      connections: sessions.size, bufferedBytes: [...ws.clients].reduce((sum, client) => sum + client.bufferedAmount, 0),
      matches: [...matches.values()].map(match => match.runtimeDiagnostics()) }),
    get rooms() {
      return rooms;
    },
    async close() {
      clearInterval(clock);
      clearInterval(directoryClock);
      clearInterval(heartbeat);
      clearInterval(diagnosticClock);
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
