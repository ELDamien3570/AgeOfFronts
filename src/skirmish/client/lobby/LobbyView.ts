import { MAX_EMPIRE_NAME_LENGTH } from "../../lobby/EmpireProfile";
import {
  CUSTOM_LOBBY_LIMIT,
  RESOURCE_MULTIPLIERS,
  defaultLobbySettings,
  type CustomLobby,
} from "../../lobby/LobbyDirectory";
import { empireFlag } from "./FlagCatalog";
import type { LobbyViewModel } from "./LobbyViewModel";
import { lobbyMapDimensions, type LobbyMapCard } from "./MapCatalog";

export interface LobbyActions {
  preview(mapId: string): void;
  customPreview(id: string): void;
  home(): void;
  addSample(): void;
  removeSample(): void;
  reset(): void;
  openCreate(): void;
  openFlags(): void;
  closeDialog(): void;
  chooseFlag(code: string | null): void;
  searchFlags(search: string): void;
  moreFlags(): void;
  draftName(name: string): void;
  saveProfile(name: string): void;
  createRoom(data: FormData): void;
  removeRoom(id: string): void;
}

const e = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
const arrow = '<span aria-hidden="true">↗</span>';
const compass = `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 28 28 20 23 12 28Z"/><path d="M20 23v14M3 20h9m16 0h9"/></svg>`;

function flag(
  code: string | null,
  name: string,
  className = "empire-flag",
): string {
  const selected = empireFlag(code);
  return selected
    ? `<img class="${className}" src="${e(selected.image)}" alt="${e(name)} flag: ${e(selected.name)}" width="48" height="32" />`
    : `<span class="${className} no-flag" aria-label="No flag selected">${compass}</span>`;
}

function roomCard(
  map: LobbyMapCard,
  room?: CustomLobby,
  vm?: LobbyViewModel,
): string {
  const online = vm?.online;
  const settings = room?.settings ?? defaultLobbySettings(map.id);
  const title = room?.title ?? map.name;
  const humans = vm?.directoryHumanCount(room?.id ?? `default-${map.id}`);
  const preview = room
    ? `href="#room=${room.id}" data-room="${room.id}"`
    : `href="#lobby=${map.id}" data-preview="${map.id}"`;
  return `<article class="directory-card" ${room ? `data-custom-id="${room.id}"` : `data-default="${map.id}"`}>
    <a class="directory-map" ${preview} aria-label="${online ? "Join" : "Preview"} ${e(title)} lobby"><img src="${map.image}" alt="${map.name} terrain overview" width="500" height="250" loading="lazy" /><span>${room ? "CUSTOM" : "DEFAULT"}</span></a>
    <div class="directory-card-copy"><h3>${e(title)}</h3><p class="room-owner">${room ? `${flag(room.owner.flagCode, room.owner.name, "owner-flag")}<span>${e(room.owner.name)}</span>` : map.terrain}</p>
      <div class="directory-human-count" aria-label="${humans ?? "Unknown"} connected humans out of ${settings.slots} slots"><strong>${humans ?? "—"}<small> / ${settings.slots}</small></strong><span>${online ? "HUMANS IN LOBBY" : "HUMANS · LOCAL PREVIEW"}</span></div>
      <p class="directory-meta">${settings.slots} slots <span>·</span> ${settings.countdownSeconds}s timer <span>·</span> ${settings.alliances ? "Alliances allowed" : "Free for all"}</p>
      <div class="directory-card-actions"><a class="lobby-button brass" ${preview}>${online ? "Join lobby" : "Preview lobby"} ${arrow}</a>${room && (!online || vm?.canCloseRoom(room.id)) ? `<button class="close-room" data-remove-room="${room.id}" aria-label="Close ${e(title)} lobby">Close</button>` : `<a class="quiet-link" href="/skirmish/index.html?map=${map.id}" aria-label="Play ${map.name} vs AI">Play vs AI →</a>`}</div>
    </div>
  </article>`;
}

