import footLayout from "../../../../Art/Cultures/Russians/FormationLayouts/Clubman.json";
import rangedLayout from "../../../../Art/Cultures/Russians/FormationLayouts/Javelinist.json";
import mountedLayout from "../../../../Art/Cultures/Russians/FormationLayouts/MountedSpearman.json";
import type { Projectile } from "../../domain/Definitions";
import { FIXED, type ArcherVolley, type Snapshot } from "../../Protocol";
import { squadArtworkPose } from "../CombatEffectsViewModel";
import { COLORS } from "../FactionColors";
import {
  FormationEngagement,
  type EngagementOpponents,
} from "../FormationEngagement";
import { FormationHeading } from "../FormationHeading";
import { FormationSoldierMotion } from "../FormationSoldierMotion";
import { SoldierDrawQueue } from "../SoldierDrawQueue";
import { SoldierSelectionIndex } from "../SoldierSelectionIndex";
import { troopAssetUrl } from "./TroopAssetUrls";
import { TroopChoreography } from "./TroopChoreography";
import {
  clipFrame,
  resolveFormation,
  type ActorClip,
  type ActorManifest,
  type FormationLayout,
  type ManualFormation,
} from "./TroopFormationModel";
import { actorFormationSlots } from "./TroopPacking";
import { TroopRemains } from "./TroopRemains";
import {
  javelinThrowTime,
  TroopVolley,
  type VolleyThrower,
} from "./TroopVolley";

type Name = string;
export interface TroopActorDefinition {
  name: string;
  age: string;
  mounted: boolean;
  ranged: boolean;
  memberScale: number;
  /** Explicit runtime/source folder, independent of age labels and asset keys. */
  assetRoot?: string;
  projectile?: "javelin" | "arrow" | "bullet" | "shell" | "rocket";
  vehicle?: boolean;
  members?: number;
  widthWorld?: number;
  lengthWorld?: number;
  releasePoints?: readonly { x: number; y: number }[];
  facingOffset?: number;
}
export interface TroopActorOptions {
  troops: readonly TroopActorDefinition[];
  byDefinitionId: ReadonlyMap<string, TroopActorDefinition>;
  reformInPlace?: boolean;
  formationForSquad?: (squad: Snapshot["squads"][number]) => ManualFormation;
}

