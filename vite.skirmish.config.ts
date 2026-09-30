import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  publicDir: "resources",
  resolve: { tsconfigPaths: true },
  plugins: [
    {
      name: "skirmish-entry",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] !== "/") {
            next();
            return;
          }
          const html = fs.readFileSync(
            path.resolve("skirmish/index.html"),
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
      // Vite's Rollup input lives in a subdirectory; publish a normal root page.
      closeBundle() {
        const nested = path.resolve("build/skirmish/skirmish/index.html");
        if (fs.existsSync(nested))
          fs.copyFileSync(nested, path.resolve("build/skirmish/index.html"));
      },
    },
  ],
  server: { host: "127.0.0.1", port: 9000, strictPort: true, open: false },
  preview: { host: "127.0.0.1", port: 9000, strictPort: true },
  build: {
    outDir: "build/skirmish",
    rollupOptions: { input: "skirmish/index.html" },
  },
  test: { environment: "node", include: ["tests/skirmish/**/*.test.ts"] },
});
