import type { BuildingType, ShipType, SquadType } from "../Protocol";
import { BUILDING_RULES } from "../Rules";
import { AGE_NAMES, AGES, type Age } from "../domain/Definitions";
import { buildingPreviewArtworkId } from "./ArtworkCatalog";
import type { EmpireActions } from "./EmpireView";
import type { EmpireViewModel } from "./EmpireViewModel";
import { eraPortrait } from "./EraArtwork";
import { icon } from "./HudView";
import { SkirmishViewModel } from "./SkirmishViewModel";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (n: number) => Math.floor(n).toLocaleString("en-US");
const groups = [
  {
    id: "ores",
    name: "Raw materials",
    glyph: "M3 18 7 5l9-2 5 13-7 5Z",
    items: ["stone", "copper", "tin", "ironOre", "sulphur", "nitrate"],
  },
  {
    id: "metals",
    name: "Metals",
    glyph: "m3 15 5-7h10l3 7-5 5H7Z M3 15h18 M8 8l-1 12 M18 8l-2 12",
    items: ["bronze", "iron", "steel"],
  },
  {
    id: "energy",
    name: "Fuel & powder",
    glyph: "M12 2c2 7 8 8 8 14a8 8 0 0 1-16 0c0-5 5-7 8-14Z",
    items: ["carbon", "gunpowder", "oil"],
  },
  {
    id: "horses",
    name: "Horses",
    glyph: "m5 20 2-8-3-3 7-6 1 3 5 2 3 7-3 5Z M7 12l8-4",
    items: ["horses"],
  },
  {
    id: "equipment",
    name: "Equipment",
    glyph: "m4 20 15-15 1-3-3 1L2 18Z M5 13l6 6",
    prefix: "equipment:",
  },
  {
    id: "payloads",
    name: "Payloads",
    glyph: "M12 2 7 8v9l5 5 5-5V8Z M7 14H3v7l4-4 M17 14h4v7l-4-4",
    prefix: "payload:",
  },
] as const;
export interface DockPreferences {
  autoTier: boolean;
  tierLimit?: Age;
  choices: Partial<Record<SquadType | ShipType, string>>;
}
// The view dispatches commands selected by read-only quotes. It never mutates
// inventories, progression, world orders, or diplomacy.
export class EmpireHudView {
  private vm?: EmpireViewModel;
  private dockKey = "";
  private stockKey = "";
  private lastEvent = 0;
  private readonly log: HTMLElement;
  private readonly tip: HTMLElement;
  constructor(
    private root: HTMLElement,
    private actions: EmpireActions,
    private preferences: DockPreferences,
    private inspect: (id: number) => void,
  ) {
    const troopsHeading = root.querySelector(".troops h3")!;
    const troopsHeader = document.createElement("div");
    troopsHeader.className = "troops-heading";
    troopsHeading.replaceWith(troopsHeader);
    troopsHeader.append(troopsHeading);
    troopsHeader.insertAdjacentHTML(
      "beforeend",
      `<div class="dock-tier"><select id="recruit-tier" aria-label="Recruitment tier"><option value="">Best available</option>${AGES.map((age, i) => `<option value="${age}">${AGE_NAMES[i]}</option>`).join("")}</select><label><input id="auto-tier" type="checkbox" checked>Auto tier</label></div>`,
    );
    for (const section of ["economy", "military", "troops"])
      root
        .querySelector(`.command-category.${section} .category-actions`)!
        .insertAdjacentHTML(
          "beforeend",
          `<div id="dock-extra-${section}" class="dock-extra"></div>`,
        );
    root
      .querySelector(".command-category.ships")!
      .insertAdjacentHTML(
        "afterend",
        `<div class="command-category aviation"><h3>Air & strategic</h3><div class="category-actions" id="dock-extra-aviation"></div></div>`,
      );
    root
      .querySelector(".battlefield")!
      .insertAdjacentHTML(
        "beforeend",
        `<aside id="match-feed" class="match-feed hud-surface" aria-label="World events"><header><b>World events</b><button id="feed-toggle" aria-label="Collapse world events">−</button></header><div id="match-feed-log" role="log" aria-live="polite" aria-relevant="additions"></div></aside><div id="empire-hud-tip" class="empire-hud-tip hud-surface" role="tooltip" hidden></div>`,
      );
    this.log = root.querySelector("#match-feed-log")!;
    this.tip = root.querySelector("#empire-hud-tip")!;
    root.querySelector("#feed-toggle")!.addEventListener("click", () => {
      this.log.hidden = !this.log.hidden;
      root.querySelector("#feed-toggle")!.textContent = this.log.hidden
        ? "+"
        : "−";
    });
    root.querySelector("#recruit-tier")!.addEventListener("change", (event) => {
      this.preferences.tierLimit =
        ((event.target as HTMLSelectElement).value as Age) || undefined;
      this.chooseTier();
    });
    root.querySelector("#auto-tier")!.addEventListener("change", (event) => {
      this.preferences.autoTier = (event.target as HTMLInputElement).checked;
      this.chooseTier();
    });
    root.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-dock-action],[data-feed-player]",
      );
      if (!button || !this.vm) return;
      if (button.dataset.feedPlayer) {
        this.inspect(Number(button.dataset.feedPlayer));
        return;
      }
      this.dispatch(button.dataset.dockAction!, button.dataset.value);
    });
    root.addEventListener("pointerover", (event) =>
      this.showTip(
        (event.target as HTMLElement).closest<HTMLElement>("[data-dock-tip]"),
      ),
    );
    root.addEventListener("focusin", (event) =>
      this.showTip(
        (event.target as HTMLElement).closest<HTMLElement>("[data-dock-tip]"),
      ),
    );
    root.addEventListener("pointerout", (event) => {
      const from = (event.target as HTMLElement).closest("[data-dock-tip]"),
        to = (event as PointerEvent).relatedTarget as Node | null;
      if (from && !from.contains(to)) this.tip.hidden = true;
    });
    root.addEventListener("focusout", () => {
      this.tip.hidden = true;
    });
  }
  reset(): void {
    this.lastEvent = 0;
    this.log.replaceChildren();
    this.dockKey = "";
    this.stockKey = "";
    this.tip.hidden = true;
    this.preferences.autoTier = true;
    this.preferences.tierLimit = undefined;
    (this.root.querySelector("#auto-tier") as HTMLInputElement).checked = true;
    (this.root.querySelector("#recruit-tier") as HTMLSelectElement).value = "";
  }
  private chooseTier(): void {
    if (!this.vm) return;
    for (const line of [
      "infantry",
      "archer",
      "cavalry",
      "transport",
      "warship",
    ] as const) {
      const units =
        line === "transport" || line === "warship"
          ? this.vm.vessels(line)
          : this.vm.units(line);
      const latest = units
        .filter(
          (u) =>
            !this.preferences.tierLimit ||
            AGES.indexOf(u.age) <= AGES.indexOf(this.preferences.tierLimit),
        )
        .slice(-1)[0];
      if (!this.preferences.autoTier && this.preferences.tierLimit)
        this.preferences.choices[line] =
          `${this.preferences.tierLimit.toLowerCase()}-${line}`;
      else if (latest) this.preferences.choices[line] = latest.id;
    }
    this.dockKey = "";
    this.actions.refresh();
  }
  private showTip(anchor: HTMLElement | null): void {
    if (!anchor) {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = anchor.dataset.dockTip!;
    this.tip.hidden = false;
    const rect = anchor.getBoundingClientRect(),
      box = this.tip.getBoundingClientRect();
    this.tip.style.left = `${Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.left))}px`;
    this.tip.style.top = `${Math.max(8, rect.top > box.height + 12 ? rect.top - box.height - 8 : rect.bottom + 8)}px`;
  }
  private button(
    label: string,
    action: string,
    value: string,
    reason: string | null | undefined,
    tip: string,
    portrait?: string,
  ): string {
    const art = portrait && eraPortrait(portrait);
    return `<div class="action-slot" data-dock-tip="${esc(`${label}\n${tip}${reason ? `\n${reason}` : ""}`)}" tabindex="${reason ? 0 : -1}"><button class="hud-action" data-dock-action="${action}" data-value="${value}" ${reason ? "disabled" : ""} aria-label="${esc(label)}">${art ? `<img class="hud-art" src="${art}" alt="">` : `<span class="command-symbol">${esc(label.slice(0, 2))}</span>`}<span class="action-name">${esc(label)}</span></button></div>`;
  }
  update(vm: EmpireViewModel): void {
    this.vm = vm;
    for (const kind of [
      "city",
      "factory",
      "port",
      "barracks",
      "archery",
      "stables",
    ] as const) {
      const age = vm.buildingAge(kind);
      const button = this.root.querySelector(`#build-${kind}`)!;
      const artId = buildingPreviewArtworkId(kind, age ?? vm.progression.age);
      const art = artId && eraPortrait(artId);
      const image = button.querySelector<HTMLImageElement>(".hud-art");
      if (art && image && image.getAttribute("src") !== art) image.src = art;
    }
    const stock = groups
      .map((group) => {
        const entries = Object.entries(vm.resources.stocks).filter(([id]) =>
          "prefix" in group
            ? id.startsWith(group.prefix)
            : group.items.includes(id as never),
        );
        if (!entries.length) return "";
        const tip = `${group.name}\n${entries.map(([id, n]) => `${vm.itemName(id)}: ${fmt(n)}`).join("\n") || "No stock yet"}`;
        return `<details class="stock-group" data-stock-group="${group.id}"><summary data-dock-tip="${esc(tip)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${group.glyph}"/></svg><span>${group.name}</span><b>${fmt(entries.reduce((n, [, value]) => n + value, 0))}</b></summary><div class="stock-items">${
          entries
            .map(
              ([id, n]) =>
                `<span>${esc(vm.itemName(id))}<b>${fmt(n)}</b></span>`,
            )
            .join("") || "No stock yet"
        }</div></details>`;
      })
      .join("");
    if (stock !== this.stockKey) {
      const strip = this.root.querySelector("#strategic-stocks")!,
        opened = [
          ...strip.querySelectorAll<HTMLDetailsElement>("details[open]"),
        ].map((d) => d.dataset.stockGroup);
      const focused = (
        document.activeElement as HTMLElement | null
      )?.closest<HTMLElement>("[data-stock-group]")?.dataset.stockGroup;
      strip.innerHTML = stock;
      for (const d of strip.querySelectorAll<HTMLDetailsElement>("details"))
        d.open = opened.includes(d.dataset.stockGroup);
      if (focused)
        strip
          .querySelector<HTMLElement>(`[data-stock-group="${focused}"] summary`)
          ?.focus();
      this.stockKey = stock;
    }
    const buildings = (economy: boolean) =>
      (Object.keys(BUILDING_RULES) as BuildingType[])
        .filter(
          (type) =>
            ![
              "city",
              "factory",
              "port",
              "barracks",
              "archery",
              "stables",
            ].includes(type) &&
            ["mine", "oil-well", "oil-rig"].includes(type) === economy,
        )
        .map((type) => {
          const choice = vm.buildingPreview(type);
          return this.button(
            BUILDING_RULES[type].name,
            "build",
            type,
            choice.reason,
            `${choice.age ? AGE_NAMES[AGES.indexOf(choice.age)] : "Research required"} · ${choice.cost?.gold ?? 0} gold\n${Object.entries(
              choice.cost?.items ?? {},
            )
              .map(([id, n]) => `${n} ${vm.itemName(id)}`)
              .join(" · ")}`,
            buildingPreviewArtworkId(type, choice.age ?? vm.progression.age),
          );
        })
        .join("");
    const support = ["siege", "artillery", "anti-air", "launcher"]
      .map((role) => {
        const candidates = vm
          .units()
          .filter(
            (u) =>
              u.role === role &&
              (!this.preferences.tierLimit ||
                AGES.indexOf(u.age) <=
                  AGES.indexOf(this.preferences.tierLimit)),
          )
          .slice()
          .reverse();
        const u = this.preferences.autoTier
          ? (candidates.find((u) => !vm.recruitDefinition(u.id).reason) ??
            candidates[0])
          : candidates[0];
        if (!u) return "";
        const quote = vm.recruitDefinition(u.id);
        return this.button(
          u.name,
          "support",
          u.id,
          quote.reason,
          `${u.cost.gold ?? 0} gold · 1,000 reserves\n${Object.entries(
            u.cost.items ?? {},
          )
            .map(([id, n]) => `${n} ${vm.itemName(id)}`)
            .join(
              " · ",
            )}\n${u.attack.damage} ${u.attack.channel} damage · ${u.attack.range / 256} cells range · ${u.attack.reloadTicks / 20}s reload`,
          u.id,
        );
      })
      .join("");
    const ready = vm.expansion.aircraft.filter(
      (a) =>
        a.playerId === 1 &&
        a.state === "ready" &&
        vm.selection.selectedAircraft?.has(a.id),
    );
    const aviation =
      (["fighter", "bomber"] as const)
        .map((kind) => {
          const q = vm.aircraft(kind);
          return this.button(
            kind === "fighter" ? "Fighter" : "Bomber",
            "aircraft",
            kind,
            q.reason,
            "5,000 gold · 1,000 reserves · 1 airframe · 20 oil\n1,000 HP · 60s fuel · 6 per airfield / 32 per faction",
            kind,
          );
        })
        .join("") +
      this.button(
        "Sortie",
        "sortie",
        "",
        ready.length ? null : "Select ready aircraft",
        "Selected aircraft fly to the target and return to base.",
      ) +
      (["icbm", "hydrogen", "mirv"] as const)
        .map((payload) => {
          const q = vm.launcher(payload);
          return this.button(
            payload === "hydrogen" ? "H-bomb" : payload.toUpperCase(),
            "launch",
            payload,
            q.reason,
            `10,000 gold · 1 ${payload.toUpperCase()} payload\n36s flight · 60s launcher reload${payload === "mirv" ? " · 4 warheads" : ""}`,
            payload,
          );
        })
        .join("");
    const values = {
      economy: buildings(true),
      military: buildings(false),
      troops: support,
      aviation,
    };
    const key = JSON.stringify(values);
    if (key !== this.dockKey) {
      for (const [section, html] of Object.entries(values))
        this.root.querySelector(`#dock-extra-${section}`)!.innerHTML = html;
      this.dockKey = key;
    }
    const game = new SkirmishViewModel(
      vm.state,
      vm.selection,
      this.preferences.choices,
      this.preferences.autoTier,
      this.preferences.tierLimit,
    );
    for (const kind of [
      "infantry",
      "archer",
      "cavalry",
      "transport",
      "warship",
    ] as const) {
      const id =
          kind === "transport" || kind === "warship" ? kind : `recruit-${kind}`,
        button = this.root.querySelector<HTMLButtonElement>(`#${id}`)!,
        quote = game.recruitment(kind);
      if (button.dataset.definition !== quote.definitionId) {
        const art = button.querySelector(".hud-art,.command-symbol");
        if (art) art.outerHTML = icon(kind, quote.definitionId);
        button.dataset.definition = quote.definitionId;
      }
    }
    for (const event of vm.expansion.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      const name = (id: number | undefined) =>
          vm.state.players.find((p) => p.id === id)?.name ?? "Unknown faction",
        other = event.actorId === 1 ? event.otherId : event.actorId;
      const message =
        event.kind === "age"
          ? `${name(event.actorId)} reached ${AGE_NAMES[AGES.indexOf(event.age!)]}`
          : event.kind === "conquest"
            ? `${name(event.actorId)} defeated ${name(event.otherId)}`
            : `${name(event.actorId)} ${{ offer: "offered an alliance to", accept: "formed an alliance with", reject: "declined an alliance with", renew: "requested alliance renewal with", break: "broke the alliance with", expire: "ended its alliance with" }[event.action!]} ${name(event.otherId)}`;
      const item = document.createElement("div");
      item.className = "feed-event";
      item.innerHTML = `<time>${Math.floor(event.tick / 1200)}:${String(Math.floor(event.tick / 20) % 60).padStart(2, "0")}</time><span>${esc(message)}</span>${event.kind === "diplomacy" ? `<button data-feed-player="${other}">Open</button>` : ""}`;
      const atBottom =
        this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 20;
      this.log.append(item);
      if (this.log.children.length > 40) this.log.firstElementChild!.remove();
      if (atBottom) this.log.scrollTop = this.log.scrollHeight;
    }
  }
  private dispatch(action: string, value?: string): void {
    const vm = this.vm!;
    if (action === "build")
      this.actions.build(
        value as BuildingType,
        vm.buildingAge(value as BuildingType),
      );
    if (action === "support") {
      const q = vm.recruitDefinition(value!);
      if (q.building && !q.reason)
        this.actions.command({
          type: "recruit",
          playerId: 1,
          buildingId: q.building.id,
          definitionId: value!,
        });
    }
    if (action === "aircraft") {
      const kind = value as "fighter" | "bomber",
        q = vm.aircraft(kind);
      if (q.building && !q.reason)
        this.actions.command({
          type: "recruit-aircraft",
          playerId: 1,
          buildingId: q.building.id,
          definitionId: kind,
        });
    }
    if (action === "sortie") {
      const ids = vm.expansion.aircraft
        .filter(
          (a) =>
            a.playerId === 1 &&
            a.state === "ready" &&
            vm.selection.selectedAircraft?.has(a.id),
        )
        .map((a) => a.id);
      if (ids.length)
        this.actions.target(
          (x, y) =>
            this.actions.command({
              type: "sortie",
              playerId: 1,
              aircraftIds: ids,
              x,
              y,
            }),
          "Click sortie target · Escape cancels",
        );
    }
    if (action === "launch") {
      const payload = value as "icbm" | "hydrogen" | "mirv",
        q = vm.launcher(payload);
      if (q.launcher && !q.reason)
        this.actions.target(
          (x, y) =>
            this.actions.command({
              type: "launch",
              playerId: 1,
              launcherId: q.launcher!.id,
              payload,
              x,
              y,
            }),
          `Click ${payload.toUpperCase()} target · Escape cancels`,
        );
    }
  }
}
