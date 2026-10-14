import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createCoordinatorServer } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorServer";
import { CoordinatorStore } from "../../src/skirmish/multiplayer/infrastructure/CoordinatorStore";

it("rejects malformed static paths without losing authenticated sockets or HTTP service", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aof-static-test-"));
  writeFileSync(join(directory, "index.html"), "home");
  writeFileSync(join(directory, "valid file.txt"), "valid encoded path");
  const store = new CoordinatorStore(":memory:");
  const server = createCoordinatorServer({ store, origins: [], staticDir: directory });
  let socket: WebSocket | undefined;
  try {
    await new Promise<void>(resolve => server.http.listen(0, "127.0.0.1", resolve));
    const port = (server.http.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const identity = await (await fetch(base + "/guest", { method: "POST" })).json();
    socket = new WebSocket(`ws://127.0.0.1:${port}/socket`);
    await new Promise<void>((resolve, reject) => { socket!.once("open", resolve); socket!.once("error", reject); });
    const directoryReceived = new Promise<void>(resolve => socket!.on("message", raw => {
      if (JSON.parse(raw.toString()).type === "directory") resolve();
    }));
    socket.send(JSON.stringify({ type: "authenticate", token: identity.token }));
    await directoryReceived;
    for (const path of ["/%", "/%GG", "/%FF", "/%C0%AF", "/%E0%A4%A", "/assets/%ED%A0%80.js"])
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(base + path, { method });
        expect(response.status).toBe(400);
        expect(response.headers.get("cache-control")).toBe("no-store");
        await response.arrayBuffer();
      }
    expect(await (await fetch(base + "/healthz")).json()).toMatchObject({ status: "ok" });
    expect(await (await fetch(base + "/valid%20file.txt")).text()).toBe("valid encoded path");
    expect(await (await fetch(base + "/")).text()).toBe("home");
    const pong = new Promise<void>(resolve => socket!.once("pong", () => resolve()));
    socket.ping(); await pong;
    expect(socket.readyState).toBe(WebSocket.OPEN);
  } finally {
    socket?.terminate();
    await server.close(); store.close();
    unlinkSync(join(directory, "index.html")); unlinkSync(join(directory, "valid file.txt")); rmdirSync(directory);
  }
}, 10_000);
