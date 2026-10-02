import type { Resource } from "../domain/Definitions";
import { AGES, RESOURCES } from "../domain/Definitions";
import { BUILDING_RULES, SHIP_RULES } from "../Rules";
import { buildingArtworkId, buildingPreviewArtworkId } from "./ArtworkCatalog";
import { STONE_AGE_BUILDINGS } from "./BuildingArtwork";
import { CONSTRUCTION, CONSTRUCTION_SHORTCUTS, LAND_RECRUITMENT, NAVAL_RECRUITMENT } from "./Controls";
import { eraPortrait } from "./EraArtwork";
import { HudViewModel, type HudCard, type HudKind } from "./HudViewModel";
import { HudDrawerViewModel } from "./HudDrawerViewModel";
import { promotionUrl } from "./PromotionArtwork";
import { resourceIcon } from "./ResourceIcon";
import { UNIT_ANIMATIONS } from "./UnitAnimation";

const infantry = new URL(
  "../../../Art/Soldier Icons/Melee/StoneAge/Idle.png",
  import.meta.url,
).href;
const archer = new URL(
  "../../../Art/Soldier Icons/Ranged/StoneAge/Idle.png",
  import.meta.url,
).href;
const cavalry = new URL(
  "../../../Art/Soldier Icons/Cavalry/StoneAge/Idle.png",
  import.meta.url,
).href;
const transport = new URL(
  "../../../Art/Formation Icons/png/transport-ship.png",
  import.meta.url,
).href;
const warship = new URL(
  "../../../Art/Formation Icons/png/warship.png",
  import.meta.url,
).href;
const icons: Partial<Record<HudKind, string>> = {
  ...STONE_AGE_BUILDINGS,
  infantry,
  archer,
  cavalry,
  transport,
  warship,
};
const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});
const fmt = (n: number) => numberFormat.format(n);
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function icon(kind: HudKind, definitionId?: string) {
  if (RESOURCES.includes(kind as Resource))
    return resourceIcon(kind as Resource);
  const fallback = [
    "infantry",
    "archer",
    "cavalry",
    "transport",
    "warship",
  ].includes(kind)
    ? `stoneage-${kind}`
    : `building-stoneage-${kind}`;
  let artworkId = definitionId ?? fallback;
  if (kind in BUILDING_RULES) {
    const age =
      AGES.find((a) => artworkId.startsWith(`building-${a.toLowerCase()}-`)) ??
      "StoneAge";
    artworkId =
      (definitionId
        ? buildingArtworkId(kind as keyof typeof BUILDING_RULES, age)
        : buildingPreviewArtworkId(kind as keyof typeof BUILDING_RULES, age)) ??
      artworkId;
  }
  const portrait = eraPortrait(artworkId);
  if (portrait) return `<img class="hud-art" src="${portrait}" alt="">`;
  if (kind === "infantry" || kind === "archer" || kind === "cavalry") {
    const grid = UNIT_ANIMATIONS[kind].grid;
    return `<span class="hud-art sprite" style="background-image:url('${icons[kind]}');background-size:${grid.columns * 100}% ${grid.rows * 100}%" aria-hidden="true"></span>`;
  }
  return icons[kind]
    ? `<img class="hud-art" src="${icons[kind]}" alt="">`
    : `<span class="command-symbol">${BUILDING_RULES[kind as keyof typeof BUILDING_RULES]?.glyph ?? "?"}</span>`;
}
function action(
  id: string,
  label: string,
  key: string,
  kind?: HudKind,
  symbol?: string,
) {
  return `<div class="action-slot" data-hud-tip="${id}" tabindex="-1"><button id="${id}" class="hud-action" aria-label="${label}">${kind ? icon(kind) : `<span class="command-symbol" aria-hidden="true">${symbol}</span>`}<kbd>${key}</kbd><span class="action-name">${label}</span></button></div>`;
}
export function hudMarkup(): string {
  const buildings = (economy: boolean) =>
    CONSTRUCTION.filter(
      (a) => ["city", "factory", "port"].includes(a.kind) === economy,
    )
      .map((a) =>
        action(`build-${a.kind}`, BUILDING_RULES[a.kind].name, a.key, a.kind),
      )
      .join("");
  return `
    <aside id="selection-card" class="selection-card hud-surface" aria-label="Selection details" hidden>
      <div class="selection-heading"><span class="eyebrow" id="selection-label">SELECTION</span><button id="selection-back" class="text-button" hidden>Back to selection</button></div>
      <div id="selection-detail">
        <div class="unit-heading"><div id="selection-portrait" class="unit-portrait"></div><div><h2 id="selection-title"></h2><p id="selection-subtitle"></p><span id="selection-status" class="status-chip"></span></div></div><div id="selection-promotion" class="promotion-progress" hidden></div>
        <div id="selection-meter"><div class="meter-label"><span id="meter-name"></span><b id="meter-value"></b></div><div id="selection-health" class="health-track" role="progressbar"><i></i></div></div>
        <dl id="selection-stats" class="stat-list"></dl><p id="selection-description" class="card-description"></p>
      </div>
      <div id="selection-mixed" hidden><h2 id="mixed-title"></h2><p class="card-description">Hover for stats. Click to inspect while keeping your army selected.</p><div id="selection-cells" class="selection-cells"></div></div>
      <div class="selection-orders"><strong id="selected"></strong><p id="selected-orders"></p></div>
      <div id="naval-orders" class="naval-orders" hidden><span id="ship-selection"></span><button id="load">Meet & board</button><button id="unload">Unload at coast</button></div>
    </aside>
    <section class="command-dock hud-surface" aria-label="Resources and commands">
      <div class="resource-row"><div class="resource gold-resource"><span class="resource-symbol" aria-hidden="true">◈</span><span>Gold<strong id="gold">—</strong></span></div><div class="resource"><span>Troops in field<strong id="troop-total">—</strong></span></div><div class="resource"><span>Reserve troops<strong id="reserves">—</strong></span></div><div class="resource small-resource"><span>Squads<strong id="squad-count">—</strong></span></div><div class="resource small-resource"><span>Land<strong id="land">—</strong></span></div><div class="resource small-resource match-metric" title="Individual enemy soldiers killed, including troops aboard sunk transports."><span>Kills<strong id="kills">—</strong></span></div><div class="resource small-resource match-metric" title="Cumulative individual soldier casualties, including troops aboard sunk transports. Ship damage is excluded."><span>Deaths<strong id="losses">—</strong></span></div><div class="resource small-resource match-metric" title="Base gold value of enemy cargo captured this match; excludes delivery bonuses. Each capture counts, including recaptures."><span>Trade captured<strong id="trade-captured">—</strong></span></div><div class="resource small-resource match-metric" title="Base gold value of your cargo captured by enemies or discarded this match. Delivered and returned cargo are excluded."><span>Trade lost<strong id="trade-lost">—</strong></span></div><button type="button" class="dock-age" aria-controls="hud-command-sections" aria-expanded="true" aria-pressed="false">STONE AGE</button></div>
      <div id="hud-command-sections" class="command-row"><div class="command-category economy"><h3>Economy</h3><div class="category-actions">${buildings(true)}</div></div><div class="command-category military"><h3>Military buildings</h3><div class="category-actions">${buildings(false)}</div></div><div class="command-category troops"><h3>Troops</h3><div class="category-actions">${LAND_RECRUITMENT.map((a) => action(`recruit-${a.kind}`, a.label, a.key, a.kind)).join("")}</div></div><div class="command-category ships"><h3>Ships</h3><div class="category-actions">${NAVAL_RECRUITMENT.map((a) => action(a.kind, SHIP_RULES[a.kind].name, a.key, a.kind)).join("")}</div></div><div class="command-category orders"><h3>Orders</h3><div class="category-actions">${action("replenish", "Replenish", "R", undefined, "+")}${action("hold", "Hold", "T", undefined, "■")}${action("all", "Select all", "Ctrl A", undefined, "▦")}</div></div></div>
      <div class="dock-utility"><div class="control-groups"><span>Groups</span>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => `<button id="group-${d}" aria-label="Control group ${d}"><b>${d}</b><small>0</small></button>`).join("")}</div><span class="group-help">Shift adds · Ctrl replaces</span><button id="controls-toggle" aria-expanded="false">Controls <span>?</span></button><button id="roster-toggle" aria-expanded="false">Factions</button></div>
    </section>
    <section id="controls-popover" class="hud-popover hud-surface" aria-label="Game controls" hidden><div class="popover-heading"><h2>Battlefield controls</h2><button data-close="controls-popover" aria-label="Close controls">×</button></div><dl class="stat-list"><dt>Left click / drag</dt><dd>Select units</dd><dt>Shift + select</dt><dd>Add units</dd><dt>Double click</dt><dd>Select visible units of type</dd><dt>Right click</dt><dd>Move / attack / board</dd><dt>Shift + right click</dt><dd>Queue waypoints</dd><dt>1–0</dt><dd>Recall control group</dd><dt>Shift + 1–0</dt><dd>Add to control group</dd><dt>Ctrl + 1–0</dt><dd>Replace / clear group</dd><dt>Wheel / middle drag</dt><dd>Zoom / pan</dd><dt>Shift + recruit</dt><dd>Queue five (normal mode)</dd><dt>Space + recruit</dt><dd>Queue five (WASD mode)</dd><dt>Pause button</dt><dd>Pause / resume</dd><dt>Home</dt><dd>Fit battlefield</dd><dt>Escape</dt><dd>Cancel placement / inspection</dd></dl><p class="card-description">Recruit and construction keys are shown on every command button. R replenishes eligible squads or repairs selected buildings; T holds units; Ctrl A selects all land squads.</p><a href="/age-of-fronts-source.zip" download>Download corresponding source</a></section>
    <section id="roster-popover" class="hud-popover hud-surface" aria-label="Factions" hidden><div class="popover-heading"><h2>Factions & territory</h2><button data-close="roster-popover" aria-label="Close factions">×</button></div><div id="roster"></div></section>
    <div id="hud-tooltip" class="hud-tooltip hud-surface" role="tooltip" hidden></div>
    <div id="deposit-tooltip" class="hud-tooltip compact-tooltip hud-surface" role="tooltip" hidden></div>`;
}
function cardMarkup(card: HudCard) {
  const content = card.compact ?? card;
  return `<div class="tooltip-heading">${card.kind ? `<div class="tooltip-art">${icon(card.kind, card.definitionId)}</div>` : ""}<div><h3>${escape(card.title)}</h3><p>${escape(card.subtitle)}</p></div></div>${card.meter ? `<div class="tooltip-strength">${escape(card.meter.label)} · ${fmt(card.meter.value)} / ${fmt(card.meter.max)}</div>` : ""}<dl class="stat-list">${content.stats.map((s) => `<dt>${escape(s.label)}</dt><dd>${escape(s.value)}</dd>`).join("")}</dl><p class="card-description">${escape(content.description)}</p>${card.status ? `<div class="tooltip-status">${escape(card.status)}</div>` : ""}`;
}

