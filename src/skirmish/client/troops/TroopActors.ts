import { TICKS_PER_SECOND } from "../../Protocol";
import {TICK_MS} from '../../Protocol';
import { formationRenderPose, type FormationRenderPose } from "../FormationRenderPose";
import { formationDoctrine } from "../../domain/FormationGeometry";
import { formationFootprint } from '../../domain/FormationContact';
import { carryCasualtyPoses, meleeCasualtyContact, meleeCasualtyScores, type MeleeCasualtyContact } from './TroopCasualties';
import footLayout from "../../../../Art/Cultures/Russians/FormationLayouts/Clubman.json";
import rangedLayout from "../../../../Art/Cultures/Russians/FormationLayouts/Javelinist.json";
import mountedLayout from "../../../../Art/Cultures/Russians/FormationLayouts/MountedSpearman.json";
import type { Projectile } from "../../domain/Definitions";
import { FIXED, type ArcherVolley, type Snapshot } from "../../Protocol";
import { squadArtworkPose } from "../CombatEffectsViewModel";
import { COLORS } from "../FactionColors";
import { FactionFrames } from "./FactionFrames";
import { TroopImpacts } from "./TroopImpacts";
import { RangedAttackPresentation, rangedRecoveryClip } from "./RangedAttackPresentation";
import { drawPreviewProjectile } from "./ProjectilePresentation";
import { weaponCycle } from "../../content/WeaponCycles";
import { UNIT } from "../../content/Units";
import { SOLDIER_SCALE, CAVALRY_SCALE } from '../../content/SoldierScale';
import { projectilePresentationScale } from '../../content/ProjectileScale';
import { chargeReactions } from './ChargeImpactPresentation';
import { CHARGE_IMPACT } from '../../domain/ChargeImpact';
import { CavalryPoseContinuity } from './CavalryPoseContinuity';
import { CavalryAssaultMotion, type AssaultRiderPose } from './CavalryAssaultPresentation';
import { cavalryRankExposure } from '../../domain/CavalryMelee';
import { weaponVisual } from "../CombatEffectsViewModel";
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
import { committedMeleeActors } from "./TroopMeleeStrike";
import { cavalryCohort,cavalryWaves,type CavalryCohort } from './CavalryMeleePresentation';
import {
  clipFrame,
  resolveFormation,
  type ActorClip,
  type ActorManifest,
  type FormationLayout,
  type FormationSlot,
  type ManualFormation,
} from "./TroopFormationModel";
import { actorFormationSlots } from "./TroopPacking";
import { TroopRemains } from "./TroopRemains";
import {
  reloadClipTime,
  throwTiming,
  TroopVolley,
  type VolleyThrower,
} from "./TroopVolley";

type Name = string;
type LayoutTransition=NonNullable<Snapshot['squads'][number]['formation']>['transition'];
/** Snapshots can clone the same transition. Compare its authored inputs, not
 * object identity, so frame sampling never recompiles a stable assignment. */
