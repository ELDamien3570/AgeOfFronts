import { portWaterTiles } from "../PortWaterAccess";
import { coastalPatrol } from "./CoastalPatrol";
import { stepBombardment, type Bombardment } from "./AiNavalBombardment";
import { AI_DOCTRINES } from "../content/AiDoctrines";
import { shipCap } from "../FactionRules";
import { MAX_SHIPS } from "../Rules";
import { FIXED, type Player, type Ship } from "../Protocol";
import { personalityOf } from "../content/AiPersonalities";
import { VESSEL, VESSELS } from "../content/Units";
import { affordableAiCost } from "./AiBudgetLedger";
import type { AiEconomicDirector } from "./AiEconomicDirector";
import { AGES, type VesselDefinition } from "./Definitions";
import type { Expansion } from "./Expansion";
import { vesselEffects } from "./ResearchEffects";

export type FleetState =
  | "assess"
  | "fund"
  | "assemble"
  | "stage"
  | "execute"
  | "recover"
  | "complete"
  | "abort";
interface TheaterAssessment {
 playerId:number;generation:number;phase:"ports"|"buildings"|"ships"|"jobs";cursor?:number|null;index:number;
 seas:{sea:number;port:number;anchor:number;ownedValue:number;enemyPower:number;fleetPower:number;futurePower:number;cargoValue:number;score:number}[];
}
interface Assessment {
  phase: "buildings" | "ships" | "jobs";
  cursor?: number | null;
  port?: number;
  portDistance: number;
  anchor?: number;
  members: number[];
  enemyPower: number;
  localEnemyPower?: number;
  target?: number;
  targetDistance: number;
  futurePower: number;
  recoveringPower?: number;
}
interface PatrolGroup {members:number[];anchor:number;route:number[];leg:number;goal?:number;}
export interface AiFleetMission {
  id: string;
  playerId: number;
  generation: number;
  objective: "defend-port" | "bombard-coast" | "raid-trade";
  bombard?: Bombardment;
  sea: number;
  state: FleetState;
  reason: string;
  createdTick: number;
  deadline: number;
  nextAssessment: number;
  port?: number;
  anchor?: number;
  target?: number;
  patrolGoal?: number;
  patrolLeg?: number;
  patrolRoute?: number[];
  patrolAnchor?: number;
  patrolGroups?:PatrolGroup[];
  patrolSectors?:string;
  members: number[];
  recovering?: number[];
  purchases: number;
  assessment?: Assessment;
  phaseSince?:number;lostPower?:number;trackedPower?:Map<number,number>;recorded?:boolean;
}
/** Integer rate proxy based on authored, researched attack and current health.
 * It is a planning comparison, never an alternative combat damage rule. */
export function navalPower(vessel: VesselDefinition, health: number): number {
  const attack = vessel.attack;
  if (!attack?.targets.includes("ship") || health <= 0) return 0;
  const fraction = Math.min(1000, Math.floor((health * 1000) / vessel.health));
  const range = Math.max(FIXED, attack.range);
  return Math.floor(
    (attack.damage * fraction * Math.min(range, 16 * FIXED)) /
      (Math.max(1, attack.reloadTicks) * FIXED),
  );
}
export function navalReady(ship: Ship, vessel: VesselDefinition): boolean {
  return (
    ship.kind === "warship" &&
    ship.health * 5 >= vessel.health * 3 &&
    !ship.refit &&
    (!ship.repairState || ["idle", "patrolling"].includes(ship.repairState))
  );
}
/** Persistent port-defense/concentration missions. Fact enumeration is resumed
 * one record per charged unit. Domain handlers retain payment and movement.
 * Landing, escort and coastal bombardment are separate subsequent objectives. */
