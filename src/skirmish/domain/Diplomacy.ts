import { secondsToTicks } from '../Protocol';
import { restoreRecord } from "../StateTransfer";
import { TICKS_PER_SECOND, type Player, type Command } from "../Protocol";
import type { DiplomacyState } from "./Definitions";
import {validateRaidDiplomacy} from './DiplomacyValidation';
export interface AiDiplomacyPolicy {maximumOutgoing:number;proposerTicks:number;recipientTicks:number;declinedPairTicks:number;brokenPairTicks:number;}
const DEFAULT_AI_CONTACT:AiDiplomacyPolicy={maximumOutgoing:6,proposerTicks:secondsToTicks(120),recipientTicks:secondsToTicks(60),declinedPairTicks:secondsToTicks(180),brokenPairTicks:secondsToTicks(300)};
export class Diplomacy {
  constructor(readonly aiPolicy:AiDiplomacyPolicy=DEFAULT_AI_CONTACT, readonly rules?: "raids-v1"){
    if(Object.values(aiPolicy).some(n=>!Number.isSafeInteger(n)||n<1))throw new Error("Invalid AI diplomacy policy");
    if(this.raids){this.state.embargoes=[];this.state.peaceProtection=[];this.state.dontEmbargo=[];}
  }
  get raids():boolean{return this.rules==="raids-v1";}
  private tick=0;
  permissionRevision=0;
  private permissionGeneration=0;
  private readonly ownerPermissions=new Map<number,number>();
  private readonly peacePairNext:Record<string,number>={};
  private readonly peaceRecipientNext:Record<number,number>={};
  private readonly peaceContexts:Record<string,string>={};
  onAutomaticAction?: (actorId:number,otherId:number,action:"raid"|"raid-expire"|"declare")=>void;
  private permissionsChanged(a:number,b:number):void {
    this.permissionRevision++;this.revision++;
    this.ownerPermissions.set(a,(this.ownerPermissions.get(a)??0)+1);
    this.ownerPermissions.set(b,(this.ownerPermissions.get(b)??0)+1);
  }
  permissionSignature(owner:number):string {
    return this.raids?`${this.permissionGeneration}:${this.ownerPermissions.get(owner)??0}`:String(this.revision);
  }
  nonAllied(a:number,b:number):boolean{return !!a&&!!b&&!this.allied(a,b);}
  /** Either faction start-protected, or a pairwise peace row (13 R1.1). */
  protected(a:number,b:number,tick=this.tick):boolean {
    return this.startProtectedPair(a,b,tick)||this.peaceProtected(a,b,tick);
  }
  private peaceProtected(a:number,b:number,tick:number):boolean {
    return !!this.state.peaceProtection?.some(p=>this.pair(p.a,p.b)===this.pair(a,b)&&p.untilTick>tick);
  }
  /** O(1) per-seat lookup, rebuilt from state on restore. */
  private readonly startUntil=new Map<number,number>();
  /** Start protection never concerns neutral land (owner 0) or oneself. */
  private startProtectedPair(a:number,b:number,tick:number):boolean {
    return !!this.startUntil.size&&!!a&&!!b&&a!==b&&(this.startProtected(a,tick)||this.startProtected(b,tick));
  }
  startProtected(playerId:number,tick=this.tick):boolean{return (this.startUntil.get(playerId)??0)>tick;}
  /** True while any start-protection row remains (until step() expires it). */
  get startProtectionActive():boolean{return this.startUntil.size>0;}
  /** Protect the given seats from tick 0 until `untilTick` (raids rules only). */
  protectStart(playerIds:readonly number[],untilTick:number):void {
    if(!this.raids||untilTick<=0||!playerIds.length)return;
    this.state.startProtection=playerIds.map(playerId=>({playerId,untilTick}));
    this.rebuildStartProtection();this.startProtectionChanged();
  }
  private rebuildStartProtection():void {
    this.startUntil.clear();if(!this.raids)return;
    for(const row of this.state.startProtection??[])this.startUntil.set(row.playerId,row.untilTick);
  }
  /** Start protection affects every pair of the seat, so all owner permissions refresh. */
  private startProtectionChanged():void{this.permissionGeneration++;this.permissionRevision++;this.revision++;}
  private endStartProtection(keep:(row:{playerId:number;untilTick:number})=>boolean):void {
    const rows=this.state.startProtection;if(!rows?.length)return;
    const kept=rows.filter(keep);if(kept.length===rows.length)return;
    if(kept.length)this.state.startProtection=kept;else delete this.state.startProtection;
    this.rebuildStartProtection();this.startProtectionChanged();
  }
  embargo(a:number,b:number,tick=this.tick):boolean {
    return !!this.state.embargoes?.some(r=>this.pair(r.initiator,r.victim)===this.pair(a,b)&&r.lastTheftTick+60*TICKS_PER_SECOND>tick);
  }
  canCapture(a:number,b:number):boolean {
    return !b||a===b||(!this.raids?this.nonAllied(a,b):this.nonAllied(a,b)&&!this.protected(a,b)&&this.declaredWar(a,b));
  }
  canAttackStructure(a:number,b:number):boolean{return !!b&&a!==b&&this.canCapture(a,b);}
  canSteal(a:number,b:number,tick:number,automaticHuman:boolean):boolean {
    if(!this.nonAllied(a,b)||this.protected(a,b,tick))return false;
    if(!this.raids)return this.hostile(a,b);
    if(this.declaredWar(a,b))return true;
    if(this.state.dontEmbargo?.some(e=>e.playerId===a&&e.otherId===b))return false;
    return automaticHuman||this.embargo(a,b,tick);
  }
  recordTheft(a:number,b:number,tick:number):void {
    if(!this.raids||this.declaredWar(a,b)||!this.nonAllied(a,b)||this.protected(a,b,tick))return;
    const rows=this.state.embargoes??=[],row=rows.find(r=>r.initiator===a&&r.victim===b),active=this.embargo(a,b,tick);
    if(row){row.lastTheftTick=tick;this.revision++;}
    else {rows.push({initiator:a,victim:b,lastTheftTick:tick});this.revision++;}
    if(!active){this.permissionsChanged(a,b);this.onAutomaticAction?.(a,b,"raid");}
  }
  /** An explicit AI raid mission opens combat permission before interception.
   * Mission selection stays with the AI; humans start raids through actual theft. */
  beginAiRaid(player: Player, other: Player | undefined, tick: number): string | null {
    if (!this.raids || !player.ai || player.eliminated || !other || other.eliminated || !this.nonAllied(player.id, other.id))
      return "Choose a living non-allied faction for an AI raid";
    if (this.protected(player.id, other.id, tick)) return "Peace protection is still active";
    if (this.declaredWar(player.id, other.id)) return "This faction is already at war";
    if (this.state.dontEmbargo?.some(e => e.playerId === player.id && e.otherId === other.id)) return "Trade interception is disabled for this faction";
    if (this.embargo(player.id, other.id, tick)) return null;
    this.recordTheft(player.id, other.id, tick);
    return null;
  }
  establishWar(a:number,b:number,tick:number,cause:"declaration"|"entry"|"invasion"="invasion"):string|null {
    if(!this.raids)return null;
    if(this.protected(a,b,tick))return "Peace protection is still active";
    if(this.declaredWar(a,b))return null;
    if(!this.nonAllied(a,b))return "Choose a non-allied faction";
    (this.state.wars??=[]).push({a,b,initiator:a,cause,startedTick:tick});
    this.state.offers=this.state.offers.filter(o=>this.pair(o.proposer,o.recipient)!==this.pair(a,b));
    this.permissionsChanged(a,b);this.onAutomaticAction?.(a,b,"declare");return null;
  }
  private neutralPeace(a:number,b:number,tick:number):void {
    const key=this.pair(a,b);
    this.state.wars=(this.state.wars??[]).filter(w=>this.pair(w.a,w.b)!==key);
    this.state.embargoes=(this.state.embargoes??[]).filter(r=>this.pair(r.initiator,r.victim)!==key);
    this.state.offers=this.state.offers.filter(o=>this.pair(o.proposer,o.recipient)!==key);
    this.state.peaceProtection=(this.state.peaceProtection??[]).filter(p=>this.pair(p.a,p.b)!==key);
    this.state.peaceProtection.push({a,b,untilTick:tick+60*TICKS_PER_SECOND});this.permissionsChanged(a,b);
  }
  private readonly aiProposers=new Set<number>();
  private readonly proposerNext:Record<number,number>={};
  private readonly pairNext:Record<string,number>={};
  private pair(a:number,b:number):string{return `${Math.min(a,b)}:${Math.max(a,b)}`;}
  revision=0;
  private readonly recipientCooldowns: Record<number, number> = {};
  aiOfferAvailable(recipient: number, tick: number): boolean {
    return (this.recipientCooldowns[recipient] ?? 0) <= tick && !this.state.offers.some(o => o.recipient === recipient && o.expiresTick > tick);
  }
  checkpoint() { return structuredClone({state:this.state, nextId:this.nextId, recipientCooldowns:this.recipientCooldowns,proposerNext:this.proposerNext,pairNext:this.pairNext,aiProposers:[...this.aiProposers],...(this.raids?{tick:this.tick,peacePairNext:this.peacePairNext,peaceRecipientNext:this.peaceRecipientNext,peaceContexts:this.peaceContexts,
    // Route revisions embed the permission signature, so a restored match must
    // reproduce it; otherwise every saved route looks stale after a rollback.
    permissionGeneration:this.permissionGeneration,ownerPermissions:[...this.ownerPermissions]}: {})}); }
  restore(saved: ReturnType<Diplomacy["checkpoint"]>): void {
    if(this.raids)validateRaidDiplomacy(saved.state);
    const state=structuredClone(saved);
    restoreRecord(this.state,state.state);
    this.nextId=state.nextId;this.revision++;
    restoreRecord(this.recipientCooldowns, state.recipientCooldowns ?? {});
    restoreRecord(this.proposerNext,state.proposerNext??{});restoreRecord(this.pairNext,state.pairNext??{});
    this.aiProposers.clear();for(const id of state.aiProposers??[])this.aiProposers.add(id);
    if(this.raids){this.state.embargoes??=[];this.state.peaceProtection??=[];this.state.dontEmbargo??=[];}
    this.rebuildStartProtection();
    restoreRecord(this.peacePairNext,state.peacePairNext??{});restoreRecord(this.peaceRecipientNext,state.peaceRecipientNext??{});restoreRecord(this.peaceContexts,state.peaceContexts??{});
    this.ownerPermissions.clear();this.permissionRevision++;
    if(state.permissionGeneration===undefined)this.permissionGeneration++;
    else {
      if(!Number.isSafeInteger(state.permissionGeneration)||state.permissionGeneration<0||!Array.isArray(state.ownerPermissions)||
        state.ownerPermissions.some(([id,n])=>!Number.isSafeInteger(id)||!Number.isSafeInteger(n)||n<0))throw new Error("Invalid diplomacy permission checkpoint");
      this.permissionGeneration=state.permissionGeneration;
      for(const [id,n] of state.ownerPermissions)this.ownerPermissions.set(id,n);
    }
    this.tick=state.tick??0;

  }

