import { flankCandidate, approachCandidate } from "./AiTacticalRoutes";
import { AiInvasionResponse } from "./AiInvasionResponse";
import { structureAim } from "./StructureTargeting";
import { tilePoint } from "../SquadGeometry";
import { UNITS } from "../content/Units";
import { AGES } from "./Definitions";
import { unitRefitCost } from "./Refitting";
import { conquestBuildings } from "./AiConquestObjective";
import { MAX_ORDER_SQUADS } from "../FactionRules";
import { affordableAiCost } from "./AiBudgetLedger";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { personalityOf } from "../content/AiPersonalities";
import { FIXED, type Player, type Squad } from "../Protocol";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import type { Expansion } from "./Expansion";
interface ArmyObjective {
  id: string;
  playerId: number;
  generation: number;
  phase:
    | "select"
    | "rally"
    | "assemble"
    | "advance"
    | "engage"
    | "recover"
    | "flank"
    | "breach"
    | "replenish"
    | "refit"
    | "complete";
  created: number;
  since: number;
  deadline: number;
  nextThink: number;
  cursor: number;
  rosterIds: number[];
  home?: number;
  members: number[];
  armyId?: number;
  target?: number;
  targetTile?: number;
  initialTroops: number;
  reason: string;
  purpose?: "combat" | "coast";
  rejoined?: number;
  maneuver?: { enemy: number; targetTile: number; start: number; cursor: number; tile?: number; since: number };
  breach?: { scan: number; start: number; barrier?: number; building?: number; cursor: number; tile?: number; shooters: number[]; since: number };
}
export class AiArmyPlanner {
  readonly invasion: AiInvasionResponse;
  readonly objectives = new Map<number, ArmyObjective>();
  private cursor = 0;
  private serial = 0;
  readonly diagnostics = { work: 0, commands: 0, rejected: 0, completed: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) { this.invasion = new AiInvasionResponse(expansion, economy); }
  checkpoint() {
    return structuredClone({
      objectives: [...this.objectives],
      cursor: this.cursor,
      serial: this.serial,
      invasion: this.invasion.checkpoint(),
    });
  }
  restore(saved?: ReturnType<AiArmyPlanner["checkpoint"]>): void {
    this.invasion.restore(saved?.invasion);
    this.objectives.clear();
    this.cursor = saved?.cursor ?? 0;
    this.serial = saved?.serial ?? 0;
    for (const [id, plan] of structuredClone(saved?.objectives ?? []))
      this.objectives.set(id, plan);
  }
  release(playerId: number): void {
    this.invasion.release(playerId);
    const plan = this.objectives.get(playerId);
    if (plan) {
      this.economy.assets.release(plan.id); this.economy.routes.release(plan.id);
      const army=this.expansion.armies.armies.find(a=>a.id===plan.armyId && a.playerId===playerId);
      if(army)this.expansion.world.applyCommand({type:"disband-army",playerId,armyId:army.id});
    }
    this.objectives.delete(playerId);
  }
  adoptBeachhead(
    player: Player,
    ids: readonly number[],
    tile: number,
    target: number,
    targetTile?: number,
  ): boolean {
    const { world, armies } = this.expansion;
    if (!armies.capacity(player.id) || this.objectives.has(player.id))
      return false;
    const members = ids
      .map((id) => world.squad(id))
      .filter(
        (s): s is Squad =>
          !!s &&
          s.playerId === player.id &&
          s.embarkedOn === null &&
          !s.refit &&
          !armies.armyOf(s.id) &&
          !this.economy.assets.held(`squad:${s.id}`),
      )
      .slice(0, Math.min(MAX_ORDER_SQUADS,armies.capacity(player.id)));
    if (!members.length) return false;
    const plan: ArmyObjective = {
      id: `land-army:${player.id}:${++this.serial}`,
      playerId: player.id,
      generation: world.aiGeneration(player.id),
      phase: "assemble",
      created: world.tick,
      since: world.tick,
      deadline: world.tick + 2400,
      nextThink: world.tick,
      cursor: 0,
      rosterIds: members.map((s) => s.id),
      members: members.map((s) => s.id),
      target,
      targetTile: targetTile ?? world.players.find((p) => p.id === target)?.base,
      purpose: targetTile === undefined ? "combat" : "coast",
      initialTroops: members.reduce((n, s) => n + s.troops, 0),
      reason: "Taking ownership of the landed beachhead",
      home: tile,
    };
    if (
      !this.economy.assets.acquire(
        plan.members.map((id) => ({
          asset: `squad:${id}` as const,
          playerId: player.id,
          generation: plan.generation,
          controller: plan.id,
          priority: "operation" as const,
          createdTick: world.tick,
          expiresTick: plan.deadline + 800,
        })),
      )
    )
      return false;
    if (
      world.applyCommand({
        type: "create-army",
        playerId: player.id,
        squadIds: plan.members,
      })
    ) {
      this.economy.assets.release(plan.id);
      return false;
    }
    plan.armyId = armies.armyOf(plan.members[0])!.id;
    this.objectives.set(player.id, plan);
    world.applyCommand({
      type: "army-auto",
      playerId: player.id,
      armyId: plan.armyId,
      enabled: false,
    });
    this.order(plan, { type: "regroup", tile });
    return true;
  }
  acquireCoast(player: Player, tile: number): boolean {
    const { world, armies } = this.expansion;
    if (this.objectives.has(player.id) || !armies.capacity(player.id) || !world.paths.connected(player.base,tile)) return false;
    this.objectives.set(player.id, {
      id:`land-coast:${player.id}:${++this.serial}`,playerId:player.id,generation:world.aiGeneration(player.id),
      phase:"select",created:world.tick,since:world.tick,deadline:world.tick+3600,nextThink:world.tick,
      cursor:0,rosterIds:world.squadFacts().byOwner(player.id).map(s=>s.id),members:[],initialTroops:0,
      target:world.owners[tile] || undefined,targetTile:tile,purpose:"coast",reason:"Acquiring a useful reachable coast",
    });
    return true;
  }
  private eligible(squad: Squad, plan: ArmyObjective): boolean {
    const { world } = this.expansion;
    return (
      squad.playerId === plan.playerId &&
      squad.troops >=
        AI_DOCTRINES[
          personalityOf(world.players.find((p) => p.id === plan.playerId)!).id
        ].minimumHealth &&
      squad.embarkedOn === null &&
      !squad.refit &&
      !squad.charge &&
      !squad.structureTarget &&
      !squad.fighting &&
      squad.order.type === "hold" &&
      !this.expansion.armies.armyOf(squad.id) &&
      !this.economy.assets.held(`squad:${squad.id}`) &&
      world.paths.connected(
        world.tileOf(squad),
        world.players.find((p) => p.id === plan.playerId)!.base,
      )
    );
  }
  private order(
    plan: ArmyObjective,
    order: import("./Definitions").ArmyOrder,
  ): boolean {
    const rejected = this.expansion.world.applyCommand({
      type: "army-order",
      playerId: plan.playerId,
      armyId: plan.armyId!,
      order,
    });
    this.diagnostics.commands++;
    if (rejected) {
      this.diagnostics.rejected++;
      plan.reason = rejected;
      return false;
    }
    return true;
  }
  step(budget = 24): number {
    const { world, armies, operations } = this.expansion;
    this.diagnostics.work = 0;
    if (budget <= 0 || !world.options?.deferredPlanning || !world.players.length) return 0;
    let player: Player | undefined;
    for (let n = 0; n < world.players.length; n++) {
      const candidate = world.players[this.cursor++ % world.players.length];
      if (this.economy.enabled(candidate)) {
        player = candidate;
        break;
      }
    }
    if (!player) return 0;
    const defenseWork = this.invasion.step(player, budget, () => this.release(player!.id));
    this.diagnostics.work=defenseWork;
    if (this.invasion.blocking(player.id) || defenseWork>=budget) return defenseWork;
    let plan = this.objectives.get(player.id);
    const abandoned=armies.armies.find(a=>a.playerId===player!.id && a.id!==plan?.armyId && a.state==="holding" &&
      a.memberIds.every(id=>!this.economy.assets.held(`squad:${id}`)));
    if(abandoned) {
      world.applyCommand({type:"disband-army",playerId:player.id,armyId:abandoned.id});
      this.diagnostics.work++;return this.diagnostics.work;
    }
    if (
      plan &&
      (plan.generation !== world.aiGeneration(player.id) ||
        !armies.capacity(player.id))
    ) {
      this.release(player.id);
      return this.diagnostics.work;
    }
    const profile = personalityOf(player),
      doctrine = AI_DOCTRINES[profile.id];
    if (plan && plan.phase === "complete") {
      if (world.tick < plan.nextThink) return this.diagnostics.work;
      this.release(player.id);
      plan = undefined;
    }
    if (!plan) {
      if (!armies.capacity(player.id) || world.tick < profile.raidAfterTicks)
        return this.diagnostics.work;
      const target = operations.enabled(player)
        ? operations.offensiveTarget(player.id)
        : world.players
            .filter(
              (p) =>
                p.id !== player!.id &&
                !p.eliminated &&
                world.hostile(player!.id, p.id) &&
                world.paths.connected(player!.base, p.base),
            )
            .sort(
              (a, b) =>
                world.map.euclideanDistSquared(player!.base, a.base) -
                  world.map.euclideanDistSquared(player!.base, b.base) ||
                a.id - b.id,
            )[0]?.id;
      const threat = operations.state(player.id)?.threats[0];
      if (target === undefined && !threat) return this.diagnostics.work;
      plan = {
        id: `land-army:${player.id}:${++this.serial}`,
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        phase: "select",
        created: world.tick,
        since: world.tick,
        deadline: world.tick + 3600,
        nextThink: world.tick,
        cursor: 0,
        rosterIds: world
          .squadFacts()
          .byOwner(player.id)
          .map((s) => s.id),
        members: [],
        target: target ?? threat?.rival,
        targetTile:
          target === undefined
            ? threat?.tile
            : world.players.find((p) => p.id === target)?.base,
        initialTroops: 0,
        reason: "Selecting a reachable supported roster",
      };
      this.objectives.set(player.id, plan);
    }
    if (world.tick < plan.nextThink) return this.diagnostics.work;
    if (plan.phase === "select") {
      const own = plan.rosterIds;
      while (plan.cursor < own.length && this.diagnostics.work < budget) {
        const squad = world.squad(own[plan.cursor++]);
        this.diagnostics.work++;
        if (squad && this.eligible(squad, plan)) plan.members.push(squad.id);
      }
      if (plan.cursor < own.length) return this.diagnostics.work;
      const available = plan.members
        .map((id) => world.squad(id)!)
        .filter((s) => s && this.eligible(s, plan!));
      const reserve = Math.max(
          operations.offensiveTarget(player.id) !== undefined ? 0 : 2,
          operations.offensiveTarget(player.id) !== undefined && available.length < profile.minimumRaidSquads ? 0 : Math.ceil((available.length * doctrine.reservePercent) / 100),
        ),
        maximum = Math.min(
          MAX_ORDER_SQUADS,
          armies.capacity(player.id),
          available.length - reserve,
        );
      if (
        maximum <
        Math.min(operations.offensiveTarget(player.id) !== undefined ? 2 : profile.minimumRaidSquads, armies.capacity(player.id))
      ) {
        plan.cursor = 0;
        plan.rosterIds = world
          .squadFacts()
          .byOwner(player.id)
          .map((s) => s.id);
        plan.members = [];
        plan.nextThink = world.tick + 200;
        plan.reason = "Retaining mobile reserve while filling role shortfalls";
        return this.diagnostics.work;
      }
      available.sort((a, b) => {
        const ar = doctrine.preferredRoles.indexOf(this.expansion.unit(a).role),
          br = doctrine.preferredRoles.indexOf(this.expansion.unit(b).role);
        return (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br) || a.id - b.id;
      });
      plan.members = available.slice(0, maximum).map((s) => s.id);
      plan.initialTroops = plan.members.reduce(
        (n, id) => n + world.squad(id)!.troops,
        0,
      );
      if (
        !this.economy.assets.acquire(
          plan.members.map((id) => ({
            asset: `squad:${id}` as const,
            playerId: player!.id,
            generation: plan!.generation,
            controller: plan!.id,
            priority: "operation" as const,
            createdTick: world.tick,
            expiresTick: plan!.deadline+800,
          })),
        )
      ) {
        plan.nextThink = world.tick + 60;
        plan.cursor = 0;
        plan.members = [];
        return this.diagnostics.work;
      }
      const rejected = world.applyCommand({
        type: "create-army",
        playerId: player.id,
        squadIds: plan.members,
      });
      this.diagnostics.commands++;
      if (rejected) {
        this.economy.assets.release(plan.id);
        plan.reason = rejected;
        plan.nextThink = world.tick + 200;
        plan.cursor = 0;
        plan.members = [];
        this.diagnostics.rejected++;
        return this.diagnostics.work;
      }
      plan.armyId = armies.armyOf(plan.members[0])!.id;
      world.applyCommand({
        type: "army-auto",
        playerId: player.id,
        armyId: plan.armyId,
        enabled: false,
      });
      if (
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "rally";
        plan.since = world.tick;
        plan.reason = "Rallying through transactional Army admission";
      } else {
        world.applyCommand({
          type: "disband-army",
          playerId: player.id,
          armyId: plan.armyId,
        });
        this.economy.assets.release(plan.id);
        plan.phase = "complete";
        plan.nextThink = world.tick + 200;
      }
      return this.diagnostics.work;
    }
    const army = armies.armies.find((a) => a.id === plan!.armyId),
      members = plan.members
        .map((id) => world.squad(id))
        .filter(
          (s): s is Squad => !!s && s.playerId === player!.id && s.troops > 0,
        );
    if (
      !members.length || (!army && plan.phase !== "replenish" && plan.phase !== "refit") ||
      members.some((s) => !this.economy.assets.owns(`squad:${s.id}`, plan!.id))
    ) {
      this.release(player.id);
      return this.diagnostics.work;
    }
    const target = world.players.find((p) => p.id === plan!.target),
      troops = members.reduce((n, s) => n + s.troops, 0);
    if(operations.finishing(player.id,plan.target ?? 0) && plan.deadline < world.tick+200) {
      plan.deadline=world.tick+200;
      this.economy.assets.acquire(members.map(s=>({...this.economy.assets.leases.get(`squad:${s.id}`)!,expiresTick:plan!.deadline+800})));
    }
    if (
      !["recover","replenish","refit"].includes(plan.phase) &&
      ((world.tick >= plan.deadline && !operations.finishing(player.id,plan.target ?? 0)) ||
        (plan.purpose !== "coast" && (!target || target.eliminated || !world.hostile(player.id, target.id) ||
          (operations.enabled(player) && !operations.canTarget(player.id,target.id)))) ||
        (plan.purpose === "coast" && plan.targetTile !== undefined &&
          world.owners[plan.targetTile] !== player.id && operations.enabled(player) &&
          !operations.canEnter(player.id,world.owners[plan.targetTile],plan.targetTile)) ||
        troops < plan.initialTroops * 0.55)
    ) {
      if (
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "recover";
        plan.since = world.tick; this.economy.routes.release(plan.id);
        const detached=members.filter(s=>!armies.armyOf(s.id));
        if(detached.length)world.applyCommand({type:"order",playerId:player.id,squadIds:detached.map(s=>s.id),order:{type:"move",tile:plan.home??player.base}});
        plan.reason = "Returning survivors through the same movement owner";
      }
    }
    if (
      plan.phase === "rally" &&
      members.every(
        (s) =>
          world.map.euclideanDistSquared(
            world.tileOf(s),
            plan!.home ?? player!.base,
          ) <
          12 ** 2,
      )
    ) {
      plan.phase = "assemble";
      plan.since = world.tick;
    } else if (
      plan.phase === "assemble" &&
      world.tick - plan.since >= doctrine.assemblyTicks
    ) {
      if (
        plan.targetTile !== undefined &&
        (!operations.enabled(player) ||
          operations.canEnter(player.id, plan.target!, plan.targetTile)) &&
        this.order(plan, { type: "move", tile: plan.targetTile })
      ) {
        plan.phase = "advance";
        plan.since = world.tick;
        plan.reason = "Supported Army advancing on its committed region";
      }
    } else if (plan.phase === "flank") {
      const maneuver=plan.maneuver!,enemy=world.squad(maneuver.enemy);
      if(!enemy || enemy.embarkedOn!==null || !world.hostile(player.id,enemy.playerId) ||
        world.map.euclideanDistSquared(world.tileOf(enemy),maneuver.targetTile)>6**2 ||
        world.tick-maneuver.since>400){
        this.economy.routes.release(plan.id);plan.phase="advance";plan.reason="Flank invalidated; reassessing the supported push";
      } else if(maneuver.tile===undefined){
        const tile=flankCandidate(world.map,tilePoint(world.map,maneuver.start),enemy,maneuver.cursor,doctrine.engagement==="flank-right"?1:-1);
        this.diagnostics.work++;
        if(tile===undefined || !world.paths.connected(maneuver.start,tile) || this.expansion.fortifications.blocked(tile,player.id) ||
          (operations.enabled(player)&&!operations.canEnter(player.id,world.owners[tile],tile))){maneuver.cursor++;}
        else {
          const route=this.economy.routes.request(plan.id,player.id,maneuver.start,tile);
          if(!route.pending){
            if(route.path && route.path.length<=Math.max(24,world.map.manhattanDist(maneuver.start,maneuver.targetTile)*3+24) &&
              this.order(plan,{type:"move",tile})){maneuver.tile=tile;plan.reason="Taking a certified reachable side route";}
            else maneuver.cursor++;
          }
        }
        if(maneuver.cursor>=12){this.economy.routes.release(plan.id);this.order(plan,{type:"attack",targetId:enemy.id});plan.phase="engage";plan.since=world.tick;plan.reason="No bounded flank route; stable supported push";}
      } else if(members.every(s=>world.map.euclideanDistSquared(world.tileOf(s),maneuver.tile!)<=6**2)){
        this.economy.routes.release(plan.id);this.order(plan,{type:"attack",targetId:enemy.id});plan.phase="engage";plan.since=world.tick;
      }
    } else if(plan.phase==="breach"){
      const b=plan.breach!,forts=this.expansion.fortifications;
      const wall=b.barrier===undefined?undefined:forts.barrier(b.barrier),building=b.building===undefined?undefined:world.building(b.building);
      if(b.barrier===undefined && b.building===undefined){
        while(b.scan<81 && this.diagnostics.work<Math.min(budget,8)){
          const x=world.map.x(b.start)+(b.scan%9)-4,y=world.map.y(b.start)+Math.floor(b.scan/9)-4;b.scan++;this.diagnostics.work++;
          if(x<0||y<0||x>=world.map.width()||y>=world.map.height())continue;
          const tile=world.map.ref(x,y),barrier=forts.barriersAt(tile).find(w=>w.kind!=="trench"&&w.health>0&&world.hostile(player.id,w.playerId)&&
            (!operations.enabled(player)||operations.canTarget(player.id,w.playerId)));
          if(barrier){b.barrier=barrier.id;break;}
          const tower=world.buildingsAt(tile).find(t=>t.type==="tower"&&(t.health??1)>0&&world.hostile(player.id,t.playerId)&&
            (!operations.enabled(player)||operations.canTarget(player.id,t.playerId)));
          if(tower){b.building=tower.id;break;}
        }
        if(b.scan>=81&&b.barrier===undefined&&b.building===undefined){this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Blocked approach has no supported local breach target";}
      } else if(!wall && !building || (wall?.health??building?.health??0)<=0 ||
        !world.hostile(player.id,(wall??building)!.playerId)){
        this.economy.routes.release(plan.id);plan.phase="advance";plan.breach=undefined;
        if(plan.targetTile!==undefined)this.order(plan,{type:"move",tile:plan.targetTile});plan.reason="Breach opened or structure access changed";
      } else {
        const shooters=b.shooters.map(id=>world.squad(id)).filter((s):s is Squad=>!!s&&s.playerId===player!.id&&s.troops>=500);
        const tiles=wall?.tiles??[building!.tile],range=Math.min(...shooters.map(s=>this.expansion.unit(s).attack.range));
        if(!shooters.length || members.filter(s=>this.expansion.unit(s).role==="frontline"&&s.troops>=500).length<2 || world.tick-b.since>600){
          this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Breach support lost; protecting survivors";
        } else if(b.tile===undefined){
          const tile=approachCandidate(world.map,tiles[0],range,b.cursor);this.diagnostics.work++;
          if(tile===undefined || forts.blocked(tile,player.id) || !world.paths.walkable(tile) ||
            !structureAim(tilePoint(world.map,tile),tiles,range,player.id,world.map.width(),forts)){b.cursor++;}
          else {
            const route=this.economy.routes.request(plan.id,player.id,b.start,tile);
            if(!route.pending){if(route.path&&this.order(plan,{type:"move",tile})){b.tile=tile;plan.reason="Bringing siege and escort to a legal firing approach";}else b.cursor++;}
          }
          if(b.cursor>=24){this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="No certified protected siege approach";}
        } else {
          const ready=shooters.filter(s=>!s.structureTarget&&structureAim(s,tiles,this.expansion.unit(s).attack.range,player.id,world.map.width(),forts));
          if(ready.length && members.filter(s=>this.expansion.unit(s).role==="frontline").every(s=>world.map.euclideanDistSquared(world.tileOf(s),b.tile!)<=6**2)){
            world.applyCommand({type:"attack-structure",playerId:player.id,squadIds:ready.map(s=>s.id),barrierId:wall?.id,buildingId:building?.id});
            plan.reason="Researched siege firing with a physical escort";
          }
        }
      }
    } else if (plan.phase === "advance" || plan.phase === "engage") {
      if(plan.purpose==="coast" && plan.targetTile!==undefined && world.owners[plan.targetTile]===player.id){
        this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Coastal objective physically captured";
      } else if(army?.state==="blocked"){
        const siege=members.filter(s=>["siege","artillery"].includes(this.expansion.unit(s).role)&&
          this.expansion.progression.has(player!.id,this.expansion.unit(s).technologyId)&&
          this.expansion.unit(s).attack.targets.some(t=>t==="wall"||t==="structure"));
        if(siege.length&&members.filter(s=>this.expansion.unit(s).role==="frontline").length>=2){
          this.order(plan,{type:"hold"});plan.phase="breach";plan.breach={scan:0,start:world.tileOf(army),cursor:0,shooters:siege.map(s=>s.id),since:world.tick};
        } else {this.order(plan,{type:"regroup",tile:plan.home??player.base});plan.phase="recover";plan.since=world.tick;plan.reason="Intact fortification requires researched siege and escort";}
      }

      const enemy = world
        .nearbyArmyEnemies(army ?? members[0], 12 * FIXED, player.id)
        .sort((a, b) => a.id - b.id)
        .find(
          (s) =>
            !operations.enabled(player) ||
            operations.canTarget(player!.id, s.playerId),
        );
      if (
        enemy &&
        plan.phase !== "engage" &&
        plan.phase === "advance"
      ) {
        if(doctrine.engagement.startsWith("flank") && members.some(s=>this.expansion.unit(s).role==="mounted") &&
          members.filter(s=>this.expansion.unit(s).role==="frontline"&&s.troops>=500).length>=2){
          this.order(plan,{type:"hold"});plan.phase="flank";plan.maneuver={enemy:enemy.id,targetTile:world.tileOf(enemy),start:world.tileOf(army!),cursor:0,since:world.tick};
          plan.reason="Certifying a supported flank rather than only offsetting formation slots";
        } else {this.order(plan,{type:doctrine.engagement==="fire-retreat"?"fire-retreat":"attack",targetId:enemy.id});plan.phase="engage";plan.since=world.tick;}
      } else if (!enemy && plan.purpose !== "coast" && target) {
        const remaining = conquestBuildings(world.buildingFacts().byOwner(target.id), target.ai)
          .filter(b => operations.canEnter(player.id, target.id, b.tile))
          .sort((a,b) => world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),a.tile) -
            world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),b.tile) || a.id-b.id);
        const lastSquad = !remaining.length && operations.finishing(player.id,target.id)
          ? world.squads.filter(s => s.playerId === target.id && s.troops > 0 && s.embarkedOn === null &&
            operations.canEnter(player.id,target.id,world.tileOf(s)))
            .sort((a,b) => world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),world.tileOf(a)) -
              world.map.euclideanDistSquared(world.tileOf(army ?? members[0]),world.tileOf(b)) || a.id-b.id)[0]
          : undefined;
        const objective = remaining[0] ?? (lastSquad ? {tile:world.tileOf(lastSquad)} : undefined);
        if (objective && (plan.targetTile !== objective.tile || members.every(s => s.order.type === "hold"))) {
          if (this.order(plan, {type:"move",tile:objective.tile})) {
            plan.targetTile = objective.tile; plan.phase = "advance"; plan.reason = "Securing remaining cities and ground squads";
          }
        }
      }
      if (
        (plan.phase === "advance" || plan.phase === "engage") &&
        world.tick - plan.since >= doctrine.commitmentTicks &&
        !operations.finishing(player.id, plan.target ?? 0) &&
        this.order(plan, { type: "regroup", tile: plan.home ?? player.base })
      ) {
        plan.phase = "recover";
        plan.since = world.tick;
      }
    } else if (
      plan.phase === "recover" &&
      (members.every(
        (s) =>
          world.map.euclideanDistSquared(
            world.tileOf(s),
            plan!.home ?? player!.base,
          ) <
          12 ** 2,
      ) ||
        world.tick - plan.since >= 800)
    ) {
      this.economy.assets.release(plan.id);
      world.applyCommand({
        type: "disband-army",
        playerId: player.id,
        armyId: army!.id,
      });
      const wounded=members.filter(s=>world.owners[world.tileOf(s)]===player!.id && s.troops<900 && !s.fighting);
      if(wounded.length && player.reserves>0 && !(plan.rejoined??0)){
        this.economy.assets.acquire(members.map(s=>({asset:`squad:${s.id}` as const,playerId:player!.id,generation:plan!.generation,controller:plan!.id,
          priority:"recovery" as const,createdTick:world.tick,expiresTick:world.tick+1000})));
        world.applyCommand({type:"order",playerId:player.id,squadIds:wounded.map(s=>s.id),order:{type:"replenish"}});
        plan.phase="replenish";plan.since=world.tick;plan.reason="Replenishing survivors using actual reserves";
      } else {plan.phase="complete";plan.nextThink=world.tick+400;plan.reason="Survivors returned and objective leases released";this.diagnostics.completed++;}
    } else if(plan.phase==="replenish" || plan.phase==="refit"){
      if(members.some(s=>s.refit) || (members.some(s=>s.troops<900)&&player.reserves>0&&world.tick-plan.since<600)){
        plan.nextThink=world.tick+40;return this.diagnostics.work;
      }
      const replacement=members.find(s=>!s.refit&&!s.fighting&&world.owners[world.tileOf(s)]===player!.id &&
        UNITS.some(u=>u.line===this.expansion.unit(s).line&&u.role===this.expansion.unit(s).role&&
          AGES.indexOf(u.age)>AGES.indexOf(this.expansion.unit(s).age)&&this.expansion.progression.has(player!.id,u.technologyId)));
      if(plan.phase==="replenish"&&replacement){
        const unit=[...UNITS].reverse().find(u=>u.line===this.expansion.unit(replacement).line&&u.role===this.expansion.unit(replacement).role&&
          AGES.indexOf(u.age)>AGES.indexOf(this.expansion.unit(replacement).age)&&this.expansion.progression.has(player!.id,u.technologyId))!;
        const stock=this.economy.ledger.spendable(player.id,{gold:player.gold,reserves:player.reserves,items:this.expansion.supply.inventories[player.id]},plan.id,"growth");
        if(affordableAiCost(stock,unitRefitCost(unit,1))&&!world.applyCommand({type:"refit",playerId:player.id,squadIds:[replacement.id],definitionId:unit.id})){
          plan.phase="refit";plan.since=world.tick;plan.reason="Paid compatible survivor refit";return this.diagnostics.work;
        }
      }
      if(plan.purpose!=="coast"&&target&&!target.eliminated&&world.hostile(player.id,target.id)&&
        (!operations.enabled(player)||operations.canTarget(player.id,target.id))&&world.tick<plan.deadline&&
        members.length>=2&&members.every(s=>s.troops>=800)){
        world.applyCommand({type:"order",playerId:player.id,squadIds:members.map(s=>s.id),order:{type:"hold"}});
        const rejection=world.applyCommand({type:"create-army",playerId:player.id,squadIds:members.map(s=>s.id)});
        if(!rejection){this.economy.assets.acquire(members.map(s=>({asset:`squad:${s.id}` as const,playerId:player!.id,generation:plan!.generation,controller:plan!.id,priority:"operation" as const,createdTick:world.tick,expiresTick:plan!.deadline+800})));plan.armyId=armies.armyOf(members[0].id)!.id;plan.phase="assemble";plan.since=world.tick;plan.initialTroops=troops;plan.rejoined=1;plan.reason="Recovered supported roster rejoining once";
          world.applyCommand({type:"army-auto",playerId:player.id,armyId:plan.armyId,enabled:false});return this.diagnostics.work;}
      }
      this.economy.assets.release(plan.id);plan.phase="complete";plan.nextThink=world.tick+400;plan.reason="Paid recovery finished; objective closed";this.diagnostics.completed++;
    }
    if (plan.phase !== "complete") plan.nextThink = world.tick + 40;
    return this.diagnostics.work;
  }
}
