import { eligibleShape } from "../../domain/FormationProfiles";
import { formationDoctrine } from "../../domain/FormationGeometry";
import type { Command } from "../../Protocol";
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
  sendCommand?: (command:Command)=>void,
  reviewOptions?: { infantryCrowdPress?: () => boolean },
): LocalSkirmishPresentation {
  let nextControls = 0;
  let time = 0,
    previousFrame: number | undefined,
    latest: Snapshot | undefined;

  const actors = new TroopActors(() => time, {
    reformInPlace: true,
    infantryCrowdPress: reviewOptions?.infantryCrowdPress ?? (() => true),
    groundElevationAt: (x, y) => renderer.groundElevationAt(x, y),
    troops: [...RUSSIAN_TROOP_ACTORS.values()],
    byDefinitionId: RUSSIAN_TROOP_ACTORS,
    formationForSquad: (squad) => squad.formation?.shape ?? formationDoctrine(squad.definitionId).defaultShape,
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
  renderer.squadLabelPose = actors.labelPose;

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
  document.addEventListener("click", (event) => {
    const unlock=(event.target as HTMLElement).closest<HTMLButtonElement>("button[data-formation-unlock]");
    if(unlock && !unlock.disabled && sendCommand){for(const squad of selected())sendCommand({type:"formation",playerId:latest?.localPlayerId??1,squadIds:[squad.id],shape:squad.formation?.deployedShape??squad.formation?.shape??formationDoctrine(squad.definitionId).defaultShape,shapeLock:false});return;}
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button[data-shape]",
    );
    if (!button || button.disabled || !sendCommand) return;
    const shape = button.dataset.shape as ManualFormation;
    const squads=selected();
    if(squads.length && squads.every(s=>formationDoctrine(s.definitionId).shapes.includes(shape)))sendCommand({type:"formation",playerId:latest?.localPlayerId??1,squadIds:squads.map(s=>s.id),shape});
  });
  return {
    reset() {

      actors.clear();
      latest = undefined;
      time = 0;
      previousFrame = undefined;
    },
    update(snapshot) {
      latest = snapshot;
      time = Math.max(time, snapshot.tick * 50);
      actors.setDetailed(renderer.pixelsPerCell >= TROOP_DETAIL_CUTOFF);
      actors.prune(snapshot);

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
      const unlock=document.querySelector<HTMLButtonElement>("button[data-formation-unlock]");if(unlock){unlock.disabled=!squads.some(s=>s.formation?.shapeLock)||squads.some(s=>!!s.formation?.transition||!!s.charge||!!s.refit||!!s.manpower?.enlargement);unlock.setAttribute("aria-pressed",String(!!squads.length&&squads.every(s=>!s.formation?.shapeLock)));}
      for (const button of document.querySelectorAll<HTMLButtonElement>(
        "button[data-shape]",
      )) {
        const shape = button.dataset.shape as ManualFormation;
        button.disabled =
          !squads.length ||
          squads.some(s=>eligibleShape(s.troops,formationDoctrine(s.definitionId),shape)!==shape||!!s.refit||!!s.manpower?.enlargement||!!s.charge||s.embarkedOn!==null||!!s.formation?.transition&&!s.formation.automatic);
        button.title=squads.some(s=>s.formation?.automatic)?`Will deploy as ${shape}`:shape;
        button.setAttribute(
          "aria-pressed",
          String(
            !!squads.length &&
              squads.every(
                (squad) => (squad.formation?.automatic?squad.formation.deployedShape:squad.formation?.shape ?? formationDoctrine(squad.definitionId).defaultShape) === shape,
              ),
          ),
        );
      }
    },
  };
}
