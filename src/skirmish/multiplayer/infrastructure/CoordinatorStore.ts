import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { EmpireProfile } from "../../lobby/EmpireProfile";
import type { CoordinatorState } from "../domain/RoomCoordinator";
import type { ServerMessage } from "../Protocol";

export interface GuestSession {
  guestId: string;
  token: string;
}

/** A single coordinator process owns this durable transactional store. */
export class CoordinatorStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS coordinator (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS guest_profiles (guest_id TEXT PRIMARY KEY, profile TEXT NOT NULL); CREATE TABLE IF NOT EXISTS requests (guest_id TEXT NOT NULL, request_id TEXT NOT NULL, reply TEXT NOT NULL, sequence INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE(guest_id, request_id));",
    );
  }
  createGuest(): GuestSession {
    const session = {
      guestId: randomUUID(),
      token: randomBytes(32).toString("base64url"),
    };
    this.db
      .prepare("INSERT INTO guests (id, token_hash) VALUES (?, ?)")
      .run(session.guestId, this.hash(session.token));
    return session;
  }
  authenticate(token: string): string | undefined {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) return undefined;
    return (
      this.db
        .prepare("SELECT id FROM guests WHERE token_hash = ?")
        .get(this.hash(token)) as { id: string } | undefined
    )?.id;
  }
  read(): CoordinatorState | undefined {
    const row = this.db
      .prepare("SELECT state FROM coordinator WHERE id=1")
      .get() as { state: string } | undefined;
    return row ? JSON.parse(row.state) : undefined;
  }
  reply(guestId: string, requestId: string): ServerMessage | undefined {
    const row = this.db
      .prepare("SELECT reply FROM requests WHERE guest_id=? AND request_id=?")
      .get(guestId, requestId) as { reply: string } | undefined;
    return row ? JSON.parse(row.reply) : undefined;
  }
  profile(guestId: string): EmpireProfile | undefined {
    const row = this.db
      .prepare("SELECT profile FROM guest_profiles WHERE guest_id=?")
      .get(guestId) as { profile: string } | undefined;
    return row ? JSON.parse(row.profile) : undefined;
  }
  write(
    state: CoordinatorState,
    command?: {
      guestId: string;
      requestId: string;
      reply: ServerMessage;
      profile?: EmpireProfile;
    },
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO coordinator (id, state) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state",
        )
        .run(JSON.stringify(state));
      if (command) {
        this.db
          .prepare(
            "INSERT INTO requests (guest_id, request_id, reply) VALUES (?, ?, ?)",
          )
          .run(
            command.guestId,
            command.requestId,
            JSON.stringify(command.reply),
          );
        this.db
          .prepare(
            "DELETE FROM requests WHERE guest_id=? AND sequence NOT IN (SELECT sequence FROM requests WHERE guest_id=? ORDER BY sequence DESC LIMIT 256)",
          )
          .run(command.guestId, command.guestId);
        if (command.profile)
          this.db
            .prepare(
              "INSERT INTO guest_profiles (guest_id, profile) VALUES (?, ?) ON CONFLICT(guest_id) DO UPDATE SET profile=excluded.profile",
            )
            .run(command.guestId, JSON.stringify(command.profile));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
