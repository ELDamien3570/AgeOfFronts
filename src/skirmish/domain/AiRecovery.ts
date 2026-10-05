import type { Building, BuildingType } from "../Protocol";
import { FIXED } from "../Protocol";
import { tilePoint } from "../SquadGeometry";
import { DEFENSIVE_BUILDINGS } from "../content/Buildings";
import { shoreTransportDefinition } from "../content/ShoreTransport";
import type { Expansion } from "./Expansion";
import { FALLOUT_TROOP_LOSS_PER_CELL } from "./NuclearWasteland";

interface Episode {
  nextThink: number;
  evacuationAttempted: boolean;
}
/** Loss-driven rebuilding backoff and bounded straggler recovery. */
export class AiRecovery {
  private readonly known = new Map<
    number,
    { owner: number; tile: number; type: BuildingType }
  >();
  private readonly blocked = new Map<string, number>();
  private readonly episodes = new Map<number, Episode>();
  private readonly restricted = new Map<
    number,
    { since: number; x: number; y: number; order: string }
  >();
  private readonly cleanup=new Map<number,{squadId:number;tile:number}>();
  readonly diagnostics = {
    losses: 0,
    deniedBuilds: 0,
    rallied: 0,
    evacuations: 0,
    clearedRestricted: 0,
  };
  constructor(private readonly expansion: Expansion) {}
  observe(building: Building): void {
    const old = this.known.get(building.id);
    if (
      old &&
      old.owner === building.playerId &&
      old.tile === building.tile &&
      old.type === building.type
    )
      return;
    if (old && old.owner !== building.playerId) this.lost(old);
    this.known.set(building.id, {
      owner: building.playerId,
      tile: building.tile,
      type: building.type,
    });
  }
  forget(id: number): void {
    const old = this.known.get(id);
    if (old) this.lost(old);
    this.known.delete(id);
  }
  rebuild(buildings: readonly Building[]): void {
    this.known.clear();
    for (const building of buildings) this.observe(building);
  }
  private lost(building: {
    owner: number;
    tile: number;
    type: BuildingType;
  }): void {
    if (
      !this.expansion.world.players.find((p) => p.id === building.owner)?.ai ||
      DEFENSIVE_BUILDINGS.includes(building.type)
    )
      return;
    this.blocked.set(
      `${building.owner}:${building.tile}:${building.type}`,
      this.expansion.world.tick + 1200,
    );
    this.episodes.set(
      building.owner,
      this.episodes.get(building.owner) ?? {
        nextThink: 0,
        evacuationAttempted: false,
      },
    );
    this.diagnostics.losses++;
  }
  canBuild(playerId: number, type: BuildingType, tile: number): boolean {
    const { world } = this.expansion;
    if ((this.blocked.get(`${playerId}:${tile}:${type}`) ?? 0) > world.tick) {
      this.diagnostics.deniedBuilds++;
      return false;
    }
    const point = tilePoint(world.map, tile);
    const threat = world
      .nearbyArmyEnemies(point, 8 * FIXED, playerId)
      .reduce((n, s) => n + s.troops, 0);
    if (!threat) return true;
    const defenders = world
      .squadFacts()
      .byOwner(playerId)
      .reduce(
        (n, s) =>
          n +
          (s.embarkedOn === null &&
          (s.x - point.x) ** 2 + (s.y - point.y) ** 2 <= (8 * FIXED) ** 2
            ? s.troops
            : 0),
        0,
      );
    if (threat > defenders * 1.25) {
      this.diagnostics.deniedBuilds++;
      return false;
    }
    return true;
  }
  step(): void {
    const { world, economy } = this.expansion;
    if (world.tick % 60) return;
    if(world.wasteland.size || this.cleanup.size)this.clearFallout();
    const alive = new Set<number>();
    for (const squad of world.squads) {
      if (
        !world.players.find((p) => p.id === squad.playerId)?.ai ||
        squad.embarkedOn !== null ||
        !["move", "board"].includes(squad.order.type) ||
        squad.movementStatus?.reason !== "restricted"
      )
        continue;
      alive.add(squad.id);
      const order = JSON.stringify(squad.order),
        old = this.restricted.get(squad.id);
      if (
        !old ||
        old.order !== order ||
        Math.hypot(squad.x - old.x, squad.y - old.y) > FIXED / 4
      ) {
        this.restricted.set(squad.id, {
          since: world.tick,
          x: squad.x,
          y: squad.y,
          order,
        });
        continue;
      }
      // Permission failures cannot be repaired by repeatedly requesting the same path.
      // Normal cancellation releases boarding ownership; the mission/AI can reassess.
      if (world.tick - old.since >= 120) {
        world.applyCommand({
          type: "order",
          playerId: squad.playerId,
          squadIds: [squad.id],
          order: { type: "hold" },
        });
        this.restricted.delete(squad.id);
        this.diagnostics.clearedRestricted++;
      }
    }
    for (const id of this.restricted.keys())
      if (!alive.has(id)) this.restricted.delete(id);
    for (const [key, until] of this.blocked)
      if (until <= world.tick) this.blocked.delete(key);
    for (const [id, episode] of this.episodes) {
      const player = world.players.find((p) => p.id === id);
      if (!player?.ai || player.eliminated) {
        this.episodes.delete(id);
        continue;
      }
      if (
        world.owners[player.base] === id &&
        ![...this.blocked.keys()].some((key) => key.startsWith(`${id}:`))
      ) {
        this.episodes.delete(id);
        continue;
      }
      if (world.tick < episode.nextThink) continue;
      episode.nextThink = world.tick + 200;
      const own = world
        .squadFacts()
        .byOwner(id)
        .filter(
          (s) =>
            s.embarkedOn === null &&
            !s.refit &&
            !s.fighting &&
            !s.charge &&
            s.order.type === "hold" &&
            !economy.assets.held(`squad:${s.id}`) &&
            !this.expansion.armies.armyOf(s.id),
        )
        .slice(0, 30);
      if (!own.length) continue;
      const core = world
        .buildingFacts()
        .byOwner(id)
        .filter(
          (b) =>
            !DEFENSIVE_BUILDINGS.includes(b.type) &&
            (b.health ?? 1) > 0 &&
            world.owners[b.tile] === id,
        )
        .slice(0, 16)
        .find((b) => this.canBuild(id, b.type, b.tile));
      if (core) {
        const members = own.filter(
          (s) =>
            world.paths.connected(world.tileOf(s), core.tile) &&
            world.map.euclideanDistSquared(world.tileOf(s), core.tile) > 8 ** 2,
        );
        if (
          members.length &&
          world.applyCommand({
            type: "order",
            playerId: id,
            squadIds: members.map((s) => s.id),
            order: { type: "move", tile: core.tile },
          }) === null
        )
          this.diagnostics.rallied += members.length;
      } else if (
        !episode.evacuationAttempted &&
        shoreTransportDefinition(
          this.expansion.progression.states[id].completed,
        )
      ) {
        episode.evacuationAttempted = true;
        const destination = world
          .ownedLandNearest(id, player.base, 64)
          .find(
            (tile) =>
              world.paths.walkable(tile) &&
              !world.paths.connected(world.tileOf(own[0]), tile) &&
              this.canBuild(id, "city", tile),
          );
        if (
          destination !== undefined &&
          world.applyCommand({
            type: "order",
            playerId: id,
            squadIds: own.map((s) => s.id),
            order: { type: "move", tile: destination },
          }) === null
        )
          this.diagnostics.evacuations++;
      }
    }
  }
  checkpoint() {
    return structuredClone({
      known: [...this.known],
      blocked: [...this.blocked],
      episodes: [...this.episodes],
      restricted: [...this.restricted],
      cleanup:[...this.cleanup],
    });
  }
  restore(saved?: ReturnType<AiRecovery["checkpoint"]>): void {
    this.rebuild(this.expansion.world.buildings);
    this.blocked.clear();
    this.episodes.clear();
    this.restricted.clear();
    this.cleanup.clear();
    for(const [id,value] of saved?.cleanup??[])this.cleanup.set(id,{...value});
    for (const [key, value] of saved?.blocked ?? [])
      this.blocked.set(key, value);
    for (const [id, value] of structuredClone(saved?.episodes ?? []))
      this.episodes.set(id, value);
    for (const [id, value] of structuredClone(saved?.restricted ?? []))
      this.restricted.set(id, value);
  }
  private clearFallout():void {
    const {world,economy}=this.expansion;
    for(const player of world.players) {
      const controller=`fallout:${player.id}`,own=world.squadFacts().aliveByOwner(player.id),old=this.cleanup.get(player.id);
      const release=()=>{
        const assignment=this.cleanup.get(player.id),squad=assignment && world.squad(assignment.squadId);
        if(squad && economy.assets.owns(`squad:${squad.id}`,controller) && squad.order.type==="move" && squad.order.tile===assignment!.tile)
          world.applyCommand({type:"order",playerId:player.id,squadIds:[squad.id],order:{type:"hold"}});
        economy.assets.release(controller);this.cleanup.delete(player.id);
      };
      if(!player.ai || player.eliminated){release();continue;}
      if(own.length<5 || player.reserves<29*FALLOUT_TROOP_LOSS_PER_CELL || economy.military.armyPlanner.invasion.active(player.id)) {release();continue;}
      const squad=old && world.squad(old.squadId) || own.find(s=>s.embarkedOn===null && !s.refit && !s.fighting && s.order.type==="hold" && this.expansion.unit(s).canCapture && !economy.assets.held(`squad:${s.id}`) && !this.expansion.armies.armyOf(s.id));
      if(!squad || squad.playerId!==player.id || squad.embarkedOn!==null || squad.refit || squad.fighting || world.nearbyArmyEnemies(squad,12*FIXED,player.id).length) {release();continue;}
      if(!economy.assets.acquire([{asset:`squad:${squad.id}`,playerId:player.id,generation:world.aiGeneration(player.id),controller,priority:"patrol",createdTick:world.tick,expiresTick:world.tick+180}])){release();continue;}
      this.cleanup.set(player.id,{squadId:squad.id,tile:old?.tile??world.tileOf(squad)});
      if(squad.troops<800) {
        const tile=world.ownedLandNearest(player.id,world.tileOf(squad),32).find(t=>world.paths.walkable(t) && world.paths.connected(world.tileOf(squad),t));
        if(tile===undefined){release();continue;}
        if(world.owners[world.tileOf(squad)]===player.id) {
          if(squad.order.type!=="replenish")world.applyCommand({type:"order",playerId:player.id,squadIds:[squad.id],order:{type:"replenish"}});
        } else if(squad.order.type!=="move" || squad.order.tile!==tile)world.applyCommand({type:"order",playerId:player.id,squadIds:[squad.id],order:{type:"move",tile}});
        continue;
      }
      // Preserve a committed capture until cleared instead of retargeting as
      // neighboring cells change. Candidates are bounded and owner-indexed.
      const tile=old && world.wasteland.has(old.tile) ? old.tile : [...world.wasteland.recoveryCandidates(player.id)]
        .filter(t=>world.paths.connected(world.tileOf(squad),t) && !world.nearbyArmyEnemies(tilePoint(world.map,t),12*FIXED,player.id).length)
        .sort((a,b)=>world.map.euclideanDistSquared(world.tileOf(squad),a)-world.map.euclideanDistSquared(world.tileOf(squad),b) || a-b)[0];
      if(tile===undefined){release();continue;}
      this.cleanup.set(player.id,{squadId:squad.id,tile});
      if(world.map.euclideanDistSquared(world.tileOf(squad),tile)>1 && (squad.order.type!=="move" || squad.order.tile!==tile))
        if(world.applyCommand({type:"order",playerId:player.id,squadIds:[squad.id],order:{type:"move",tile}})!==null)release();
    }
  }
}
