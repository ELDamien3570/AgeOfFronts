import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeRuntimeBuild } from "../../src/skirmish/multiplayer/infrastructure/RuntimeBuild";

describe("runtime compatibility identity", () => {
  it("includes workers and client decoding while excluding documentation and normalizing line endings", () => {
    const root = mkdtempSync(join(tmpdir(), "aof-runtime-build-"));
    const files = [
      "src/skirmish/Simulation.ts",
      "src/skirmish/domain/Trade.ts",
      "src/skirmish/content/Units.ts",
      "src/core/game/GameMap.ts",
      "src/skirmish/multiplayer/application/LiveMatch.ts",
      "src/skirmish/multiplayer/infrastructure/SnapshotEncodingWorker.ts",
      "src/skirmish/multiplayer/infrastructure/snapshotEncoderWorker.ts",
      "src/skirmish/multiplayer/infrastructure/serverMatchWorker.ts",
      "src/skirmish/client/CanonicalStateStream.ts",
      ...["StateCodec", "StateLimits", "Protocol", "CommandSchema"].map(
        (name) => `src/skirmish/multiplayer/${name}.ts`,
      ),
    ];
    try {
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), "export const value = 1;\n");
      }
      const original = computeRuntimeBuild(root);
      for (const file of files) {
        writeFileSync(join(root, file), "export const value = 2;\n");
        expect(computeRuntimeBuild(root), file).not.toBe(original);
        writeFileSync(join(root, file), "export const value = 1;\r\n");
        expect(computeRuntimeBuild(root), file).toBe(original);
      }
      mkdirSync(join(root, ".codex/plans"), { recursive: true });
      writeFileSync(
        join(root, ".codex/plans/Release.md"),
        "documentation only",
      );
      expect(computeRuntimeBuild(root)).toBe(original);
      expect(readFileSync(join(root, files[0]), "utf8")).toContain("\r\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