  readonly state: DiplomacyState = {
    offers: [],
    alliances: [],
    betrayal: {},
    cooldowns: {},
    wars: [],
  };
  private nextId = 1;
  allied(a: number, b: number): boolean {
    return (
      a === b ||
      this.state.alliances.some(
        (t) => (t.a === a && t.b === b) || (t.a === b && t.b === a),
      )
    );
  }
  hostile(a: number, b: number): boolean {
    return this.nonAllied(a,b)&&(!this.raids||!this.protected(a,b)&&(this.declaredWar(a,b)||this.embargo(a,b)));
  }
  declaredWar(a: number, b: number): boolean {
    return (this.state.wars ?? []).some(w => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }
  action(
    player: Player,
    other: Player | undefined,
    action: Extract<Command,{type:"alliance"}>["action"],
    tick: number,
    peaceContext?:string,
  ): string | null {
    this.tick=tick;
    const raidAction = ["offer-peace","accept-peace","reject-peace","dont-embargo","allow-embargo"].includes(action);
    if (raidAction && !this.raids) return "This match uses legacy diplomacy rules";
    if(raidAction){
      if(!other||other.id===player.id||other.eliminated)return "Choose a living faction";
      const a=player.id,b=other.id,key=this.pair(a,b);
      if(action==="dont-embargo"||action==="allow-embargo"){
        this.state.dontEmbargo=(this.state.dontEmbargo??[]).filter(e=>e.playerId!==a||e.otherId!==b);
        if(action==="dont-embargo")this.state.dontEmbargo.push({playerId:a,otherId:b});
        this.revision++;return null;
      }
      const incoming=this.state.offers.find(o=>o.kind==="peace"&&o.proposer===b&&o.recipient===a&&o.expiresTick>tick);
      if(action==="accept-peace"){
        if(!incoming)return "No incoming peace offer";this.neutralPeace(a,b,tick);return null;
      }
      if(action==="reject-peace"){
        if(!incoming)return "No incoming peace offer";this.state.offers=this.state.offers.filter(o=>o!==incoming);this.revision++;return null;
      }
      if(!this.hostile(a,b))return "Peace requires an active war or raid";
      if(incoming){this.neutralPeace(a,b,tick);return null;}
      if(this.state.offers.some(o=>o.kind==="peace"&&this.pair(o.proposer,o.recipient)===key&&o.expiresTick>tick))return "Peace offer already pending";
      if((this.peacePairNext[key]??0)>tick)return "Wait for the peace offer cooldown";
      const context=peaceContext??`${this.state.wars?.find(w=>this.pair(w.a,w.b)===key)?.startedTick??"raid"}:${this.embargo(a,b)}`;
      const proposerKey=`${a}:${b}`;
      if(player.ai&&this.peaceContexts[proposerKey]===context)return "Peace circumstances have not changed";
      if(player.ai&&!other.ai&&(this.peaceRecipientNext[b]??0)>tick)return "Wait for this recipient to consider peace";
      this.peacePairNext[key]=tick+300*TICKS_PER_SECOND;this.peaceContexts[proposerKey]=context;
      if(player.ai&&!other.ai)this.peaceRecipientNext[b]=tick+30*TICKS_PER_SECOND;
      this.state.offers.push({id:this.nextId++,proposer:a,recipient:b,expiresTick:tick+20*TICKS_PER_SECOND,kind:"peace"});this.revision++;return null;
    }
    if (
      !other ||
      other.id === player.id ||
      other.eliminated ||
      ((player.kind === "tribe" || other.kind === "tribe")&&!(this.raids&&action==="declare"))
    )
      return "Choose a living regular faction";
    if (!["offer", "offer-long-term", "accept", "reject", "renew", "break", "declare", "end-long-term"].includes(action))
      return "Invalid diplomacy action";
    const treaty = this.state.alliances.find(
      (t) =>
        (t.a === player.id && t.b === other.id) ||
        (t.b === player.id && t.a === other.id),
    );
    const incoming = this.state.offers.find(
      (o) =>
        o.proposer === other.id &&
        o.recipient === player.id &&
        o.expiresTick > tick && o.kind!=="peace",
    );
    if (action === "declare") {
      // A start-protected seat may break its own protection by declaring; an
      // AI-controlled seat (e.g. a disconnected human) keeps it (13 R1.1, OD15).
      if(this.raids&&(this.peaceProtected(player.id,other.id,tick)||this.startProtected(other.id,tick)||player.ai&&this.startProtected(player.id,tick)))return "Peace protection is still active";
      if(this.raids&&this.startProtected(player.id,tick))this.endStartProtection(row=>row.playerId!==player.id);
      if (this.declaredWar(player.id, other.id)) return "Already at war";
      if (treaty) {
        this.state.alliances = this.state.alliances.filter(t => t !== treaty);
        this.state.betrayal[player.id] = Math.max(this.state.betrayal[player.id] ?? 0, tick + (treaty.longTerm ? secondsToTicks(120) : secondsToTicks(30)));
        if (player.ai || other.ai) this.pairNext[this.pair(player.id, other.id)] = tick + this.aiPolicy.brokenPairTicks;
      }
      (this.state.wars ??= []).push({ a: player.id, b: other.id,...(this.raids?{initiator:player.id,cause:"declaration" as const,startedTick:tick}:{}) });
      this.state.offers = this.state.offers.filter(o => !((o.proposer === player.id && o.recipient === other.id) || (o.proposer === other.id && o.recipient === player.id)));
      if(this.raids)this.permissionsChanged(player.id,other.id);else this.revision++; return null;
    }
    if (action === "end-long-term") {
      if (!treaty?.longTerm) return "Choose a long-term alliance";
      if (treaty.ending) return "Alliance is already ending";
      treaty.ending = true;
      treaty.expiresTick = tick + secondsToTicks(180);
      treaty.renewal = [];
      this.state.offers = this.state.offers.filter(o => !((o.proposer === player.id && o.recipient === other.id) || (o.proposer === other.id && o.recipient === player.id)));
      this.revision++; return null;
    }
    if (action === "break") {
      if (!treaty) return "No active alliance";
      this.state.alliances = this.state.alliances.filter((t) => t !== treaty);
      this.state.betrayal[player.id] = Math.max(this.state.betrayal[player.id] ?? 0, tick + (treaty.longTerm ? secondsToTicks(60) : secondsToTicks(30)));
      if(player.ai||other.ai)this.pairNext[this.pair(player.id,other.id)]=tick+this.aiPolicy.brokenPairTicks;
      if(this.raids)this.permissionsChanged(player.id,other.id);else this.revision++;return null;
    }
    if (action === "renew") {
      if (treaty?.longTerm) return treaty.ending ? "This alliance is ending" : "Long-term alliances renew automatically";
      if (!treaty || treaty.expiresTick - tick > secondsToTicks(30))
        return "Renewal opens in the final thirty seconds";
      if (!treaty.renewal.includes(player.id)) treaty.renewal.push(player.id);
      if (treaty.renewal.length === 2) {
        treaty.expiresTick += secondsToTicks(300);
        treaty.renewal = [];
      }
      this.revision++;return null;
    }
    if (action === "reject") {
      if (!incoming) return "No incoming offer";
      this.state.offers = this.state.offers.filter((o) => o !== incoming);
      if(player.ai||other.ai)this.pairNext[this.pair(player.id,other.id)]=tick+this.aiPolicy.declinedPairTicks;
      this.revision++;return null;
    }
    if (treaty && (treaty.longTerm || (action !== "offer-long-term" && action !== "accept"))) return "Already allied";
    if (action === "accept" || (incoming && (action === "offer-long-term") === !!incoming.longTerm)) {
      if (!incoming) return "No incoming offer";
      if (treaty && !incoming.longTerm) return "Already allied";
      this.state.offers = this.state.offers.filter(
        (o) =>
          !(
            (o.proposer === player.id && o.recipient === other.id) ||
            (o.proposer === other.id && o.recipient === player.id)
          ),
      );
      if (treaty) {
        treaty.longTerm = true; treaty.ending = false; treaty.expiresTick = tick + secondsToTicks(300); treaty.renewal = [];
      } else this.state.alliances.push({
        id: this.nextId++,
        a: player.id,
        b: other.id,
        expiresTick: tick + secondsToTicks(300),
        renewal: [],
        ...(incoming.longTerm ? { longTerm: true } : {}),
      });
      this.state.wars = (this.state.wars ?? []).filter(w => !((w.a === player.id && w.b === other.id) || (w.a === other.id && w.b === player.id)));
      if(this.raids){this.state.embargoes=(this.state.embargoes??[]).filter(r=>this.pair(r.initiator,r.victim)!==this.pair(player.id,other.id));this.permissionsChanged(player.id,other.id);}else this.revision++;return null;
    }
    if (incoming) return "Accept or reject the pending alliance offer";
    if (
      this.state.offers.some(
        (o) => o.proposer === player.id && o.recipient === other.id,
      )
    )
      return "Offer already pending";
    if(player.ai){
      if((this.proposerNext[player.id]??0)>tick || (this.pairNext[this.pair(player.id,other.id)]??0)>tick)return "AI contact window is closed";
      if(this.state.offers.some(o=>o.proposer===player.id&&o.expiresTick>tick))return "AI already has an outgoing offer";
      // The active AI proposer set is captured from ordinary offers, never from physical treaties.
      const total=this.state.offers.filter(o=>o.expiresTick>tick&&this.aiProposers.has(o.proposer)).length;
      if(total>=this.aiPolicy.maximumOutgoing)return "AI diplomacy quota is full";
      this.aiProposers.add(player.id);
    }
    if (player.ai && !this.aiOfferAvailable(other.id, tick)) return "Wait for this recipient to consider other offers";
    const key = `${player.id}:${other.id}`;
    if ((this.state.cooldowns[key] ?? 0) > tick)
      return "Wait for the offer cooldown";
    this.state.cooldowns[key] = tick + secondsToTicks(30);
    if(player.ai){this.recipientCooldowns[other.id]=tick+this.aiPolicy.recipientTicks;this.proposerNext[player.id]=tick+this.aiPolicy.proposerTicks;}
    this.state.offers.push({
      id: this.nextId++,
      proposer: player.id,
      recipient: other.id,
      expiresTick: tick + secondsToTicks(20),
      ...(action === "offer-long-term" ? { longTerm: true } : {}),
    });
    this.revision++;return null;
  }
  step(tick: number, players: readonly Player[]): void {
    this.tick=tick;
    const live = new Set(players.filter((p) => !p.eliminated).map((p) => p.id));
    if(this.raids){
      const expired=(this.state.embargoes??[]).filter(r=>r.lastTheftTick+60*TICKS_PER_SECOND<=tick||!live.has(r.initiator)||!live.has(r.victim));
      this.state.embargoes=(this.state.embargoes??[]).filter(r=>!expired.includes(r));
      for(const r of expired){
        this.revision++;
        if(!this.embargo(r.initiator,r.victim)&&!this.declaredWar(r.initiator,r.victim))this.permissionsChanged(r.initiator,r.victim);
        this.onAutomaticAction?.(r.initiator,r.victim,"raid-expire");
      }
      const protections=(this.state.peaceProtection??[]).filter(p=>p.untilTick<=tick||!live.has(p.a)||!live.has(p.b));
      this.state.peaceProtection=(this.state.peaceProtection??[]).filter(p=>!protections.includes(p));
      for(const p of protections)this.permissionsChanged(p.a,p.b);
      this.endStartProtection(row=>row.untilTick>tick&&live.has(row.playerId));
      this.state.dontEmbargo=(this.state.dontEmbargo??[]).filter(e=>live.has(e.playerId)&&live.has(e.otherId));
      const offers = this.state.offers;
      this.state.offers = offers.filter(o => o.kind !== "peace" || this.hostile(o.proposer, o.recipient));
      if (this.state.offers.length !== offers.length) this.revision++;
    }
    this.aiProposers.clear();for(const player of players)if(player.ai&&!player.eliminated)this.aiProposers.add(player.id);
    const before=this.state.offers.length+this.state.alliances.length+Object.keys(this.state.cooldowns).length+Object.keys(this.state.betrayal).length;
    for(const offer of this.state.offers)if(offer.expiresTick<=tick&&this.aiProposers.has(offer.proposer))this.pairNext[this.pair(offer.proposer,offer.recipient)]=tick+this.aiPolicy.declinedPairTicks;
    for(const key of Object.keys(this.pairNext))if(this.pairNext[key]<=tick)delete this.pairNext[key];
    for(const id of Object.keys(this.proposerNext))if(this.proposerNext[Number(id)]<=tick || !live.has(Number(id)))delete this.proposerNext[Number(id)];
    this.state.offers = this.state.offers.filter(
      (o) =>
        o.expiresTick > tick && live.has(o.proposer) && live.has(o.recipient),
    );
    for (const treaty of this.state.alliances) {
      if (treaty.longTerm && !treaty.ending && treaty.expiresTick <= tick && live.has(treaty.a) && live.has(treaty.b)) {
        treaty.expiresTick += (Math.floor((tick - treaty.expiresTick) / secondsToTicks(300)) + 1) * secondsToTicks(300);
        this.revision++;
      }
    }
    const wars = this.state.wars ?? [];
    this.state.wars = wars.filter(w => live.has(w.a) && live.has(w.b));
    if (this.state.wars.length !== wars.length) {
      this.revision++;
      if(this.raids)for(const war of wars)if(!live.has(war.a)||!live.has(war.b))this.permissionsChanged(war.a,war.b);
    }
    if(this.raids)for(const treaty of this.state.alliances)if(treaty.expiresTick<=tick||!live.has(treaty.a)||!live.has(treaty.b))this.permissionsChanged(treaty.a,treaty.b);
    this.state.alliances = this.state.alliances.filter(
      (a) => a.expiresTick > tick && live.has(a.a) && live.has(a.b),
    );
    for (const id of Object.keys(this.recipientCooldowns))
      if (this.recipientCooldowns[Number(id)] <= tick || !live.has(Number(id))) delete this.recipientCooldowns[Number(id)];
    for (const key of Object.keys(this.state.cooldowns))
      if (this.state.cooldowns[key] <= tick) delete this.state.cooldowns[key];
    for (const id of Object.keys(this.state.betrayal))
      if (this.state.betrayal[Number(id)] <= tick)
        delete this.state.betrayal[Number(id)];
    if(before!==this.state.offers.length+this.state.alliances.length+Object.keys(this.state.cooldowns).length+Object.keys(this.state.betrayal).length)this.revision++;
  }
}
