import type { MovementAdmissionEvent } from "./MovementAdmission";
import type { Command } from "./Protocol";

export interface CommandOutcome {
  id: string;
  playerId: number;
  tick: number;
  status: "accepted" | "deferred" | "executed" | "rejected" | "superseded";
  reason?: string;
}
interface Receipt {
  outcome: CommandOutcome;
  plans: Set<string>;
}
interface Ports {
  apply(command: Command): string | null;
  tick(): number;
}
/** Application receipts correlate input identity with domain planning events.
 * They own no movement, payment, jobs or transport acknowledgements. A host
 * subscribes to results; there is no unbounded second outbound state queue. */
export class CommandApplications {
  private readonly pending = new Map<string, Receipt>();
  private readonly plans = new Map<string, string>();
  private readonly recent = new Map<string, CommandOutcome>();
  private applying?: { key: string; playerId: number; plans: Set<string> };
  onOutcome?: (outcome: CommandOutcome) => void;
  readonly diagnostics = { pending: 0, rejectedAtCapacity: 0 };
  constructor(
    private readonly ports: Ports,
    private readonly capacity = 512,
    private readonly historyLimit = 2048,
  ) {
    if (
      !Number.isInteger(capacity) ||
      capacity < 1 ||
      !Number.isInteger(historyLimit) ||
      historyLimit < 1
    )
      throw new Error("Invalid command receipt budget");
  }
  private key(id: string, playerId: number): string {
    return `${playerId}:${id}`;
  }
  private publish(outcome: CommandOutcome): void {
    const key = this.key(outcome.id, outcome.playerId);
    this.recent.delete(key);
    this.recent.set(key, { ...outcome });
    while (this.recent.size > this.historyLimit)
      this.recent.delete(this.recent.keys().next().value!);
    this.onOutcome?.({ ...outcome });
  }
  apply(id: string, command: Command): CommandOutcome {
    if (this.applying) throw new Error("Nested external command application");
    const key = this.key(id, command.playerId),
      previous = this.pending.get(key)?.outcome ?? this.recent.get(key);
    if (previous) {
      this.onOutcome?.({ ...previous });
      return { ...previous };
    }
    const result: CommandOutcome = {
      id,
      playerId: command.playerId,
      tick: this.ports.tick(),
      status: "executed",
    };
    const mayDefer =
      command.type === "army-order" || command.type === "board" || command.type === "unload" ||
      command.type === "sail" ||
      (command.type === "order" &&
        ((command.append ?? false) || command.order.type === "move"));
    // Interrupt/stop commands remain available when the input-planning budget
    // is full. Capacity rejection leaves every current domain order intact.
    if (mayDefer && this.pending.size >= this.capacity) {
      result.status = "rejected";
      result.reason =
        "Command planning is full; retry after pending orders finish";
      this.diagnostics.rejectedAtCapacity++;
      this.publish(result);
      return result;
    }
    const applying = {
      key,
      playerId: command.playerId,
      plans: new Set<string>(),
    };
    this.applying = applying;
    let rejection: string | null;
    try {
      rejection = this.ports.apply(command);
    } finally {
      this.applying = undefined;
    }
    if (rejection) {
      result.status = "rejected";
      result.reason = rejection;
    } else if (applying.plans.size) {
      result.status = "deferred";
      this.pending.set(key, { outcome: result, plans: applying.plans });
      for (const plan of applying.plans) this.plans.set(plan, key);
      this.diagnostics.pending = this.pending.size;
    }
    this.publish(result);
    return { ...result };
  }
  observe(source: "land" | "water" | "army" | "shore" | "trade", event: MovementAdmissionEvent): void {
    const plan = `${source}:${event.id}`;
    if (event.status === "deferred") {
      if (this.applying?.playerId === event.playerId)
        this.applying.plans.add(plan);
      return;
    }
    const key = this.plans.get(plan),
      receipt = key === undefined ? undefined : this.pending.get(key);
    if (!receipt || receipt.outcome.playerId !== event.playerId) return;
    this.plans.delete(plan);
    receipt.plans.delete(plan);
    if (event.status === "executed" && receipt.plans.size) return;
    for (const remaining of receipt.plans) this.plans.delete(remaining);
    this.pending.delete(key!);
    this.diagnostics.pending = this.pending.size;
    this.publish({
      ...receipt.outcome,
      tick: event.tick,
      status: event.status,
      reason: event.reason,
    });
  }
  release(playerId: number, tick: number): void {
    for (const [key, receipt] of this.pending)
      if (receipt.outcome.playerId === playerId) {
        for (const plan of receipt.plans) this.plans.delete(plan);
        this.pending.delete(key);
        this.publish({
          ...receipt.outcome,
          tick,
          status: "superseded",
          reason: "Faction control changed",
        });
      }
    this.diagnostics.pending = this.pending.size;
  }
  checkpoint() {
    return structuredClone({
      pending: [...this.pending],
      recent: [...this.recent],
    });
  }
  restore(saved: ReturnType<CommandApplications["checkpoint"]>): void {
    if (
      saved.pending.length > this.capacity ||
      saved.recent.length > this.historyLimit
    )
      throw new Error("Command receipt checkpoint exceeds its budget");
    this.pending.clear();
    this.plans.clear();
    this.recent.clear();
    this.applying = undefined;
    for (const [key, receipt] of structuredClone(saved.pending)) {
      this.pending.set(key, receipt);
      for (const plan of receipt.plans) this.plans.set(plan, key);
    }
    for (const [key, result] of structuredClone(saved.recent))
      this.recent.set(key, result);
    this.diagnostics.pending = this.pending.size;
  }
}
