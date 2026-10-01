import type { Command } from "../Protocol";
import type { EmpireViewModel } from "./EmpireViewModel";
import { ResearchOpportunitiesViewModel } from "./ResearchOpportunitiesViewModel";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const format = (value: number) => value.toLocaleString("en-US");

/** Passive research shortcuts; the authority still validates every command. */
export class ResearchOpportunitiesView {
  private readonly element: HTMLElement;
  private vm?: EmpireViewModel;
  private fingerprint = "";

  constructor(
    main: Element,
    private readonly command: (command: Command) => void,
  ) {
    main.insertAdjacentHTML(
      "beforeend",
      '<aside class="research-opportunities" aria-label="Available research" hidden></aside>',
    );
    this.element = main.querySelector<HTMLElement>(".research-opportunities")!;
    this.element.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-quick-research]",
      );
      if (!button || button.disabled || !this.vm) return;
      const card = new ResearchOpportunitiesViewModel(this.vm).cards.find(
        (node) => node.id === button.dataset.quickResearch,
      );
      if (!card || card.reason) return;
      this.command({
        type: "research",
        playerId: this.vm.playerId,
        technologyId: card.id,
      });
    });
  }

  reset(): void {
    this.vm = undefined;
    this.fingerprint = "";
    this.element.replaceChildren();
    this.element.hidden = true;
  }

  update(vm: EmpireViewModel): void {
    this.vm = vm;
    const cards = new ResearchOpportunitiesViewModel(vm).cards;
    this.element.hidden = cards.length === 0;
    const fingerprint = JSON.stringify(
      cards.map((card) => [card.id, card.gold, card.seconds, card.reason]),
    );
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    // Preserve wheel position and keyboard focus while affordability updates.
    const scroll = this.element.scrollTop;
    const focused = this.element.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.quickResearch
      : undefined;
    this.element.innerHTML = cards
      .map(
        (card) =>
          `<article class="research-opportunity hud-surface" aria-label="${escape(card.name)}" tabindex="0"><header><small>${escape(card.tree)}</small><b>${escape(card.name)}</b></header><div class="research-description"><div><p>${escape(card.description)}</p></div></div><button data-quick-research="${escape(card.id)}" aria-label="Research ${escape(card.name)}"><span>Research · ${format(card.gold)} gold · ${card.seconds}s</span></button></article>`,
      )
      .join("");
    this.element.scrollTop = scroll;
    if (focused)
      [
        ...this.element.querySelectorAll<HTMLButtonElement>(
          "[data-quick-research]",
        ),
      ]
        .find((button) => button.dataset.quickResearch === focused)
        ?.focus({ preventScroll: true });
  }
}