export class AiNavalPlanner {
  readonly missions = new Map<number, AiFleetMission>();
  private readonly lanes = new Map<number, number>();
  private refreshLanes(m:AiFleetMission):void {
    m.members.forEach((id,i)=>this.lanes.set(id,i%4));
    // Retained patrol groups own their formation lanes even while the ready
    // roster changes during interception. Rebuild and restore use one rule.
    for(const group of m.patrolGroups??[])group.members.forEach((id,i)=>this.lanes.set(id,i%4));
  }
  fleetLane(ship: Ship): number | undefined {
    const m=this.missions.get(ship.playerId);
    return m && this.economy.assets.owns(`ship:${ship.id}`,m.id) ? this.lanes.get(ship.id) : undefined;
  }
  private readonly funding = new Map<
    string,
    {
      purchases: number;
      vesselPower: number;
      enemyPower: number;
      gold: number;
      windowStart?: number;
      windowSpent?: number;
      investmentCredit?: number;
      creditTick?: number;
      lossPauseUntil?: number;
      quietSince?: number;
      lostPower?:number;
    }
  >();
  private readonly theaters=new Map<number,TheaterAssessment>();
  private readonly history:{id:string;playerId:number;sea:number;tick:number;state:FleetState;reason:string;purchases:number;lostPower:number}[]=[];
  private chooseTheater(player:Player,budget:number):{work:number;sea?:number;pending:boolean}{
    const {world}=this.expansion;let scan=this.theaters.get(player.id);
    if(!scan || scan.generation!==world.aiGeneration(player.id)){scan={playerId:player.id,generation:world.aiGeneration(player.id),phase:"ports",index:0,seas:[]};this.theaters.set(player.id,scan);}
    let work=0;
    while(work<budget){
      work++;
      const read=scan.phase==="ports"?this.economy.navalFacts.readOwnedBuilding(player.id,scan.cursor):this.economy.navalFacts.readSea(scan.phase,scan.seas[scan.index].sea,scan.cursor);
      if(read.invalid){this.theaters.delete(player.id);return {work,pending:true};}
      scan.cursor=read.next;
      if(read.value && scan.phase==="ports" && "type" in read.value){
        const b=read.value,sea=this.portSea(b.tile),anchor=portWaterTiles(world.map, b.tile).find(t=>world.waterPaths.walkable(t));
        if(b.type==="port" && !b.remainingTicks && (b.health??1)>0 && world.owners[b.tile]===player.id && sea && anchor!==undefined){
          const existing=scan.seas.find(s=>s.sea===sea);
          if(existing){existing.ownedValue+=1000;if(b.id<existing.port){existing.port=b.id;existing.anchor=anchor;}}
          else if(scan.seas.length<8)scan.seas.push({sea,port:b.id,anchor,ownedValue:1000,enemyPower:0,fleetPower:0,futurePower:0,cargoValue:0,score:0});
        }
      }else if(read.value && "type" in read.value && scan.phase==="buildings"){
        const b=read.value,theater=scan.seas[scan.index];
        if(!b.remainingTicks&&(b.health??1)>0){if(b.playerId===player.id)theater.ownedValue+=Math.min(1000,(this.expansion.supply.goods.get(b.id)??0)*10)+(b.type==="port"?300:100);else if(world.hostile(player.id,b.playerId))theater.ownedValue+=Math.min(500,(this.expansion.supply.goods.get(b.id)??0)*5)+100;}
      }else if(read.value && "destination" in read.value){
        const s=read.value,theater=scan.seas[scan.index],power=navalPower(this.expansion.vessel(s),s.health);
        if(s.playerId===player.id){if(navalReady(s,this.expansion.vessel(s)))theater.fleetPower+=power;}
        else if(world.hostile(player.id,s.playerId))theater.enemyPower+=power;
      }else if(read.value && "category" in read.value && read.value.playerId===player.id){
        const definition=VESSEL.get(read.value.definitionId??"");if(definition)scan.seas[scan.index].futurePower+=navalPower(vesselEffects(definition,this.expansion.progression.states[player.id].completed),definition.health);
      }
      if(read.next===null){
        scan.cursor=undefined;
        if(scan.phase==="ports"){if(!scan.seas.length){this.theaters.delete(player.id);return {work,pending:false};}scan.phase="buildings";}
        else if(scan.phase==="buildings")scan.phase="ships";
        else if(scan.phase==="ships")scan.phase="jobs";
        else{
          const theater=scan.seas[scan.index],evidence=this.funding.get(`${player.id}:${theater.sea}`);
          theater.score=theater.ownedValue+theater.cargoValue+(this.economy.tradeQuotes.best(player.id,true)?.sea===theater.sea ? Math.min(5000,this.economy.tradeQuotes.best(player.id,true)!.quote.riskAdjustedGoldPer1000Ticks) : 0)+Math.min(10000,theater.enemyPower)*AI_DOCTRINES[personalityOf(player).id].navalWeight/100+Math.min(3000,theater.fleetPower+theater.futurePower)-Math.min(5000,evidence?.lostPower??0);
          if(++scan.index<scan.seas.length)scan.phase="buildings";
          else{const best=scan.seas.sort((a,b)=>b.score-a.score||a.sea-b.sea)[0];this.theaters.delete(player.id);return {work,sea:best.sea,pending:false};}
        }
      }
    }
    return {work,pending:true};
  }
  private observeLosses(m:AiFleetMission):void {
    const {world}=this.expansion,key=`${m.playerId}:${m.sea}`,tracked=m.trackedPower??=new Map();
    for(const [id,power] of tracked){
      const ship=world.ship(id);
      if(!ship || ship.playerId!==m.playerId || ship.health<=0){
        const record=this.funding.get(key)??{purchases:0,vesselPower:0,enemyPower:0,gold:0,lostPower:0};
        record.lostPower=(record.lostPower??0)+power;this.funding.set(key,record);m.lostPower=(m.lostPower??0)+power;tracked.delete(id);
      }
    }
    for(const id of [...m.members,...(m.recovering??[])]){const ship=world.ship(id);if(ship && !tracked.has(id))tracked.set(id,navalPower(this.expansion.vessel(ship),ship.health));}
  }
  private cursor = 0;
  private serial = 0;
  readonly diagnostics = { work: 0, transitions: 0, commands: 0, rejected: 0 };
  constructor(
    private readonly expansion: Expansion,
    private readonly economy: AiEconomicDirector,
  ) {}
  enabled(player: Player): boolean {
    return (
      (this.economy.enabled(player) || (player.ai && player.kind === "tribe" && !player.eliminated &&
        this.expansion.world.options?.aiEconomy === true)) &&
      this.expansion.world.options?.aiNaval === true &&
      this.expansion.world.options.deferredPlanning === true
    );
  }
  checkpoint() {
    return structuredClone({
      missions: [...this.missions],
      funding: [...this.funding],theaters:[...this.theaters],history:this.history,
      cursor: this.cursor,
      serial: this.serial,
    });
  }
  restore(saved?: ReturnType<AiNavalPlanner["checkpoint"]>): void {
    saved ??= {missions:[],funding:[],theaters:[],history:[],cursor:0,serial:0};
    this.missions.clear();
    this.lanes.clear();
    for (const [id, mission] of structuredClone(saved.missions))
      this.missions.set(id, mission);
    for(const mission of this.missions.values())this.refreshLanes(mission);
    this.funding.clear();
    for (const [key, evidence] of structuredClone(saved.funding ?? []))
      this.funding.set(key, evidence);
    this.theaters.clear();for(const [id,scan] of structuredClone(saved.theaters??[]))this.theaters.set(id,scan);
    this.history.length=0;this.history.push(...structuredClone(saved.history??[]));
    this.cursor = saved.cursor;
    this.serial = saved.serial;
  }
  release(playerId: number): void {
    const mission = this.missions.get(playerId);
    if (mission) {
      this.economy.routes.release(mission.id);
      this.economy.assets.release(mission.id);
      this.economy.ledger.release(mission.id);
    }
    this.missions.delete(playerId);this.theaters.delete(playerId);
  }
  private transition(
    m: AiFleetMission,
    state: FleetState,
    reason: string,
  ): void {
    if (m.state !== state || m.reason !== reason)
      this.diagnostics.transitions++;
    if(m.state!==state)m.phaseSince=this.expansion.world.tick;
    m.state = state;
    m.reason = reason;
    if (state !== "fund") this.economy.ledger.release(m.id);
    if (state === "complete" || state === "abort") {
      this.economy.routes.release(m.id);
      this.observeLosses(m);
      if(!m.recorded){this.history.push({id:m.id,playerId:m.playerId,sea:m.sea,tick:this.expansion.world.tick,state,reason,purchases:m.purchases,lostPower:m.lostPower??0});while(this.history.length>128)this.history.shift();m.recorded=true;}
      const { world } = this.expansion;
      const owned = [...m.members, ...(m.recovering ?? [])].filter((id) => {
        const ship = world.ship(id);
        return (
          ship &&
          navalReady(ship, this.expansion.vessel(ship)) &&
          this.economy.assets.owns(`ship:${id}`, m.id)
        );
      });
      // Fence any still-pending replacement voyage before relinquishing its
      // controller. Recovery tasks retain their normal movement ownership.
      if (owned.length)
        world.applyCommand({
          type: "stop-ships",
          playerId: m.playerId,
          shipIds: owned,
        });
      this.economy.assets.release(m.id);
      for(const id of m.members)this.lanes.delete(id);
      this.economy.ledger.release(m.id);
      m.assessment = undefined;
      m.nextAssessment = this.expansion.world.tick + 400;
    }
  }
  step(budget = 32): number {
    const { world } = this.expansion;
    this.diagnostics.work = 0;
    if (!this.economy.navalFacts.ready || !world.players.length || budget <= 0)
      return 0;
    // One faction per tick; entity work inside it shares one fixed allowance.
    let player: Player | undefined;
    for (let n = 0; n < world.players.length; n++) {
      const candidate = world.players[this.cursor++ % world.players.length];
      if (this.enabled(candidate)) {
        player = candidate;
        break;
      }
    }
    if (!player) return 0;
    let initialWork=0;
    let m = this.missions.get(player.id);
    if (m && m.generation !== world.aiGeneration(player.id)) {
      this.release(player.id);
      m = undefined;
    }
    if (m && ["abort", "complete"].includes(m.state)) {
      if (world.tick < m.nextAssessment) return 0;
      this.release(player.id);
      m = undefined;
    }
    if (!m) {
      const theater=this.chooseTheater(player,budget);
      this.diagnostics.work=theater.work;
      if(theater.pending || !theater.sea)return theater.work;
      const sea=theater.sea;
      initialWork=theater.work;budget-=theater.work;
      m = {
        id: `fleet:${player.id}:${++this.serial}`,
        playerId: player.id,
        generation: world.aiGeneration(player.id),
        objective: "defend-port",
        sea,
        state: "assess",
        reason: "selecting an owned gathering port",
        createdTick: world.tick,
        deadline: world.tick + 2400,
        nextAssessment: world.tick,
        assessment:{phase:"buildings",portDistance:Infinity,members:[],enemyPower:0,targetDistance:Infinity,futurePower:0},
        members: [],
        recovering: [],
        purchases: 0,
      };
      this.missions.set(player.id, m);
      if(budget<=0)return initialWork;
    }
    this.observeLosses(m);
    if (world.tick >= m.deadline) {
      this.transition(m, "abort", "mission deadline expired");
      return 0;
    }
    const livePort = m.port === undefined ? undefined : world.building(m.port);
    if (
      m.port !== undefined &&
      (!livePort ||
        livePort.playerId !== player.id ||
        world.owners[livePort.tile] !== player.id ||
        (livePort.health ?? 1) <= 0)
    ) {
      const alternative=[...this.economy.navalFacts.ports(player.id,m.sea)].find(port=>port.id!==m!.port);
      if(alternative){m.port=alternative.id;m.anchor=portWaterTiles(world.map, alternative.tile).find(t=>world.waterPaths.walkable(t));m.assessment=undefined;m.nextAssessment=world.tick;this.transition(m,"recover","Gathering port lost; using a same-sea recovery port");}
      else {this.transition(m,"abort","No legal same-sea recovery port");return 0;}
    }
    if(m.bombard){
      const result=stepBombardment(player,m,this.expansion,this.economy,budget);
      if(result.terminal==="recover"){
        const roster=[...new Set([...m.members,...(m.recovering??[])])].map(id=>world.ship(id)).filter((s):s is Ship=>!!s&&s.playerId===player!.id&&s.health>0);
        m.members=roster.filter(s=>navalReady(s,this.expansion.vessel(s))).map(s=>s.id);
        m.recovering=roster.filter(s=>this.recovering(s,m!.sea)).map(s=>s.id);
        m.assessment=undefined;m.nextAssessment=world.tick;
      }
      if(result.terminal)this.transition(m,result.terminal,result.reason!);
      this.diagnostics.work=initialWork+result.work;return initialWork+result.work;
    }
    if (!m.assessment && world.tick < m.nextAssessment) return 0;
    m.assessment ??= {
      phase: "buildings",
      portDistance: Infinity,
      members: [],
      enemyPower: 0,
      targetDistance: Infinity,
      futurePower: 0,
    };
    const a = m.assessment;
    let used = 0;
    while (used < budget && m.assessment) {
      used++;
      const read =
        a.phase === "buildings"
          ? this.economy.navalFacts.readOwnedBuilding(player.id, a.cursor)
          : this.economy.navalFacts.readSea(a.phase, m.sea, a.cursor);
      a.cursor = read.next;
      if (read.invalid) {
        m.assessment = undefined;
        m.nextAssessment = world.tick;
        this.transition(m, "assess", "fact cursor invalidated");
        break;
      }
      const value = read.value;
      if (value) {
        if ("type" in value && a.phase === "buildings") {
          if (
            value.type === "port" && this.portSea(value.tile)===m.sea &&
            (m.port === undefined || value.id === m.port) &&
            value.playerId === player.id &&
            world.owners[value.tile] === player.id &&
            !value.remainingTicks &&
            (value.health ?? 1) > 0
          ) {
            const distance = world.map.euclideanDistSquared(
              value.tile,
              player.base,
            );
            if (
              distance < a.portDistance ||
              (distance === a.portDistance && value.id < (a.port ?? Infinity))
            ) {
              const anchor = portWaterTiles(world.map, value.tile)
                .find((t) => world.waterPaths.walkable(t));
              if (
                anchor !== undefined &&
                world.waterPaths.component[anchor] > 0
              ) {
                a.port = value.id;
                a.anchor = anchor;
                a.portDistance = distance;
              }
            }
          }
        } else if (
          "destination" in value &&
          a.phase === "ships" &&
          a.anchor !== undefined
        ) {
          const ship = value,
            definition = this.expansion.vessel(ship);
          if (
            ship.playerId === player.id &&
            navalReady(ship, definition) &&
            (!this.economy.assets.held(`ship:${ship.id}`) ||
              this.economy.assets.owns(`ship:${ship.id}`, m.id))
          ) {
            a.members.push(ship.id);
            // A bounded strongest fleet; unrelated ships remain available.
            a.members.sort((x, y) => {
              const sx = world.ship(x),
                sy = world.ship(y);
              return (
                (sy ? navalPower(this.expansion.vessel(sy), sy.health) : 0) -
                  (sx ? navalPower(this.expansion.vessel(sx), sx.health) : 0) ||
                x - y
              );
            });
            a.members.length = Math.min(MAX_SHIPS, a.members.length);
          } else if (
            ship.playerId === player.id &&
            this.recovering(ship, m.sea)
          ) {
            a.recoveringPower =
              (a.recoveringPower ?? 0) +
              navalPower(definition, definition.health);
          } else if (
            ship.health > 0 &&
            this.expansion.diplomacy.hostile(player.id, ship.playerId)
          ) {
            let distance = world.map.euclideanDistSquared(
              world.tileOf(ship),
              a.anchor,
            );
            for(const group of m.patrolGroups ?? []) {
              const leader=world.ship(group.members[0]);
              if(leader)distance=Math.min(distance,world.map.euclideanDistSquared(world.tileOf(ship),world.tileOf(leader)));
            }
            {
              if (distance <= 32 ** 2) this.expansion.operations.threatened(player.id, ship.playerId, a.anchor);
              a.enemyPower += navalPower(definition, ship.health);
              if(distance <= 32 ** 2 || (m.state === "execute" && m.target === ship.id))
                a.localEnemyPower=(a.localEnemyPower ?? 0)+navalPower(definition,ship.health);
              if (
                (distance <= 32 ** 2 || (m.state === "execute" && m.target === ship.id)) && (distance < a.targetDistance ||
                (distance === a.targetDistance &&
                  ship.id < (a.target ?? Infinity)))
              ) {
                a.target = ship.id;
                a.targetDistance = distance;
              }
            }
          }
        } else if (
          "category" in value &&
          a.phase === "jobs" &&
          value.playerId === player.id
        ) {
          const definition = VESSEL.get(value.definitionId ?? ""),
            port = world.building(value.buildingId);
          if (
            definition?.kind === "warship" &&
            port?.playerId === player.id &&
            world.owners[port.tile] === player.id &&
            (port.health ?? 1) > 0
          ) {
            const effective = vesselEffects(
              definition,
              this.expansion.progression.states[player.id].completed,
            );
            a.futurePower += navalPower(effective, effective.health);
          }
        }
      }
      if (read.next === null) {
        if (a.phase === "buildings") {
          if (a.port === undefined) {
            this.transition(m, "abort", "no usable port in this sea");
            break;
          }
          a.phase = "ships";
          m.sea = world.waterPaths.component[a.anchor!];
          a.cursor = undefined;
        } else if (a.phase === "ships") {
          a.phase = "jobs";
          a.cursor = undefined;
        } else {
          this.applyAssessment(player, m, a);
          m.assessment = undefined;
          m.nextAssessment = world.tick + 100;
        }
      }
    }
    this.diagnostics.work = initialWork+used;
    return initialWork+used;
  }
  private applyAssessment(
    player: Player,
    m: AiFleetMission,
    a: Assessment,
  ): void {
    const { world } = this.expansion;
    m.port = a.port;
    m.anchor = a.anchor;
    m.target = a.target;
    const port = world.building(a.port!);
    if (
      !port ||
      port.type !== "port" ||
      port.remainingTicks > 0 ||
      port.playerId !== player.id ||
      world.owners[port.tile] !== player.id ||
      (port.health ?? 1) <= 0 ||
      this.portSea(port.tile) !== m.sea ||
      a.anchor === undefined ||
      world.waterPaths.component[a.anchor] !== m.sea
    ) {
      this.transition(
        m,
        "abort",
        "gathering port invalidated during assessment",
      );
      return;
    }
    const ships = a.members
      .map((id) => world.ship(id))
      .filter(
        (s): s is Ship =>
          !!s &&
          s.playerId === player.id &&
          world.waterPaths.component[world.tileOf(s)] === m.sea &&
          navalReady(s, this.expansion.vessel(s)),
      );
    const readyPower = ships.reduce(
      (power, s) => power + navalPower(this.expansion.vessel(s), s.health),
      0,
    );
    const target = a.target === undefined ? undefined : world.ship(a.target);
    // Live hostility/sea checks fence an assessment spanning several ticks.
    if (
      a.target !== undefined &&
      (!target ||
        target.health <= 0 ||
        !this.expansion.diplomacy.hostile(player.id, target.playerId) ||
        world.waterPaths.component[world.tileOf(target)] !== m.sea)
    ) {
      this.transition(m, "assess", "target legality changed");
      // Losing an interception target does not require a healthy fleet to dock.
      // Keep its admitted voyage until the next live assessment resumes patrol.
      return;
    }
    const required = Math.ceil(
      (a.enemyPower * (personalityOf(player).id === "admiral" ? 115 : 130)) /
        100,
    );
    const enough = readyPower > 0 && readyPower >= required;
    const canIntercept = readyPower > 0 && readyPower >= Math.ceil((a.localEnemyPower ?? a.enemyPower)*1.3);
    const evidence = this.funding.get(`${player.id}:${m.sea}`);
    if (evidence) {
      if (!a.enemyPower) {
        evidence.quietSince ??= world.tick;
        // Quiet water does not erase casualty or purchase evidence across mission IDs.
      } else evidence.quietSince = undefined;
    }
    if(m.state==="recover"){
      const age=world.tick-(m.phaseSince??m.createdTick);
      const survivors=[...new Set([...m.members,...(m.recovering??[])])].map(id=>world.ship(id)).filter((s):s is Ship=>!!s&&s.playerId===player.id&&s.health>0);
      const repairPending=survivors.some(s=>this.recovering(s,m.sea));
      if(!a.enemyPower && !repairPending && age>=400){this.transition(m,"complete","Fleet recovered and port threat cleared");return;}
      if(age>=800 && !enough){this.transition(m,"abort","Recovery deadline reached; paid repairs remain physical tasks");return;}
      if(!enough || repairPending || age<200){if(ships.length)this.sail(m,ships,a.anchor);m.reason=repairPending?"Waiting for paid repair subtasks":"Consolidating surviving fleet power";return;}
      this.transition(m,"stage","Recovered fleet can safely rejoin its intended sea");
    }
    const future = a.futurePower + (a.recoveringPower ?? 0);
    if (!enough && readyPower + future < Math.max(1, required))
      this.fund(
        player,
        m,
        port.id,
        required,
        readyPower + future,
        a.enemyPower,
      );
    else if (!enough)
      this.transition(
        m,
        "assemble",
        "paid ships are still training or recovering",
      );
    if (!ships.length) return;
    const recovering = [...new Set([...m.members, ...(m.recovering ?? [])])]
      .map((id) => world.ship(id))
      .filter(
        (s): s is Ship =>
          !!s &&
          s.playerId === player.id &&
          this.recovering(s, m.sea) &&
          this.economy.assets.owns(`ship:${s.id}`, m.id),
      )
      .slice(0, 8);
    const roster = [...ships, ...recovering];
    const requests = roster.map((s) => ({
      asset: `ship:${s.id}` as const,
      playerId: player.id,
      generation: m.generation,
      controller: m.id,
      priority: recovering.some((ship) => ship.id === s.id)
        ? ("recovery" as const)
        : ("operation" as const),
      createdTick: m.createdTick,
      expiresTick: m.deadline,
    }));
    if (!this.economy.assets.acquire(requests)) {
      this.transition(m, "assess", "fleet movement ownership changed");
      return;
    }
    const selected = new Set(roster.map((s) => `ship:${s.id}` as const));
    const dropped = [...m.members, ...(m.recovering ?? [])].filter(
      (id) =>
        !selected.has(`ship:${id}`) &&
        this.economy.assets.owns(`ship:${id}`, m.id) &&
        world.ship(id)?.playerId === player.id &&
        navalReady(world.ship(id)!, this.expansion.vessel(world.ship(id)!)),
    );
    if (dropped.length)
      world.applyCommand({
        type: "stop-ships",
        playerId: player.id,
        shipIds: dropped,
      });
    this.economy.assets.retain(m.id, selected);
    for(const id of m.members)this.lanes.delete(id);
    m.members = ships.map((s) => s.id);
    this.refreshLanes(m);
    m.recovering = recovering.map((s) => s.id);
    if(enough && !target && ships.length && !recovering.length) {
      const raids: import("./Definitions").TradeActor[] = [];
      this.expansion.trade.raidTargets(ships[0].x,ships[0].y,48*FIXED,player.id,raids);
      const victim = raids.filter(t=>world.waterPaths.component[world.tileOf(t)]===m.sea)
        .sort((a,b)=>b.cargo*b.valuePerGood-a.cargo*a.valuePerGood || a.id-b.id)[0];
      if(victim) {
        if(!this.expansion.operations.canTarget(player.id,victim.playerId))
          world.applyCommand({type:"alliance",playerId:player.id,otherId:victim.playerId,action:"declare"});
        m.objective="raid-trade";m.reason="Sea control established; intercepting valuable foreign trade";
        this.sail(m,ships,world.tileOf(victim));return;
      }
    }
    if(!a.enemyPower && world.tick-m.createdTick>=300 && !recovering.length && ships.length>=2 && ships.some(s=>this.expansion.vessel(s).attack?.targets.includes("structure")) &&
      (!this.expansion.operations.enabled(player)||this.expansion.operations.offensiveTarget(player.id)!==undefined)){
      m.bombard={phase:"targets",scanned:0,candidate:0,start:world.tileOf(ships[0]),since:world.tick};
      m.reason="Selecting an actual legal coastal bombardment target";return;
    }
    const gathered = ships.every(
      (s) =>
        world.map.euclideanDistSquared(world.tileOf(s), world.tileOf(ships[0])) <= 12 ** 2,
    );
    if(target && canIntercept && m.patrolGroups?.length) {
      if (!this.expansion.operations.canTarget(player.id,target.playerId))
        world.applyCommand({type:"alliance",playerId:player.id,otherId:target.playerId,action:"declare"});
      const groups=m.patrolGroups.map(group=>({group,ships:group.members.map(id=>world.ship(id)).filter((s):s is Ship=>!!s && ships.some(ready=>ready.id===s.id))}))
        .filter(group=>group.ships.length)
        .sort((a,b)=>world.map.euclideanDistSquared(world.tileOf(a.ships[0]),world.tileOf(target))-
          world.map.euclideanDistSquared(world.tileOf(b.ships[0]),world.tileOf(target)) || a.ships[0].id-b.ships[0].id);
      const intercept:Ship[]=[];let power=0;
      const needed=Math.ceil((a.localEnemyPower ?? a.enemyPower)*1.3);
      for(const group of groups){intercept.push(...group.ships);power+=group.ships.reduce((n,s)=>n+navalPower(this.expansion.vessel(s),s.health),0);if(power>=needed)break;}
      this.transition(m,"execute","Nearby navies intercept; other coastal sectors retain coverage");
      this.sail(m,intercept,world.tileOf(target));
      const engaged=new Set(intercept.map(s=>s.id));
      this.patrol(m,ships.filter(s=>!engaged.has(s.id)),a.anchor!);
      return;
    }
    if (
      canIntercept &&
      target &&
      // Assembly is a launch requirement. Path lengths and local interception
      // naturally spread an outbound fleet; they must not send it back to port.
      (gathered || m.state === "execute")
    ) {
      if (!this.expansion.operations.canTarget(player.id,target.playerId))
        world.applyCommand({type:"alliance",playerId:player.id,otherId:target.playerId,action:"declare"});
      this.transition(
        m,
        "execute",
        "concentrated fleet intercepting a port threat",
      );
      this.sail(m, ships, world.tileOf(target));
    } else {
      if (!target)
        this.transition(m, "stage", "patrolling friendly coastal waters");
      else if (enough)
        this.transition(m, "stage", "concentrating before interception");
      let goal=a.anchor!;
      if(target && canIntercept) goal=world.tileOf(ships[0]);
      if (!target && ships.length) {
        this.patrol(m,ships,a.anchor!);return;
      }
      this.sail(m, ships, goal);
    }
  }
  private patrol(m:AiFleetMission,ships:Ship[],anchor:number):void {
    if(!ships.length)return;
    const {world}=this.expansion;
    // Membership uses the complete roster so temporary interceptions do not
    // repartition the navies or reset the other sectors' patrol progress.
    const roster=[...m.members].sort((a,b)=>a-b),anchors=this.economy.placements.navalAnchors(m.playerId,m.sea);
    if(!anchors.length)anchors.push(anchor);
    const sectorKey=anchors.join(","),count=Math.ceil(roster.length/8);
    if(m.patrolSectors!==sectorKey || !m.patrolGroups || m.patrolGroups.flatMap(g=>g.members).join(",")!==roster.join(",")) {
      const selected:number[]=[];
      for(let i=0;i<Math.min(count,anchors.length);i++) {
        const remaining=anchors.filter(t=>!selected.includes(t));
        remaining.sort((a,b)=>selected.length ?
          Math.min(...selected.map(t=>world.map.euclideanDistSquared(b,t)))-Math.min(...selected.map(t=>world.map.euclideanDistSquared(a,t))) || a-b :
          world.map.euclideanDistSquared(a,anchor)-world.map.euclideanDistSquared(b,anchor) || a-b);
        selected.push(remaining[0]);
      }
      const previous=m.patrolGroups ?? [];
      m.patrolGroups=Array.from({length:count},(_,i)=>{
        const members=roster.slice(i*8,i*8+8),station=selected[i%selected.length];
        const retained=previous.find(g=>g.anchor===station && g.members.join(",")===members.join(","));
        return retained ?? {members,anchor:station,route:coastalPatrol(world.map,world.waterPaths,world.owners,m.playerId,station),leg:i};
      });
      m.patrolSectors=sectorKey;
    }
    this.refreshLanes(m);
    const available=new Set(ships.map(s=>s.id));
    for(const group of m.patrolGroups) {
      const navy=group.members.filter(id=>available.has(id)).map(id=>world.ship(id)!);
      if(!navy.length)continue;
      if(group.goal===undefined || navy.every(s=>s.destination===null && world.map.euclideanDistSquared(world.tileOf(s),group.goal!)<=6**2)) {
        const route=group.route;
        group.goal=route.length ? route[group.leg%route.length] : group.anchor;
        group.leg=route.length ? (group.leg+1)%route.length : 0;
      }
      m.patrolGoal ??= group.goal;
      this.sail(m,navy,group.goal,true);
    }
    // Retain the first itinerary for older diagnostics and save readers.
    m.patrolRoute=m.patrolGroups[0].route;m.patrolAnchor=m.patrolGroups[0].anchor;
    m.patrolGoal=m.patrolGroups[0].goal;
  }
  allowsLocalPursuit(ship:Ship):boolean {
    const m=this.missions.get(ship.playerId);
    return !!m && (m.state==="execute" || m.objective==="raid-trade" ||
      (m.state==="stage" && m.target===undefined && m.patrolGoal!==undefined)) && m.members.includes(ship.id) &&
      this.economy.assets.owns(`ship:${ship.id}`,m.id);
  }
  private sail(m: AiFleetMission, ships: Ship[], tile: number, patrol=false): void {
    const { world } = this.expansion;
    if((patrol || (m.state === "stage" && m.target === undefined && m.patrolGoal !== undefined)) && ships.length > 4) {
      // Small flotillas share an itinerary but not an arrival cell. Bounded
      // candidate slots require no pairwise repulsion or collision solver.
      const slots: number[]=[];
      for(let radius=0;radius<=6 && slots.length<Math.ceil(ships.length/4);radius+=2)
        for(let dy=-radius;dy<=radius;dy+=2) for(let dx=-radius;dx<=radius;dx+=2) {
          if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
          const x=world.map.x(tile)+dx,y=world.map.y(tile)+dy;
          if(!world.map.isValidCoord(x,y))continue;
          const candidate=world.map.ref(x,y);
          if(world.waterPaths.walkable(candidate) && world.waterPaths.component[candidate]===m.sea &&
            this.expansion.operations.canEnter(m.playerId,world.owners[candidate],candidate)) slots.push(candidate);
        }
      for(let i=0;i<ships.length;i+=4) this.sailGroup(m,ships.slice(i,i+4),slots[Math.floor(i/4)] ?? tile);
      return;
    }
    this.sailGroup(m,ships,tile);
  }
  private sailGroup(m: AiFleetMission, ships: Ship[], tile: number): void {
    const { world } = this.expansion;
    if (
      ships.every(
        (s) =>
          s.destination === tile ||
          (s.destination === null &&
            world.map.euclideanDistSquared(world.tileOf(s), tile) <= 3 ** 2),
      )
    )
      return;
    const rejection = world.applyCommand({
      type: "sail",
      playerId: m.playerId,
      shipIds: ships.map((s) => s.id),
      tile,
    });
    this.diagnostics.commands++;
    if (rejection) {
      this.diagnostics.rejected++;
      this.transition(m, "assess", `sail rejected: ${rejection}`);
    } else if (m.state === "execute" || m.objective === "raid-trade" ||
      (m.state === "stage" && m.target === undefined && m.patrolGoal !== undefined)) {
      for (const ship of ships) world.updateShip(ship.id,{autonomousVoyage:true});
    }
  }
  private portSea(tile: number): number | undefined {
    const { world } = this.expansion;
    const berth = portWaterTiles(world.map, tile)
      .find((t) => world.waterPaths.walkable(t));
    return berth === undefined ? undefined : world.waterPaths.component[berth];
  }
  private recovering(ship: Ship, sea: number): boolean {
    const { world } = this.expansion,
      port =
        ship.repairPortId === undefined || ship.repairPortId === null
          ? undefined
          : world.building(ship.repairPortId);
    return (
      ship.kind === "warship" &&
      ship.health > 0 &&
      !ship.refit &&
      [
        "returning-to-dock",
        "waiting-for-dock",
        "repairing",
        "returning-to-patrol",
      ].includes(ship.repairState ?? "") &&
      world.waterPaths.component[world.tileOf(ship)] === sea &&
      !!port &&
      port.type === "port" &&
      !port.remainingTicks &&
      port.playerId === ship.playerId &&
      world.owners[port.tile] === ship.playerId &&
      (port.health ?? 1) > 0 &&
      this.portSea(port.tile) === sea
    );
  }
  private fund(
    player: Player,
    m: AiFleetMission,
    portId: number,
    required: number,
    future: number,
    enemyPower: number,
  ): void {
    const { world, progression, supply } = this.expansion,
      port = world.building(portId)!;
    const cap = shipCap(player, "warship");
    const committed = world.shipFacts().byOwner(player.id).filter(s => s.kind === "warship").length +
      world.recruitment.byOwner(player.id).filter(j => j.category === "ship" && j.kind === "warship").length;
    if (committed >= cap) return;
    const definition = VESSELS.slice()
      .reverse()
      .find(
        (v) =>
          v.kind === "warship" &&
          progression.has(player.id, v.technologyId) &&
          AGES.indexOf(v.age) <= AGES.indexOf(port.age ?? "StoneAge"),
      );
    if (!definition) {
      this.transition(
        m,
        "fund",
        "no researched vessel for the gathering port tier",
      );
      return;
    }
    const researched = vesselEffects(
        definition,
        progression.states[player.id].completed,
      ),
      power = navalPower(researched, researched.health),
      key = `${player.id}:${m.sea}`;
    if(!this.funding.has(key) && [...this.funding.keys()].filter(k=>k.startsWith(`${player.id}:`)).length>=16){this.transition(m,"recover","Theater evidence envelope reached");return;}
    const evidence = this.funding.get(key) ?? { purchases: 0, vesselPower: power, enemyPower, gold: 0 };
    const spending = evidence as typeof evidence & { windowStart?: number; windowSpent?: number; investmentCredit?: number; creditTick?: number; lossPauseUntil?: number; lostPower?: number };
    if (spending.windowStart === undefined || world.tick-spending.windowStart >= 1200) {
      spending.windowStart=world.tick;spending.windowSpent=0;spending.lostPower=0;
    }
    const costGold=definition.cost.gold ?? 0;
    const tradeRate=(this.economy.tradeQuotes.best(player.id,true)?.quote.riskAdjustedGoldPer1000Ticks ?? 0)/50;
    const income=20+Math.floor(player.land/(40*(world.options?.territoryIncomeScale ?? 1)))+tradeRate;
    const allowance=Math.max(costGold*4,Math.floor(income*60*.35));
    // One initial four-vessel allowance; afterward only 35% of estimated
    // income replenishes credit. A new minute must not repeatedly grant four
    // ships and consume the treasury needed for research and advancement.
    spending.investmentCredit=Math.min(allowance,(spending.investmentCredit ?? costGold*4)+
      Math.max(0,world.tick-(spending.creditTick ?? world.tick))/20*income*.35);
    spending.creditTick=world.tick;this.funding.set(key,spending);
    if ((spending.lossPauseUntil ?? 0)>world.tick || spending.investmentCredit<costGold) {
      this.transition(m,"recover","Protecting existing ships while the naval investment allowance replenishes");return;
    }
    if ((spending.lostPower ?? 0)>power*4) {
      spending.lossPauseUntil=world.tick+400;spending.lostPower=Math.floor((spending.lostPower ?? 0)/2);
      this.funding.set(key,spending);this.transition(m,"recover","Recent naval losses require consolidation before reinvestment");return;
    }
    if (future >= Math.max(power,Math.min(required,cap*power))) return;
    this.funding.set(key,spending);
    const priority = this.expansion.operations.state(player.id)?.threats.some(t=>t.until>=world.tick && world.map.euclideanDistSquared(t.tile,port.tile)<=32**2) ? "emergency" as const : "growth" as const;
    const liquid = {
        gold: player.gold,
        reserves: player.reserves,
        items: supply.inventories[player.id],
      },
      available = this.economy.ledger.spendable(player.id, liquid, m.id, priority),
      cost = definition.cost;
    const amounts = {
      gold: Math.min(available.gold ?? 0, cost.gold ?? 0),
      reserves: Math.min(available.reserves ?? 0, cost.reserves ?? 0),
      items: Object.fromEntries(
        Object.entries(cost.items ?? {}).map(([id, n]) => [
          id,
          Math.min(n, available.items?.[id] ?? 0),
        ]),
      ),
    };
    this.transition(m, "fund", "saving for a same-sea defender");
    if (
      !this.economy.ledger.tryReserve(
        {
          id: m.id,
          claimant: m.id,
          playerId: player.id,
          generation: m.generation,
          priority,
          amounts,
          createdTick: m.createdTick,
          progressTick: world.tick,
          expiresTick: m.deadline,
        },
        liquid,
      ) ||
      !affordableAiCost(available, cost)
    )
      return;
    const producer = world.buildingFacts().byType(player.id,"port").slice(0,64).filter(b=>!b.remainingTicks &&
      (b.health ?? 1)>0 && this.portSea(b.tile)===m.sea && AGES.indexOf(b.age ?? "StoneAge")>=AGES.indexOf(definition.age)).sort((a,b)=>world.recruitment.byProducer(a.id).length-world.recruitment.byProducer(b.id).length || a.id-b.id)[0];
    if (!producer) { this.economy.ledger.release(m.id); return; }
    const rejection = world.applyCommand({
      type: "recruit-ship",
      playerId: player.id,
      buildingId: producer.id,
      shipType: "warship",
      definitionId: definition.id,
    });
    this.diagnostics.commands++;
    this.economy.ledger.release(m.id);
    if (rejection) {
      this.diagnostics.rejected++;
      this.transition(m, "assess", `recruit rejected: ${rejection}`);
    } else {
      m.purchases++;
      const record = this.funding.get(key) ?? {
        purchases: 0,
        vesselPower: power,
        enemyPower,
        gold: 0,
        investmentCredit: costGold*4,
      };
      record.purchases++;
      record.vesselPower = power;
      record.enemyPower = enemyPower;
      record.gold += definition.cost.gold ?? 0;
      record.windowSpent = (record.windowSpent ?? 0) + (definition.cost.gold ?? 0);
      record.investmentCredit=Math.max(0,(record.investmentCredit ?? 0)-(definition.cost.gold ?? 0));
      this.funding.set(key, record);
      this.transition(m, "assemble", "same-sea defender paid and training");
    }
  }
}
