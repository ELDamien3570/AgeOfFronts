import type { Command } from "../Protocol";
import type { EmpireViewModel } from "./EmpireViewModel";

/** A keyed overlay keeps keyboard focus while the authoritative clock advances. */
export class AllianceRenewalView {
  private readonly element: HTMLElement;
  private readonly dismissed = new Set<string>();
  private readonly cards = new Map<string, HTMLElement>();
  private vm?: EmpireViewModel;
  constructor(main: Element, private readonly command: (command: Command) => void) {
    this.element = document.createElement("aside");
    this.element.className = "alliance-renewals";
    this.element.setAttribute("aria-label", "Alliance renewal");
    this.element.hidden = true;
    main.append(this.element);
    this.element.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
      const card = button?.closest<HTMLElement>("[data-treaty-key]");
      if (!button || button.disabled || !card || !this.vm) return;
      const key = card.dataset.treatyKey!;
      const alert = this.vm.allianceRenewals.find(a => a.key === key);
      if (!alert) return;
      if (button.dataset.action === "dismiss") {
        this.dismissed.add(key);
        this.update(this.vm);
      } else if (!alert.requested) {
        this.command({type: "alliance", playerId: this.vm.playerId, otherId: alert.otherId, action: "renew"});
      }
    });
  }
  reset(): void {
    this.vm = undefined;
    this.dismissed.clear();
    this.cards.clear();
    this.element.replaceChildren();
    this.element.hidden = true;
  }
  update(vm: EmpireViewModel): void {
    this.vm = vm;
    const current = new Set(vm.expansion.diplomacy.alliances.map(t => t.id + ":" + t.expiresTick));
    for (const key of this.dismissed) if (!current.has(key)) this.dismissed.delete(key);
    const alerts = vm.allianceRenewals.filter(a => !this.dismissed.has(a.key));
    const keys = new Set(alerts.map(a => a.key));
    for (const [key, card] of this.cards) if (!keys.has(key)) {card.remove();this.cards.delete(key);}
    for (const alert of alerts) {
      let card = this.cards.get(alert.key);
      if (!card) {
        card = document.createElement("section");
        card.className = "alliance-renewal hud-surface";
        card.dataset.treatyKey = alert.key;
        card.innerHTML = '<strong></strong><span></span><button type="button" data-action="renew">Renew alliance</button><button type="button" data-action="dismiss" aria-label="Dismiss alliance renewal">×</button>';
        this.cards.set(alert.key, card);
        this.element.append(card);
      }
      card.querySelector("strong")!.textContent = "Alliance with " + alert.name + " expires in " + alert.seconds + "s";
      card.querySelector("span")!.textContent = alert.requested ? "Renewal requested · awaiting your ally" : "Both allies must agree to renew.";
      card.querySelector<HTMLButtonElement>('[data-action="renew"]')!.disabled = alert.requested;
    }
    this.element.hidden = alerts.length === 0;
  }
}