function header(): string {
  return `<a class="skip-link" href="#main-content">Skip to content</a><header class="lobby-header"><a class="lobby-brand" href="/" data-home aria-label="Age of Fronts home"><img class="lobby-brand-mark" src="/images/age-of-fronts-stone-logo.png" alt="" width="96" height="96" /><span>AGE <small>OF</small> FRONTS</span></a><nav aria-label="Main navigation"><a href="/" data-home>Lobbies</a><a href="/skirmish/troops.html">Troop almanac</a><a class="lobby-button outline" href="/skirmish/index.html">Play vs AI ${arrow}</a></nav></header>`;
}

function footer(sourceUrl?: string): string {
  return `<footer class="lobby-footer"><span>AGE OF FRONTS <span class="footer-divider">/</span> Your empire. Your front.</span><div><span>© OpenFront and Contributors · Modified prototype</span><a href="${e(sourceUrl ?? "/age-of-fronts-source.zip")}" ${sourceUrl ? "" : "download"}>Corresponding source</a></div></footer>`;
}

function rules(vm: LobbyViewModel): string {
  const r = vm.rules;
  const dimensions = lobbyMapDimensions(vm.selectedMap, r.worldSize);
  return `<dl class="match-rules"><div><dt>Mode</dt><dd>Free for all</dd></div><div><dt>Faction slots</dt><dd>${r.slots}</dd></div><div><dt>Start timer</dt><dd>${r.countdownSeconds}s</dd></div><div><dt>Minimum humans</dt><dd>${r.minimumHumans}</dd></div><div><dt>Empty slots</dt><dd>${r.fillVacanciesWithAi ? "Filled by AI" : "Remain vacant"}</dd></div><div><dt>Alliances</dt><dd>${r.alliances ? "Allowed" : "Disabled"}</dd></div><div><dt>Victory</dt><dd>${r.victory === "allied" ? "Allied conquest" : "Solo conquest"}</dd></div><div><dt>Map size</dt><dd>${dimensions.width}×${dimensions.height}</dd></div><div><dt>Technology speed</dt><dd>${r.technologySpeed}×</dd></div><div><dt>Resource density</dt><dd>${r.resourceDensity}×</dd></div><div><dt>Deposit output</dt><dd>${r.resourceOutput}×</dd></div></dl>`;
}

function home(vm: LobbyViewModel): string {
  const custom = vm.directory.visible;
  return `<main id="main-content" class="directory-page">
    <div class="directory-heading"><div><p class="overline">GATHER YOUR EMPIRE</p><h1>Lobbies</h1><p>Choose a battlefield or make a room of your own.</p></div><button id="create-lobby" class="lobby-button brass large" data-open-create><span aria-hidden="true">＋</span> Create lobby</button></div>
    <form id="empire-customization" class="customization-bar" aria-label="Empire customization"><div class="customization-label"><span class="overline">YOUR EMPIRE</span><span>Customize your lobby identity</span></div><label class="empire-name-field" for="empire-name">Empire name<input id="empire-name" name="empireName" value="${e(vm.draftEmpireName)}" placeholder="Name your empire" autocomplete="off" required aria-describedby="empire-name-help" /><small id="empire-name-help">Up to ${MAX_EMPIRE_NAME_LENGTH} characters</small></label><div class="flag-field"><span>Empire flag</span><button type="button" id="choose-flag" data-open-flags aria-label="Choose empire flag">${flag(vm.profile.flagCode, vm.profile.name)}<span>${e(vm.selectedFlag?.name ?? "Choose a flag")}<small>Change flag ▾</small></span></button></div><button id="save-empire" type="submit" class="lobby-button outline">Save empire</button></form>
    <div class="directory-preview-label"><span class="planned-label">${vm.online ? "SHARED LOBBIES" : "LOCAL PREVIEW"}</span><p>${vm.online ? "Join a room with friends. The match starts when enough humans join and the countdown ends, or the room fills." : "Rooms and the queue are saved in this browser. Online joining will be connected next. The AI skirmish is playable now."}</p></div>
    <p id="directory-message" class="directory-message" role="status">${e(vm.message)}</p>
    <section class="lobby-holder" aria-label="Lobby directory"><div class="default-room-holder"><div class="holder-heading"><h2>Default lobbies</h2><span>${vm.maps.length} MAPS / ROTATES IN <span data-rotation-seconds>${vm.rotationSeconds}</span>S</span></div><div class="room-list" data-featured-maps data-maps="${vm.featuredMaps.map((map) => map.id).join(",")}">${vm.featuredMaps.map((map) => roomCard(map, undefined, vm)).join("")}</div></div>
      <div class="custom-room-holder"><div class="holder-heading"><h2>Custom lobbies</h2><span>${custom.length} / ${CUSTOM_LOBBY_LIMIT} DISPLAY SPACES</span></div><div class="room-list">${Array.from({ length: CUSTOM_LOBBY_LIMIT }, (_, index) => (custom[index] ? roomCard(vm.maps.find((map) => map.id === custom[index].settings.mapId)!, custom[index], vm) : `<div class="empty-room"><span class="empty-room-symbol" aria-hidden="true">＋</span><div><h3>Custom space ${String(index + 1).padStart(2, "0")}</h3><p>Your lobby can appear here.</p></div><button class="lobby-button outline" data-open-create aria-label="Create lobby in an available space">Create lobby</button></div>`)).join("")}</div></div>
    </section>
    <section class="directory-queue" aria-labelledby="queue-title"><div class="holder-heading"><div><h2 id="queue-title">Waiting for a display space</h2><p>When a custom lobby closes, the first waiting room takes its place.</p></div><span>${vm.directory.queue.length} QUEUED</span></div>${vm.directory.queue.length ? `<ol class="queue-list">${vm.directory.queue.map((room, index) => `<li><span class="queue-position">${String(index + 1).padStart(2, "0")}</span><div><strong>${e(room.title)}</strong><small>${e(room.owner.name)} · ${vm.maps.find((map) => map.id === room.settings.mapId)!.name}</small></div><span class="planned-label">WAITING</span><a class="quiet-link" href="#room=${room.id}" data-room="${room.id}" aria-label="Preview queued ${e(room.title)} lobby">Preview</a>${vm.canCloseRoom(room.id) ? `<button class="close-room" data-remove-room="${room.id}" aria-label="Cancel queued ${e(room.title)} lobby">Cancel</button>` : ""}</li>`).join("")}</ol>` : `<p class="queue-empty">No rooms waiting. If all three custom spaces are occupied, you can opt into the queue when creating a lobby.</p>`}</section>
  </main>`;
}

