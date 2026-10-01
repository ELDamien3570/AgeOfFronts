import { armyCapacity } from "../content/Armies";
import { defaultUnit, UNIT } from "../content/Units";
import type { Army } from "../domain/Definitions";
import { SQUAD_TROOPS, type Snapshot } from "../Protocol";
export class ArmyViewModel {
  constructor(
    readonly state: Snapshot,
    readonly selected: ReadonlySet<number>,
    readonly playerId = 1,
  ) {}
  get armies(): readonly Army[] {
    return (this.state.expansion?.armies ?? []).filter(
      (a) => a.playerId === this.playerId,
    );
  }
  get capacity() {
    return armyCapacity(
      this.state.expansion?.progression[this.playerId]?.completed ?? [],
    );
  }
  get selectedSquads() {
    return this.state.squads.filter(
      (s) => s.playerId === this.playerId && this.selected.has(s.id),
    );
  }
  members(army: Army) {
    const ids = new Set(army.memberIds);
    return this.state.squads.filter((s) => ids.has(s.id));
  }
  get selectedArmy() {
    if (!this.selected.size) return undefined;
    return this.armies.find((a) => {
      const available = this.members(a).filter(
        (s) => s.embarkedOn === null && !s.refit,
      );
      return (
        available.length > 0 &&
        available.length === this.selected.size &&
        available.every((s) => this.selected.has(s.id))
      );
    });
  }
  get createReason(): string | null {
    if (!this.capacity) return "Research Armies in Bronze Warfare";
    if (!this.selectedSquads.length) return "Select squads to create an army";
    if (this.selectedSquads.some((s) => s.embarkedOn !== null || s.refit))
      return "Choose available land squads";
    if (this.selectedSquads.length > this.capacity)
      return `Select at most ${this.capacity} squads`;
    if (
      this.armies.some((a) => a.memberIds.some((id) => this.selected.has(id)))
    )
      return "Detach members from their army first";
    return null;
  }
  addReason(armyId: number): string | null {
    const army = this.armies.find((a) => a.id === armyId);
    if (!army || !this.selectedSquads.length)
      return "Select squads and their destination army";
    if (this.selectedSquads.some((s) => s.embarkedOn !== null || s.refit))
      return "Choose available land squads";
    if (
      this.armies.some(
        (a) =>
          a.id !== armyId && a.memberIds.some((id) => this.selected.has(id)),
      )
    )
      return "Detach squads from their current army first";
    if (this.selectedSquads.every((s) => army.memberIds.includes(s.id)))
      return "Those squads already belong to this army";
    if (
      new Set([...army.memberIds, ...this.selectedSquads.map((s) => s.id)])
        .size > this.capacity
    )
      return `Army capacity is ${this.capacity}`;
    return null;
  }
  card(army: Army) {
    const members = this.members(army);
    const roles = new Map<string, number>();
    for (const s of members) {
      const u = UNIT.get(s.definitionId ?? "") ?? defaultUnit(s.kind);
      roles.set(u.role, (roles.get(u.role) ?? 0) + 1);
    }
    return {
      count: members.length,
      capacity: this.capacity,
      strength: members.reduce((sum, s) => sum + s.troops, 0),
      maximum: members.length * SQUAD_TROOPS,
      suspended: members.filter((s) => s.embarkedOn !== null || s.refit).length,
      roles: [...roles].map(([role, count]) => `${count} ${role}`).join(" · "),
      status:
        army.reason ?? `${army.state}${army.manual ? " · manual order" : ""}`,
      queued: army.queuedOrders.length,
    };
  }
}