const sharedImages = new Map<string, Promise<HTMLImageElement>>();
function loadSharedImage(src: string): Promise<HTMLImageElement> {
  let pending = sharedImages.get(src);
  if (!pending) {
    const image = new Image();
    image.src = src;
    pending = image
      .decode()
      .then(() => image)
      .catch((error) => {
        sharedImages.delete(src);
        throw error;
      });
    sharedImages.set(src, pending);
  }
  return pending;
}
export class TroopActors {
  formation: ManualFormation = "line";
  private assets = new Map<
    string,
    { clip: ActorClip; image: HTMLImageElement }
  >();
  private layouts = new Map<Name, FormationLayout>();
  private motions = new Map<
    number,
    {
      motion: TroopChoreography;
      shape: string;
      walkers: FormationSoldierMotion;
      engagement: FormationEngagement;
      captured: Set<number>;
      name: Name;
      anchor: { x: number; y: number };
      angle: number;
    }
  >();
  private readonly remains = new TroopRemains();
  private readonly volleys = new TroopVolley();
  private readonly shells = new TroopVolley();
  private readonly throwers = new Map<number, VolleyThrower[]>();
  private readonly contacts = new Map<
    number,
    {
      target?: { x: number; y: number };
      threats: { x: number; y: number }[];
      opponents: EngagementOpponents[];
    }
  >();
  private javelin!: HTMLImageElement;
  private blood!: HTMLImageElement;
  private playerId = 1;
  private readonly headings: FormationHeading;
  ready = false;
  drawnSoldiers = 0;
  sortMs = 0;
  private readonly drawQueue = new SoldierDrawQueue();
  private readonly selectionIndex = new SoldierSelectionIndex();
  private detailed = true;
  isSelected: (squadId: number) => boolean = () => false;
  get detailedEnabled(): boolean {
    return this.detailed;
  }
  setDetailed(enabled: boolean): boolean {
    if (enabled === this.detailed) return false;
    this.detailed = enabled;
    this.motions.clear();
    this.headings.clear();
    this.contacts.clear();
    this.throwers.clear();
    this.volleys.clear();
    this.shells.clear();
    this.drawQueue.clear();
    this.selectionIndex.clear();
    this.drawnSoldiers = 0;
    this.sortMs = 0;
    return true;
  }
  hitTest = (
    squad: Snapshot["squads"][number],
    point: { x: number; y: number },
    scale: number,
  ): number | undefined =>
    this.detailed && !squad.afloat
      ? this.selectionIndex.hitTest(squad.id, point, scale)
      : undefined;
  intersectsBox = (
    squad: Snapshot["squads"][number],
    box: { x1: number; y1: number; x2: number; y2: number },
  ): boolean =>
    this.detailed &&
    !squad.afloat &&
    this.selectionIndex.intersectsBox(squad.id, box);
  viewRadius = (squad: Snapshot["squads"][number], scale: number): number =>
    this.detailed && this.byDefinitionId.has(squad.definitionId ?? "")
      ? Math.max(
          3,
          this.selectionIndex.viewRadius(squad.id, {
            x: squad.x / FIXED,
            y: squad.y / FIXED,
          }),
        ) * scale
      : 0;
  deploymentPreview = (
    squad: Snapshot["squads"][number],
    root: { x: number; y: number },
    facing: number,
  ): { x: number; y: number; radius: number }[] | undefined => {
    const troop = this.byDefinitionId.get(squad.definitionId ?? "");
    const layout =
      troop &&
      (this.layouts.get(troop.name) ??
        (troop.mounted
          ? mountedLayout
          : troop.ranged
            ? rangedLayout
            : footLayout));
    if (!troop || !layout) return undefined;
    const shape = resolveFormation(
      this.options?.formationForSquad?.(squad) ?? this.formation,
      troop.mounted,
      false,
    );
    const slots = actorFormationSlots(
      layout,
      troop.mounted,
      shape,
      troop.memberScale,
      troop,
    );
    const count = Math.ceil(
      ((troop.members ?? (troop.mounted ? 6 : 12)) *
        Math.max(0, squad.troops)) /
        1000,
    );
    const members = new TroopChoreography(slots, squad.id, 0, count).soldiers(
      0,
    );
    const footprint = 2 / 0.75,
      c = Math.cos(facing),
      s = Math.sin(facing);
    return members.map((member) => ({
      x: root.x / FIXED + (member.x * c - member.y * s) * footprint,
      y: root.y / FIXED + (member.x * s + member.y * c) * footprint,
      radius: footprint * member.scale * (troop.mounted ? 0.25 : 0.37),
    }));
  };
  beginFrame(): void {
    this.drawQueue.clear();
    this.selectionIndex.beginFrame();
  }
  flush = (ctx: CanvasRenderingContext2D): void => {
    const started = performance.now();
    const entries = this.detailed ? this.drawQueue.sort() : [];
    this.selectionIndex.commit();
    this.sortMs = performance.now() - started;
    this.drawnSoldiers = entries.length;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    // Rings share the soldiers' current ground anchors and stay below all sprites.
    ctx.lineWidth = 1.25;
    for (const entry of entries)
      if (entry.selectionRadius && entry.selectionColor) {
        ctx.strokeStyle = entry.selectionColor + "b3";
        ctx.fillStyle = entry.selectionColor + "40";
        ctx.beginPath();
        ctx.arc(
          entry.screenX,
          entry.screenY,
          entry.selectionRadius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
    for (const entry of entries) {
      const { frame, size } = entry;
      ctx.save();
      ctx.translate(entry.screenX, entry.screenY);
      ctx.rotate(entry.angle);
      ctx.drawImage(
        entry.image,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        (-size * frame.pivot.x) / frame.width,
        (-size * frame.pivot.y) / frame.height,
        size,
        size,
      );
      ctx.restore();
    }
    ctx.restore();
  };
  private readonly vehicles: Set<string>;
  private readonly troops: readonly TroopActorDefinition[];
  private readonly byDefinitionId: ReadonlyMap<string, TroopActorDefinition>;
  constructor(
    private readonly clock: () => number = () => performance.now(),
    private readonly options?: TroopActorOptions,
  ) {
    this.headings = new FormationHeading(
      (squad) => (squad.playerId === this.playerId ? Math.PI : 0),
      60,
      options?.reformInPlace,
    );
    if (!options)
      throw new Error("TroopActors requires an explicit artwork catalogue");
    this.troops = options.troops;
    this.vehicles = new Set(
      this.troops.filter((troop) => troop.vehicle).map((troop) => troop.name),
    );
    this.byDefinitionId = options.byDefinitionId;
  }
  clear(): void {
    this.motions.clear();
    this.headings.clear();
    this.remains.clear();
    this.volleys.clear();
    this.shells.clear();
    this.throwers.clear();
    this.contacts.clear();
    this.drawQueue.clear();
    this.selectionIndex.clear();
    this.drawnSoldiers = 0;
    this.sortMs = 0;
  }
  private effects?: Promise<void>;
  private readonly loaded = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly failed = new Set<string>();
  private async loadEffects(): Promise<void> {
    return (this.effects ??= Promise.all([
      loadSharedImage(
        new URL("./assets/StoneAgeJavelin-v1.png", import.meta.url).href,
      ),
      loadSharedImage(
        new URL("./assets/StoneAgeBloodSplats-v1.png", import.meta.url).href,
      ),
    ]).then(([javelin, blood]) => {
      this.javelin = javelin;
      this.blood = blood;
      this.ready = true;
    }));
  }
  /** Fixtures may preload; normal skirmish requests only visible detailed actors. */
  async load(): Promise<void> {
    await Promise.all(this.troops.map((troop) => this.loadActor(troop)));
  }
  isLoaded(definitionId: string): boolean {
    const troop = this.byDefinitionId.get(definitionId);
    return !!troop && this.loaded.has(troop.name);
  }
  private loadActor(troop: TroopActorDefinition): Promise<void> {
    if (this.loaded.has(troop.name)) return Promise.resolve();
    const pending = this.loading.get(troop.name);
    if (pending) return pending;
    const task = (async () => {
      const { name } = troop;
      const root =
        troop.assetRoot ?? `/Art/Cultures/Russians/Units/${troop.age}/${name}/`;
      const [manifestResponse] = await Promise.all([
        fetch(troopAssetUrl(root + "animations.json")),
        this.loadEffects(),
      ]);
      if (!manifestResponse.ok) throw new Error(`Missing ${name} assets`);
      const manifest: ActorManifest = await manifestResponse.json();
      if (manifest.actorCount !== 1)
        throw new Error(`${name} must be individual soldier artwork`);
      const layout: FormationLayout = troop.mounted
        ? mountedLayout
        : troop.ranged
          ? rangedLayout
          : footLayout;
      const assets = await Promise.all(
        ["idle", "running", "attack", "death"].map(async (id) => {
          const clip = manifest.animations.find((clip) => clip.id === id);
          if (!clip) throw new Error(`Missing ${name} ${id}`);
          const image = await loadSharedImage(troopAssetUrl(root + clip.file));
          const baseScale =
            manifest.animations.find((c) => c.id === "idle")?.scale ?? 1;
          return {
            id,
            clip: { ...clip, scale: (clip.scale ?? 1) / baseScale },
            image,
          };
        }),
      );
      // Publish atomically: a partially loaded unit never reaches the draw path.
      this.layouts.set(name, layout);
      for (const asset of assets) this.assets.set(`${name}:${asset.id}`, asset);
      this.loaded.add(name);
    })();
    this.loading.set(troop.name, task);
    return task;
  }
  prune(snapshot: Snapshot): void {
    const now = this.clock();
    this.playerId = snapshot.localPlayerId ?? 1;
    if (!this.detailed) return;
    this.headings.update(snapshot, now);
    this.volleys.prune(snapshot.volleys);
    this.shells.prune(snapshot.expansion?.projectiles ?? []);
    const squads = new Map(snapshot.squads.map((s) => [s.id, s]));
    const buildings = new Map(snapshot.buildings.map((b) => [b.id, b]));
    this.contacts.clear();
    // Freeze opponent poses at the snapshot boundary, so facing does not depend
    // on which army happens to be drawn first this frame.
    const opponentPoses = new Map<number, EngagementOpponents>();
    for (const squad of snapshot.squads) {
      const state = this.motions.get(squad.id);
      const soldiers = state
        ? state.motion.soldiers(now).flatMap((slot) => {
            const position = state.walkers.position(slot.id);
            return position
              ? [{ id: `${squad.id}:${slot.id}`, x: position.x, y: position.y }]
              : [];
          })
        : [];
      opponentPoses.set(squad.id, {
        center: { x: squad.x / FIXED, y: squad.y / FIXED },
        soldiers,
      });
    }
    for (const squad of snapshot.squads) {
      const target = squads.get(
        squad.combatTargetId ??
          (squad.order.type === "attack" ? squad.order.targetId : -1),
      );
      const building = buildings.get(squad.structureTarget?.buildingId ?? -1);
      this.contacts.set(squad.id, {
        target: target
          ? { x: target.x / FIXED, y: target.y / FIXED }
          : building
            ? {
                x: (building.tile % snapshot.width) + 0.5,
                y: Math.floor(building.tile / snapshot.width) + 0.5,
              }
            : undefined,
        threats: [],
        opponents: target ? [opponentPoses.get(target.id)!] : [],
      });
    }
    for (const squad of snapshot.squads) {
      if (!squad.fighting || squad.combatTargetId === null) continue;
      const contact = this.contacts.get(squad.combatTargetId);
      contact?.threats.push({ x: squad.x / FIXED, y: squad.y / FIXED });
      contact?.opponents.push(opponentPoses.get(squad.id)!);
    }
    const ids = new Set(snapshot.squads.map((squad) => squad.id));
    for (const [id, state] of this.motions)
      if (!ids.has(id)) {
        // The aggregate squad has died. Retain the remaining displayed soldiers
        // as bodies instead of deleting all artwork with the simulation entity.
        for (const soldier of state.motion.soldiers(now))
          this.captureDeath(id, state, soldier, now);
        this.motions.delete(id);
        this.throwers.delete(id);
      }
  }
  drawVolley = (
    ctx: CanvasRenderingContext2D,
    volley: ArcherVolley,
    tick: number,
    tileSize: number,
    project: (x: number, y: number) => { x: number; y: number },
    width: number,
    height: number,
  ): boolean => {
    const troop = this.byDefinitionId.get(volley.definitionId ?? "");
    if (!this.detailed || !troop?.ranged || !this.loaded.has(troop.name))
      return false;
    const clip = this.assets.get(`${troop.name}:attack`)!.clip;
    for (const flight of this.volleys.sample(
      volley,
      tick,
      this.throwers.get(volley.squadId) ?? [],
      clip,
      2 / 0.75,
      troop.releasePoints,
      troop.facingOffset,
      troop.projectile !== "bullet" &&
        troop.projectile !== "shell" &&
        troop.projectile !== "rocket",
    )) {
      const p = project(flight.x, flight.y);
      if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20)
        continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(tileSize / 32, tileSize / 32);
      ctx.rotate(flight.angle);
      ctx.imageSmoothingQuality = "high";
      // Crop transparent margins when sampling the preserved generated master.
      // Keep the previous 15px reference length, with its tip facing the target.
      const length = 15;
      // Slightly exaggerate width for readability at gameplay resolution.
      const thickness = 2;
      if (troop.projectile === "javelin" || troop.name === "Javelinist") {
        ctx.drawImage(
          this.javelin,
          38,
          382,
          1697,
          107,
          -12,
          -thickness / 2,
          length,
          thickness,
        );
      } else if (
        troop.projectile === "bullet" ||
        troop.projectile === "shell" ||
        troop.projectile === "rocket"
      ) {
        ctx.strokeStyle = "#f6d786";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-3, 0);
        ctx.lineTo(2, 0);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#bc9866";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(3, 0);
        ctx.stroke();
        ctx.fillStyle = "#d5d0c6";
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(1, -1.3);
        ctx.lineTo(1, 1.3);
        ctx.fill();
        ctx.strokeStyle = "#ddd1b4";
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(-9, -1.2);
        ctx.moveTo(-7, 0);
        ctx.lineTo(-9, 1.2);
        ctx.stroke();
      }
      ctx.restore();
    }
    return true;
  };
  /** Reconstruct cosmetic flights from visible launchers; authoritative impact
   * timing, target, damage and replication stay on the aggregate projectile. */
  drawProjectile = (
    ctx: CanvasRenderingContext2D,
    projectile: Projectile,
    tick: number,
    tileSize: number,
    project: (x: number, y: number) => { x: number; y: number },
  ): boolean => {
    const troop = this.byDefinitionId.get(projectile.definitionId ?? "");
    if (
      !this.detailed ||
      projectile.impacted ||
      projectile.sourceKind !== "squad" ||
      !troop ||
      !this.loaded.has(troop.name)
    )
      return false;
    const throwers = this.throwers.get(projectile.sourceId) ?? [];
    const volley = {
      ...projectile,
      squadId: projectile.sourceId,
    } as unknown as ArcherVolley;
    const clip = this.assets.get(`${troop.name}:attack`)!.clip;
    const flights = this.shells.sample(
      volley,
      tick,
      throwers.map((soldier) => ({ ...soldier, throwing: true })),
      clip,
      2 / 0.75,
      troop.releasePoints,
      troop.facingOffset,
      false,
      projectile.impactTick - projectile.tick,
    );
    if (!flights.length) return false;
    ctx.save();
    for (const flight of flights) {
      const p = project(flight.x, flight.y);
      if (
        p.x < -20 ||
        p.y < -20 ||
        p.x > ctx.canvas.clientWidth + 20 ||
        p.y > ctx.canvas.clientHeight + 20
      )
        continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(flight.angle);
      const length = Math.max(
        3,
        tileSize * (troop.projectile === "rocket" ? 0.23 : 0.12),
      );
      ctx.strokeStyle = troop.projectile === "rocket" ? "#ffd895" : "#efcf83";
      ctx.lineWidth = Math.max(1, tileSize * 0.025);
      ctx.beginPath();
      ctx.moveTo(-length, 0);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    return true;
  };
  private captureDeath(
    id: number,
    state: NonNullable<ReturnType<typeof this.motions.get>>,
    soldier: {
      id: number;
      x: number;
      y: number;
      angle?: number;
      scale: number;
    },
    started: number,
  ): void {
    if (state.captured.has(soldier.id)) return;
    state.captured.add(soldier.id);
    const footprint = 2 / 0.75;
    const position = state.walkers.position(soldier.id) ?? {
      x:
        state.anchor.x +
        (soldier.x * Math.cos(state.angle) -
          soldier.y * Math.sin(state.angle)) *
          footprint,
      y:
        state.anchor.y +
        (soldier.x * Math.sin(state.angle) +
          soldier.y * Math.cos(state.angle)) *
          footprint,
      angle: state.angle + (soldier.angle ?? 0),
    };
    const clip = this.assets.get(`${state.name}:death`)!.clip;
    const fallDuration =
      clip.durations?.reduce((sum, duration) => sum + duration, 0) ??
      (clip.frameCount * 1000) / (clip.fps ?? 6);
    this.remains.add({
      key: `${id}:${soldier.id}:${started}`,
      artwork: state.name,
      ...position,
      angle:
        position.angle +
        (this.troops.find((troop) => troop.name === state.name)?.facingOffset ??
          0),
      size: footprint * soldier.scale,
      started,
      fallDuration,
      seed: id * 31 + soldier.id * 17,
    });
  }
  drawRemains = (
    ctx: CanvasRenderingContext2D,
    tileSize: number,
    project: (x: number, y: number) => { x: number; y: number },
    width: number,
    height: number,
  ): void => {
    if (!this.detailed) return;
    const records = this.remains
      .sample(this.clock())
      .map((record) => ({ record, p: project(record.x, record.y) }))
      .filter(
        ({ record, p }) =>
          p.x + record.size * tileSize >= 0 &&
          p.y + record.size * tileSize >= 0 &&
          p.x - record.size * tileSize <= width &&
          p.y - record.size * tileSize <= height,
      );
    ctx.save();
    // One transparent atlas, with stable variant and rotation per casualty.
    // The existing radius controls footprint; opacity changes independently.
    ctx.imageSmoothingEnabled = true;
    for (const { record, p } of records) {
      if (this.vehicles.has(record.artwork)) continue;
      if (!record.bloodGrowth) continue;
      const radius = record.size * tileSize * 0.24 * record.bloodGrowth;
      const variant = Math.abs(record.seed) % 4;
      const cellWidth = this.blood.naturalWidth / 2;
      const cellHeight = this.blood.naturalHeight / 2;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(record.angle + (record.seed % 13) * 0.17);
      ctx.globalAlpha = 0.82 * record.bloodOpacity;
      // Fit the atlas inside the previous stain envelope, including satellite drops.
      ctx.drawImage(
        this.blood,
        (variant % 2) * cellWidth,
        Math.floor(variant / 2) * cellHeight,
        cellWidth,
        cellHeight,
        -radius * 1.66,
        -radius * 1.66,
        radius * 3.32,
        radius * 3.32,
      );
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    for (const { record, p } of records) {
      if (!record.bodyVisible) continue;
      const { clip, image } = this.assets.get(`${record.artwork}:death`)!;
      const frame = clip.frames[clipFrame(clip, record.age)];
      const size =
        record.size * tileSize * record.bodyScale * (clip.scale ?? 1);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(record.angle);
      ctx.drawImage(
        image,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        (-size * frame.pivot.x) / frame.width,
        (-size * frame.pivot.y) / frame.height,
        size,
        size,
      );
      ctx.restore();
    }
    ctx.restore();
  };
  draw = (
    ctx: CanvasRenderingContext2D,
    squad: Snapshot["squads"][number],
    p: { x: number; y: number },
    angle: number,
    tileSize: number,
    tick: number,
    worldPosition: { x: number; y: number },
  ): boolean => {
    const troop = this.byDefinitionId.get(squad.definitionId ?? "");
    if (!this.detailed || !troop) return false;
    if (!this.loaded.has(troop.name)) {
      if (!this.failed.has(troop.name) && !this.loading.has(troop.name))
        void this.loadActor(troop).catch((error) => {
          this.failed.add(troop.name);
          console.error(
            "Individual troop artwork unavailable",
            troop.name,
            error,
          );
        });
      return false;
    }
    const name: Name = troop.name;
    const mounted = troop.mounted;
    const ranged = troop.ranged;
    const soldierCount = troop.members ?? (troop.mounted ? 6 : 12);
    const shape = resolveFormation(
      this.options?.formationForSquad?.(squad) ??
        (squad.playerId === this.playerId ? this.formation : "line"),
      mounted,
      !troop.vehicle && !!squad.charge && squad.charge.phase !== "recovery",
    );
    const mobile = shape === "mass";
    const laneTravel =
      !!this.options?.reformInPlace &&
      squad.order.type === "move" &&
      !squad.charge;
    if (mobile) angle = 0;
    const now = this.clock();
    let state = this.motions.get(squad.id);
    // Refit keeps the authoritative squad ID but changes its artwork and packing.
    if (state && state.name !== name) {
      for (const corpse of state.motion.dead(now))
        this.captureDeath(squad.id, state, corpse, now - corpse.age);
      state.name = name;
      state.shape = "";
      this.throwers.delete(squad.id);
    }
    if (!state) {
      state = {
        motion: new TroopChoreography(
          actorFormationSlots(
            this.layouts.get(name)!,
            troop.mounted,
            shape,
            troop.memberScale,
            troop,
          ),
          squad.id,
          now,
          Math.ceil((soldierCount * Math.max(0, squad.troops)) / 1000),
        ),
        shape,
        walkers: new FormationSoldierMotion(squad.id),
        engagement: new FormationEngagement(squad.id),
        captured: new Set(),
        name,
        anchor: { ...worldPosition },
        angle,
      };
      this.motions.set(squad.id, state);
    }
    if (state.shape !== shape) {
      state.motion.reshape(
        actorFormationSlots(
          this.layouts.get(name)!,
          troop.mounted,
          shape,
          troop.memberScale,
          troop,
        ),
        now,
      );
      state.shape = shape;
    }
    const travelFacing = this.headings.angle(squad.id, now);
    angle = mobile ? 0 : laneTravel ? state.angle : travelFacing;
    const contact = this.contacts.get(squad.id);
    const intent = {
      active: squad.fighting && squad.order.type !== "move",
      charging: !!squad.charge && squad.charge.phase !== "recovery",
      mounted,
      ranged: ranged,
      square: shape === "square",
      travelHeading: angle,
      reformInPlace: this.options?.reformInPlace,
      travelling:
        squad.order.type === "move" ||
        !!squad.charge ||
        (squad.locomotion?.speed ?? 0) > 0,
      footprint: 2 / 0.75,
      layout: shape,
      target: contact?.target,
      threats: contact?.threats,
      opponents: contact?.opponents,
    };
    const reforming =
      this.options?.reformInPlace &&
      !(intent.active && !intent.charging && intent.target);
    const frameDelta = Math.atan2(
      Math.sin(state.angle - angle),
      Math.cos(state.angle - angle),
    );
    if (reforming && Math.abs(frameDelta) > 0.001) {
      // Capture falls in the old frame before changing its coordinate basis.
      for (const corpse of state.motion.dead(now))
        this.captureDeath(squad.id, state, corpse, now - corpse.age);
      state.motion.reorient(frameDelta, now);
    }
    let engagement = state.engagement.sample(
      now,
      worldPosition,
      state.motion.soldiers(now),
      intent,
    );
    state.motion.advance(
      now,
      Math.ceil((soldierCount * Math.max(0, squad.troops)) / 1000),
      engagement.engaged
        ? { angle: engagement.casualtyAngle, front: engagement.front }
        : undefined,
    );
    engagement = state.engagement.sample(
      now,
      worldPosition,
      state.motion.soldiers(now),
      intent,
    );
    angle = engagement.heading;
    state.anchor = { ...worldPosition };
    state.angle = angle;
    const pose = squadArtworkPose(squad, tick);
    const footprint = 2 / 0.75,
      extent = tileSize * footprint;
    const draw = (
      position: { id: number; x: number; y: number; angle: number },
      scale: number,
      id: string,
      time: number,
    ) => {
      const { clip, image } = this.assets.get(`${name}:${id}`)!;
      const frame = clip.frames[clipFrame(clip, time)];
      const size = extent * scale * (clip.scale ?? 1);
      const screenX = p.x + (position.x - worldPosition.x) * tileSize;
      const screenY = p.y + (position.y - worldPosition.y) * tileSize;
      // Conservative rotated bounds, including off-center animation pivots.
      const radius =
        size *
        Math.hypot(
          Math.max(frame.pivot.x, frame.width - frame.pivot.x) / frame.width,
          Math.max(frame.pivot.y, frame.height - frame.pivot.y) / frame.height,
        );
      const width = ctx.canvas.clientWidth || ctx.canvas.width;
      const height = ctx.canvas.clientHeight || ctx.canvas.height;
      if (
        screenX + radius < 0 ||
        screenY + radius < 0 ||
        screenX - radius > width ||
        screenY - radius > height
      )
        return;
      const selectionRadius = footprint * scale * (mounted ? 0.25 : 0.37);
      this.selectionIndex.add(
        squad.id,
        position.x,
        position.y,
        selectionRadius,
      );
      this.drawQueue.add(
        squad.id,
        position.id,
        screenX,
        screenY,
        position.angle + (troop.facingOffset ?? 0),
        size,
        image,
        frame,
        this.isSelected(squad.id) ? Math.max(3, selectionRadius * tileSize) : 0,
        COLORS[squad.playerId],
      );
    };
    for (const corpse of state.motion.dead(now))
      this.captureDeath(squad.id, state, corpse, now - corpse.age);
    const slots =
      mobile && !engagement.engaged
        ? engagement.slots.map((slot) => ({
            ...slot,
            angle: travelFacing - angle,
          }))
        : engagement.slots;
    const throwTime = ranged
      ? javelinThrowTime(squad, tick, this.assets.get(`${name}:attack`)!.clip)
      : undefined;
    const planted =
      throwTime !== undefined
        ? new Set(slots.map((slot) => slot.id))
        : undefined;
    const soldiers = state.walkers.sample(now, worldPosition, angle, slots, {
      footprint,
      mounted,
      engaged: mobile ? engagement.engaged : squad.fighting,
      looseTravel:
        !troop.vehicle && (mobile || laneTravel) && !engagement.engaged,
      travelLanes:
        !troop.vehicle && (mobile || laneTravel) && !engagement.engaged,
      planted,
      combatFootwork: !troop.vehicle,
      reformInPlace: this.options?.reformInPlace,
    });
    const walking = this.assets.get(`${name}:running`)!.clip;
    const duration =
      walking.durations?.reduce((sum, duration) => sum + duration, 0) ??
      (walking.frameCount * 1000) / (walking.fps ?? 6);
    const throwers: VolleyThrower[] = [];
    for (const soldier of soldiers) {
      const moving = soldier.speed > 0.001 || soldier.turning;
      const clip =
        ranged && throwTime !== undefined
          ? "attack"
          : moving
            ? "running"
            : (
                  ranged
                    ? throwTime !== undefined
                    : soldier.front &&
                      (soldier.facingError ?? 0) < Math.PI / 6 &&
                      pose.clip === "attack"
                )
              ? "attack"
              : "idle";
      const time =
        clip === "attack"
          ? (throwTime ?? pose.elapsed * 50)
          : clip === "running"
            ? (((soldier.backstepping ? -1 : 1) *
                (soldier.gaitDistance / (mounted ? 1.1 : 0.7)) *
                duration +
                soldier.id * 73) %
                duration) +
              duration
            : now + squad.id * 73 + soldier.id * 19;
      draw(soldier, soldier.scale, clip, time);
      if (ranged) throwers.push({ ...soldier, throwing: clip === "attack" });
    }
    if (ranged) this.throwers.set(squad.id, throwers);
    return true;
  };
}