function lobby(vm: LobbyViewModel): string {
  const map = vm.selectedMap;
  return `<main id="main-content" class="room-page"><a class="back-link" href="#" data-home>← All lobbies</a><div class="preview-notice"><span class="planned-label">${vm.online ? "ONLINE LOBBY" : "LOCAL PREVIEW"}</span><p>${vm.online ? "Your guest identity reserves one seat. You have 60 seconds to reconnect after a disconnect." : "This lobby is a demonstration. Sample players are simulated; online joining is not available yet."}</p></div>
    <div class="room-heading"><div><p class="overline">${map.name.toUpperCase()} / ${vm.online ? "LOBBY" : "LOBBY PREVIEW"}</p><h1>${e(vm.roomTitle)}</h1><p>${map.terrain} · ${vm.rules.alliances ? "Alliances allowed" : "Free for all"}</p></div><div class="room-capacity"><strong data-human-count>${vm.humanCount} <span>/ ${vm.rules.slots}</span></strong><span>${vm.online ? "connected humans" : "human seats in preview"}</span></div></div>
    ${vm.queuePosition ? `<p class="room-queue-note">This room is waiting at display queue position ${vm.queuePosition}. You can review its preview while it waits.</p>` : ""}<div class="room-columns"><section class="room-roster" aria-labelledby="roster-title"><div class="panel-heading"><h2 id="roster-title">The war room</h2><span>${vm.rules.slots} FACTION SLOTS</span></div><div class="countdown-panel" data-phase="${vm.phase}"><div><span class="overline">${vm.online ? "LIVE LOBBY" : "LOBBY FLOW PREVIEW"}</span><h3 data-status role="status">${e(vm.status)}</h3><p data-status-detail>${e(vm.statusDetail)}</p></div><div class="countdown-clock"><strong data-countdown>${vm.countdown}</strong><span>${vm.rules.countdownSeconds}-second timer</span></div></div><div class="roster-legend"><span><i class="legend-you"></i>Your empire</span><span><i class="legend-human"></i>${vm.online ? "Player" : "Sample player"}</span><span><i class="legend-open"></i>${vm.rules.fillVacanciesWithAi ? "Vacant / AI on start" : "Vacant seat"}</span></div><ol class="seat-grid" aria-label="${vm.online ? "Lobby faction seats" : "Preview faction seats"}">${seatMarkup(vm)}</ol><div class="preview-controls" ${vm.online ? "hidden" : ""}><span>TRY THE LOBBY FLOW</span><div><button id="add-sample" class="lobby-button outline" data-add ${vm.canAddSample ? "" : "disabled"}>+ Add sample player</button><button id="remove-sample" class="lobby-button subtle" data-remove ${vm.canRemoveSample ? "" : "disabled"}>Remove sample</button><button id="reset-preview" class="lobby-button subtle" data-reset>Reset preview</button></div></div></section>
    <aside class="room-sidebar" aria-label="Selected battlefield and rules"><div class="room-map"><img src="${map.image}" alt="${map.name} terrain overview" width="500" height="250" /><div><span class="overline">SELECTED BATTLEFIELD</span><h2>${map.name}</h2><p>${map.description}</p><small>${map.imageCredit}</small></div></div><div class="room-rules"><p class="overline">${vm.online ? "MATCH RULES" : "PREVIEW MATCH RULES"}</p>${rules(vm)}<p class="room-rule-note">${vm.online ? "The timer starts at the minimum connected human count and resets below it. A match also requires reserved fallback capacity." : "The sample timer starts at the minimum human count and resets below it. The coordinator will enforce the real start rules when connected."}</p></div><div class="room-play"><a class="lobby-button brass" href="${vm.skirmishHref}">Play this map vs AI ${arrow}</a><p>Launches the existing local game with 3 AI opponents and its own match settings. Online matches use this lobby’s rules. AI practice uses its own settings.</p></div></aside></div>
  </main>`;
}

