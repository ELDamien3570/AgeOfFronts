import { restoreRecord } from "../StateTransfer";
import type { Player } from "../Protocol";
import type { DiplomacyState } from "./Definitions";
export interface AiDiplomacyPolicy {maximumOutgoing:number;proposerTicks:number;recipientTicks:number;declinedPairTicks:number;brokenPairTicks:number;}
const DEFAULT_AI_CONTACT:AiDiplomacyPolicy={maximumOutgoing:6,proposerTicks:2400,recipientTicks:1200,declinedPairTicks:3600,brokenPairTicks:6000};
export class Diplomacy {
  constructor(readonly aiPolicy:AiDiplomacyPolicy=DEFAULT_AI_CONTACT){if(Object.values(aiPolicy).some(n=>!Number.isSafeInteger(n)||n<1))throw new Error("Invalid AI diplomacy policy");}
  private readonly aiProposers=new Set<number>();
  private readonly proposerNext:Record<number,number>={};
  private readonly pairNext:Record<string,number>={};
  private pair(a:number,b:number):string{return `${Math.min(a,b)}:${Math.max(a,b)}`;}
  revision=0;
  private readonly recipientCooldowns: Record<number, number> = {};
  aiOfferAvailable(recipient: number, tick: number): boolean {
    return (this.recipientCooldowns[recipient] ?? 0) <= tick && !this.state.offers.some(o => o.recipient === recipient && o.expiresTick > tick);
  }
  checkpoint() { return structuredClone({state:this.state, nextId:this.nextId, recipientCooldowns:this.recipientCooldowns,proposerNext:this.proposerNext,pairNext:this.pairNext,aiProposers:[...this.aiProposers]}); }
  restore(saved: ReturnType<Diplomacy["checkpoint"]>): void {
    const state=structuredClone(saved);
    restoreRecord(this.state,state.state);
    this.nextId=state.nextId;this.revision++;
    restoreRecord(this.recipientCooldowns, state.recipientCooldowns ?? {});
    restoreRecord(this.proposerNext,state.proposerNext??{});restoreRecord(this.pairNext,state.pairNext??{});
    this.aiProposers.clear();for(const id of state.aiProposers??[])this.aiProposers.add(id);

  }

  readonly state: DiplomacyState = {
    offers: [],
    alliances: [],
    betrayal: {},
    cooldowns: {},
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
    return !!a && !!b && !this.allied(a, b);
  }
  action(
    player: Player,
    other: Player | undefined,
    action: "offer" | "accept" | "reject" | "renew" | "break",
    tick: number,
  ): string | null {
    if (
      !other ||
      other.id === player.id ||
      other.eliminated ||
      player.kind === "tribe" ||
      other.kind === "tribe"
    )
      return "Choose a living regular faction";
    if (!["offer", "accept", "reject", "renew", "break"].includes(action))
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
        o.expiresTick > tick,
    );
    if (action === "break") {
      if (!treaty) return "No active alliance";
      this.state.alliances = this.state.alliances.filter((t) => t !== treaty);
      this.state.betrayal[player.id] = tick + 600;
      if(player.ai||other.ai)this.pairNext[this.pair(player.id,other.id)]=tick+this.aiPolicy.brokenPairTicks;
      this.revision++;return null;
    }
    if (action === "renew") {
      if (!treaty || treaty.expiresTick - tick > 600)
        return "Renewal opens in the final thirty seconds";
      if (!treaty.renewal.includes(player.id)) treaty.renewal.push(player.id);
      if (treaty.renewal.length === 2) {
        treaty.expiresTick += 6000;
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
    if (treaty) return "Already allied";
    if (action === "accept" || incoming) {
      if (!incoming) return "No incoming offer";
      this.state.offers = this.state.offers.filter(
        (o) =>
          !(
            (o.proposer === player.id && o.recipient === other.id) ||
            (o.proposer === other.id && o.recipient === player.id)
          ),
      );
      this.state.alliances.push({
        id: this.nextId++,
        a: player.id,
        b: other.id,
        expiresTick: tick + 6000,
        renewal: [],
      });
      this.revision++;return null;
    }
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
    this.state.cooldowns[key] = tick + 600;
    if(player.ai){this.recipientCooldowns[other.id]=tick+this.aiPolicy.recipientTicks;this.proposerNext[player.id]=tick+this.aiPolicy.proposerTicks;}
    this.state.offers.push({
      id: this.nextId++,
      proposer: player.id,
      recipient: other.id,
      expiresTick: tick + 400,
    });
    this.revision++;return null;
  }
  step(tick: number, players: readonly Player[]): void {
    const live = new Set(players.filter((p) => !p.eliminated).map((p) => p.id));
    this.aiProposers.clear();for(const player of players)if(player.ai&&!player.eliminated)this.aiProposers.add(player.id);
    const before=this.state.offers.length+this.state.alliances.length+Object.keys(this.state.cooldowns).length+Object.keys(this.state.betrayal).length;
    for(const offer of this.state.offers)if(offer.expiresTick<=tick&&this.aiProposers.has(offer.proposer))this.pairNext[this.pair(offer.proposer,offer.recipient)]=tick+this.aiPolicy.declinedPairTicks;
    for(const key of Object.keys(this.pairNext))if(this.pairNext[key]<=tick)delete this.pairNext[key];
    for(const id of Object.keys(this.proposerNext))if(this.proposerNext[Number(id)]<=tick || !live.has(Number(id)))delete this.proposerNext[Number(id)];
    this.state.offers = this.state.offers.filter(
      (o) =>
        o.expiresTick > tick && live.has(o.proposer) && live.has(o.recipient),
    );
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
