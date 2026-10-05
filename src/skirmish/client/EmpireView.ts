import type { BuildingType, Command, ShipType, SquadType } from "../Protocol";

import { AGES, AGE_NAMES, type Age, type Tree } from "../domain/Definitions";

import { BUILDING_RULES } from "../Rules";

import { UNIT } from "../content/Units";
import { TRADE_RULES } from "../content/Economy";

import { AllianceRenewalView } from "./AllianceRenewalView";
import { AgeThemeView } from "./AgeThemeView";
import { AGE_UI_THEMES } from "./AgeUiTheme";
import { EmpireHudView } from "./EmpireHudView";
import type { EmpireViewModel } from "./EmpireViewModel";
import { COLORS } from "./FactionColors";
import { productionText } from "./ProductionText";
import { ResearchOpportunitiesView } from "./ResearchOpportunitiesView";
import { technologyTreeMarkup } from "./TechnologyTreeView";
import { TechnologyViewModel } from "./TechnologyViewModel";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

const fmt = (n: number) => Math.floor(n).toLocaleString("en-US");

export function empireMarkup(): string {
  return `<div id="resource-strip" class="resource-strip" aria-label="Empire resources"><div id="treasury"></div><div id="strategic-stocks"></div><span id="clock" aria-label="Game time">0:00</span><button id="technology-toggle">Technology <kbd>Y</kbd></button><button id="supplies-toggle">Supplies <kbd>I</kbd></button><button id="empire-age" type="button" aria-controls="match-topbar" aria-expanded="true" title="Show or hide the top bar">Stone Age</button></div>`;
}

export interface EmpireActions {
  recruitmentBatch?(shift: boolean): number;
  refresh(): void;
  command(command: Command): void;
  build(type: BuildingType, age?: Age): void;
  notify(text: string): void;
  focusedRef(): string | null;
  target(action: (x: number, y: number, gesture?: {shift:boolean; buildingId?:number}) => void, hint: string): void;
}

export class EmpireView {
  private get playerId(): number {
    return this.vm?.playerId ?? 1;
  }

  autoTier = true;
  tierLimit?: Age;
  private readonly dock: EmpireHudView;
  private readonly researchOpportunities: ResearchOpportunitiesView;
  private readonly ageTheme: AgeThemeView;
  private readonly allianceRenewals: AllianceRenewalView;
  readonly buildAges: Partial<Record<BuildingType, Age>> = {};
  readonly choices: Partial<Record<SquadType | ShipType, string>> = {};

  private vm?: EmpireViewModel;
  private wallPage = 0;
  private readonly pendingProduction = new Map<
    BuildingType,
    { recipeIds: string[] | null; tick: number }
  >();
  private pendingProductionResetTick?: number;

  private panel: "technology" | "supplies" | "diplomacy" | null = null;

  private browsedAge: Age = "StoneAge";

  private inspectedTechnology = "";
  private technologyDetailsExpanded = false;
  private inspectedTree: Tree = "warfare";

  private inspectedPlayer = 0;

  private previousAge?: Age;

  private fingerprint = "";

  private lastRender = -Infinity;