function seatMarkup(vm: LobbyViewModel): string {
  return vm.seats
    .map(
      (seat) =>
        `<li class="seat" data-kind="${seat.kind}"><span class="seat-number">${seat.number}</span><span class="seat-copy"><strong>${e(seat.name)}</strong><small>${e(seat.detail)}</small></span>${seat.kind === "you" && vm.selectedFlag ? flag(vm.profile.flagCode, vm.profile.name, "seat-flag") : `<span class="seat-emblem" aria-hidden="true">${seat.kind === "you" ? "◆" : seat.kind === "sample" ? "◇" : seat.kind === "ai" ? "▣" : "+"}</span>`}</li>`,
    )
    .join("");
}

function createDialog(vm: LobbyViewModel): string {
  return `<dialog id="lobby-dialog" class="directory-dialog" aria-labelledby="dialog-title"><form id="create-room"><div class="dialog-heading"><div><p class="overline">CUSTOM WAR ROOM</p><h2 id="dialog-title">Create a lobby</h2></div><button type="button" class="dialog-close" data-close-dialog aria-label="Close create lobby dialog">×</button></div><p class="dialog-description">${vm.online ? "Create a shared lobby with your chosen rules." : "Create a local preview, then try its roster and start rules."}</p><label>Lobby name<input name="title" value="${e(vm.profile.name)}'s lobby" maxlength="40" required /></label><label>Battlefield<select name="mapId">${vm.maps.map((map) => `<option value="${map.id}">${map.name}</option>`).join("")}</select></label><div class="settings-row three"><label>Total slots<input name="slots" type="number" min="2" max="20" value="20" required /></label><label>Minimum humans<input name="minimumHumans" type="number" min="1" max="20" value="2" required /></label><label>Start timer (seconds)<input name="countdownSeconds" type="number" min="15" max="300" value="60" required /></label></div><div class="settings-row"><label>Map size<select name="worldSize"><option value="250">250 cells · longest edge</option><option value="500" selected>500 cells · longest edge</option><option value="1000">1000 cells · longest edge</option></select></label><label>Technology speed<select name="technologySpeed"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></select></label></div><p class="settings-hint">Map size sets the longest edge. Each map retains its original proportions.</p><div class="settings-row"><label>Resource density<select name="resourceDensity" aria-describedby="resource-settings-hint">${RESOURCE_MULTIPLIERS.map((value) => `<option value="${value}">${value}×${value === 1 ? " · Normal" : ""}</option>`).join("")}</select></label><label>Deposit output<select name="resourceOutput" aria-describedby="resource-settings-hint">${RESOURCE_MULTIPLIERS.map((value) => `<option value="${value}">${value}×${value === 1 ? " · Normal" : ""}</option>`).join("")}</select></label></div><p id="resource-settings-hint" class="settings-hint">Density adds more deposit locations. Output increases extraction from each deposit. These rules apply to every faction.</p><div class="settings-row"><label>Alliances<select name="alliances"><option value="disabled">Disabled</option><option value="allowed">Allowed</option></select></label><label>Victory<select name="victory"><option value="solo">Solo conquest</option><option value="allied">Allied conquest</option></select></label></div><label class="checkbox-label"><input name="fillVacanciesWithAi" type="checkbox" checked /> AI fills vacant faction slots when the timer ends</label><div class="queue-opt-in"><p>${vm.directory.full ? "All three custom display spaces are occupied." : "There is a custom display space available."}</p><label class="checkbox-label"><input name="willingToWait" type="checkbox" /> If full, put my lobby in the waiting queue</label></div><p class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="lobby-button subtle" data-close-dialog>Cancel</button><button class="lobby-button brass" type="submit">${vm.directory.full ? "Create / join queue" : "Create lobby"} ${arrow}</button></div></form></dialog>`;
}

