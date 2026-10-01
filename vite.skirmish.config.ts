import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { computeRuntimeBuild } from "./src/skirmish/multiplayer/infrastructure/RuntimeBuild";

let buildOutDir = path.resolve("build/skirmish");

export default defineConfig({
  define: { "import.meta.env.VITE_SKIRMISH_RUNTIME_ID": JSON.stringify(computeRuntimeBuild()) },
  publicDir: "resources",
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: "skirmish-entry",
      configResolved(config) {
        buildOutDir = path.resolve(config.root, config.build.outDir);
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] !== "/") {
            next();
            return;
          }
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
        });
      },
      // Publish the homepage at / and retain the game at /skirmish/index.html.
      closeBundle() {
        const nested = path.join(buildOutDir, "skirmish/home.html");
        if (fs.existsSync(nested))
          fs.copyFileSync(nested, path.join(buildOutDir, "index.html"));
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
        troops: "skirmish/troops.html",
      },
    },
  },
  test: { environment: "node", include: ["tests/skirmish/**/*.test.ts"] },
});
