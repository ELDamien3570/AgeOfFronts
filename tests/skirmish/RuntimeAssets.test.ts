import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects unresolved LFS images in nested Docker inputs and accepts materialized images", () => {
  const root = mkdtempSync(path.join(tmpdir(), "aof-assets-"));
  try {
    mkdirSync(path.join(root, "effects"));
    const image = path.join(root, "effects", "blood.png");
    writeFileSync(image, "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 100\n");
    const verify = () => spawnSync(process.execPath, ["scripts/verifyRuntimeAssets.mjs", root], { encoding: "utf8" });
    const rejected = verify();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(image);
    writeFileSync(image, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(verify().status).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
