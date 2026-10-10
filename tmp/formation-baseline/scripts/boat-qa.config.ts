import { defineConfig } from "vitest/config";
import base from "../vite.skirmish.config";
export default defineConfig({
  ...base,
  test: { environment: "node", include: ["scripts/BoatVisualQA.test.ts"] },
});
