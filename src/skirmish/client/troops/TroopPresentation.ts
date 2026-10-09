import { UNIT } from "../../content/Units";
import type { Snapshot } from "../../Protocol";
import type { LocalSkirmishPresentation } from "../LocalSkirmishProfile";
import type { Renderer } from "../Renderer";
import { RUSSIAN_TROOP_ACTORS } from "./RussianTroopCatalogue";
import { TroopActors } from "./TroopActors";
import type { ManualFormation } from "./TroopFormationModel";

export const TROOP_DETAIL_CUTOFF = 12;

/** Client-only attachment: aggregate snapshots remain the network/simulation unit. */
export function installTroopPresentation(
  renderer: Renderer,
): LocalSkirmishPresentation {
  let nextControls = 0;
  let time = 0,
    previousFrame: number | undefined,
    latest: Snapshot | undefined;
  const formations = new Map<number, ManualFormation>();
  const actors = new TroopActors(() => time, {
    reformInPlace: true,
    troops: [...RUSSIAN_TROOP_ACTORS.values()],
    byDefinitionId: RUSSIAN_TROOP_ACTORS,
    formationForSquad: (squad) => formations.get(squad.id) ?? "mass",
  });
  actors.isSelected = (id) =>
    renderer.selected.has(id) || renderer.inspectedSquadId === id;
  renderer.squadArtworkDetailed = (squad, scale) =>
    UNIT.get(squad.definitionId ?? "")?.troopClass
      ? scale >= TROOP_DETAIL_CUTOFF &&
        actors.isLoaded(squad.definitionId ?? "")
      : undefined;
  renderer.squadDeploymentPreview = actors.deploymentPreview;
  renderer.squadArtworkHitTest = actors.hitTest;
  renderer.squadArtworkIntersectsBox = actors.intersectsBox;
  renderer.squadArtworkOverride = actors.draw;
  renderer.squadArtworkFlush = actors.flush;
  renderer.squadVolleyArtwork = actors.drawVolley;
  renderer.squadProjectileArtwork = actors.drawProjectile;
  renderer.squadRemainsArtwork = actors.drawRemains;
  renderer.squadArtworkViewRadius = actors.viewRadius;

  const panel = document.createElement("div");
  panel.className = "troop-formation-controls";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Selected squad visual formation");
  panel.innerHTML = `<span>Formation</span> <button data-shape="mass">Mass</button> <button data-shape="line">Line</button> <button data-shape="shield-wall">Shield wall</button> <button data-shape="square">Square</button>`;
  const style = document.createElement("style");
  style.textContent = `.troop-formation-controls{position:fixed;left:50%;transform:translateX(-50%);top:158px;z-index:65;background:#10212bee;padding:8px;border:1px solid #5e7464;border-radius:6px;color:#eaf0ec;font:12px system-ui}.troop-formation-controls[hidden]{display:none}.troop-formation-controls button{margin-left:4px;padding:5px 7px}.troop-formation-controls button[aria-pressed=true]{outline:2px solid #c4ff36}`;
  document.head.append(style);
  document.querySelector("#app")!.append(panel);
  function selected() {
    return (
      latest?.squads.filter(
        (squad) =>
          squad.playerId === (latest?.localPlayerId ?? 1) &&
          !squad.afloat &&
          renderer.selected.has(squad.id) &&
          RUSSIAN_TROOP_ACTORS.has(squad.definitionId ?? ""),
      ) ?? []
    );
  }
  panel.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-shape]",
    );
    if (!button) return;
    const shape = button.dataset.shape as ManualFormation;
    for (const squad of selected()) {
      const art = RUSSIAN_TROOP_ACTORS.get(squad.definitionId ?? "")!;
      const mounted = art.mounted || art.vehicle;
      if (!mounted || shape === "mass" || shape === "line")
        formations.set(squad.id, shape);
    }
  });
  return {
    reset() {
      formations.clear();
      actors.clear();
      latest = undefined;
      time = 0;
      previousFrame = undefined;
      panel.hidden = true;
    },
    update(snapshot) {
      latest = snapshot;
      time = Math.max(time, snapshot.tick * 50);
      actors.setDetailed(renderer.pixelsPerCell >= TROOP_DETAIL_CUTOFF);
      actors.prune(snapshot);
      const ids = new Set(snapshot.squads.map((squad) => squad.id));
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
      if (
        actors.setDetailed(renderer.pixelsPerCell >= TROOP_DETAIL_CUTOFF) &&
        latest
      )
        actors.prune(latest);
      actors.beginFrame();
    },
    endFrame(now) {
      if (now < nextControls) return;
      nextControls = now + 150;
      const squads = selected();
      panel.hidden = !squads.length;
      for (const button of panel.querySelectorAll<HTMLButtonElement>(
        "button[data-shape]",
      )) {
        const shape = button.dataset.shape as ManualFormation;
        button.disabled =
          squads.every((squad) => {
            const art = RUSSIAN_TROOP_ACTORS.get(squad.definitionId ?? "")!;
            return art.mounted || art.vehicle;
          }) &&
          shape !== "mass" &&
          shape !== "line";
        button.setAttribute(
          "aria-pressed",
          String(
            !!squads.length &&
              squads.every(
                (squad) => (formations.get(squad.id) ?? "mass") === shape,
              ),
          ),
        );
      }
    },
  };
}
