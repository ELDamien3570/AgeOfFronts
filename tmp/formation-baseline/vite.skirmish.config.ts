import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { technologyPlanDevPlugin } from "./scripts/technologyPlanDevPlugin";
import { computeRuntimeBuild } from "./src/skirmish/multiplayer/infrastructure/RuntimeBuild";

let buildOutDir = path.resolve("build/skirmish");

export default defineConfig({
  define: {
    "import.meta.env.VITE_SKIRMISH_RUNTIME_ID": JSON.stringify(
      computeRuntimeBuild(),
    ),
  },
  publicDir: "resources",
  resolve: { tsconfigPaths: true },
  plugins: [
    technologyPlanDevPlugin(),
    {
      name: "skirmish-entry",
      configResolved(config) {
        buildOutDir = path.resolve(config.root, config.build.outDir);
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const rawUrl = req.url?.split("?")[0] ?? "";
          if (rawUrl === "/") {
            const html = fs.readFileSync(
              path.resolve("skirmish/home.html"),
              "utf8",
            );
            server
              .transformIndexHtml("/", html)
              .then((output) => {
                res.setHeader("Content-Type", "text/html");
                res.end(output);
              })
              .catch(next);
            return;
          }
          const relPath = rawUrl.replace(/^\/+/, "");
          if (["robots.txt", "sitemap.xml", "ads.txt"].includes(relPath)) {
            const filePath = path.resolve("resources/public", relPath);
            if (fs.existsSync(filePath)) {
              res.setHeader(
                "Content-Type",
                relPath.endsWith(".xml")
                  ? "application/xml; charset=utf-8"
                  : "text/plain; charset=utf-8",
              );
              res.end(fs.readFileSync(filePath));
              return;
            }
          }
          next();
        });
      },
      // Publish the homepage at / and retain the game at /skirmish/index.html.
      writeBundle() {
        const nested = path.join(buildOutDir, "skirmish/home.html");
        if (!fs.existsSync(nested)) {
          return;
        }
        try {
          fs.copyFileSync(nested, path.join(buildOutDir, "index.html"));
        } catch {}

        const publicFiles = [
          "robots.txt",
          "sitemap.xml",
          "ads.txt",
          "privacy-policy.html",
          "terms-of-service.html",
        ];
        for (const file of publicFiles) {
          const src = path.resolve("resources/public", file);
          const dest = path.join(buildOutDir, file);
          if (fs.existsSync(src)) {
            try {
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.copyFileSync(src, dest);
            } catch {}
          }
        }
      },
      closeBundle() {
        const nested = path.join(buildOutDir, "skirmish/home.html");
        if (!fs.existsSync(nested)) {
          return;
        }
        try {
          fs.copyFileSync(nested, path.join(buildOutDir, "index.html"));
        } catch {}

        const publicFiles = [
          "robots.txt",
          "sitemap.xml",
          "ads.txt",
          "privacy-policy.html",
          "terms-of-service.html",
        ];
        for (const file of publicFiles) {
          const src = path.resolve("resources/public", file);
          const dest = path.join(buildOutDir, file);
          if (fs.existsSync(src)) {
            try {
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.copyFileSync(src, dest);
            } catch {}
          }
        }
      },
    },
  ],
  server: { host: "127.0.0.1", port: 9000, strictPort: true, open: false },
  preview: { host: "127.0.0.1", port: 9000, strictPort: true },
  build: {
    outDir: "build/skirmish",
    rollupOptions: {
      input: {
        home: "skirmish/home.html",
        game: "skirmish/index.html",
        blackForest: "skirmish/black-forest.html",
        migration: "skirmish/migration.html",
        troops: "skirmish/troops.html",
        technologyPlanner: "skirmish/technology-planner.html",
        troopTree: "skirmish/troop-tree.html",
      },
    },
  },
  test: { environment: "node", include: ["tests/skirmish/**/*.test.ts"] },
});
