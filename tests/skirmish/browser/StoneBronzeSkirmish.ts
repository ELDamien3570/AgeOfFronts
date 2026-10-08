import { configureLocalSkirmishProfile } from "../../../src/skirmish/client/LocalSkirmishProfile";
import type { Snapshot } from "../../../src/skirmish/Protocol";
import { StoneAgeDemoActors } from "./StoneAgeDemoActors";
import {
  STONE_BRONZE_ACTORS,
  STONE_BRONZE_ARTWORK,
  STONE_BRONZE_OPTIONS,
} from "./StoneBronzeSkirmishRoster";
import type { ManualFormation } from "./TroopPrototypeModel";

const formations = new Map<number, ManualFormation>();
let time = 0,
  latest: Snapshot | undefined,
  previousFrame: number | undefined;
let stats: HTMLElement | undefined, selection: HTMLElement | undefined;
let nextStats = 0,
  lastRendered: number | undefined;
const actors = new StoneAgeDemoActors(() => time, {
  reformInPlace: true,
  troops: STONE_BRONZE_ACTORS,
  byDefinitionId: STONE_BRONZE_ARTWORK,
  formationForSquad: (squad) => formations.get(squad.id) ?? "mass",
});
try {
  await actors.load();
  configureLocalSkirmishProfile({
    formationDrawing: true,
    matchOptions: STONE_BRONZE_OPTIONS,
    install(renderer) {
      const syncDetail = () => actors.setDetailed(renderer.pixelsPerCell >= 12);
      syncDetail();
      actors.isSelected = (id) =>
        renderer.selected.has(id) || renderer.inspectedSquadId === id;
      renderer.squadArtworkDetailed = (squad, scale) =>
        STONE_BRONZE_ARTWORK.has(squad.definitionId ?? "")
          ? scale >= 12
          : undefined;
      renderer.squadDeploymentPreview = actors.deploymentPreview;
      renderer.squadArtworkHitTest = actors.hitTest;
      renderer.squadArtworkIntersectsBox = actors.intersectsBox;
      renderer.squadArtworkOverride = actors.draw;
      renderer.squadArtworkFlush = actors.flush;
      renderer.squadVolleyArtwork = actors.drawVolley;
      renderer.squadRemainsArtwork = actors.drawRemains;
      renderer.squadArtworkViewRadius = actors.viewRadius;
      const panel = document.createElement("aside");
      panel.className = "formation-demo-panel";
      panel.innerHTML = `<details open><summary>Stone / Bronze formation demo</summary><p>Normal local skirmish · Bronze is the final age.</p><div class="formation-demo-buttons"><button data-formation="mass">Mass</button><button data-formation="line">Line</button><button data-formation="shield-wall">Shield wall</button><button data-formation="square">Square</button></div><p class="formation-demo-selection">Select infantry to change formation.</p><p>Mobile mass is the default. Charges use wedge. Squad shapes are visual only. Right-drag to deploy selected squads along a line; reverse drag to reverse facing. Shift-drag queues. Shift-click moves retain your drawn layout. Shorter drags tighten gaps, then add ranks behind the front.</p><small class="formation-demo-performance"></small><p><a href="./StoneAgeDemo.html">Battle stress test</a></p></details>`;
      const style = document.createElement("style");
      style.textContent = `.formation-demo-panel{position:fixed;right:14px;top:82px;z-index:70;width:280px;padding:12px;border:1px solid #5e7464;border-radius:8px;background:#10212bee;color:#eaf0ec;font:12px/1.4 system-ui;box-shadow:0 4px 14px #0005}.formation-demo-panel summary{cursor:pointer;font-weight:700}.formation-demo-panel p{margin:8px 0}.formation-demo-buttons{display:flex;flex-wrap:wrap;gap:5px}.formation-demo-buttons button{padding:5px 8px}.formation-demo-panel a{color:#c4ff36}.formation-demo-performance{display:block;color:#b6c6bc}`;
      document.head.append(style);
      document.querySelector("#app")!.append(panel);
      stats = panel.querySelector(".formation-demo-performance")!;
      selection = panel.querySelector(".formation-demo-selection")!;
      panel.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          "button[data-formation]",
        );
        if (!button || !latest) return;
        const shape = button.dataset.formation as ManualFormation;
        const own = latest?.localPlayerId ?? 1;
        for (const squad of latest.squads) {
          const art = STONE_BRONZE_ARTWORK.get(squad.definitionId ?? "");
          if (
            squad.playerId === own &&
            renderer.selected.has(squad.id) &&
            art &&
            !art.mounted &&
            !squad.afloat
          )
            formations.set(squad.id, shape);
        }
        nextStats = 0;
      });
      return {
        reset() {
          formations.clear();
          actors.clear();
          latest = undefined;
          time = 0;
          previousFrame = undefined;
          lastRendered = undefined;
          nextStats = 0;
          if (stats) stats.textContent = "Waiting for the skirmish...";
        },
        update(snapshot) {
          latest = snapshot;
          time = Math.max(time, snapshot.tick * 50);
          syncDetail();
          actors.prune(snapshot);
          const ids = new Set(snapshot.squads.map((s) => s.id));
          for (const id of formations.keys())
            if (!ids.has(id)) formations.delete(id);
        },
        beginFrame(now, speed, paused) {
          if (latest && !paused && previousFrame !== undefined)
            time = Math.min(
              (latest.tick + 1) * 50,
              time + Math.min(100, now - previousFrame) * speed,
            );
          previousFrame = now;
          if (syncDetail() && latest) actors.prune(latest);
          actors.beginFrame();
        },
        endFrame(now, renderMs) {
          if (stats && selection && now >= nextStats) {
            const fps =
              lastRendered === undefined
                ? "—"
                : (1000 / (now - lastRendered)).toFixed(0);
            stats.textContent = `${fps} FPS · render ${renderMs.toFixed(1)} ms · ${actors.drawnSoldiers} soldiers drawn · ${actors.detailedEnabled ? "soldiers" : "icons"} (${renderer.pixelsPerCell.toFixed(1)} px/cell)`;
            const infantry =
              latest?.squads.filter(
                (s) =>
                  s.playerId === (latest?.localPlayerId ?? 1) &&
                  renderer.selected.has(s.id) &&
                  !s.afloat &&
                  STONE_BRONZE_ARTWORK.get(s.definitionId ?? "")?.mounted ===
                    false,
              ) ?? [];
            const chosen = new Set(
              infantry.map((s) => formations.get(s.id) ?? "mass"),
            );
            selection.textContent = infantry.length
              ? `${infantry.length} foot squads selected · ${chosen.size === 1 ? [...chosen][0] : "mixed formations"}`
              : "Select infantry to change formation.";
            for (const button of panel.querySelectorAll<HTMLButtonElement>(
              "button[data-formation]",
            )) {
              button.disabled = !infantry.length;
              button.setAttribute(
                "aria-pressed",
                String(
                  chosen.size === 1 &&
                    chosen.has(button.dataset.formation as ManualFormation),
                ),
              );
            }
            nextStats = now + 500;
          }
          lastRendered = now;
        },
      };
    },
    initializeControls() {
      document.title = "Stone / Bronze Skirmish Demo";
      document.querySelector(".brand h1")!.textContent = "Stone / Bronze Demo";
      document.querySelector(".brand p")!.textContent =
        "Isolated local AI skirmish · individual soldiers";
      const age = document.querySelector<HTMLSelectElement>("#starting-age")!;
      for (const option of [...age.options])
        if (!["StoneAge", "BronzeAge"].includes(option.value)) option.remove();
      age.value = "StoneAge";
      const size = document.querySelector<HTMLSelectElement>("#world-size")!;
      size.value = "250";
      const map = document.querySelector<HTMLSelectElement>("#map")!;
      map.value = "thebox";
    },
  });
  await import("../../../src/skirmish/client/main");
} catch (error) {
  const root = document.querySelector("#app")!;
  const message = document.createElement("p");
  message.style.padding = "32px";
  message.textContent = `Unable to load the skirmish demo: ${String(error)}`;
  root.replaceChildren(message);
  console.error(error);
}