function flagResults(vm: LobbyViewModel): string {
  return `${vm.visibleFlags.length ? vm.visibleFlags.map((entry) => `<button type="button" class="flag-choice" data-flag="${e(entry.code)}" aria-pressed="${vm.profile.flagCode === entry.code}" aria-label="Choose ${e(entry.name)} flag"><img src="${e(entry.image)}" alt="" width="48" height="32" loading="lazy" /><span>${e(entry.name)}</span></button>`).join("") : '<p class="no-flag-results">No matching flags.</p>'}`;
}

function flagsDialog(vm: LobbyViewModel): string {
  return `<dialog id="lobby-dialog" class="directory-dialog flags-dialog" aria-labelledby="dialog-title"><div class="dialog-heading"><div><p class="overline">EMPIRE CUSTOMIZATION</p><h2 id="dialog-title">Choose your flag</h2></div><button class="dialog-close" data-close-dialog aria-label="Close flag picker">×</button></div><p class="dialog-description">OpenFront's local country and historical flag catalog.</p><label for="flag-search">Search flags<input id="flag-search" type="search" placeholder="Search a country or historical empire…" value="${e(vm.flagSearch)}" /></label><div class="flag-picker-meta"><button class="quiet-link" data-no-flag>Use no flag</button><span data-flag-count>${vm.flagMatches.length} flags</span></div><div class="flag-grid">${flagResults(vm)}</div><button class="lobby-button outline more-flags" data-more-flags ${vm.visibleFlags.length >= vm.flagMatches.length ? "hidden" : ""}>Show more flags</button><p class="dialog-error" role="alert" hidden></p></dialog>`;
}

