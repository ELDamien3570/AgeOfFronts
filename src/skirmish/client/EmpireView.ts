import type { BuildingType, Command, ShipType, SquadType } from "../Protocol";

import { type Age, type Tree } from "../domain/Definitions";

import { BUILDING_RULES } from "../Rules";

import { UNIT } from "../content/Units";

import { AgeThemeView } from "./AgeThemeView";
import { EmpireHudView } from "./EmpireHudView";
import type { EmpireViewModel } from "./EmpireViewModel";
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
  return `<div id="resource-strip" class="resource-strip" aria-label="Empire resources"><div id="treasury"></div><div id="strategic-stocks"></div><button id="technology-toggle">Technology <kbd>Y</kbd></button><button id="supplies-toggle">Supplies <kbd>I</kbd></button><span id="empire-age">Stone Age</span></div>`;
}

export interface EmpireActions {
  refresh(): void;
  command(command: Command): void;
  build(type: BuildingType, age?: Age): void;
  notify(text: string): void;
  focusedRef(): string | null;
  target(action: (x: number, y: number) => void, hint: string): void;
}

export class EmpireView {
  autoTier = true;
  tierLimit?: Age;
  private readonly dock: EmpireHudView;
  private readonly ageTheme: AgeThemeView;
  readonly buildAges: Partial<Record<BuildingType, Age>> = {};
  readonly choices: Partial<Record<SquadType | ShipType, string>> = {};

  private vm?: EmpireViewModel;
  private productionPage = 0;
  private wallPage = 0;

  private panel: "technology" | "supplies" | "diplomacy" | null = null;

  private browsedAge: Age = "StoneAge";

  private inspectedTechnology = "";
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
    this.dock.reset();
    this.close();
    this.previousAge = undefined;
    this.fingerprint = "";
    this.productionPage = 0;
    this.wallPage = 0;
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

  close(): boolean {
    if (!this.panel) return false;
    const opener =
      this.panel === "technology" ? "technology-toggle" : "supplies-toggle";
    this.panel = null;
    (this.root.querySelector("#empire-panel") as HTMLElement).hidden = true;
    this.root.querySelector<HTMLElement>(`#${opener}`)?.focus();
    return true;
  }

  get open(): boolean {
    return !!this.panel;
  }

  update(vm: EmpireViewModel): void {
    this.vm = vm;
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

    const focus = this.actions.focusedRef();

    const refit = vm.selection.selected.size
      ? vm.refit(
          focus?.startsWith("squad:") ? Number(focus.split(":")[1]) : undefined,
        )
      : vm.shipRefit(
          focus?.startsWith("ship:") ? Number(focus.split(":")[1]) : undefined,
        );
    const actions = this.root.querySelector<HTMLElement>("#refit-actions")!;

    actions.hidden = !refit;

    if (
      refit &&
      actions.dataset.key !==
        `${refit.reason}:${refit.target?.id}:${refit.selected.map((s) => s.id).join()}`
    ) {
      actions.dataset.key = `${refit.reason}:${refit.target?.id}:${refit.selected.map((s) => s.id).join()}`;
      actions.innerHTML = `<button ${refit.reason || !refit.target ? "disabled" : ""}>Upgrade ${refit.selected.length} <kbd>U</kbd></button><small>${escape(refit.reason ?? `${refit.target!.name} · ${fmt(refit.cost!.gold)} gold · 10 sec · promotion resets`)}</small>`;
    }

    if (this.panel && performance.now() - this.lastRender > 500)
      this.render(false);
  }

  upgrade(): void {
    if (!this.vm) return;
    const focus = this.actions.focusedRef();
    if (this.vm.selection.selected.size) {
      const choice = this.vm.refit(
        focus?.startsWith("squad:") ? Number(focus.split(":")[1]) : undefined,
      );
      if (choice?.target && !choice.reason)
        this.actions.command({
          type: "refit",
          playerId: 1,
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
          playerId: 1,
          shipIds: choice.selected.map((s) => s.id),
          definitionId: choice.target.id,
        });
      else if (choice)
        this.actions.notify(choice.reason ?? "No compatible vessel refit");
    }
  }

  private click(event: Event): void {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "button",
    );
    if (!button || button.disabled || !this.vm) return;

