import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { technologyPlanDevPlugin } from "../../scripts/technologyPlanDevPlugin";
import { createRussianRework } from "../../src/skirmish/planning/RussianTechnologyRework";
import { createInitialPlan } from "../../src/skirmish/planning/TechnologyPlanSeed";

describe("local technology-plan saves", () => {
  let directory: string, server: ViteDevServer, origin: string, file: string;
  beforeAll(async () => {
    directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "aof-technology-plan-"),
    );
    file = path.join(directory, "skirmish/plans/technology-plan.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify(createInitialPlan(), null, 2) + "\n",
    );
    server = await createServer({
      configFile: false,
      root: directory,
      plugins: [technologyPlanDevPlugin()],
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string")
      throw new Error("No test server address");
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await server?.close();
    if (directory) {
      if (
        path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) ||
        !path.basename(directory).startsWith("aof-technology-plan-")
      )
        throw new Error("Unexpected test cleanup directory");
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  const get = async () =>
    (await fetch(`${origin}/__planning/technology-plan`)).json();
  const put = (plan: unknown, revision: string, requestOrigin = origin) =>
    fetch(`${origin}/__planning/technology-plan`, {
      method: "PUT",
      headers: {
        Origin: requestOrigin,
        "Content-Type": "application/json",
        "If-Match": revision,
      },
      body: JSON.stringify(plan),
    });
  it("persists validated edits and detects stale-tab overwrites", async () => {
    const loaded = await get();
    loaded.plan.civilizations[1].units[0].name = "Test Clubmen";
    const response = await put(loaded.plan, loaded.revision);
    expect(response.status).toBe(200);
    expect(
      JSON.parse(await fs.readFile(file, "utf8")).civilizations[1].units[0]
        .name,
    ).toBe("Test Clubmen");
    expect((await put(loaded.plan, loaded.revision)).status).toBe(409);
  });
  it("round-trips the eight-age draft and edited capstone prices", async () => {
    const loaded = await get();
    const draft = createRussianRework(loaded.plan.civilizations[1]);
    const capstone = draft.technologies.find(
      (n) => n.id === "russian-hypersonic-rail",
    )!;
    capstone.gold = 1500000;
    capstone.researchSeconds = 420;
    loaded.plan.civilizations.push(draft);
    expect((await put(loaded.plan, loaded.revision)).status).toBe(200);
    const saved = (await get()).plan.civilizations.find(
      (c: { id: string }) => c.id === draft.id,
    );
    expect(saved.ages).toEqual(draft.ages);
    expect(
      saved.technologies.find((n: { id: string }) => n.id === capstone.id),
    ).toEqual(capstone);
  });
  it("rejects invalid graphs and external-origin writes without modifying the file", async () => {
    const loaded = await get(),
      before = await fs.readFile(file, "utf8");
    loaded.plan.civilizations[0].technologies[0].prerequisites = [
      "missing-node",
    ];
    expect((await put(loaded.plan, loaded.revision)).status).toBe(422);
    expect(
      (
        await put(
          createInitialPlan(),
          loaded.revision,
          "https://external.example",
        )
      ).status,
    ).toBe(403);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
});
