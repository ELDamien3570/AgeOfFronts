import { loadMap } from "../Terrain";
import type { ExecutorRequest } from "../multiplayer/application/MatchExecutor";
import { createMatchRuntime } from "../multiplayer/application/MatchRuntime";
import { InlineSnapshotEncoder } from "../multiplayer/application/InlineSnapshotEncoder";

/** Runs a custom match's authoritative simulation in its owner's browser.
 * The page relays coordinator requests here and posts every message this
 * worker emits back to the coordinator (MatchHostConnection). */
const scope = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<{ id: number; request: ExecutorRequest }>) => void) | null;
};

const memory = () => {
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return { heapUsed: heap?.usedJSHeapSize ?? 0, heapTotal: heap?.totalJSHeapSize ?? 0, external: 0, arrayBuffers: 0, rss: 0 };
};

const runtime = createMatchRuntime({
  post: (message) => scope.postMessage(message),
  encoder: new InlineSnapshotEncoder(),
  directPublications: false,
  // The same browser map loader every player uses, so the map hash agrees.
  loadMap: async (settings, seed) => {
    const loaded = await loadMap(settings.mapId, settings.worldSize, seed);
    return {
      map: {
        width: loaded.map.width(),
        height: loaded.map.height(),
        terrain: loaded.terrain,
        elevation: loaded.elevation,
        forest: loaded.forest,
        resourceTerrain: loaded.resourceTerrain,
      },
      territoryIncomeScale: loaded.territoryIncomeScale,
    };
  },
  memory,
  source: String(import.meta.env.VITE_SKIRMISH_RUNTIME_ID ?? "browser"),
  runtime: "browser",
  threadId: 0,
  rollback: false,
  // Per-advance diagnostics stay off: they would only cost the host upload.
  diagnostics: false,
});

scope.onmessage = (event) => runtime.handle(event.data);