    const d = button.dataset;
    if (d.tree) {
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
    if (d.productionPage !== undefined) {
      this.productionPage = Number(d.productionPage);
      this.render(true);
      return;
    }

    if (d.age) {
      this.browsedAge = d.age as Age;
      this.inspectedTechnology = "";
      this.render(true);
    }

    if (d.node) {
      this.inspectedTechnology = d.node;
      this.inspectedTree = this.vm
        .nodes(this.browsedAge)
        .find((n) => n.id === d.node)!.tree;
      this.render(true);
    }

    if (d.research)
      this.actions.command({
        type: "research",
        playerId: 1,
        technologyId: d.research,
      });

    if (d.advance) this.actions.command({ type: "advance-age", playerId: 1 });

    if (d.build)
      this.actions.build(
        d.build as BuildingType,
        this.buildAges[d.build as BuildingType] ?? (d.buildAge as Age),
      );

    if (d.recipe)
      this.actions.command({
        type: "produce",
        playerId: 1,
        buildingId: Number(d.producer),
        recipeId: d.recipe,
      });

    if (d.recruit) {
      const u = UNIT.get(d.recruit)!;
      const source = this.vm.recruitDefinition(u.id).building;
      if (source)
        this.actions.command({
          type: "recruit",
          playerId: 1,
          buildingId: source.id,
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
        playerId: 1,
        otherId: Number(d.other),
        action: d.diplomacy as
          | "offer"
          | "accept"
          | "reject"
          | "renew"
          | "break",
      });

    if (d.inspect) this.inspectPlayer(Number(d.inspect));

    if (d.aircraft)
      this.actions.command({
        type: "recruit-aircraft",
        playerId: 1,
        buildingId: Number(d.airfield),
        definitionId: d.aircraft as "fighter" | "bomber",
      });

    if (d.sortie) {
      const ids = this.vm.expansion.aircraft
        .filter((a) => a.playerId === 1 && a.state === "ready")
        .map((a) => a.id);
      this.actions.target(
        (x, y) =>
          this.actions.command({
            type: "sortie",
            playerId: 1,
            aircraftIds: ids,
            x,
            y,
          }),
        "Click a sortie target · Escape cancels",
      );
    }

    if (d.launch) {
      const id = Number(d.launcher),
        payload = d.launch as "icbm" | "hydrogen" | "mirv";
      this.actions.target(
        (x, y) =>
          this.actions.command({
            type: "launch",
            playerId: 1,
            launcherId: id,
            payload,
            x,
            y,
          }),
        `Click ${payload.toUpperCase()} target · Escape cancels`,
      );
    }

    if (d.repair)
      this.actions.command({
        type: "repair",
        playerId: 1,
        buildingId: Number(d.repair),
      });

    if (d.gate) {
      const id = Number(d.gate);
      this.actions.target(
        (x, y) =>
          this.actions.command({
            type: "gate",
            playerId: 1,
            barrierId: id,
            tile:
              Math.floor(y / 256) * this.vm!.state.width + Math.floor(x / 256),
          }),
        "Click a tile on this wall to build a gate · 250 gold",
      );
    }

    if (d.wallRepair)
      this.actions.command({
        type: "repair",
        playerId: 1,
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
          : this.diplomacyContent();

    const footer =
      this.panel === "technology"
        ? `<b>${escape(vm.summary)}</b><p>${vm.progression.advancement ? `Advancing: ${Math.ceil(vm.progression.advancement.remainingTicks / 20)} sec` : (vm.advance.reason ?? "Two trees complete · ready to advance")}</p>${vm.advance.cost ? `<button data-advance="yes" ${vm.advance.reason ? "disabled" : ""}>Advance age · ${fmt(vm.advance.cost.gold)} gold · ${vm.advance.cost.ticks / 20}s</button>` : "<b>Final age</b>"}`
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
      scroll = content.scrollTop;

    content.innerHTML = html;
    this.root.querySelector("#empire-panel-footer")!.innerHTML = footer;
    content.scrollTop = scroll;

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
    );
  }

  private supplyContent(): string {
    const vm = this.vm!,
      all = vm.producers.filter((p) => p.recipes.length),
      page = Math.min(
        this.productionPage,
        Math.max(0, Math.ceil(all.length / 12) - 1),
      );
    const cards = all.slice(page * 12, page * 12 + 12);
    const walls = vm.expansion.barriers.filter(
      (w) => w.playerId === 1 && w.health > 0,
    );
    const wallPage = Math.min(
      this.wallPage,
      Math.max(0, Math.ceil(walls.length / 16) - 1),
    );
    const repair = vm.state.buildings.find(
      (b) => b.id === vm.selection.selectedBuilding && b.playerId === 1,
    );
    return `<p>Resources and equipment are folded into the top bar. Recruitment and construction are in the main command dock.</p><h3>Production</h3><p>${all.length} producers · page ${page + 1} / ${Math.max(1, Math.ceil(all.length / 12))}</p><button data-production-page="${Math.max(0, page - 1)}" ${page === 0 ? "disabled" : ""}>Previous</button><button data-production-page="${page + 1}" ${(page + 1) * 12 >= all.length ? "disabled" : ""}>Next</button>${
      cards
        .map(
          ({ building: b, selected, recipes }) =>
            `<article class="producer"><b>${escape(BUILDING_RULES[b.type].name)} #${b.id}</b><small>${escape(vm.productionStatus(b.id))}</small><div>${recipes
              .map((r) => {
                const choice = vm.productionChoice(b.id, r.id),
                  inputs =
                    choice.inputs
                      .map(
                        (i) =>
                          `${vm.itemName(i.id)} ${i.available}/${i.required}`,
                      )
                      .join(", ") || "No material input",
                  outputs = choice.outputs
                    .map((i) => `${i.amount} ${vm.itemName(i.id)}`)
                    .join(", ");
                return `<button data-producer="${b.id}" data-recipe="${r.id}" aria-pressed="${selected?.id === r.id}" ${choice.reason ? "disabled" : ""} title="${escape(choice.reason ?? `${inputs} → ${outputs} · ${choice.cycleTicks / 20}s · repeats when supplied`)}">${escape(r.name)}<small>${escape(inputs)} → ${escape(outputs)} · ${choice.cycleTicks / 20}s</small></button>`;
              })
              .join("")}</div></article>`,
        )
        .join("") || "<p>Build a factory or equipment producer.</p>"
    }<h3>Trade</h3><p>Delivered gold: ${fmt(vm.expansion.deliveredGold[1] ?? 0)} · ${vm.expansion.traders.filter((a) => a.playerId === 1).length}/64 traders</p>${vm.expansion.traders
      .filter((a) => a.playerId === 1)
      .slice(0, 16)
      .map(
        (a) =>
          `<div class="shipment">Shipment ${a.shipmentId}: ${a.state} · ${a.cargo}/${a.loaded} cargo · ${a.visited.length} stops paid</div>`,
      )
      .join(
        "",
      )}<h3>Fortification controls</h3>${repair ? `<button data-repair="${repair.id}">Repair selected ${BUILDING_RULES[repair.type].name}</button>` : "<p>Select an owned building to repair it.</p>"}<p>${walls.length} wall segments · page ${wallPage + 1} / ${Math.max(1, Math.ceil(walls.length / 16))}</p><button data-wall-page="${Math.max(0, wallPage - 1)}" ${wallPage === 0 ? "disabled" : ""}>Previous walls</button><button data-wall-page="${wallPage + 1}" ${(wallPage + 1) * 16 >= walls.length ? "disabled" : ""}>Next walls</button>${walls
      .slice(wallPage * 16, wallPage * 16 + 16)
      .map(
        (w) =>
          `<button data-gate="${w.id}">Gate · wall #${w.id}</button><button data-wall-repair="${w.id}">Repair wall #${w.id}</button>`,
      )
      .join("")}`;
  }

  private diplomacyContent(): string {
    const vm = this.vm!,
      faction = vm.faction(this.inspectedPlayer);
    if (!faction) return "Choose a faction";
    const p = faction.player;

    const treaty = vm.expansion.diplomacy.alliances.find(
        (t) => (t.a === 1 && t.b === p.id) || (t.b === 1 && t.a === p.id),
      ),
      incoming = vm.incoming.find((o) => o.proposer === p.id);

    return `<h3>${escape(p.name)}</h3><p class="faction-age"><strong>Current age: ${faction.ageName}</strong></p><p>${p.kind === "tribe" ? "Tribes do not negotiate" : treaty ? `Allied · ${Math.ceil((treaty.expiresTick - vm.state.tick) / 20)}s remaining` : "Independent faction"}</p><p>${fmt(p.land)} land · ${fmt(p.gold)} gold</p>${p.kind === "tribe" || p.eliminated ? "" : treaty ? `<button data-diplomacy="renew" data-other="${p.id}">Agree to renewal</button><button data-diplomacy="break" data-other="${p.id}">Break alliance · 30s betrayal penalty</button>` : incoming ? `<button data-diplomacy="accept" data-other="${p.id}">Accept alliance</button><button data-diplomacy="reject" data-other="${p.id}">Reject</button>` : `<button data-diplomacy="offer" data-other="${p.id}">Offer alliance</button>`}<p>Allies retain their own units, supplies, buildings and research.</p>`;
  }
}