function sameLayoutTransition(a:LayoutTransition,b:LayoutTransition):boolean {
  return !!a && !!b && a.startTick===b.startTick && a.duration===b.duration && a.from===b.from && a.fromFacing===b.fromFacing && a.reorientation===b.reorientation && a.occupationReform===b.occupationReform && a.fromFrontage===b.fromFrontage &&
    (a.fromSlots===b.fromSlots || !!a.fromSlots && !!b.fromSlots && a.fromSlots.length===b.fromSlots.length && a.fromSlots.every((p,i)=>p.x===b.fromSlots![i].x&&p.y===b.fromSlots![i].y&&p.row===b.fromSlots![i].row));
}
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
  /** The attack sheet owns the initial muzzle puff; persist smoke afterward. */
  bakedMuzzleSmoke?: boolean;
}
export interface TroopActorOptions {
  unitDefinition?: (squad:Snapshot['squads'][number])=>import('../../domain/Definitions').UnitDefinition|undefined;
  troops: readonly TroopActorDefinition[];
  byDefinitionId: ReadonlyMap<string, TroopActorDefinition>;
  reformInPlace?: boolean;
  infantryCrowdPress?: () => boolean;
  groundElevationAt?: (x: number, y: number) => number;
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
  private readonly sharedLayouts = new WeakMap<FormationRenderPose["slots"],Map<string,FormationSlot[]>>();
  private sharedActorSlots(pose:FormationRenderPose,scale:number,capacity:number):FormationSlot[]{
    let variants=this.sharedLayouts.get(pose.slots);if(!variants)this.sharedLayouts.set(pose.slots,variants=new Map());
    const key=scale+":"+capacity;let slots=variants.get(key);if(!slots){slots=Array.from({length:capacity},(_,i)=>{const slot=pose.slots[Math.min(i,pose.slots.length-1)];return {...slot,x:slot.x/FIXED/(2/0.75),y:slot.y/FIXED/(2/0.75),scale,angle:0};});variants.set(key,slots);}
    return slots;
  }
  private assets = new Map<
    string,
    { clip: ActorClip; image: HTMLImageElement; mask?: HTMLImageElement }
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
      drawn: Map<number,{x:number;y:number;angle:number}>;
      name: Name;
      anchor: { x: number; y: number };
      angle: number;
      assignmentTransition?: Snapshot['squads'][number]['formation'];
    }
  >();
  private readonly detailedInFrame = new Set<number>();
  /** Visibility is published only by a completed draw. beginFrame can be
   * followed by a throttled renderer frame, so its empty set is not culling. */
  private readonly completedDetail = new Set<number>();
  /** Snapshot history stays current even when actor detail is culled. */
  private casualtySnapshot?: Snapshot;
  private readonly casualtyContacts=new Map<number,MeleeCasualtyContact[]>();
  private readonly chargeCohorts = new Map<number,{tick:number;sourceId:number;role:string;ids:Set<number>}>();
  private readonly cavalryCohorts=new Map<number,Map<number,CavalryCohort>>();
  private readonly cavalryContinuity=new Map<number,CavalryPoseContinuity>();
  private readonly cavalryAssaults=new Map<number,CavalryAssaultMotion>();
  private readonly remains = new TroopRemains();
  private readonly factionFrames = new FactionFrames();
  private readonly impacts = new TroopImpacts();
  private frameScale = 64;
  private frameProject?: (x:number,y:number)=>{x:number;y:number};
  private readonly ownerBySquad = new Map<number, number>();
  private presentationSquads: ReadonlyMap<number, Snapshot["squads"][number]> = new Map();
  private readonly poses = new Map<number, { x: number; y: number; bottom: number; width: number }>();
  labelPose = (id: number) => this.poses.get(id);
  private readonly volleys = new TroopVolley();
  private readonly rangedPlayback = new RangedAttackPresentation();
  private readonly shells = new TroopVolley();
  private readonly throwers = new Map<number, VolleyThrower[]>();
  /** Latest drawn soldier positions per squad, so bullets can land on live targets. */
  private readonly bodies = new Map<number, { id: number; x: number; y: number }[]>();
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
    this.completedDetail.clear();
    this.motions.clear();
    this.headings.clear();
    this.contacts.clear();
    this.throwers.clear();
    this.bodies.clear();
    this.presentationSquads = new Map();
    this.volleys.clear();
    this.rangedPlayback.clear();
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
    const slots = squad.formation ? formationRenderPose(squad,0).slots.map(slot=>({...slot,x:slot.x/FIXED/(2/0.75),y:slot.y/FIXED/(2/0.75),scale:troop.memberScale,angle:0})) : actorFormationSlots(
      layout,
      troop.mounted,
      shape,
      troop.memberScale,
      {...troop,members:squad.manpower?.capacity ?? troop.members},
    );
    const count = squad.manpower ? Math.max(0,squad.troops) : Math.ceil(((troop.members ?? (troop.mounted ? 6 : 12))*Math.max(0,squad.troops))/1000);
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
    this.detailedInFrame.clear();
    this.drawQueue.clear();
    this.poses.clear();
    this.selectionIndex.beginFrame();
  }
  flush = (ctx: CanvasRenderingContext2D): void => {
    this.completedDetail.clear();
    for(const id of this.detailedInFrame)this.completedDetail.add(id);
    for(const id of this.cavalryContinuity.keys())if(!this.detailedInFrame.has(id))this.cavalryContinuity.delete(id);
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
        ctx.beginPath();
        ctx.arc(
          entry.screenX,
          entry.screenY,
          entry.selectionRadius,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    for (const entry of entries) {
      this.impacts.member(ctx,entry.squadId,entry.soldierId,{x:entry.screenX,y:entry.screenY,angle:entry.angle},this.clock(),this.frameScale,true);
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
    for (const entry of entries) this.impacts.member(ctx,entry.squadId,entry.soldierId,{x:entry.screenX,y:entry.screenY,angle:entry.angle},this.clock(),this.frameScale,false);
    if(this.frameProject)this.impacts.drawSmoke(ctx,this.clock(),this.frameScale,this.frameProject);
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
    const scaled = new Map<TroopActorDefinition, TroopActorDefinition>();
    const scaleTroop = (troop: TroopActorDefinition): TroopActorDefinition => {
      let value = scaled.get(troop);
      if (!value) {
        value = troop.vehicle ? troop : {...troop, memberScale: troop.memberScale * SOLDIER_SCALE * (troop.mounted ? CAVALRY_SCALE : 1)};
        scaled.set(troop, value);
      }
      return value;
    };
    this.troops = options.troops.map(scaleTroop);
    this.vehicles = new Set(
      this.troops.filter((troop) => troop.vehicle).map((troop) => troop.name),
    );
    this.byDefinitionId = new Map([...options.byDefinitionId].map(([id, troop]) => [id, scaleTroop(troop)]));
  }
  clear(): void {
    this.completedDetail.clear();
    this.casualtySnapshot=undefined;
    this.casualtyContacts.clear();
    this.chargeCohorts.clear();
    this.cavalryCohorts.clear();
    this.cavalryContinuity.clear();
    this.cavalryAssaults.clear();
    this.detailedInFrame.clear();
    this.factionFrames.clear();
    this.impacts.clear();
    this.ownerBySquad.clear();
    this.presentationSquads = new Map();
    this.poses.clear();
    this.motions.clear();
    this.headings.clear();
    this.remains.clear();
    this.volleys.clear();
    this.rangedPlayback.clear();
    this.shells.clear();
    this.throwers.clear();
    this.bodies.clear();
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
        manifest.animations.map(async (clip) => {
          const id = clip.id;
          const image = await loadSharedImage(troopAssetUrl(root + clip.file));
          const mask = clip.mask ? await loadSharedImage(troopAssetUrl(root + clip.mask)) : undefined;
          const baseScale =
            manifest.animations.find((c) => c.id === "idle")?.scale ?? 1;
          return {
            id,
            clip: { ...clip, scale: (clip.scale ?? 1) / baseScale },
            image,
            mask,
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
    const previousTick=this.casualtySnapshot?.tick??-1;
    const previous=new Map(this.casualtySnapshot?.squads.map(s=>[s.id,s])??[]);
    const incoming=new Map(snapshot.squads.map(s=>[s.id,s]));
    for(const id of this.casualtyContacts.keys()){
      const target=incoming.get(id),motion=this.motions.get(id)?.motion;
      if(!target || !motion || motion.count<=target.troops)this.casualtyContacts.delete(id);
    }
    const recordHit=(source:Snapshot['squads'][number],target:Snapshot['squads'][number],hit:{toX:number;toY:number;bearing?:number})=>{
      const old=previous.get(target.id);
      if((old?.troops??target.troops)<=target.troops && (this.motions.get(target.id)?.motion.count??target.troops)<=target.troops)return;
      const receiving=old?{...target,troops:old.troops,formation:old.formation}:target;
      let hits=this.casualtyContacts.get(target.id);
      if(!hits){hits=[];this.casualtyContacts.set(target.id,hits);}
      if(hits.length<8)hits.push(meleeCasualtyContact(source,receiving,snapshot.tick,hit));
    };
    for(const source of snapshot.squads){
      if(!source.meleeStrike || source.meleeStrike.tick<=previousTick || source.meleeStrike.tick>snapshot.tick)continue;
      for(const hit of source.meleeStrike.contacts){
        if(!hit.damage || hit.targetId===undefined)continue;
        const target=incoming.get(hit.targetId)??previous.get(hit.targetId);
        if(!target)continue;
        recordHit(source,target,hit);
      }
    }
    // A simultaneous fatal batch can remove the attacker and its strike fact.
    // Its committed volley remains available without inventing a new hit.
    for(const hit of snapshot.volleys){
      if(!hit.melee || !hit.damage || hit.tick<=previousTick || hit.tick>snapshot.tick || hit.targetId===undefined || incoming.get(hit.squadId)?.meleeStrike?.tick===hit.tick)continue;
      const source=incoming.get(hit.squadId)??previous.get(hit.squadId),target=incoming.get(hit.targetId);
      if(source&&target)recordHit(source,target,hit);
    }
    this.playerId = snapshot.localPlayerId ?? 1;
    const current=new Map(snapshot.squads.map(s=>[s.id,s]));
    for(const old of this.casualtySnapshot?.squads??[]){
      const next=current.get(old.id),troop=this.byDefinitionId.get(old.definitionId??'');
      if(!troop)continue;
      const count=(s:Snapshot['squads'][number])=>s.manpower?Math.max(0,s.troops):Math.ceil((troop.members??(troop.mounted?6:12))*Math.max(0,s.troops)/1000);
      const before=count(old),after=next?count(next):0;
      const visible=this.detailed&&this.completedDetail.has(old.id)&&this.motions.has(old.id);
      if(before>after&&!visible)this.captureOffscreenLoss(next??old,before-after,before,snapshot.tick,now,troop);
      // An undrawn motion history cannot be reused as current soldier poses.
      // Reentry starts at current strength without replaying missed losses.
      if(!visible){this.motions.delete(old.id);this.bodies.delete(old.id);this.throwers.delete(old.id);this.cavalryContinuity.delete(old.id);this.cavalryAssaults.delete(old.id);}
    }
    this.casualtySnapshot=snapshot;
    if (!this.detailed) {this.ownerBySquad.clear();this.chargeCohorts.clear();this.cavalryCohorts.clear();this.cavalryContinuity.clear();this.cavalryAssaults.clear();return;}
    for (const squad of snapshot.squads) this.ownerBySquad.set(squad.id, squad.playerId);
    this.headings.update(snapshot, now);
    this.volleys.prune(snapshot.volleys);
    this.rangedPlayback.observe(snapshot.volleys);
    this.rangedPlayback.prune(new Set(snapshot.squads.map(s => s.id)));
    this.shells.prune(snapshot.expansion?.projectiles ?? []);
    const squads = new Map(snapshot.squads.map((s) => [s.id, s]));
    this.presentationSquads = squads;
    for(const id of this.cavalryContinuity.keys())if(!squads.has(id))this.cavalryContinuity.delete(id);
    for(const id of this.cavalryAssaults.keys())if(!squads.get(id)?.cavalryEngagement?.assault)this.cavalryAssaults.delete(id);
    for(const id of this.cavalryCohorts.keys())if(!squads.get(id)?.cavalryMelee)this.cavalryCohorts.delete(id);
    for(const id of this.chargeCohorts.keys()){
      const impact=squads.get(id)?.chargeImpact;
      if(!impact || snapshot.tick>=impact.tick+CHARGE_IMPACT.duration)this.chargeCohorts.delete(id);
    }
    this.impacts.update(snapshot.volleys,now,id=>{
      const state=this.motions.get(id);
      return state ? state.motion.soldiers(now).flatMap(s=>{const p=state.walkers.position(s.id);return p?[{...p,id:s.id}]:[];}) : [];
    });
    const buildings = new Map(snapshot.buildings.map((b) => [b.id, b]));
    this.contacts.clear();
    // Freeze opponent poses at the snapshot boundary, so facing does not depend
    // on which army happens to be drawn first this frame.
    const opponentPoses = new Map<number, EngagementOpponents>();
    for (const squad of snapshot.squads) {
      const state = this.motions.get(squad.id);
      const soldiers = state && this.completedDetail.has(squad.id)
        ? (this.bodies.get(squad.id)?.map(p=>({id:`${squad.id}:${p.id}`,x:p.x,y:p.y})) ?? state.motion.soldiers(now).flatMap((slot) => {
            const position = state.walkers.position(slot.id);
            return position
              ? [{ id: `${squad.id}:${slot.id}`, x: position.x, y: position.y }]
              : [];
          }))
        : [];
      opponentPoses.set(squad.id, {
        center: { x: squad.x / FIXED, y: squad.y / FIXED },
        soldiers,
        ...(this.completedDetail.has(squad.id)?{boundary:formationFootprint(squad,snapshot.tick).map(p=>({x:p.x/FIXED,y:p.y/FIXED}))}:{}),
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
    for(const squad of snapshot.squads){
      const contact=this.contacts.get(squad.id);if(!contact || !squad.meleeStrike || snapshot.tick-squad.meleeStrike.tick>3*TICKS_PER_SECOND)continue;
      for(const strike of squad.meleeStrike.contacts){
        const opponent=strike.targetId===undefined?undefined:opponentPoses.get(strike.targetId);
        const point=opponent?.center??{x:strike.toX/FIXED,y:strike.toY/FIXED};
        if(!contact.threats.some(p=>p.x===point.x && p.y===point.y))contact.threats.push(point);
        if(opponent && !contact.opponents.includes(opponent))contact.opponents.push(opponent);
      }
    }
    const ids = new Set(snapshot.squads.map((squad) => squad.id));
    for (const [id, state] of this.motions)
      if (!ids.has(id)) {
        // Complete a terminal carrier movement before freezing the survivors'
        // last local artwork offsets; the source entity is already gone.
        for(let i=snapshot.volleys.length-1;i>=0;i--){
          const hit=snapshot.volleys[i];
          if(hit.tick<=previousTick)break;
          const roots=hit.combatRoots;
          const root=roots&&(hit.squadId===id?{x:roots.sourceX/FIXED,y:roots.sourceY/FIXED}:hit.targetId===id?{x:roots.targetX/FIXED,y:roots.targetY/FIXED}:undefined);
          if(root){if(state.drawn)carryCasualtyPoses(state.drawn,state.anchor,root);state.anchor=root;break;}
        }
        for (const soldier of state.motion.soldiers(now))
          this.captureDeath(id, state, soldier, now);
        this.motions.delete(id);
        this.throwers.delete(id);
        this.bodies.delete(id);
      }
    for(const id of this.ownerBySquad.keys())if(!ids.has(id))this.ownerBySquad.delete(id);
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
    if (volley.melee || volley.impact || volley.sourceKind === "aircraft") return true;
    const troop = this.byDefinitionId.get(volley.definitionId ?? "");
    if (!this.detailed || !troop?.ranged || !this.loaded.has(troop.name))
      return false;
    const clip = this.assets.get(`${troop.name}:attack`)!.clip;
    const flights = this.volleys.sample(
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
      (troop.projectile === "bullet" ? .2 : troop.projectile === "rocket" ? .4 : .6) * TICKS_PER_SECOND,
      undefined,
      volley.targetId === undefined ? undefined : this.bodies.get(volley.targetId),
      (throwTiming(clip).duration - throwTiming(clip).release) / TICK_MS,
    );
    this.impacts.release(volley, tick, this.volleys.releases(volley.id),
      troop.bakedMuzzleSmoke ? throwTiming(clip).duration - throwTiming(clip).release : 0);
    for (const flight of flights) {
      const p = project(flight.x, flight.y);
      if (p.x < -20 || p.y < -20 || p.x > width + 20 || p.y > height + 20)
        continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      const projectileScale = projectilePresentationScale(weaponVisual(volley.definitionId), 'flight');
      ctx.scale(tileSize / 32 * projectileScale, tileSize / 32 * projectileScale);
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
    if (!this.rangedPlayback.permitsRelease(projectile.sourceId) && !this.shells.releases(projectile.id).length) return true;
    const volley = {
      ...projectile,
      squadId: projectile.sourceId,
    } as unknown as ArcherVolley;
    const clip = this.assets.get(`${troop.name}:attack`)!.clip;
    const flights = this.shells.sample(
      volley,
      tick,
      throwers,
      clip,
      2 / 0.75,
      troop.releasePoints,
      troop.facingOffset,
      false,
      projectile.impactTick - projectile.tick,
      this.contacts.get(projectile.sourceId)?.opponents[0]?.soldiers.map(s=>({x:s.x-this.contacts.get(projectile.sourceId)!.opponents[0].center.x,y:s.y-this.contacts.get(projectile.sourceId)!.opponents[0].center.y})) ?? [],
    );
    if (!flights.length) return false;
    ctx.save();
    for (const flight of flights) {
      const p = project(flight.x, flight.y);
      const style=weaponVisual(projectile.definitionId);
      if (["javelin","arrow","bolt"].includes(style)) {
        ctx.save();ctx.translate(p.x,p.y);ctx.scale(tileSize/64,tileSize/64);drawPreviewProjectile(ctx,style==="arrow"?"bow":style,0,0,flight.angle);ctx.restore();continue;
      }
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
  private captureOffscreenLoss(squad:Snapshot['squads'][number],lost:number,before:number,tick:number,now:number,troop:TroopActorDefinition):void {
    // Only loss events reconstruct slots; offscreen animation remains asleep.
    const root={x:squad.x/FIXED,y:squad.y/FIXED};
    const priorStrength={...squad,troops:squad.manpower?before:Math.ceil(before*1000/(troop.members??(troop.mounted?6:12)))};
    const pose=squad.formation?formationRenderPose(priorStrength,tick,root):undefined;
    const slots:FormationSlot[]=pose?this.sharedActorSlots(pose,troop.memberScale,before):actorFormationSlots(
      troop.mounted?mountedLayout:troop.ranged?rangedLayout:footLayout,troop.mounted,'line',troop.memberScale,{...troop,members:before});
    const angle=pose?.geometry.angle??0,c=Math.cos(angle),s=Math.sin(angle),footprint=2/.75;
    const victims=[...slots].sort((a,b)=>b.y-a.y||Math.abs(a.x)-Math.abs(b.x)).slice(0,lost);
    for(const [i,p] of victims.entries())this.remains.add({
      key:`offscreen:${squad.id}:${tick}:${i}`,artwork:troop.name,
      x:root.x+(p.x*c-p.y*s)*footprint,y:root.y+(p.x*s+p.y*c)*footprint,
      angle:angle+(p.angle??0)+(troop.facingOffset??0),size:p.scale*footprint,
      started:now,fallDuration:0,seed:squad.id*31+tick*17+i,color:COLORS[squad.playerId],
    });
  }
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
    const position = state.drawn?.get(soldier.id) ?? this.cavalryContinuity.get(id)?.lastPose(soldier.id) ?? state.walkers.position(soldier.id) ?? {
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
      embedded: this.impacts.detach(id,soldier.id,started),
      color: COLORS[this.ownerBySquad.get(id) ?? this.playerId],
    });
    state.drawn?.delete(soldier.id);
  }
  drawRemains = (
    ctx: CanvasRenderingContext2D,
    tileSize: number,
    project: (x: number, y: number) => { x: number; y: number },
    width: number,
    height: number,
  ): void => {
    if (!this.detailed || !this.ready) return;
    this.impacts.ground(ctx,this.clock(),tileSize,project);
    this.frameProject = project;
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
      const asset = this.assets.get(`${record.artwork}:death`);
      if(!asset){
        const troop=this.troops.find(t=>t.name===record.artwork);
        if(troop&&!this.failed.has(troop.name))void this.loadActor(troop).catch(()=>this.failed.add(troop.name));
        continue;
      }
      const { clip } = asset;
      const { image, frame } = this.factionFrames.get(`${record.artwork}:death`, asset.image, asset.mask, clip.frames[clipFrame(clip, record.age)], record.color ?? COLORS[this.playerId]);
      const size =
        record.size * tileSize * record.bodyScale * (clip.scale ?? 1);
      for(const shaft of record.embedded ?? []) {
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(record.angle);ctx.scale(tileSize/64*.65,tileSize/64*.65);drawPreviewProjectile(ctx,shaft.kind,2,0,shaft.angle,true);ctx.restore();
      }
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
    suppliedPose?: FormationRenderPose,
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
    this.detailedInFrame.add(squad.id);
    this.frameScale = tileSize;
    const mounted = troop.mounted;
    const ranged = troop.ranged;
    const soldierCount = squad.manpower?.capacity ?? troop.members ?? (troop.mounted ? 6 : 12);
    const sharedPose = squad.formation ? suppliedPose ?? formationRenderPose(squad,tick,worldPosition) : undefined;
    const sharedSlots = sharedPose ? this.sharedActorSlots(sharedPose,troop.memberScale,soldierCount) : undefined;
    const shape = sharedPose?.geometry.shape ?? resolveFormation(
      this.options?.formationForSquad?.(squad) ?? (squad.playerId === this.playerId ? this.formation : "line"),mounted,!troop.vehicle && !!squad.charge && squad.charge.phase !== "recovery");
    const mobile = shape === "mass";
    const laneTravel =
      !!this.options?.reformInPlace &&
      squad.order.type === "move" &&
      !squad.charge;
    if (mobile) angle = 0;
    const now = this.clock();
    let state = this.motions.get(squad.id);
    const created=!state;
    // Refit keeps the authoritative squad ID but changes its artwork and packing.
    if (state && state.name !== name) {
      for (const corpse of state.motion.dead(now))
        this.captureDeath(squad.id, state, corpse, now - corpse.age);
      state.name = name;
      state.shape = "";
      this.throwers.delete(squad.id);
      this.bodies.delete(squad.id);
    }
    if (!state) {
      state = {
        motion: new TroopChoreography(
          sharedSlots ?? actorFormationSlots(
            this.layouts.get(name)!,
            troop.mounted,
            shape,
            troop.memberScale,
            {...troop,members:squad.manpower?.capacity ?? troop.members},
          ),
          squad.id,
          now,
          squad.manpower ? Math.max(0,squad.troops) : Math.ceil((soldierCount * Math.max(0, squad.troops)) / 1000),
        ),
        shape,
        walkers: new FormationSoldierMotion(squad.id),
        engagement: new FormationEngagement(squad.id),
        captured: new Set(),
        drawn: new Map(),
        name,
        anchor: { ...worldPosition },
        angle,
      };
      this.motions.set(squad.id, state);
    }
    if (!sharedPose && (state.shape !== shape || state.motion.capacity !== soldierCount)) {
      state.motion.reshape(
        sharedSlots ?? actorFormationSlots(
          this.layouts.get(name)!,
          troop.mounted,
          shape,
          troop.memberScale,
          {...troop,members:squad.manpower?.capacity ?? troop.members},
        ),
        now,
      );
      state.shape = shape;
    }
    let casualtyPriority:Set<number>|undefined;
    if(mounted && squad.cavalryMelee && state.motion.count>squad.troops){
      casualtyPriority=new Set();
      for(const cycle of [squad.cavalryMelee.current,squad.cavalryMelee.previous]){
        if(!cycle)continue;
        const exposed=cavalryRankExposure(cycle,tick)|cavalryRankExposure(cycle,Math.max(0,tick-1));
        const cohort=this.cavalryCohorts.get(squad.id)?.get(cycle.tick);
        if(cohort)for(const [id,p] of cohort)if((exposed&(1<<p.rank))&&cycle.contacts[p.contact].lunge>0)casualtyPriority.add(id);
      }
    }
    if(sharedSlots){
      const basis=sharedPose!.geometry.angle,delta=Math.atan2(Math.sin(state.angle-basis),Math.cos(state.angle-basis));
      if(state.motion.count>squad.troops)carryCasualtyPoses(state.drawn,state.anchor,worldPosition,-delta);
      if(!created && Math.abs(delta)>.000001){
        for(const corpse of state.motion.dead(now))this.captureDeath(squad.id,state,corpse,now-corpse.age);
        state.motion.rebaseFrame(delta);
        state.engagement.rebaseFrame(delta);
      }
      const sameTransition=sameLayoutTransition(state.assignmentTransition?.transition,squad.formation?.transition) && Math.abs(delta)<.000001;
      const scores=state.motion.count>squad.troops?meleeCasualtyScores(state.drawn,this.casualtyContacts.get(squad.id)??[]):undefined;
      state.motion.applyAuthoritative(sharedSlots,squad.troops,now,casualtyPriority,sameTransition,scores);
      if(scores)this.casualtyContacts.delete(squad.id);
      state.assignmentTransition=squad.formation;
    }
    const presentedMembers=()=>sharedPose?state!.motion.formationSoldiers(now):state!.motion.soldiers(now);
    const travelFacing = sharedPose && !troop.vehicle && squad.locomotion && (squad.order.type==='move' || !!squad.charge)
      ? squad.locomotion.speed>0?squad.locomotion.heading:squad.locomotion.targetHeading
      : sharedPose?.geometry.angle ?? this.headings.angle(squad.id, now);
    angle = sharedPose?.geometry.angle ?? (mobile ? 0 : laneTravel ? state.angle : travelFacing);
    const contact = this.contacts.get(squad.id);
    const preparation = squad.weaponState?.rangedAction;
    const preparing = !!preparation && tick >= preparation.startTick && tick < preparation.releaseTick;
    const preparedTarget = preparing && preparation.targetKind === "squad" ? this.presentationSquads.get(preparation.targetId) : undefined;
    const intent = {
      anchored:squad.occupancy?.phase==='occupying',
      active: (squad.fighting || preparing) && squad.order.type !== "move",
      charging: !!squad.charge && squad.charge.phase !== "recovery",
      mounted,
      ranged: ranged,
      square: shape === "square",
      travelHeading: angle,
      canonicalHeading:!!sharedPose,
      crowdPress:squad.occupancy?.phase!=='occupying'&&!mounted&&!ranged&&!!this.options?.infantryCrowdPress?.(),
      meleeReach:sharedPose?((this.options?.unitDefinition?.(squad)??UNIT.get(squad.definitionId??""))?.meleeAttack?.range??0)/FIXED:undefined,
      contactAdvance:sharedPose?formationDoctrine(squad.definitionId).spacing*1.5/FIXED:undefined,
      reformInPlace: this.options?.reformInPlace,
      travelling:
        squad.order.type === "move" ||
        !!squad.charge ||
        (squad.locomotion?.speed ?? 0) > 0,
      footprint: 2 / 0.75,
      layout: shape,
      target: preparedTarget ? {x:preparedTarget.x/FIXED,y:preparedTarget.y/FIXED} : contact?.target,
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
    if (!sharedPose && reforming && Math.abs(frameDelta) > 0.001) {
      // Capture falls in the old frame before changing its coordinate basis.
      for (const corpse of state.motion.dead(now))
        this.captureDeath(squad.id, state, corpse, now - corpse.age);
      state.motion.reorient(frameDelta, now);
    }
    let engagement = state.engagement.sample(
      now,
      worldPosition,
      presentedMembers(),
      intent,
    );
    if(!sharedPose)state.motion.advance(
      now,
      squad.manpower ? Math.max(0,squad.troops) : Math.ceil((soldierCount * Math.max(0, squad.troops)) / 1000),
      engagement.engaged
        ? { angle: engagement.casualtyAngle, front: engagement.front }
        : undefined,
    );
    engagement = state.engagement.sample(
      now,
      worldPosition,
      presentedMembers(),
      intent,
    );
    const rankAttack=!!mounted && !!squad.cavalryMelee;
    if(rankAttack){
      // The rank controller owns movement here. Retain opponent attention,
      // but do not add generic reserve steps underneath its cached paths.
      const anchors=new Map(presentedMembers().map(p=>[p.id,p]));
      engagement={...engagement,slots:engagement.slots.map(slot=>{
        const anchor=anchors.get(slot.id);return anchor?{...slot,x:anchor.x,y:anchor.y}:slot;
      })};
    }
    angle = sharedPose?.geometry.angle ?? engagement.heading;
    state.anchor = { ...worldPosition };
    state.angle = angle;
    const pose = squadArtworkPose(squad, tick);
    const footprint = 2 / 0.75,
      extent = tileSize * footprint;
    let drawnClip = "";
    const draw = (
      position: { id: number; x: number; y: number; angle: number },
      scale: number,
      id: string,
      time: number,
    ) => {
      const asset = this.assets.get(`${name}:${id}`)!;
      const { clip } = asset;
      const colored = this.factionFrames.get(`${name}:${id}`, asset.image, asset.mask, clip.frames[clipFrame(clip, time)], COLORS[squad.playerId]);
      const { image, frame } = colored;
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
        this.options?.groundElevationAt?.(position.x, position.y) ?? 0,
      );
      state!.drawn.set(position.id,{x:position.x,y:position.y,angle:position.angle});
      drawnClip = id;
    };
    for (const corpse of state.motion.dead(now))
      this.captureDeath(squad.id, state, corpse, now - corpse.age);
    const slots =
      (mobile || !!sharedPose) && !engagement.engaged && !troop.vehicle
        ? engagement.slots.map((slot) => ({
            ...slot,
            angle: travelFacing - angle,
          }))
        : engagement.slots;
    const rangedCycle=squad.weaponState?.ranged;
    const rangedShot=rangedCycle?.lastShotTick;
    const firingSquad=rangedShot===undefined?squad:{...squad,lastAttackTick:rangedShot,nextAttackTick:rangedCycle!.nextTick};
    const lastWasMelee=rangedShot===undefined && !squad.weaponState?.rangedAction && squad.meleeStrike && squad.meleeStrike.tick>=(squad.lastAttackTick??-Infinity);
    const rangedDefinition = this.options?.unitDefinition?.(squad) ?? UNIT.get(squad.definitionId ?? "");
    const rangedWeapon = rangedDefinition?.rangedAttack ?? rangedDefinition?.attack;
    const throwTime = ranged && !lastWasMelee
      ? this.rangedPlayback.sample(firingSquad, tick, this.assets.get(`${name}:attack`)!.clip,
          rangedWeapon?.rpm ? 60000 / rangedWeapon.rpm : Infinity, rangedWeapon?.preparation)
      : undefined;
    const planted =
      throwTime !== undefined
        ? new Set(slots.map((slot) => slot.id))
        : undefined;
    let soldiers = state.walkers.sample(now, worldPosition, angle, slots, {
      footprint,
      mounted,
      // A move order out of contact is travel: walk it rather than strafe it.
      engaged: mobile ? engagement.engaged : intent.active,
      looseTravel:
        !sharedPose && !troop.vehicle && (mobile || laneTravel) && !engagement.engaged,
      travelLanes:
        !sharedPose && !troop.vehicle && (mobile || laneTravel) && !engagement.engaged,
      planted,
      combatFootwork: !troop.vehicle && !rankAttack,
      carrierRelative: true,
      reformInPlace: this.options?.reformInPlace,
    });
    if(sharedPose){
      // Preserve cosmetic engagement steps and independent opponent attention.
      const targets=new Map(engagement.slots.map(p=>[p.id,p]));
      const c=Math.cos(angle),s=Math.sin(angle);
      soldiers=soldiers.map(member=>{
        const slot=targets.get(member.id)!;
        const x=worldPosition.x+(slot.x*c-slot.y*s)*footprint,y=worldPosition.y+(slot.x*s+slot.y*c)*footprint;
        const residual=rankAttack || sharedPose.geometry.shape==='column'?0:Math.min(.375,formationDoctrine(squad.definitionId).bodyWidth/(2*FIXED));
        return {...member,x:x+Math.max(-residual,Math.min(residual,member.x-x)),y:y+Math.max(-residual,Math.min(residual,member.y-y))};
      });
      sharedPose.liveSlots=soldiers;
    }
    const walking = this.assets.get(`${name}:running`)!.clip;
    if (soldiers.length) {
      const minX = Math.min(...soldiers.map(s => s.x - footprint*s.scale/2));
      const maxX = Math.max(...soldiers.map(s => s.x + footprint*s.scale/2));
      const bottom = Math.max(...soldiers.map(s => s.y + footprint*s.scale/2));
      this.poses.set(squad.id, {x: (minX+maxX)/2, y: soldiers.reduce((n,s)=>n+s.y,0)/soldiers.length, bottom, width: maxX-minX});
    }
    const duration =
      walking.durations?.reduce((sum, duration) => sum + duration, 0) ??
      (walking.frameCount * 1000) / (walking.fps ?? 6);
    const throwers: VolleyThrower[] = [];
    const meleeClipKey=(ranged || squad.charge?.phase==='recovery') && this.assets.has(`${name}:charge-attack`)?'charge-attack':'attack';
    const meleeClip=this.assets.get(`${name}:${meleeClipKey}`)!.clip;
    const meleeRelease=meleeClip.durations?.slice(0,meleeClip.releaseFrame??0).reduce((n,t)=>n+t,0)??0;
    const meleeDuration=meleeClip.durations?.reduce((n,t)=>n+t,0)??meleeClip.frameCount*1000/(meleeClip.fps??6);
    const assaultAttackTime=meleeRelease+(tick-(squad.meleeStrike?.tick??-Infinity))*TICK_MS;
    // Ranged attention marks every shooter `front`; it is not a melee-contact
    // mask. Hybrid strikes select their actual recorded fighting edge instead.
    const committed=committedMeleeActors(squad.cavalryMelee?undefined:squad.meleeStrike,tick,meleeClip,soldiers,footprint,!!sharedPose && !ranged);
    let cohorts=this.cavalryCohorts.get(squad.id);
    if(squad.cavalryMelee){
      if(!cohorts)this.cavalryCohorts.set(squad.id,cohorts=new Map());
      const cycles=[squad.cavalryMelee.current,squad.cavalryMelee.previous].filter(c=>!!c);
      for(const c of cycles)if(!cohorts.has(c!.tick))cohorts.set(c!.tick,cavalryCohort(c!,soldiers));
      for(const key of cohorts.keys())if(!cycles.some(c=>c!.tick===key))cohorts.delete(key);
    }else this.cavalryCohorts.delete(squad.id);
    const waves=cavalryWaves(squad.cavalryMelee,tick,meleeClip,soldiers,cohorts??new Map());
    const impact=squad.chargeImpact?.role==='rider' && squad.cavalryEngagement?undefined:squad.chargeImpact,cohort=this.chargeCohorts.get(squad.id);
    const sameImpact=impact && cohort?.tick===impact.tick && cohort.sourceId===impact.sourceId && cohort.role===impact.role;
    const chargeActors=chargeReactions(impact,tick,soldiers,sameImpact?cohort.ids:undefined);
    if(impact && !sameImpact && chargeActors.size)this.chargeCohorts.set(squad.id,{tick:impact.tick,sourceId:impact.sourceId,role:impact.role,ids:new Set(chargeActors.keys())});
    const assaultState=squad.cavalryEngagement?.phase==='withdrawing'?undefined:squad.cavalryEngagement?.assault;
    let assaultMotion=this.cavalryAssaults.get(squad.id);
    if(assaultState && !assaultMotion)this.cavalryAssaults.set(squad.id,assaultMotion=new CavalryAssaultMotion());
    const assault=assaultMotion?.sample(assaultState,tick,soldiers.map(s=>({...s,...this.cavalryContinuity.get(squad.id)?.lastPose(s.id)})),squad.id)??new Map<number,AssaultRiderPose>();
    const desired=soldiers.map(s=>({...s,...(chargeActors.get(s.id)??assault.get(s.id)??waves.get(s.id)??(committed.get(s.id)?{angle:committed.get(s.id)!.angle}:{}))}));
    let continuous:ReturnType<CavalryPoseContinuity['sample']>|undefined;
    if(mounted){
      let handoff=this.cavalryContinuity.get(squad.id);
      if(!handoff)this.cavalryContinuity.set(squad.id,handoff=new CavalryPoseContinuity());
      const orderKey=squad.order.type==='attack'?`attack:${squad.order.targetId}`:squad.order.type;
      continuous=handoff.sample(`${orderKey}:${squad.cavalryMelee?.current.tick??'-'}:${squad.cavalryEngagement?.phase??'-'}:${assault.size?'assault':'formation'}`,now,desired,
        assault.size?undefined:worldPosition);
    }
    const drawnBodies:{id:number;x:number;y:number}[]=[];
    for (const [soldierIndex,soldier] of soldiers.entries()) {
      drawnClip = "";
      const continuousPose=continuous?.get(soldier.id);
      const strike=committed.get(soldier.id);
      const moving = mounted && continuousPose?continuousPose.moving:soldier.speed > 0.001 || soldier.turning;
      const stride=mounted?1.1*SOLDIER_SCALE:.7;
      const definition = this.options?.unitDefinition?.(squad)??UNIT.get(squad.definitionId ?? "");
      const cycle = definition && weaponCycle(definition);
      const timing = throwTiming(this.assets.get(`${name}:attack`)!.clip);
      const reloadStart = (squad.weaponState?.ranged?.reloadStartedTick ?? squad.reloadStartedTick ?? Infinity)*TICK_MS + timing.duration-timing.release;
      const reloadEnd = (squad.weaponState?.ranged?.nextTick ?? squad.nextAttackTick ?? 0)*TICK_MS - (rangedWeapon?.preparation ? rangedWeapon.preparation.ticks*TICK_MS : timing.release);
      const reloading = cycle && this.assets.has(`${name}:reload`) && tick*TICK_MS >= reloadStart && tick*TICK_MS < reloadEnd;
      const bayonet = !squad.meleeStrike && definition?.age === "Napoleonic" && definition.troopClass === "frontline" && squad.charge?.phase === "recovery" && this.assets.has(`${name}:charge-attack`);
      // `engaged` means attention to any combat target, including one at bow
      // range. Only a committed melee strike owns this soldier's attack pose.
      const clip = strike ? meleeClipKey : bayonet ? "charge-attack" : reloading ? "reload" :
        ranged && throwTime !== undefined
          ? "attack"
          : moving
            ? "running"
            : (
                  ranged
                    ? throwTime !== undefined
                    : !squad.cavalryMelee && !squad.meleeStrike && soldier.front &&
                      (soldier.facingError ?? 0) < Math.PI / 6 &&
                      pose.clip === "attack"
                )
              ? "attack"
              : "idle";
      const time = strike ? strike.time : clip === "charge-attack" ? (tick-(squad.lastAttackTick ?? tick))*TICK_MS : clip === "reload" ? reloadClipTime(this.assets.get(`${name}:reload`)!.clip, tick*TICK_MS-reloadStart, reloadEnd-reloadStart, definition?.age === "Napoleonic") :
        clip === "attack"
          ? (throwTime ?? pose.elapsed * TICK_MS)
          : clip === "running"
            ? (((soldier.backstepping ? -1 : 1) *
                ((continuousPose?.gaitDistance??soldier.gaitDistance) / stride) *
                duration +
                soldier.id * 73) %
                duration) +
              duration
            : now + squad.id * 73 + soldier.id * 19;
      const reaction=chargeActors.get(soldier.id);
      if (ranged && clip === "attack" && !strike) {
        draw({...soldier,...continuousPose},soldier.scale,clip,time);
      }else if(assault.has(soldier.id)){
        const p=assault.get(soldier.id)!;
        const attacking=p.phase==='attack'&&assaultAttackTime>=0&&assaultAttackTime<meleeDuration;
        const moving=continuousPose?.recovering?continuousPose.moving:p.moving;
        const clip=attacking?meleeClipKey:moving||p.turning?'running':'idle';
        const animationTime=attacking?assaultAttackTime:clip==='idle'?now+soldier.id*73:p.turning?now*.4+soldier.id*73:(continuousPose?.gaitDistance??p.gaitDistance)/stride*duration+soldier.id*73;
        draw({...soldier,...p,...continuousPose},soldier.scale,clip,animationTime);
      }else if(reaction){
        const reactionClip=reaction.role==='defender' && this.assets.has(`${name}:hit`)?'hit':reaction.role==='rider' && this.assets.has(`${name}:charge-attack`)?'charge-attack':clip;
        draw({...soldier,...reaction,...continuousPose},reaction.scale,reactionClip,reaction.time);
      }else {
        const wave=waves.get(soldier.id);
        const recovering=continuousPose?.recovering,walkingHome=recovering&&continuousPose.moving;
        if(wave)draw({...soldier,...wave,...continuousPose},soldier.scale,wave.attacking?meleeClipKey:(recovering?walkingHome:wave.moving)?'running':'idle',wave.attacking?wave.time:(continuousPose?.gaitDistance??wave.gaitDistance)/stride*duration+soldier.id*73);
        else {
          const finalClip = ranged ? rangedRecoveryClip(clip,!!recovering,!!walkingHome,!!strike)
            : recovering && !strike ? walkingHome ? 'running' : 'idle' : clip;
          const walkingTime = walkingHome && (!ranged || (clip !== 'attack' && clip !== 'reload'));
          draw({...soldier,...(strike?{angle:strike.angle}:{}),...continuousPose},soldier.scale,finalClip,
            walkingTime ? continuousPose.gaitDistance/stride*duration+soldier.id*73 : time);
        }
      }
      const drawn=continuousPose??desired[soldierIndex];
      drawnBodies.push({id:soldier.id,x:drawn.x,y:drawn.y});
      const attachment = state.drawn.get(soldier.id);
      if (ranged && attachment && drawnClip) throwers.push({ ...soldier, ...attachment, throwing: !strike && drawnClip === "attack" });
    }
    this.bodies.set(squad.id,drawnBodies);
    if (ranged) this.throwers.set(squad.id, throwers);
    return true;
  };
}
