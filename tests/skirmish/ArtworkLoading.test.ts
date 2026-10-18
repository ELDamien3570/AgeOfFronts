import { afterEach, describe, expect, it, vi } from "vitest";
import { EraArtwork } from "../../src/skirmish/client/EraArtwork";
import { TroopActors, type TroopActorDefinition } from "../../src/skirmish/client/troops/TroopActors";
import type { ActorClip } from "../../src/skirmish/client/troops/TroopFormationModel";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("artwork loading failures", () => {
  it("keeps a ship poster visible, retries its failed animation, and stops after three failures", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const requests: string[] = [];
    let fail = true;
    vi.stubGlobal("Image", class {
      onload?: () => void;
      onerror?: () => void;
      set src(value: string) {
        requests.push(value);
        if (fail && value.includes("-idle")) this.onerror?.();
        else this.onload?.();
      }
    });
    const art = new EraArtwork();
    expect(art.get("stoneage-warship")).toBeDefined(); // authored portrait
    art.get("stoneage-warship");
    expect(requests.filter((url) => url.includes("-idle"))).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    fail = false;
    const recovered = art.get("stoneage-warship");
    expect(recovered?.source).toBeDefined();
    expect(requests.filter((url) => url.includes("-idle"))).toHaveLength(2);
    fail = true;
    const failing = new EraArtwork();
    for (let attempt = 0; attempt < 6; attempt++) {
      failing.get("bronzeage-warship");
      vi.advanceTimersByTime(60_000);
    }
    expect(requests.filter((url) => url.includes("bronzeage-warship-idle"))).toHaveLength(3);
  });

  function troop(name: string) {
    const definition: TroopActorDefinition = { name, age: "test", assetRoot: `/test/${name}/`, mounted: false, ranged: false, memberScale: .2 };
    return new TroopActors(() => 0, { troops: [definition], byDefinitionId: new Map([[name, definition]]) });
  }
  function manifest(mask = false) {
    return { actorCount: 1, animations: ["idle", "attack", "running", "death", "reload"].map((id) => ({
      id, file: `${id}.png`, ...(mask ? { mask: `${id}.mask.png` } : {}),
      fps: 6, frameCount: 1, scale: 1, frames: [{ x: 0, y: 0, width: 128, height: 128, pivot: { x: 64, y: 64 } }],
    })) };
  }
  function images(fails: (src: string) => boolean) {
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return fails(this.src) ? Promise.reject(new Error(`decode failed: ${this.src}`)) : Promise.resolve(); }
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  it.each(["constructor", "src", "decode"])("handles synchronous Image %s failures without an unhandled effects rejection", async (stage) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", class {
      constructor() { if (stage === "constructor") throw new Error("image constructor failed"); }
      set src(_value: string) { if (stage === "src") throw new Error("image src failed"); }
      decode() { throw new Error("image decode failed"); }
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => manifest() })));
    const actors = troop(`synchronous-${stage}`);
    await expect(actors.load()).rejects.toThrow("essential");
    expect(actors.isLoaded(`synchronous-${stage}`)).toBe(false);
    expect(actors.ready).toBe(false);
    expect(console.warn).toHaveBeenCalledWith("Troop effects unavailable", expect.objectContaining({ attempt: 1 }));
  });

  it("loads soldiers when effects or optional masked clips fail, retaining the authored attack", async () => {
    vi.useFakeTimers();
    let failEffects = true;
    images((src) => (failEffects && src.includes("StoneAge")) || src.includes("running.mask") || src.includes("death.mask") || src.includes("reload.mask"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => manifest(true) })));
    const actors = troop("degraded");
    await actors.load();
    expect(actors.isLoaded("degraded")).toBe(true);
    expect(actors.ready).toBe(false);
    const assets = (actors as unknown as { assets: Map<string, {clip: ActorClip}> }).assets;
    expect(assets.get("degraded:running")?.clip).toBe(assets.get("degraded:idle")?.clip);
    expect(assets.get("degraded:attack")?.clip.id).toBe("attack");
    expect(assets.has("degraded:death")).toBe(false);
    expect(assets.has("degraded:reload")).toBe(false);
    failEffects = false;
    vi.advanceTimersByTime(1000);
    await actors.load();
    await vi.waitFor(() => expect(actors.ready).toBe(true));
  });

  it("retries an essential mask failure after backoff and never publishes an uncolored actor", async () => {
    vi.useFakeTimers();
    let fail = true;
    images((src) => fail && src.endsWith("attack.mask.png"));
    const fetch = vi.fn(async () => ({ ok: true, json: async () => manifest(true) }));
    vi.stubGlobal("fetch", fetch);
    const actors = troop("recovering");
    await expect(actors.load()).rejects.toThrow("essential");
    expect(actors.isLoaded("recovering")).toBe(false);
    await actors.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    fail = false;
    await actors.load();
    expect(actors.isLoaded("recovering")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated manifest failures without keeping a rejected pending promise", async () => {
    vi.useFakeTimers();
    images(() => false);
    const fetch = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetch);
    const actors = troop("exhausted");
    for (let attempt = 0; attempt < 6; attempt++) {
      await actors.load().catch(() => {});
      vi.advanceTimersByTime(60_000);
    }
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(actors.isLoaded("exhausted")).toBe(false);
  });
});