export class LobbyView {
  private dialogTriggerId: string | undefined;
  constructor(
    private root: HTMLElement,
    private actions: LobbyActions,
    private sourceUrl?: string,
  ) {
    root.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>(
        "[data-preview],[data-room],[data-home],[data-add],[data-remove],[data-reset],[data-open-create],[data-open-flags],[data-close-dialog],[data-flag],[data-no-flag],[data-more-flags],[data-remove-room]",
      );
      if (!action || !root.contains(action)) return;
      if (
        event instanceof MouseEvent &&
        (event.button !== 0 ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey)
      )
        return;
      event.preventDefault();
      if (action.dataset.preview) this.actions.preview(action.dataset.preview);
      else if (action.dataset.room)
        this.actions.customPreview(action.dataset.room);
      else if (action.hasAttribute("data-home")) this.actions.home();
      else if (action.hasAttribute("data-add")) this.actions.addSample();
      else if (action.hasAttribute("data-remove")) this.actions.removeSample();
      else if (action.hasAttribute("data-reset")) this.actions.reset();
      else if (action.hasAttribute("data-open-create"))
        this.actions.openCreate();
      else if (action.hasAttribute("data-open-flags")) this.actions.openFlags();
      else if (action.hasAttribute("data-close-dialog"))
        this.actions.closeDialog();
      else if (action.dataset.flag)
        this.actions.chooseFlag(action.dataset.flag);
      else if (action.hasAttribute("data-no-flag"))
        this.actions.chooseFlag(null);
      else if (action.hasAttribute("data-more-flags")) this.actions.moreFlags();
      else if (action.dataset.removeRoom)
        this.actions.removeRoom(action.dataset.removeRoom);
    });
    root.addEventListener("submit", (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      const data = new FormData(form);
      if (form.id === "empire-customization")
        this.actions.saveProfile(String(data.get("empireName") ?? ""));
      if (form.id === "create-room") this.actions.createRoom(data);
    });
    root.addEventListener("input", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      if (input.id === "empire-name") this.actions.draftName(input.value);
      if (input.id === "flag-search") this.actions.searchFlags(input.value);
    });
  }

  render(vm: LobbyViewModel): void {
    const focusedId = this.root.contains(document.activeElement)
      ? document.activeElement?.id
      : undefined;
    this.root.innerHTML = `${header()}${vm.page === "home" ? home(vm) : lobby(vm)}${footer(this.sourceUrl)}<div id="dialog-holder"></div>`;
    if (focusedId)
      document.getElementById(focusedId)?.focus({ preventScroll: true });
  }

  renderDialog(vm: LobbyViewModel): void {
    this.dialogTriggerId = document.activeElement?.id;
    this.root.querySelector("#dialog-holder")!.innerHTML =
      vm.dialog === "flags" ? flagsDialog(vm) : createDialog(vm);
    const dialog = this.root.querySelector<HTMLDialogElement>("dialog")!;
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.actions.closeDialog();
    });
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")?.focus();
  }

  refreshDirectory(vm: LobbyViewModel): void {
    const holder = this.root.querySelector<HTMLElement>("[data-featured-maps]");
    if (!holder) return;
    // Do not replace the navigation control someone is using with the keyboard.
    if (!holder.contains(document.activeElement)) {
      const signature = vm.featuredMaps.map((map) => map.id).join(",");
      if (holder.dataset.maps !== signature) {
        holder.innerHTML = vm.featuredMaps
          .map((map) => roomCard(map, undefined, vm))
          .join("");
        holder.dataset.maps = signature;
      }
    }
    const timer = this.root.querySelector("[data-rotation-seconds]");
    if (timer) timer.textContent = String(vm.rotationSeconds);
  }

  closeDialog(): void {
    this.root.querySelector<HTMLDialogElement>("dialog")?.close();
    this.root.querySelector("#dialog-holder")!.innerHTML = "";
    if (this.dialogTriggerId)
      document.getElementById(this.dialogTriggerId)?.focus();
  }

  showDialogError(message: string): void {
    const error = this.root.querySelector<HTMLElement>(".dialog-error")!;
    error.textContent = message;
    error.hidden = false;
  }

  refreshFlagResults(vm: LobbyViewModel): void {
    this.root.querySelector(".flag-grid")!.innerHTML = flagResults(vm);
    this.root.querySelector("[data-flag-count]")!.textContent =
      `${vm.flagMatches.length} ${vm.flagMatches.length === 1 ? "flag" : "flags"}`;
    this.root.querySelector<HTMLButtonElement>("[data-more-flags]")!.hidden =
      vm.visibleFlags.length >= vm.flagMatches.length;
  }

  refreshPreview(vm: LobbyViewModel): void {
    const text = (selector: string, value: string) => {
      const element = this.root.querySelector(selector);
      if (element && element.textContent !== value) element.textContent = value;
    };
    text("[data-countdown]", vm.countdown);
    text("[data-status]", vm.status);
    text("[data-status-detail]", vm.statusDetail);
    this.root.querySelector("[data-human-count]")!.innerHTML =
      `${vm.humanCount} <span>/ ${vm.rules.slots}</span>`;
    this.root.querySelector<HTMLElement>(".countdown-panel")!.dataset.phase =
      vm.phase;
    this.root.querySelector(".seat-grid")!.innerHTML = seatMarkup(vm);
    this.root.querySelector<HTMLButtonElement>("[data-add]")!.disabled =
      !vm.canAddSample;
    this.root.querySelector<HTMLButtonElement>("[data-remove]")!.disabled =
      !vm.canRemoveSample;
  }
}
