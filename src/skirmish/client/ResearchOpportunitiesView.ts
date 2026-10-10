import type { Command } from "../Protocol";
import { AGE_UI_THEMES } from "./AgeUiTheme";
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
const formatGold = (value: number): string => {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 || Number.isInteger(m) ? Math.round(m) : m.toFixed(1)}M G`;
  }
  if (value >= 10_000) {
    const k = value / 1_000;
    return `${k >= 100 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)}K G`;
  }
  return `${value.toLocaleString("en-US")}g`;
};

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
      this.command(
        card.kind === "advance-age"
          ? { type: "advance-age", playerId: this.vm.playerId }
          : {
              type: "research",
              playerId: this.vm.playerId,
              technologyId: card.id,
            },
      );
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
      cards.map((card) => [
        card.id,
        card.gold,
        card.seconds,
        card.reason,
        card.tree,
        card.kind === "advance-age" ? card.targetAge : null,
      ]),
    );
    if (fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    // Preserve wheel position and keyboard focus while affordability updates.
    const scroll = this.element.scrollTop;
    const focused = this.element.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.quickResearch
      : undefined;
    this.element.innerHTML = cards
      .map((card) => {
        const ageUp = card.kind === "advance-age";
        const treeLabel = ageUp
          ? "Age up"
          : card.tree === "economic"
            ? "Economics"
            : card.tree;
        const action = ageUp ? "Advance age" : "Research";
        const label = ageUp
          ? `Advance to ${card.name}`
          : `Research ${card.name}`;
        return `<article class="research-opportunity hud-surface research-tree-${escape(card.tree)}${ageUp ? " research-age-up" : ""}" data-tree="${escape(card.tree)}"${ageUp ? ` data-target-age="${card.targetAge}"` : ""} aria-label="${escape(card.name)}" tabindex="0"><header><div class="research-title-group"><small class="branch-label">${escape(treeLabel)}</small><b>${escape(card.name)}</b></div><button data-quick-research="${escape(card.id)}" aria-label="${escape(label)}"><span>${action}</span><small class="cost-label">${formatGold(card.gold)} · ${card.seconds}s</small></button></header><div class="research-description"><div><p>${escape(card.description)}</p></div></div></article>`;
      })
      .join("");
    for (const card of cards) {
      if (card.kind !== "advance-age") continue;
      const frame =
        this.element.querySelector<HTMLElement>(".research-age-up")!;
      const theme = AGE_UI_THEMES[card.targetAge];
      // Preview the destination frame locally; the earned HUD age stays intact.
      frame.style.setProperty(
        "--research-age-texture",
        `url("${theme.texture}")`,
      );
      frame.style.setProperty("--research-age-light", theme.palette.light);
      frame.style.setProperty("--research-age-edge", theme.palette.edge);
    }
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