  constructor(
    private readonly root: HTMLElement,
    private readonly actions: EmpireActions,
  ) {
    this.ageTheme = new AgeThemeView(root);
    const main = root.querySelector(".battlefield")!;
    this.allianceRenewals = new AllianceRenewalView(main, command => this.actions.command(command));
    this.researchOpportunities = new ResearchOpportunitiesView(
      main,
      (command) => this.actions.command(command),
    );

    main.insertAdjacentHTML(
      "beforeend",
      `<section id="empire-panel" class="empire-panel hud-surface" aria-label="Empire management" hidden><header><h2 id="empire-panel-title"></h2><button id="empire-close" aria-label="Close empire panel">×</button></header><div id="empire-content"></div><div id="empire-panel-footer"></div></section>`,
    );

    root
      .querySelector(".selection-card")!
      .insertAdjacentHTML(
        "beforeend",
        `<div id="refit-actions" class="refit-actions" hidden></div>`,
      );

    for (const [button, panel] of [
      ["technology-toggle", "technology"],
      ["supplies-toggle", "supplies"],
    ] as const)
      root
        .querySelector(`#${button}`)!
        .addEventListener("click", () => this.toggle(panel));

    root
      .querySelector("#empire-close")!
      .addEventListener("click", () => this.close());

    root
      .querySelector(".dock-utility")!
      .insertAdjacentHTML(
        "beforeend",
        `<button id="infrastructure-toggle">Build & support</button>`,
      );

    root
      .querySelector("#infrastructure-toggle")!
      .addEventListener("click", () => this.toggle("supplies"));

    const gold = root.querySelector("#gold")!.closest(".resource")!,
      reserves = root.querySelector("#reserves")!.closest(".resource")!;

    root.querySelector("#treasury")!.append(gold, reserves);

    root
      .querySelector("#empire-content")!
      .addEventListener("click", (event) => this.click(event));

    root
      .querySelector("#empire-panel-footer")!
      .addEventListener("click", (event) => this.click(event));

    root
      .querySelector("#refit-actions")!
      .addEventListener("click", () => this.upgrade());

    root
      .querySelector("#empire-content")!
      .addEventListener("change", (event) => {
        const select = event.target as HTMLSelectElement;

        if (select.dataset.buildType)
          this.buildAges[select.dataset.buildType as BuildingType] =
            select.value as Age;
        if (select.dataset.line) {
          this.choices[select.dataset.line as SquadType | ShipType] =
            select.value;
          this.actions.notify(
            `Recruitment choice: ${select.selectedOptions[0]?.textContent}`,
          );
        }
      });

    for (const id of ["controls-toggle", "roster-toggle"])
      root
        .querySelector(`#${id}`)!
        .addEventListener("click", () => this.close());
    root.querySelector("#infrastructure-toggle")!.textContent = "Production";
    root.querySelector("#supplies-toggle")!.innerHTML =
      "Production <kbd>I</kbd>";
    this.dock = new EmpireHudView(root, actions, this, (id) =>
      this.inspectPlayer(id),
    );
    root.querySelector("#roster")!.addEventListener("click", (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-player]",
      );
      if (row) this.inspectPlayer(Number(row.dataset.player));
    });
  }

  reset(): void {
    this.ageTheme.reset();
    this.allianceRenewals.reset();
    this.researchOpportunities.reset();
    this.dock.reset();
    this.close();
    this.previousAge = undefined;
    this.fingerprint = "";
    this.wallPage = 0;
    this.technologyDetailsExpanded = false;
    this.pendingProduction.clear();
    this.pendingProductionResetTick = undefined;
    for (const key of Object.keys(this.buildAges))
      delete this.buildAges[key as BuildingType];
    for (const key of Object.keys(this.choices))
      delete this.choices[key as SquadType | ShipType];
  }

  inspectPlayer(id: number): void {
    this.inspectedPlayer = id;
    this.panel = "diplomacy";
    (this.root.querySelector("#roster-popover") as HTMLElement).hidden = true;
    this.render(true);
  }

  toggle(panel: "technology" | "supplies"): void {
    if (this.panel === panel) this.close();
    else {
      this.panel = panel;
      for (const id of ["controls-popover", "roster-popover"])
        (this.root.querySelector(`#${id}`) as HTMLElement).hidden = true;
      this.render(true);
    }
  }
  sortie(shift = false): void { this.dock.sortie(shift); }

  close(): boolean {
    if (!this.panel) return false;
    const opener =
      this.panel === "technology" ? "technology-toggle" : "supplies-toggle";
    this.panel = null;
    (this.root.querySelector("#empire-panel") as HTMLElement).hidden = true;
    this.root.querySelector<HTMLElement>(`#${opener}`)?.focus();
    return true;
  }

  closeDiplomacy(): boolean {
    return this.panel === "diplomacy" && this.close();
  }

  get open(): boolean {
    return !!this.panel;
  }

  update(vm: EmpireViewModel): void {
    this.vm = vm;
    this.reconcileProductionPriorities();
    this.ageTheme.update(vm.progression.age);

    if (this.previousAge !== vm.progression.age) {
      this.previousAge = vm.progression.age;
      this.browsedAge = vm.progression.age;
      this.render(true);
    }

    this.root.querySelector("#empire-age")!.textContent = vm.ageName;

    this.root.querySelector(".dock-age")!.textContent = vm.ageName;

    this.root
      .querySelector("#technology-toggle")!
      .setAttribute("title", vm.summary);

    this.dock.update(vm);
    this.researchOpportunities.update(vm);
    this.allianceRenewals.update(vm);

    const focus = this.actions.focusedRef();

    const refit = vm.selection.selected.size
      ? vm.refit(
          focus?.startsWith("squad:") ? Number(focus.split(":")[1]) : undefined,
        )
      : vm.shipRefit(
          focus?.startsWith("ship:") ? Number(focus.split(":")[1]) : undefined,
        );
    const actions = this.root.querySelector<HTMLElement>("#refit-actions")!;

    const buildingUpgrade = vm.buildingUpgrade();
    actions.hidden = !refit && !buildingUpgrade;
    if (buildingUpgrade) {
      const { upgrades, reason, cost, skipped } = buildingUpgrade;
      const key = JSON.stringify([reason, cost, skipped, upgrades.map(u => [u.building.id, u.age])]);
      if (actions.dataset.key !== key) {
        actions.dataset.key = key;
        const tiers = [...new Set(upgrades.map(u => AGE_NAMES[AGES.indexOf(u.age)]))].join(" / ");
        const items = Object.entries(cost.items ?? {}).map(([id, n]) => `${n} ${id}`).join(" · ");
        actions.innerHTML = !upgrades.length && reason === "Military buildings upgrade automatically with research"
          ? `<small>${escape(reason)}</small>`
          : `<button ${reason ? "disabled" : ""}>Upgrade ${upgrades.length} Building${upgrades.length === 1 ? "" : "s"}${tiers ? ` to ${tiers}` : ""} <kbd>U</kbd></button><small>${escape(reason ?? `${fmt(cost.gold ?? 0)} gold${items ? ` · ${items}` : ""} · production pauses${skipped ? ` · ${skipped} ineligible skipped` : ""}`)}</small>`;
      }
    }

    if (
      !buildingUpgrade && refit &&
      actions.dataset.key !==
        `${refit.reason}:${refit.target?.id}:${refit.eligibleCount}:${refit.cost?.gold}:${JSON.stringify(refit.cost?.items)}:${refit.selected.map((s) => s.id).join()}`
    ) {
      actions.dataset.key = `${refit.reason}:${refit.target?.id}:${refit.eligibleCount}:${refit.cost?.gold}:${JSON.stringify(refit.cost?.items)}:${refit.selected.map((s) => s.id).join()}`;
      actions.innerHTML = `<button ${refit.reason || !refit.target ? "disabled" : ""}>Upgrade ${refit.affordable.length}/${refit.eligibleCount} <kbd>U</kbd></button><small>${escape(refit.reason ?? `${refit.target!.name} · ${fmt(refit.cost!.gold ?? 0)} gold · ${refit.affordable.length} of ${refit.eligibleCount} eligible · 10 sec · promotion resets`)}</small>`;
    }

    if (this.panel && performance.now() - this.lastRender > 500)
      this.render(false);
  }

  upgrade(): void {
    if (!this.vm) return;
    const focus = this.actions.focusedRef();
    const buildingUpgrade = this.vm.buildingUpgrade();
    if (buildingUpgrade) {
      if (!buildingUpgrade.reason) this.actions.command({ type: "upgrade-building",
        playerId: this.playerId, buildingIds: buildingUpgrade.upgrades.map(u => u.building.id) });
      else this.actions.notify(buildingUpgrade.reason);
      return;
    }
    if (this.vm.selection.selected.size) {
      const choice = this.vm.refit(
        focus?.startsWith("squad:") ? Number(focus.split(":")[1]) : undefined,
      );
      if (choice?.target && !choice.reason)
        this.actions.command({
          type: "refit",
          playerId: this.playerId,
          squadIds: choice.selected.map((s) => s.id),
          definitionId: choice.target.id,
        });
      else if (choice)
        this.actions.notify(choice.reason ?? "No compatible refit");
    } else {
      const choice = this.vm.shipRefit(
        focus?.startsWith("ship:") ? Number(focus.split(":")[1]) : undefined,
      );
      if (choice?.target && !choice.reason)
        this.actions.command({
          type: "refit-ships",
          playerId: this.playerId,
          shipIds: choice.selected.map((s) => s.id),
          definitionId: choice.target.id,
        });
      else if (choice)
        this.actions.notify(choice.reason ?? "No compatible vessel refit");
    }
  }

  private click(event: Event): void {
    const target = event.target as HTMLElement;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (this.vm && this.panel === "technology" &&
      (button?.hasAttribute("data-details-toggle") ||
        (!button && target.closest(".technology-detail")))) {
      this.technologyDetailsExpanded = !this.technologyDetailsExpanded;
      this.render(true);
      if (!this.technologyDetailsExpanded)
        this.root.querySelector<HTMLElement>(".technology-detail-body")!.scrollTop = 0;
      return;
    }
    if (!button || button.disabled || !this.vm) return;

    const d = button.dataset;
    if (d.tree) {
      this.technologyDetailsExpanded = false;
      this.inspectedTree = d.tree as Tree;
      this.inspectedTechnology = "";
      this.render(true);
      return;
    }
    if (d.wallPage !== undefined) {
      this.wallPage = Number(d.wallPage);
      this.render(true);
      return;
    }
    if (d.age) {
      this.technologyDetailsExpanded = false;
      this.browsedAge = d.age as Age;
      this.inspectedTechnology = "";
      this.render(true);
    }

    if (d.node) {
      if (this.inspectedTechnology !== d.node) this.technologyDetailsExpanded = false;
      this.inspectedTechnology = d.node;
      this.inspectedTree = this.vm
        .nodes(this.browsedAge)
        .find((n) => n.id === d.node)!.tree;
      this.render(true);
    }

    if (d.research)
      this.actions.command({
        type: "research",
        playerId: this.playerId,
        technologyId: d.research,
      });

    if (d.advance)
      this.actions.command({ type: "advance-age", playerId: this.playerId });

    if (d.build)
      this.actions.build(
        d.build as BuildingType,
        this.buildAges[d.build as BuildingType] ?? (d.buildAge as Age),
      );

    if (d.tradeMode) {
      const naval = d.tradeMode === "sea", control = this.vm.expansion.tradeControls?.[this.playerId];
      this.actions.command({ type: "trade-pause", playerId: this.playerId, naval, paused: !(naval ? control?.seaPaused : control?.landPaused) });
      return;
    }
    if (d.tradeFaction) {
      const otherId = Number(d.tradeFaction), naval = d.tradePartnerMode === "sea";
      if (this.vm.expansion.tradeEnemies?.[this.playerId]?.includes(otherId)) return;
      const control = this.vm.expansion.tradeControls?.[this.playerId];
      const blocked = (naval ? control?.seaBlocked : control?.landBlocked)?.includes(otherId) ?? control?.blocked.includes(otherId) ?? false;
      this.actions.command({ type: "trade-block", playerId: this.playerId, otherId, naval, blocked: !blocked }); return;
    }
    if (d.priorityRecipe && d.productionType) {
      const buildingType = d.productionType as BuildingType;
      const group = this.productionGroups.find((g) => g.type === buildingType);
      if (!group) return;
      const recipeIds = group.priorityIds.includes(d.priorityRecipe)
        ? group.priorityIds.filter((id) => id !== d.priorityRecipe)
        : [...group.priorityIds, d.priorityRecipe];
      this.pendingProduction.set(buildingType, {
        recipeIds,
        tick: this.vm.state.tick,
      });
      this.actions.command({
        type: "production-priority",
        playerId: this.playerId,
        buildingType,
        recipeIds,
      });
      this.render(true);
    }
    if (d.priorityReset) {
      this.pendingProduction.set(d.priorityReset as BuildingType, {
        recipeIds: null,
        tick: this.vm.state.tick,
      });
      this.actions.command({
        type: "production-priority",
        playerId: this.playerId,
        buildingType: d.priorityReset as BuildingType,
        recipeIds: null,
      });
      this.render(true);
    }
    if (d.resetProduction) {
      this.pendingProduction.clear();
      this.pendingProductionResetTick = this.vm.state.tick;
      this.actions.command({
        type: "reset-production-priorities",
        playerId: this.playerId,
      });
      this.render(true);
    }

    if (d.recruit) {
      const u = UNIT.get(d.recruit)!;
      const choice = this.vm.recruitDefinition(u.id);
      const source = choice.building;
      if (source)
        this.actions.command({
          type: "recruit",
          playerId: this.playerId,
          buildingId: source.id,
          buildingIds: choice.buildingIds,
          definitionId: u.id,
        });
      else
        this.actions.notify(
          `Needs a completed ${BUILDING_RULES[u.building].name} of this tier`,
        );
    }

    if (d.diplomacy)
      this.actions.command({
        type: "alliance",
        playerId: this.playerId,
        otherId: Number(d.other),
        action: d.diplomacy as
          | "offer"
          | "offer-long-term"
          | "accept"
          | "reject"
          | "renew"
          | "break"
          | "declare"
          | "end-long-term",
      });

    if (d.inspect) this.inspectPlayer(Number(d.inspect));

    if (d.aircraft)
      this.actions.command({
        type: "recruit-aircraft",
        playerId: this.playerId,
        buildingId: Number(d.airfield),
        buildingIds: this.vm.aircraft(d.aircraft as "fighter" | "bomber")
          .buildingIds,
        definitionId: d.aircraft as "fighter" | "bomber",
      });

    if (d.sortie) {
      this.sortie();
    }

    if (d.launch) {
      const id = Number(d.launcher),
        payload = d.launch as "icbm" | "hydrogen" | "mirv";
      this.actions.target(
        (x, y, gesture) =>
          this.actions.command({
            type: "launch",
            playerId: this.playerId,
            launcherId: id,
            payload,
            x,
            y,
            buildingId: gesture?.buildingId,
          }),
        `Click ${payload.toUpperCase()} target · Escape cancels`,
      );
    }

    if (d.repair)
      this.actions.command({
        type: "repair",
        playerId: this.playerId,
        buildingId: Number(d.repair),
      });

    if (d.wallRepair)
      this.actions.command({
        type: "repair",
        playerId: this.playerId,
        barrierId: Number(d.wallRepair),
      });
  }

  private render(force: boolean): void {
    if (!this.vm || !this.panel) return;

    this.lastRender = performance.now();
    const vm = this.vm;

    const panel = this.root.querySelector<HTMLElement>("#empire-panel")!;
    panel.hidden = false;
    panel.classList.toggle("technology-drawer", this.panel === "technology");
    panel.classList.toggle("diplomacy-drawer", this.panel === "diplomacy");
    if (this.panel === "diplomacy") {
      const faction = vm.faction(this.inspectedPlayer);
      if (faction) {
        const theme = AGE_UI_THEMES[faction.age];
        panel.dataset.factionAge = faction.age;
        panel.style.setProperty("--diplomacy-color", COLORS[faction.player.id]);
        panel.style.setProperty(
          "--diplomacy-texture",
          `url("${theme.texture}")`,
        );
        panel.style.setProperty("--diplomacy-rim", theme.palette.rim);
      }
    } else {
      delete panel.dataset.factionAge;
      for (const property of ["color", "texture", "rim"])
        panel.style.removeProperty(`--diplomacy-${property}`);
    }

    this.root.querySelector("#empire-panel-title")!.textContent =
      this.panel === "technology"
        ? `${vm.ageName} · Technology`
        : this.panel === "supplies"
          ? "Production & trade"
          : "Diplomacy";

    const html =
      this.panel === "technology"
        ? this.technologyContent()
        : this.panel === "supplies"
          ? this.supplyContent()
          : this.diplomacyContent() + this.tradeDiplomacyControl();

    const footer =
      this.panel === "technology"
        ? `<div class="technology-progress"><b>${escape(vm.summary)}</b><p>${vm.progression.advancement ? `Advancing: ${Math.ceil(vm.progression.advancement.remainingTicks / 20)} sec` : (vm.advance.reason ?? "Two trees complete · ready to advance")}</p></div>${vm.advance.cost ? `<button data-advance="yes" ${vm.advance.reason ? "disabled" : ""}>Advance age · ${fmt(vm.advance.cost.gold)} gold · ${vm.advance.cost.ticks / 20}s</button>` : "<b>Final age</b>"}`
        : "";

    if (!force && html + footer === this.fingerprint) return;

    this.fingerprint = html + footer;

    const active = this.root.ownerDocument.activeElement as HTMLElement | null;

    const identity =
      active && panel.contains(active)
        ? Object.entries(active.dataset)
            .map(
              ([k, v]) =>
                `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${v}"]`,
            )
            .join("")
        : "";

    const content = this.root.querySelector<HTMLElement>("#empire-content")!,
      scroll = (
        content.querySelector<HTMLElement>(".technology-tree-scroll") ?? content
      ).scrollTop;

    const oldDetail = content.querySelector<HTMLElement>(".technology-detail");
    const detailScroll = oldDetail?.querySelector<HTMLElement>(".technology-detail-body")?.scrollTop ?? 0;
    content.innerHTML = html;
    this.root.querySelector("#empire-panel-footer")!.innerHTML = footer;
    (
      content.querySelector<HTMLElement>(".technology-tree-scroll") ?? content
    ).scrollTop = scroll;
    const newDetail = content.querySelector<HTMLElement>(".technology-detail");
    if (newDetail && newDetail.dataset.detailNode === oldDetail?.dataset.detailNode)
      newDetail.querySelector<HTMLElement>(".technology-detail-body")!.scrollTop = detailScroll;

    if (identity)
      panel
        .querySelector<HTMLElement>(identity)
        ?.focus({ preventScroll: true });
  }

  private technologyContent(): string {
    return technologyTreeMarkup(
      new TechnologyViewModel(this.vm!, this.browsedAge),
      this.inspectedTechnology,
      this.inspectedTree,
      this.technologyDetailsExpanded,
    );
  }

  private reconcileProductionPriorities(): void {
    const vm = this.vm!,
      actual = vm.expansion.productionPriorities?.[vm.playerId] ?? {};
    const matches = (
      a: readonly string[] | undefined,
      b: readonly string[] | null,
    ) =>
      b === null
        ? a === undefined
        : a !== undefined &&
          a.length === b.length &&
          b.every((id) => a.includes(id));
    // Only a newer simulation snapshot can acknowledge an issued command.
    if (
      this.pendingProductionResetTick !== undefined &&
      vm.state.tick > this.pendingProductionResetTick &&
      !Object.values(vm.expansion.productionPlans ?? {}).some(
        (p) => p.owner === vm.playerId,
      ) &&
      Object.entries(actual).every(([type, ids]) => {
        const pending = this.pendingProduction.get(type as BuildingType);
        return pending !== undefined && matches(ids, pending.recipeIds);
      })
    )
      this.pendingProductionResetTick = undefined;
    const ownedTypes = new Set(vm.productionGroups.map((g) => g.type));
    for (const [type, pending] of this.pendingProduction)
      if (
        !ownedTypes.has(type) ||
        (vm.state.tick > pending.tick &&
          matches(actual[type], pending.recipeIds))
      )
        this.pendingProduction.delete(type);
  }

  private get productionGroups(): EmpireViewModel["productionGroups"] {
    return this.vm!.productionGroups.map((group) => {
      const pending = this.pendingProduction.get(group.type);
      if (!pending && this.pendingProductionResetTick === undefined)
        return group;
      const selection = pending?.recipeIds ?? null;
      const priorityIds = selection ?? group.automaticPriorityIds;
      return {
        ...group,
        mode:
          selection === null ? "auto" : selection.length ? "manual" : "paused",
        priorityIds,
        recipes: group.recipes.map((recipe) => ({
          ...recipe,
          prioritized: priorityIds.includes(recipe.id),
        })),
      };
    });
  }

  private supplyContent(): string {
    const vm = this.vm!,
      groups = this.productionGroups,
      hasManual =
        groups.some((g) => g.mode !== "auto") ||
        (this.pendingProductionResetTick === undefined &&
          vm.hasManualProduction);
    const trade = vm.expansion.tradeControls?.[this.playerId];
    const walls = vm.expansion.barriers.filter(
      (w) => w.playerId === this.playerId && w.health > 0,
    );
    const wallPage = Math.min(
      this.wallPage,
      Math.max(0, Math.ceil(walls.length / 16) - 1),
    );
    const repair = vm.state.buildings.find(
      (b) =>
        b.id === vm.selection.selectedBuilding && b.playerId === this.playerId,
    );
    return `<p>Resources and equipment are folded into the top bar. Recruitment and construction are in the main command dock.</p><h3>Production</h3><p>${escape(productionText("automatic_help"))}</p><p>${escape(productionText("balancing_help"))}</p><div class="production-toolbar"><span>${escape(productionText("groups_count", { groups: groups.length, buildings: groups.reduce((sum, group) => sum + group.count, 0) }))}</span><button data-reset-production="yes" ${hasManual ? "" : "disabled"} title="${escape(productionText("reset_all_title"))}">${escape(productionText("reset_all"))}</button></div>${
      groups.map((group) => this.producerContent(group)).join("") ||
      `<p>${escape(productionText("no_producers"))}</p>`
    }<h3>Trade</h3><p>Delivered gold: ${fmt(vm.expansion.deliveredGold[this.playerId] ?? 0)} · ${vm.expansion.traders.filter((a) => a.playerId === this.playerId).length}/${TRADE_RULES.actorCap} traders</p><button data-trade-mode="land" aria-pressed="${!!trade?.landPaused}">${trade?.landPaused ? "Resume" : "Stop"} overland trade</button><button data-trade-mode="sea" aria-pressed="${!!trade?.seaPaused}">${trade?.seaPaused ? "Resume" : "Stop"} overseas trade</button>${vm.expansion.traders
      .filter((a) => a.playerId === this.playerId)
      .slice(0, 16)
      .map(
        (a) =>
          `<div class="shipment">Shipment ${a.shipmentId}: ${a.state} · ${a.cargo}/${a.loaded} cargo · ${a.visited.length} stops paid</div>`,
      )
      .join(
        "",
      )}<h3>Fortification controls</h3><p>Your troops and allies can cross friendly walls anywhere. Gates appear automatically and are visual only.</p>${repair ? `<button data-repair="${repair.id}">Repair selected ${BUILDING_RULES[repair.type].name}</button>` : "<p>Select an owned building to repair it.</p>"}<p>${walls.length} wall / trench connections · page ${wallPage + 1} / ${Math.max(1, Math.ceil(walls.length / 16))}</p><button data-wall-page="${Math.max(0, wallPage - 1)}" ${wallPage === 0 ? "disabled" : ""}>Previous connections</button><button data-wall-page="${wallPage + 1}" ${(wallPage + 1) * 16 >= walls.length ? "disabled" : ""}>Next connections</button>${walls
      .slice(wallPage * 16, wallPage * 16 + 16)
      .map(
        (w) =>
          `<button data-wall-repair="${w.id}">Repair ${w.kind === "trench" ? "trench run" : "wall"} #${w.id}</button>`,
      )
      .join("")}`;
  }

  private producerContent(
    group: EmpireViewModel["productionGroups"][number],
  ): string {
    const vm = this.vm!,
      patterns = group.recipes
        .map((recipe) => {
          const inputs =
              Object.entries(recipe.inputs)
                .map(
                  ([id, amount]) =>
                    `${vm.itemName(id)} ${vm.inventory[id] ?? 0}/${amount}`,
                )
                .join(", ") || productionText("no_inputs"),
            outputs = Object.entries(recipe.outputs)
              .map(([id, amount]) => `${amount} ${vm.itemName(id)}`)
              .join(", ");
          return `<button data-production-type="${group.type}" data-priority-recipe="${recipe.id}" aria-pressed="${recipe.prioritized}" ${recipe.reason ? "disabled" : ""} title="${escape(recipe.reason ?? productionText("priority_title"))}">${escape(recipe.name)}<small>${escape(inputs)} → ${escape(outputs)} · ${recipe.cycleTicks / 20}s</small>${recipe.reason ? `<small>${escape(recipe.reason)}</small>` : ""}</button>`;
        })
        .join("");
    const running = group.running
      .map(
        ({ recipe, recipeId, count }) =>
          `${count} × ${recipe?.name ?? recipeId}`,
      )
      .join(", ");
    return `<article class="producer" data-production-type-group="${group.type}" data-production-mode="${group.mode}"><div class="production-group-heading"><b>${escape(BUILDING_RULES[group.type].name)}</b><span>${escape(productionText("group_count", { count: group.count, ready: group.ready }))}</span></div><small>${escape(productionText(group.mode === "auto" ? "group_auto" : group.mode === "manual" ? "group_manual" : "paused"))}</small><div class="production-mode"><button data-priority-reset="${group.type}" aria-pressed="${group.mode === "auto"}" title="${escape(productionText("automatic_title"))}">${escape(productionText("automatic"))}</button></div>${running ? `<small class="production-running">${escape(productionText("running", { batches: running }))}</small>` : ""}${group.mode === "paused" ? `<small>${escape(productionText("no_priorities"))}</small>` : ""}<div class="production-patterns"><small>${escape(productionText("patterns"))}</small>${patterns}</div></article>`;
  }

  private tradeDiplomacyControl(): string {
    const vm = this.vm!, p = vm.faction(this.inspectedPlayer)?.player;
    if (!p || p.id === this.playerId || p.kind === "tribe" || p.eliminated) return "";
    const control = vm.expansion.tradeControls?.[this.playerId], atWar = vm.expansion.tradeEnemies?.[this.playerId]?.includes(p.id);
    return ["land", "sea"].map(mode=>{
      const blocked = (mode === "sea" ? control?.seaBlocked : control?.landBlocked)?.includes(p.id) ?? control?.blocked.includes(p.id) ?? false;
      return `<button data-trade-faction="${p.id}" data-trade-partner-mode="${mode}" aria-pressed="${blocked}" ${atWar ? "disabled" : ""}>${mode === "sea" ? "Sea" : "Overland"} trade · ${atWar ? "Unavailable during war" : blocked ? "Resume" : "Stop"}</button>`;
    }).join("");
  }
  private diplomacyContent(): string {
    const vm = this.vm!,
      faction = vm.faction(this.inspectedPlayer);
    if (!faction) return "Choose a faction";
    const p = faction.player, forces = vm.militaryCounts(p.id);

    const treaty = vm.expansion.diplomacy.alliances.find(
        (t) =>
          (t.a === this.playerId && t.b === p.id) ||
          (t.b === this.playerId && t.a === p.id),
      ),
      incoming = vm.incoming.find((o) => o.proposer === p.id);

    const outgoing = vm.expansion.diplomacy.offers.find(o => o.proposer === this.playerId && o.recipient === p.id),
      atWar = (vm.expansion.diplomacy.wars ?? []).some(w => (w.a === this.playerId && w.b === p.id) || (w.b === this.playerId && w.a === p.id)),
      seconds = treaty ? Math.max(0, Math.ceil((treaty.expiresTick - vm.state.tick) / 20)) : 0,
      status = treaty?.longTerm ? (treaty.ending ? `Alliance ends in ${seconds}s` : "Long Term Alliance · renews automatically") : treaty ? `Allied · ${seconds}s remaining` : atWar ? "At war" : "Independent faction";
    let buttons = "";
    if (p.kind !== "tribe" && !p.eliminated && p.id !== this.playerId) {
      if (incoming) buttons += `<button data-diplomacy="accept" data-other="${p.id}">Accept ${incoming.longTerm ? "Long Term Alliance" : "alliance"}</button><button data-diplomacy="reject" data-other="${p.id}">Reject</button>`;
      else if (outgoing) buttons += `<p>${outgoing.longTerm ? "Long Term Alliance" : "Alliance"} offered · awaiting acceptance</p>`;
      else if (!treaty?.longTerm) buttons += `${treaty ? "" : `<button data-diplomacy="offer" data-other="${p.id}">Offer alliance</button>`}<button data-diplomacy="offer-long-term" data-other="${p.id}">Long Term Alliance</button>`;
      if (treaty) buttons += `${treaty.longTerm ? (treaty.ending ? "" : `<button data-diplomacy="end-long-term" data-other="${p.id}">End alliance in 3 minutes</button>`) : `<button data-diplomacy="renew" data-other="${p.id}">Agree to renewal</button>`}<button data-diplomacy="break" data-other="${p.id}">Break alliance · ${treaty.longTerm ? 60 : 30}s betrayal penalty</button>`;
      if (!atWar) buttons += `<button data-diplomacy="declare" data-other="${p.id}">Declare War${treaty ? ` · ${treaty.longTerm ? 120 : 30}s betrayal penalty` : ""}</button>`;
    }
    return `<div class="diplomacy-identity" data-faction-kind="${p.kind === "tribe" ? "tribe" : p.ai ? "nation" : "player"}"><span class="diplomacy-kind">${p.kind === "tribe" ? "Tribe" : p.ai ? "AI nation" : "Player nation"}</span><h3>${escape(p.name)}</h3></div>${p.ai ? `<p><strong>${escape(faction.identity.personalityName)}</strong>${faction.identity.originName ? ` · ${escape(faction.identity.originName)}` : ""}</p><p>${escape(faction.identity.description)}</p>` : ""}<p class="faction-age"><strong>Current age: ${faction.ageName}</strong></p><p>${p.kind === "tribe" ? "Tribes do not negotiate" : status}</p><p>${fmt(p.land)} land · ${fmt(p.gold)} gold</p><p>${fmt(forces.squads)} squads · ${fmt(forces.boats)} warships · ${fmt(forces.planes)} plane squadrons</p>${buttons}${treaty?.longTerm ? "" : "<p>Long Term Alliance requires mutual acceptance, renews automatically, and carries a 60s betrayal penalty.</p>"}`;
  }
}
