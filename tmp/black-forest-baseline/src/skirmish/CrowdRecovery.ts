import type { MovementIntent } from "./LocalAvoidance";
import { FIXED, type Squad } from "./Protocol";
import type { SpatialGrid, WorldPoint } from "./SpatialGrid";

interface Progress {
  x: number;
  y: number;
  since: number;
  granted: number;
  revision?: number;
}
interface Lease {
  leader: number;
  until: number;
  members: { id: number; revision?: number; goal: WorldPoint }[];
}
export interface RecoveryFrame {
  leases: Lease[];
  waiting: Map<number, Progress>;
}
const WAIT = 20,
  TERM = 60,
  MAX_CLUSTERS = 8,
  MAX_MEMBERS = 8;

// A bounded local arbitration helper, not another order/path authority. Leases
// only select short physical proposals; original orders and queues stay intact.
export class CrowdRecovery {
  private waiting = new Map<number, Progress>();
  private leases: Lease[] = [];
  checkpoint() {
    return structuredClone({ waiting: this.waiting, leases: this.leases });
  }
  restore(saved?: ReturnType<CrowdRecovery["checkpoint"]>) {
    this.waiting = saved ? structuredClone(saved.waiting) : new Map();
    this.leases = saved ? structuredClone(saved.leases) : [];
  }
  frame(
    tick: number,
    intents: ReadonlyMap<number, MovementIntent>,
    grid: SpatialGrid<Squad>,
    stalled: ReadonlySet<number>,
    allowed: (squad: Squad, end: WorldPoint) => boolean,
  ): RecoveryFrame {
    const eligible = (s: Squad) =>
      intents.has(s.id) &&
      !s.fighting &&
      !s.refit &&
      !s.charge &&
      (s.order.type === "move" ||
        intents.get(s.id)!.yieldOnly === true);
    for (const [id, intent] of intents) {
      const s = intent.squad;
      if (!eligible(s)) {
        this.waiting.delete(id);
        continue;
      }
      let progress = this.waiting.get(id);
      if (!progress || progress.revision !== intent.revision) {
        progress = {
          x: s.x,
          y: s.y,
          since: tick,
          granted: -TERM,
          revision: intent.revision,
        };
        this.waiting.set(id, progress);
      }
      if (
        (s.x - progress.x) ** 2 + (s.y - progress.y) ** 2 >
        (FIXED / 4) ** 2
      ) {
        progress.x = s.x;
        progress.y = s.y;
        progress.since = tick;
      }
    }
    for (const id of this.waiting.keys())
      if (!intents.has(id)) this.waiting.delete(id);
    this.leases = this.leases.filter(
      (lease) =>
        tick < lease.until &&
        lease.members.some(
          (m) =>
            m.id === lease.leader &&
            intents.has(m.id) &&
            intents.get(m.id)!.revision === m.revision &&
            !intents.get(m.id)!.yieldOnly &&
            eligible(intents.get(m.id)!.squad),
        ),
    );
    for (const lease of this.leases)
      lease.members = lease.members.filter((m) => {
        const i = intents.get(m.id);
        return i && i.revision === m.revision && eligible(i.squad);
      });
    const assigned = new Set(
      this.leases.flatMap((l) => l.members.map((m) => m.id)),
    );
    const candidates = [...this.waiting]
      .filter(
        ([id, p]) =>
          !assigned.has(id) &&
          stalled.has(id) &&
          !intents.get(id)!.yieldOnly &&
          tick - p.since >= WAIT,
      )
      // Waiting age wins; after a turn, an equally old neighbor gets priority.
      .sort(
        (a, b) =>
          Math.max(a[1].since, a[1].granted) -
            Math.max(b[1].since, b[1].granted) || a[0] - b[0],
      );
    const nearby: Squad[] = [];
    for (const [id, progress] of candidates) {
      if (this.leases.length >= MAX_CLUSTERS) break;
      if (assigned.has(id)) continue;
      const leader = intents.get(id)!.squad;
      const members: Squad[] = [leader];
      for (
        let at = 0;
        at < members.length && members.length < MAX_MEMBERS;
        at++
      ) {
        const member = members[at];
        grid.query(member.x, member.y, 1.5 * FIXED, nearby);
        nearby.sort((a, b) => a.id - b.id);
        for (const other of nearby) {
          if (members.length >= MAX_MEMBERS) break;
          if (
            other.playerId !== leader.playerId ||
            assigned.has(other.id) ||
            members.some((s) => s.id === other.id) ||
            !eligible(other) ||
            Math.hypot(other.x - leader.x, other.y - leader.y) > 4 * FIXED
          )
            continue;
          members.push(other);
        }
      }
      if (members.length === 1) continue;
      const center = {
        x: members.reduce((v, s) => v + s.x, 0) / members.length,
        y: members.reduce((v, s) => v + s.y, 0) / members.length,
      };
      const intent = intents.get(id)!,
        dx = intent.goal.x - leader.x,
        dy = intent.goal.y - leader.y;
      const lease: Lease = { leader: id, until: tick + TERM, members: [] };
      for (const s of members) {
        let rx = s.x - center.x,
          ry = s.y - center.y;
        if (!rx && !ry) {
          rx = -dy || FIXED;
          ry = dx;
        }
        const angle = Math.atan2(ry, rx);
        let goal: WorldPoint = { x: s.x, y: s.y };
        // A fixed, short, terrain-checked yield leg prevents alternating sidesteps.
        for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
          const a = angle + (turn * Math.PI) / 4;
          const end = {
            x: s.x + Math.round(Math.cos(a) * FIXED * 1.5),
            y: s.y + Math.round(Math.sin(a) * FIXED * 1.5),
          };
          if (allowed(s, end)) {
            goal = end;
            break;
          }
        }
        lease.members.push({
          id: s.id,
          revision: intents.get(s.id)!.revision,
          goal,
        });
        assigned.add(s.id);
      }
      progress.granted = tick;
      this.leases.push(lease);
    }
    return { leases: this.leases, waiting: this.waiting };
  }
}