export class HudView {
  private playerId = 1;

  private readonly drawer = new HudDrawerViewModel();
  private vm?: HudViewModel;
  private focusedRef: string | null = null;
  private membership = "";
  private portraitKind?: HudKind;
  private tooltipAnchor?: HTMLElement;
  private hoveredAnchor?: HTMLElement;
  private focusedAnchor?: HTMLElement;
  private depositHover?: { id: number; x: number; y: number };
  private selectionFingerprint = "";
  get inspectedRef(): string | null {
    return this.focusedRef;
  }
  private readonly healthCells = new Map<
    string,
    { track: HTMLElement; fill: HTMLElement }
  >();
  constructor(
    private readonly root: HTMLElement,
    onDockResize: (height: number) => void = () => {},
  ) {
    root.querySelector(".dock-age")!.addEventListener("click", () => {
      this.drawer.toggleMode();
      this.renderDrawer();
    });
    this.renderDrawer();
    root.querySelector(".command-dock")!.addEventListener(
      "wheel",
      (event) => {
        const wheel = event as WheelEvent;
        const section = (wheel.target as HTMLElement).closest<HTMLElement>(
          ".category-actions",
        );
        if (!section || section.scrollWidth <= section.clientWidth) return;
        const delta =
          Math.abs(wheel.deltaX) > Math.abs(wheel.deltaY)
            ? wheel.deltaX
            : wheel.deltaY;
        const scale =
          wheel.deltaMode === 1
            ? 16
            : wheel.deltaMode === 2
              ? section.clientWidth
              : 1;
        section.scrollLeft += delta * scale;
        wheel.preventDefault();
      },
      { passive: false },
    );
    this.el("selection-back").addEventListener("click", () =>
      this.closeInspection(),
    );
    this.el("selection-cells").addEventListener("click", (event) => {
      const cell = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-entity]",
      );
      if (cell) {
        this.focusedRef = cell.dataset.entity!;
        this.hideTooltip();
        this.renderSelection();
      }
    });
    for (const [toggle, popover] of [
      ["controls-toggle", "controls-popover"],
      ["roster-toggle", "roster-popover"],
    ]) {
      this.el(toggle).addEventListener("click", () => {
        const panel = this.el(popover);
        for (const other of ["controls-popover", "roster-popover"])
          if (other !== popover) this.el(other).hidden = true;
        this.el(
          toggle === "controls-toggle" ? "roster-toggle" : "controls-toggle",
        ).setAttribute("aria-expanded", "false");
        panel.hidden = !panel.hidden;
        this.el(toggle).setAttribute("aria-expanded", String(!panel.hidden));
      });
    }
    root.querySelectorAll<HTMLElement>("[data-close]").forEach((button) =>
      button.addEventListener("click", () => {
        this.el(button.dataset.close!).hidden = true;
        this.el(
          button.dataset.close === "controls-popover"
            ? "controls-toggle"
            : "roster-toggle",
        ).setAttribute("aria-expanded", "false");
      }),
    );
    const show = (event: Event) => {
      const anchor = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-hud-tip]",
      );
      if (event.type === "pointerover")
        this.hoveredAnchor = anchor ?? undefined;
      else this.focusedAnchor = anchor ?? undefined;
      this.chooseTooltipAnchor();
    };
    root.addEventListener("pointerover", show);
    root.addEventListener("focusin", show);
    const leave = (event: Event) => {
      const next = (event as PointerEvent | FocusEvent)
        .relatedTarget as Node | null;
      if (event.type === "pointerout") {
        if (!next || !this.hoveredAnchor?.contains(next))
          this.hoveredAnchor = undefined;
      } else if (!next || !this.focusedAnchor?.contains(next))
        this.focusedAnchor = undefined;
      this.chooseTooltipAnchor();
    };
    root.addEventListener("pointerout", leave);
    root.addEventListener("focusout", leave);
    window.addEventListener("resize", () => this.renderTooltip());
    new ResizeObserver(([entry]) => {
      const height = entry.target.getBoundingClientRect().height;
      this.root.style.setProperty("--dock-height", `${height}px`);
      onDockResize(height + 28);
    }).observe(this.root.querySelector(".command-dock")!);
  }
  private el(id: string) {
    return this.root.querySelector<HTMLElement>(`#${id}`)!;
  }
  setBuildingPlacement(active: boolean): void {
    this.drawer.setPlacement(active);
    this.renderDrawer();
  }
  setWasdMode(enabled: boolean): void {
    this.root.dataset.wasdMode = String(enabled);
    for (const action of [...CONSTRUCTION_SHORTCUTS, ...LAND_RECRUITMENT, ...NAVAL_RECRUITMENT]) {
      const id = CONSTRUCTION_SHORTCUTS.some((entry) => entry === action)
        ? `build-${action.kind}`
        : LAND_RECRUITMENT.some((entry) => entry === action)
          ? `recruit-${action.kind}` : action.kind;
      const key = this.root.querySelector<HTMLElement>(`#${id} kbd, [data-dock-action="build"][data-value="${action.kind}"] kbd`);
      if (key) key.textContent = `${enabled ? "⇧" : ""}${action.key}`;
    }
  }
  private renderDrawer(): void {
    const dock = this.root.querySelector<HTMLElement>(".command-dock")!;
    const button = dock.querySelector<HTMLButtonElement>(".dock-age")!;
    const commands = dock.querySelector<HTMLElement>(".command-row")!;
    commands.hidden = !this.drawer.expanded;
    dock.dataset.hudMode = this.drawer.dynamic ? "dynamic" : "always";
    button.setAttribute("aria-expanded", String(this.drawer.expanded));
    button.setAttribute("aria-pressed", String(this.drawer.dynamic));
    button.title = this.drawer.dynamic
      ? "Dynamic HUD: opens during building placement. Click to keep it always open."
      : "HUD always open. Click to use dynamic mode.";
    if (commands.hidden) {
      if (this.tooltipAnchor && commands.contains(this.tooltipAnchor)) this.hideTooltip();
      this.hoveredAnchor = this.focusedAnchor = undefined;
    }
  }
  reset() {
    this.vm = undefined;
    this.focusedRef = null;
    this.selectionFingerprint = "";
    this.membership = "";
    this.healthCells.clear();
    this.el("selection-card").hidden = true;
    this.hideTooltip();
    this.hoverDeposit(null);
  }
  closeInspection() {
    this.focusedRef = null;
    this.hideTooltip();
    this.renderSelection();
    for (const panel of ["controls-popover", "roster-popover"])
      this.el(panel).hidden = true;
    for (const toggle of ["controls-toggle", "roster-toggle"])
      this.el(toggle).setAttribute("aria-expanded", "false");
  }
  update(vm: HudViewModel) {
    this.playerId = vm.playerId;
    this.vm = vm;
    for (const slot of this.root.querySelectorAll<HTMLElement>(
      ".action-slot",
    )) {
      slot.tabIndex = slot.querySelector<HTMLButtonElement>("button")!.disabled
        ? 0
        : -1;
    }
    this.renderSelection();
    this.renderTooltip();
    this.renderDepositTooltip();
  }
  hoverDeposit(id: number | null, point?: { x: number; y: number }): void {
    this.depositHover = id !== null && point ? { id, ...point } : undefined;
    this.renderDepositTooltip();
  }
  private renderDepositTooltip(): void {
    const hover = this.depositHover,
      card = hover && this.vm?.depositCard(hover.id),
      tooltip = this.el("deposit-tooltip");
    tooltip.hidden = !card;
    if (!hover || !card) return;
    const markup = cardMarkup(card);
    if (tooltip.innerHTML !== markup) tooltip.innerHTML = markup;
    tooltip.style.left = `${Math.max(10, Math.min(window.innerWidth - tooltip.offsetWidth - 10, hover.x + 16))}px`;
    tooltip.style.top = `${Math.max(10, Math.min(window.innerHeight - tooltip.offsetHeight - 10, hover.y + 16))}px`;
  }
  private renderSelection() {
    if (!this.vm) return;
    const entities = this.vm.entities;
    const refs = entities.map((e) => e.ref).join(",");
    if (refs !== this.selectionFingerprint) this.focusedRef = null;
    this.selectionFingerprint = refs;
    const selection = this.vm.selectionCard(this.focusedRef, entities);
    this.el("selection-card").hidden = selection.mode === "empty";
    if (selection.mode === "empty") return;
    const mixed = selection.mode === "mixed";
    this.el("selection-detail").hidden = mixed;
    this.el("selection-mixed").hidden = !mixed;
    this.el("selection-back").hidden =
      !this.focusedRef || selection.entities.length < 2;
    if (mixed) {
      this.el("selection-label").textContent = "MIXED SELECTION";
      this.el("mixed-title").textContent =
        selection.entities.every(e => e.category === "building") ? `${selection.entities.reduce((sum, e) => sum + e.count, 0)} buildings selected` : `${selection.entities.length} units selected`;
      const membership = selection.entities
        .map((e) => `${e.ref}:${e.definitionId}`)
        .join(",");
      if (membership !== this.membership) {
        this.el("selection-cells").innerHTML = selection.entities
          .map(
            (e) =>
              `<button class="selection-cell" data-entity="${e.ref}" data-hud-tip="entity:${e.ref}" aria-label="Inspect ${escape(e.title)}">${icon(e.kind, e.definitionId)}<span>${e.category === "building" ? "Building" : `#${e.ref.split(":")[1]}`}</span><i class="cell-health"><b></b></i></button>`,
          )
          .join("");
        this.membership = membership;
        this.healthCells.clear();
        for (const cell of this.el(
          "selection-cells",
        ).querySelectorAll<HTMLElement>("[data-entity]"))
          this.healthCells.set(cell.dataset.entity!, {
            track: cell.querySelector<HTMLElement>(".cell-health")!,
            fill: cell.querySelector<HTMLElement>(".cell-health b")!,
          });
      }
      for (const e of selection.entities) {
        const cell = this.healthCells.get(e.ref)!;
        cell.track.hidden = !e.meter;
        if (e.meter)
          cell.fill.style.width = `${Math.max(0, Math.min(100, (e.meter.value / e.meter.max) * 100))}%`;
      }
    } else {
      const card = selection.card;
      this.el("selection-label").textContent =
        selection.mode === "group"
          ? "SELECTED GROUP"
          : card.category === "building"
            ? "BUILDING DETAILS"
            : card.category === "resource"
              ? "RESOURCE DETAILS"
              : card.playerId !== this.playerId
                ? "ENEMY UNIT DETAILS"
                : "UNIT DETAILS";
      if (this.portraitKind !== (card.definitionId ?? card.kind)) {
        this.el("selection-portrait").innerHTML = icon(
          card.kind,
          card.definitionId,
        );
        this.portraitKind = (card.definitionId ?? card.kind) as HudKind;
      }
      this.el("selection-title").textContent = card.title;
      this.el("selection-subtitle").textContent = card.subtitle;
      this.el("selection-status").textContent = card.status ?? "";
      const promotion = this.el("selection-promotion");
      promotion.hidden = !card.promotion;
      if (card.promotion) {
        const p = card.promotion,
          html = `<img src="${promotionUrl(p.level)}" alt="Promotion level ${p.level}"><span>Level ${p.level} · ${fmt(p.xp)} XP${p.next === null ? " · maximum" : ` / ${fmt(p.next)} for next level`}</span>`;
        if (promotion.dataset.key !== html) {
          promotion.innerHTML = html;
          promotion.dataset.key = html;
        }
      }
      this.el("selection-meter").hidden = !card.meter;
      if (card.meter) {
        this.el("meter-name").textContent = card.meter.label;
        const percent = Math.max(
          0,
          Math.min(100, (card.meter.value / card.meter.max) * 100),
        );
        const construction = card.meter.label === "Construction";
        this.el("meter-value").textContent = construction
          ? `${fmt(percent)}%`
          : `${fmt(card.meter.value)} / ${fmt(card.meter.max)}`;
        const bar = this.el("selection-health");
        bar.setAttribute("aria-label", card.meter.label);
        bar.setAttribute(
          "aria-valuenow",
          String(construction ? percent : card.meter.value),
        );
        bar.setAttribute(
          "aria-valuemax",
          String(construction ? 100 : card.meter.max),
        );
        bar.setAttribute("aria-valuemin", "0");
        bar.querySelector<HTMLElement>("i")!.style.width =
          `${Math.max(0, Math.min(100, (card.meter.value / card.meter.max) * 100))}%`;
      }
      const stats = card.stats
        .map((s) => `<dt>${escape(s.label)}</dt><dd>${escape(s.value)}</dd>`)
        .join("");
      if (this.el("selection-stats").innerHTML !== stats)
        this.el("selection-stats").innerHTML = stats;
      this.el("selection-description").textContent = card.description;
    }
  }
  private hideTooltip() {
    this.tooltipAnchor?.removeAttribute("aria-describedby");
    this.tooltipAnchor = undefined;
    this.hoveredAnchor = undefined;
    this.focusedAnchor = undefined;
    this.el("hud-tooltip").hidden = true;
  }
  private chooseTooltipAnchor() {
    const anchor = this.hoveredAnchor ?? this.focusedAnchor;
    if (anchor !== this.tooltipAnchor) {
      this.tooltipAnchor?.removeAttribute("aria-describedby");
      this.tooltipAnchor = anchor;
    }
    if (!anchor) this.el("hud-tooltip").hidden = true;
    else this.renderTooltip();
  }
  private renderTooltip() {
    const anchor = this.tooltipAnchor;
    if (!anchor || !this.vm || !anchor.isConnected) {
      this.hideTooltip();
      return;
    }
    const id = anchor.dataset.hudTip!;
    const card = id.startsWith("entity:")
      ? this.vm.entities.find((e) => `entity:${e.ref}` === id)
      : this.vm.actionCard(id);
    if (!card) {
      this.hideTooltip();
      return;
    }
    const tooltip = this.el("hud-tooltip");
    tooltip.classList.toggle("compact-tooltip", !!card.compact);
    const markup = cardMarkup(card);
    if (tooltip.innerHTML !== markup) tooltip.innerHTML = markup;
    tooltip.hidden = false;
    anchor.setAttribute("aria-describedby", "hud-tooltip");
    const bounds = anchor.getBoundingClientRect();
    let x = Math.max(
      10,
      Math.min(
        window.innerWidth - tooltip.offsetWidth - 10,
        bounds.left + bounds.width / 2 - tooltip.offsetWidth / 2,
      ),
    );
    let y = Math.max(10, bounds.top - tooltip.offsetHeight - 12);
    if (anchor.matches(".selection-cell")) {
      const card = this.el("selection-card").getBoundingClientRect();
      if (card.right + tooltip.offsetWidth + 22 <= window.innerWidth)
        x = card.right + 12;
      y = Math.max(
        10,
        Math.min(window.innerHeight - tooltip.offsetHeight - 10, bounds.top),
      );
      const dockTop = this.root
        .querySelector(".command-dock")!
        .getBoundingClientRect().top;
      const aboveDock = dockTop - tooltip.offsetHeight - 12;
      if (aboveDock >= 10) y = Math.min(y, aboveDock);
    }
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }
}
