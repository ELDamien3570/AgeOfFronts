import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";
import { validatePlan } from "../src/skirmish/planning/TechnologyPlan";
import { readTechnologyPlan } from "../src/skirmish/planning/TechnologyPlanMigration";

export function technologyPlanDevPlugin(): Plugin {
  let saving = false;
  let planPath: string;
  const revision = (body: string) =>
    createHash("sha256").update(body).digest("hex");
  return {
    name: "technology-planning-save",
    configResolved(config) {
      planPath = path.resolve(
        config.root,
        "skirmish/plans/technology-plan.json",
      );
    },
    handleHotUpdate(context) {
      // Explicit reloads own this file. A save must not reload the editor or
      // discard another open tab's draft through Vite's normal JSON HMR.
      if (path.resolve(context.file) === planPath) return [];
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split("?")[0] !== "/__planning/technology-plan")
          return next();
        const respond = (status: number, body: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(body));
        };
        // Only the local development page may read/write this fixed plan file.
        const host = req.headers.host ?? "";
        const remote = req.socket.remoteAddress ?? "";
        if (
          !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote)
        )
          return respond(403, {
            error: "Planning saves require a local development server.",
          });
        try {
          if (req.method === "GET") {
            const body = await fs.readFile(planPath, "utf8");
            return respond(200, {
              plan: readTechnologyPlan(JSON.parse(body)),
              revision: revision(body),
            });
          }
          if (req.method !== "PUT")
            return respond(405, { error: "Use GET or PUT." });
          if (
            req.headers.origin !== `http://${host}` ||
            !req.headers["content-type"]?.startsWith("application/json")
          )
            return respond(403, {
              error: "Save must come from the local planning page.",
            });
          if (saving)
            return respond(409, {
              error:
                "Another save is in progress. Reload the saved plan before saving again.",
            });
          saving = true;
          try {
            const previous = await fs.readFile(planPath, "utf8");
            if (req.headers["if-match"] !== revision(previous))
              return respond(409, {
                error:
                  "The file changed in another tab or on disk. Export your draft, then reload the saved plan.",
              });
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 2_000_000)
                return respond(413, { error: "Plan exceeds the 2 MB limit." });
              chunks.push(Buffer.from(chunk));
            }
            let plan: unknown;
            try {
              plan = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              return respond(400, { error: "Invalid JSON." });
            }
            const errors = validatePlan(plan);
            if (errors.length)
              return respond(422, { error: errors.slice(0, 20).join("\n") });
            const body = JSON.stringify(plan, null, 2) + "\n";
            const temporary = `${planPath}.tmp`;
            try {
              await fs.writeFile(temporary, body, "utf8");
              await fs.rename(temporary, planPath);
            } finally {
              await fs.rm(temporary, { force: true });
            }
            return respond(200, { revision: revision(body) });
          } finally {
            saving = false;
          }
        } catch (error) {
          return respond(500, {
            error:
              error instanceof Error
                ? error.message
                : "Unable to read or save plan.",
          });
        }
      });
    },
  };
}
