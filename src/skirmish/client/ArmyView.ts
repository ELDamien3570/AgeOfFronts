import type { Command } from "../Protocol";
import type { ArmyOrder } from "../domain/Definitions";
import { ArmyViewModel } from "./ArmyViewModel";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const fmt = (n: number) => n.toLocaleString("en-US");
export class ArmyView {
  private vm?: ArmyViewModel;
  private fingerprint = "";
  private readonly strip: HTMLElement;
  private readonly card: HTMLElement;
  constructor(
    root: HTMLElement,
    private readonly actions: {
      command: (c: Command) => void;
      select: (ids: number[]) => void;
      target: (id: number, type: ArmyOrder["type"]) => void;
    },
  ) {
    this.strip = document.createElement("section");
    this.strip.className = "army-list hud-surface";
    this.strip.hidden = true;
    this.strip.setAttribute("aria-label", "Your armies");
    this.strip.innerHTML =
      '<button class="text-button" data-create>Create army</button><span data-list></span><select aria-label="Army to join" data-join></select><button class="text-button" data-add>Add selected</button><button class="text-button" data-detach>Detach selected</button>';
    this.card = document.createElement("aside");
    this.card.className = "army-card selection-card hud-surface";
    this.card.setAttribute("aria-label", "Army details");
    this.card.hidden = true;
    root.querySelector(".battlefield")!.append(this.strip, this.card);
    new ResizeObserver(() =>
      root.style.setProperty(
        "--army-list-height",
        `${this.strip.hidden ? 0 : this.strip.offsetHeight}px`,
      ),
    ).observe(this.strip);
    this.strip.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      if (!b || !this.vm) return;
      if (b.hasAttribute("data-create"))
        this.actions.command({
          type: "create-army",
          playerId: this.vm.playerId,
          squadIds: this.vm.selectedSquads.map((s) => s.id),
        });
      else if (b.hasAttribute("data-add"))
        this.actions.command({
          type: "army-members",
          playerId: this.vm.playerId,
          armyId: Number(
            this.strip.querySelector<HTMLSelectElement>("select")!.value,
          ),
          squadIds: this.vm.selectedSquads.map((s) => s.id),
          action: "add",
        });
      else if (b.hasAttribute("data-detach"))
        for (const army of this.vm.armies) {
          const ids = army.memberIds.filter((id) => this.vm!.selected.has(id));
          if (ids.length)
            this.actions.command({
              type: "army-members",
              playerId: this.vm.playerId,
              armyId: army.id,
              squadIds: ids,
              action: "remove",
            });
        }
      else if (b.dataset.army) {
        const army = this.vm.armies.find(
          (a) => a.id === Number(b.dataset.army),
        );
        if (army)
          this.actions.select(
            this.vm
              .members(army)
              .filter((s) => s.embarkedOn === null && !s.refit)
              .map((s) => s.id),
          );
      }
    });
    this.card.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      const army = this.vm?.selectedArmy;
      if (!b || !army) return;
      if (b.dataset.order === "hold")
        this.actions.command({
          type: "army-order",
          playerId: army.playerId,
          armyId: army.id,
          order: { type: "hold" },
        });
      else if (b.dataset.order)
        this.actions.target(army.id, b.dataset.order as ArmyOrder["type"]);
      else if (b.hasAttribute("data-disband"))
        this.actions.command({
          type: "disband-army",
          playerId: army.playerId,
          armyId: army.id,
        });
    });
    this.card.addEventListener("change", (e) => {
      const army = this.vm?.selectedArmy;
      if (army)
        this.actions.command({
          type: "army-auto",
          playerId: army.playerId,
          armyId: army.id,
          enabled: (e.target as HTMLInputElement).checked,
        });
    });
    this.strip.querySelector("select")!.addEventListener("change", () => {
      if (this.vm) this.update(this.vm);
    });
  }
  update(vm: ArmyViewModel): void {
    this.vm = vm;
    this.strip.hidden = !vm.capacity;
    if (this.strip.hidden) {
      this.card.hidden = true;
      return;
    }
    const create =
      this.strip.querySelector<HTMLButtonElement>("[data-create]")!;
    create.disabled = !!vm.createReason;
    create.title =
      vm.createReason ??
      `Organize ${vm.selectedSquads.length} squads (cap ${vm.capacity})`;
    const list = vm.armies
      .map((a) => `${a.id}:${a.memberIds.length}`)
      .join("|");
    if (list !== this.fingerprint) {
      this.fingerprint = list;
      this.strip.querySelector("[data-list]")!.innerHTML = vm.armies
        .map(
          (a) =>
            `<button class="text-button" data-army="${a.id}" title="Select army">⚑ ${escape(a.name)} <b>${a.memberIds.length}</b></button>`,
        )
        .join("");
      const join = this.strip.querySelector<HTMLSelectElement>("select")!;
      const previous = join.value;
      join.innerHTML = vm.armies
        .map((a) => `<option value="${a.id}">${escape(a.name)}</option>`)
        .join("");
      if (vm.armies.some((a) => String(a.id) === previous))
        join.value = previous;
    }
    const add = this.strip.querySelector<HTMLButtonElement>("[data-add]")!;
    const addReason = vm.addReason(
      Number(this.strip.querySelector<HTMLSelectElement>("select")!.value),
    );
    add.disabled = !!addReason;
    add.title = addReason ?? "Add selected squads to this army";
    this.strip.querySelector<HTMLButtonElement>("[data-detach]")!.disabled =
      !vm.armies.some((a) => a.memberIds.some((id) => vm.selected.has(id)));
    this.strip.querySelector<HTMLSelectElement>("select")!.hidden =
      !vm.armies.length;
    const army = vm.selectedArmy;
    this.card.hidden = !army;
    if (!army) return;
    const detail = vm.card(army);
    // Preserve focused controls while snapshots only update meters and status.
    if (this.card.dataset.army !== String(army.id)) {
      this.card.dataset.army = String(army.id);
      this.card.innerHTML = `<span class="eyebrow">PERSISTENT ARMY</span><h2>${escape(army.name)}</h2><p data-count></p><div class="health-track" role="progressbar" aria-label="Army strength"><i></i></div><p data-strength></p><p data-roles class="card-description"></p><p data-status class="status-chip"></p><p data-suspended class="card-description"></p><div class="army-orders">${[
        ["deploy", "Deploy"],
        ["flank-left", "Flank left"],
        ["flank-right", "Flank right"],
        ["fire-retreat", "Fire & retreat"],
        ["regroup", "Regroup"],
        ["hold", "Hold"],
      ]
        .map(
          ([order, label]) => `<button data-order="${order}">${label}</button>`,
        )
        .join(
          "",
        )}</div><label><input type="checkbox" aria-label="Automatic army tactics"> Automatic tactics</label><p class="card-description">Right-click to march or attack; Shift queues. Orders to a subset detach those squads.</p><button class="text-button" data-disband>Disband army</button>`;
    }
    const text = (selector: string, value: string) => {
      this.card.querySelector(selector)!.textContent = value;
    };
    text("[data-count]", `${detail.count} / ${detail.capacity} formations`);
    text(
      "[data-strength]",
      `${fmt(detail.strength)} / ${fmt(detail.maximum)} troops`,
    );
    text("[data-roles]", detail.roles);
    text(
      "[data-status]",
      `${detail.status}${detail.queued ? ` · ${detail.queued} queued` : ""}`,
    );
    text(
      "[data-suspended]",
      detail.suspended
        ? `${detail.suspended} embarked/refitting members retain their places`
        : "",
    );
    const health = this.card.querySelector<HTMLElement>(".health-track")!;
    health.setAttribute("aria-valuenow", String(detail.strength));
    health.setAttribute("aria-valuemax", String(detail.maximum));
    health.querySelector<HTMLElement>("i")!.style.width =
      `${detail.maximum ? (detail.strength / detail.maximum) * 100 : 0}%`;
    this.card.querySelector<HTMLInputElement>("input")!.checked =
      army.autoTactics;
  }
}
