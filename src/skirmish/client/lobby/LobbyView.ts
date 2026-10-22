import english from "../../../../resources/lang/en.json";
import { translateText } from "../../../client/Utils";
import { isProceduralMap } from "../../content/Maps";
import { FACTION_PALETTE } from "../../lobby/FactionPalette";
import { STARTING_AGES, startingAgeName } from "../../domain/Definitions";
import {
  factionCountRange,
  factionDefaults,
  MAX_HUMAN_PLAYERS,
  type FactionWorldSize,
} from "../../FactionRules";
import { MAX_EMPIRE_NAME_LENGTH } from "../../lobby/EmpireProfile";
import {
  defaultLobbySettings,
  RESOURCE_MULTIPLIERS,
  type CustomLobby,
} from "../../lobby/LobbyDirectory";
import { FRIENDS_MATCH_RULES } from "../../lobby/LobbyRules";
import { playtestRuleFields, playtestRuleRows } from "./PlaytestRulesText";
import { empireFlag } from "./FlagCatalog";
import { liveMatchCard } from "./LiveMatchCards";
import type { LobbyViewModel } from "./LobbyViewModel";
import { lobbyMapDimensions, type LobbyMapCard } from "./MapCatalog";

export interface LobbyActions {
  preview(mapId: string): void;
  customPreview(id: string): void;
  home(): void;
  addSample(): void;
  removeSample(): void;
  reset(): void;
  voteStart(): void;
  voteMap(mapId: string): void;
  openCreate(): void;
  openFlags(): void;
  closeDialog(): void;
  chooseFlag(code: string | null): void;
  searchFlags(search: string): void;
  moreFlags(): void;
  draftName(name: string): void;
  saveProfile(name: string): void;
  chooseColor(index: number | null): void;
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

/** min/max/value attributes for a faction-count input at a map size. */
export function factionInputRange(
  worldSize: FactionWorldSize,
  kind: "aiCount" | "tribeCount",
): string {
  const { min, max } = factionCountRange(worldSize, kind);
  return `min="${min}" max="${max}" value="${factionDefaults(worldSize)[kind]}"`;
}
export function factionHint(worldSize: FactionWorldSize): string {
  const base = factionDefaults(worldSize),
    ai = factionCountRange(worldSize, "aiCount"),
    tribes = factionCountRange(worldSize, "tribeCount");
  return `This map size starts with ${base.aiCount} AI opponents and ${base.tribeCount} tribes. Choose ${ai.min}–${ai.max} AI and ${tribes.min}–${tribes.max} tribes. Humans join on top of these.`;
}
const WORLD_SIZE_HINT_KEY = "skirmish_lobby.procedural_1000_hint";
/** Translated text for the slow-preparation hint, with an English fallback before translations load. */
function worldSizeHintText(): string {
  const translated = translateText(WORLD_SIZE_HINT_KEY);
  return translated !== WORLD_SIZE_HINT_KEY ? translated : english.skirmish_lobby.procedural_1000_hint;
}
/** Procedural maps at 1000 cells take the server tens of seconds to prepare (R2-P1). */
export function showsWorldSizeHint(mapId: string, worldSize: number): boolean {
  return worldSize === 1000 && isProceduralMap(mapId);
}
function updateWorldSizeHint(form: HTMLFormElement): void {
  const hint = form.querySelector<HTMLElement>("#world-size-hint");
  const map = form.elements.namedItem("mapId"), size = form.elements.namedItem("worldSize");
  if (!hint || !(map instanceof HTMLSelectElement) || !(size instanceof HTMLSelectElement)) return;
  hint.hidden = !showsWorldSizeHint(map.value, Number(size.value));
}
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
    <a class="directory-map" ${preview} aria-label="${online ? "Join" : "Preview"} ${e(title)} lobby"><img src="${map.image}" alt="${map.name} terrain overview" width="500" height="250" loading="lazy" /><span>${room ? "CUSTOM" : "PUBLIC"}</span></a>
    <div class="directory-card-copy"><h3>${e(title)}</h3><p class="room-owner">${room ? `${flag(room.owner.flagCode, room.owner.name, "owner-flag")}<span>${e(room.owner.name)}</span>` : map.terrain}</p>
      <div class="directory-human-count" aria-label="${humans ?? "Unknown"} connected humans out of ${settings.slots} seats"><strong>${humans ?? "—"}<small> / ${settings.slots}</small></strong><span>${online ? "HUMANS IN LOBBY" : "HUMANS · LOCAL PREVIEW"}</span></div>
      <p class="directory-meta">${settings.slots} human seats <span>·</span> ${settings.aiCount} AI <span>·</span> ${settings.tribeCount} tribes${settings.startingAge && settings.startingAge !== "StoneAge" ? ` <span>·</span> ${startingAgeName(settings.startingAge)}` : ""} <span>·</span> ${settings.countdownSeconds}s timer <span>·</span> ${settings.alliances ? "Alliances allowed" : "Free for all"}</p>
      <div class="directory-card-actions"><a class="lobby-button brass" ${preview}>${online ? "Join lobby" : "Preview lobby"} ${arrow}</a>${room && (!online || vm?.canCloseRoom(room.id)) ? `<button class="close-room" data-remove-room="${room.id}" aria-label="Close ${e(title)} lobby">Close</button>` : `<a class="quiet-link" href="/skirmish/index.html?map=${map.id}" aria-label="Play ${map.name} vs AI">Play vs AI →</a>`}</div>
    </div>
  </article>`;
}

function colorSelector(vm: LobbyViewModel): string {
  const selected = vm.selectedColorIndex;
  const color = selected === null ? "transparent" : FACTION_PALETTE[selected].hex;
  return `<label class="faction-color-field" for="faction-color"><span>Faction color <i class="faction-color-swatch" style="background:${color}" aria-hidden="true"></i></span><select id="faction-color" aria-describedby="faction-color-help"${vm.online && !vm.connected && vm.joinedOnlineRoom ? " disabled" : ""}><option value=""${selected === null ? " selected" : ""}>Automatic</option>${vm.colorChoices.map(entry => `<option value="${entry.index}"${selected === entry.index ? " selected" : ""}>${entry.name}${entry.inUse ? " · in use" : ""}</option>`).join("")}</select><small id="faction-color-help">Several players may choose the same color.</small>${vm.colorError ? `<small class="faction-color-error" role="alert">${e(vm.colorError)}</small>` : ""}</label>`;
}

function header(): string {
  return `<a class="skip-link" href="#main-content">Skip to content</a><header class="lobby-header"><a class="lobby-brand" href="/" data-home aria-label="Age of Fronts home"><img class="lobby-brand-mark" src="/images/age-of-fronts-stone-logo.png" alt="" width="96" height="96" /><span>AGE <small>OF</small> FRONTS<span class="brand-caption">b1.6.3</span></span></a><nav aria-label="Main navigation"><a href="/" data-home>Lobbies</a><a href="/skirmish/troops.html">Troop almanac</a>${import.meta.env.DEV ? '<a href="/skirmish/technology-planner.html">Civilization workshop</a>' : ""}<a class="lobby-button outline" href="/skirmish/index.html">Play vs AI ${arrow}</a></nav></header>`;
}

function footer(sourceUrl?: string): string {
  return `<footer class="lobby-footer"><span>AGE OF FRONTS <span class="footer-divider">/</span> Your empire. Your front.</span><div><span>© OpenFront and Contributors · Modified prototype</span><a href="${e(sourceUrl ?? "/age-of-fronts-source.zip")}" ${sourceUrl ? "" : "download"}>Corresponding source</a></div></footer>`;
}

function rules(vm: LobbyViewModel): string {
  const r = vm.rules;
  const dimensions = lobbyMapDimensions(vm.selectedMap, r.worldSize);
  return `<dl class="match-rules"><div><dt>Mode</dt><dd>Free for all</dd></div><div><dt>Human seats</dt><dd>${r.slots}</dd></div><div><dt>AI opponents</dt><dd>${r.aiCount}</dd></div><div><dt>Tribes</dt><dd>${r.tribeCount}</dd></div><div><dt>Start timer</dt><dd>${r.countdownSeconds}s</dd></div><div><dt>Minimum humans</dt><dd>${r.minimumHumans}</dd></div><div><dt>Alliances</dt><dd>${r.alliances ? "Allowed" : "Disabled"}</dd></div><div><dt>Victory</dt><dd>${r.victory === "allied" ? "Allied conquest" : "Solo conquest"}</dd></div><div><dt>Map size</dt><dd>${dimensions.width}×${dimensions.height}</dd></div><div><dt>Starting age</dt><dd>${startingAgeName(r.startingAge ?? "StoneAge")}</dd></div><div><dt>Technology speed</dt><dd>${r.technologySpeed}×</dd></div><div><dt>Resource density</dt><dd>${r.resourceDensity}×</dd></div><div><dt>Human gold</dt><dd>${r.infiniteGoldForPlayers ? "Unlimited" : "Normal"}</dd></div><div><dt>Deposit output</dt><dd>${r.resourceOutput}×</dd></div>${playtestRuleRows(r)}</dl>`;
}

function home(vm: LobbyViewModel): string {
  const custom = vm.directory.visible;
  return `<main id="main-content" class="directory-page">
    <div class="directory-heading"><div><p class="overline">GATHER YOUR EMPIRE</p><h1>Battlefield Lobbies</h1><p>Choose a battlefield or make a room of your own.</p></div><button id="create-lobby" class="lobby-button brass large" data-open-create><span aria-hidden="true">＋</span> Create lobby</button></div>
    <form id="empire-customization" class="customization-bar" aria-label="Empire customization"><div class="customization-label"><span class="overline">YOUR EMPIRE</span><span>Customize your lobby identity</span></div><label class="empire-name-field" for="empire-name">Empire name<input id="empire-name" name="empireName" value="${e(vm.draftEmpireName)}" placeholder="Name your empire" autocomplete="off" required aria-describedby="empire-name-help" /><small id="empire-name-help">Up to ${MAX_EMPIRE_NAME_LENGTH} characters</small></label><div class="flag-field"><span>Empire flag</span><button type="button" id="choose-flag" data-open-flags aria-label="Choose empire flag">${flag(vm.profile.flagCode, vm.profile.name)}<span>${e(vm.selectedFlag?.name ?? "Choose a flag")}<small>Change flag ▾</small></span></button></div>${colorSelector(vm)}<button id="save-empire" type="submit" class="lobby-button outline">Save empire</button></form>
    <div class="directory-preview-label"><span class="planned-label">${vm.online ? "SHARED LOBBIES" : "LOCAL PREVIEW"}</span><p>${vm.online ? "Join the public lobby or a custom room with friends. A match starts when enough humans join and the countdown ends, or the room fills. Custom matches run in their creator's browser." : "Rooms are saved in this browser. Online joining will be connected next. The AI skirmish is playable now."}</p></div>
    <p id="directory-message" class="directory-message" role="status">${e(vm.message)}</p>
    <section class="lobby-holder" aria-label="Lobby directory"><div class="default-room-holder" data-public-holder>${publicHolder(vm)}</div>
      <div class="custom-room-holder"><div class="holder-heading"><h2>Custom lobbies</h2><span>${custom.length} OPEN · HOSTED BY THEIR CREATOR</span></div>${vm.hostedMatches.length ? `<div class="live-match-grid hosted-matches" aria-label="Your private matches">${vm.hostedMatches.map((match) => liveMatchCard(match, vm)).join("")}</div>` : ""}<div class="room-list custom-room-scroll" tabindex="0" aria-label="Custom lobbies">${custom.length ? custom.map((room) => roomCard(vm.maps.find((map) => map.id === room.settings.mapId)!, room, vm)).join("") : `<div class="empty-room"><span class="empty-room-symbol" aria-hidden="true">＋</span><div><h3>No custom lobbies yet</h3><p>Create one with your own rules. Your browser hosts the match when it starts.</p></div><button class="lobby-button outline" data-open-create aria-label="Create a custom lobby">Create lobby</button></div>`}</div></div>
    </section>
  </main>`;
}

/** One public lobby; while a public match runs, its card and the next-map vote. */
function publicHolder(vm: LobbyViewModel): string {
  const matches = vm.publicMatches, vote = vm.mapVote;
  const status = vote ? "MATCH IN PROGRESS" : vm.publicCountdown ? `STARTS IN <span data-public-countdown>${vm.publicCountdown}</span>` : "OPEN";
  const live = matches.length
    ? `<div class="live-match-grid public-matches">${matches.map((match) => liveMatchCard(match, vm)).join("")}</div><p class="live-identity-note">Away human empires stay reserved. Rejoining uses the guest identity saved in this browser, never an empire name. Tribes cannot be taken over.</p>`
    : "";
  const next = vote
    ? `<div class="map-vote" aria-labelledby="map-vote-title"><div class="map-vote-heading"><h3 id="map-vote-title">Vote for the next battlefield</h3><p>The most voted map opens as the next public lobby when the current match ends.</p></div><ol class="map-vote-list">${vote.candidates.map((mapId) => {
        const map = vm.maps.find((candidate) => candidate.id === mapId);
        const votes = vm.mapVotes(mapId), mine = vm.myMapVote === mapId;
        return `<li class="map-vote-choice" data-selected="${mine}"><img src="${map?.image ?? ""}" alt="" width="500" height="250" loading="lazy" /><div><strong>${e(map?.name ?? mapId)}</strong><small>${votes} vote${votes === 1 ? "" : "s"}</small></div><button type="button" class="lobby-button ${mine ? "brass" : "outline"}" data-vote-map="${mapId}" aria-pressed="${mine}" ${vm.connected ? "" : "disabled"}>${mine ? "Your vote" : "Vote"}</button></li>`;
      }).join("")}</ol></div>`
    : roomCard(vm.maps.find((map) => map.id === vm.publicMapId)!, undefined, vm);
  return `<div class="holder-heading"><h2>Public match</h2><span>${status}</span></div>${live}${next}`;
}

function lobby(vm: LobbyViewModel): string {
  const map = vm.selectedMap;
  return `<main id="main-content" class="room-page"><a class="back-link" href="#" data-home>← All lobbies</a><div class="preview-notice"><span class="planned-label">${vm.online ? "ONLINE LOBBY" : "LOCAL PREVIEW"}</span><p>${vm.online ? "Your guest identity reserves one seat. You have 60 seconds to reconnect after a disconnect." : "This lobby is a demonstration. Sample players are simulated; online joining is not available yet."}</p></div>
    <div class="room-heading"><div><p class="overline">${map.name.toUpperCase()} / ${vm.online ? "LOBBY" : "LOBBY PREVIEW"}</p><h1>${e(vm.roomTitle)}</h1><p>${map.terrain} · ${vm.rules.alliances ? "Alliances allowed" : "Free for all"}</p></div><div class="room-capacity"><strong data-human-count>${vm.humanCount} <span>/ ${vm.rules.slots}</span></strong><span>${vm.online ? "connected humans" : "human seats in preview"}</span></div></div>
    <div class="room-columns"><section class="room-roster" aria-labelledby="roster-title">${colorSelector(vm)}<div class="panel-heading"><h2 id="roster-title">The war room</h2><span>${vm.rules.slots} FACTION SLOTS</span></div><div class="countdown-panel" data-phase="${vm.phase}"><div><span class="overline">${vm.online ? "LIVE LOBBY" : "LOBBY FLOW PREVIEW"}</span><h3 data-status role="status">${e(vm.status)}</h3><p data-status-detail>${e(vm.statusDetail)}</p></div><div class="countdown-clock"><strong data-countdown>${vm.countdown}</strong><span>${vm.rules.countdownSeconds}-second timer</span></div></div>${vm.online ? `<div class="start-vote-panel"><button id="vote-start" class="lobby-button brass" data-vote-start ${vm.canVoteToStart ? "" : "disabled"}>${vm.hasVotedToStart ? "Voted to start" : "Vote to start"}</button><div><strong>${vm.startVotes} / ${vm.humanCount} humans voted</strong><p>${vm.customRoom ? "Start early when every connected human votes (even with 1 human). The lobby owner must be connected: their browser hosts the match." : "Start early when every connected human votes (even with 1 human). Available match capacity required."}</p></div></div>` : ""}<div class="roster-legend"><span><i class="legend-you"></i>Your empire</span><span><i class="legend-human"></i>${vm.online ? "Player" : "Sample player"}</span><span><i class="legend-open"></i>Open human seat</span></div><ol class="seat-grid" aria-label="${vm.online ? "Lobby faction seats" : "Preview faction seats"}">${seatMarkup(vm)}</ol><div class="preview-controls" ${vm.online ? "hidden" : ""}><span>TRY THE LOBBY FLOW</span><div><button id="add-sample" class="lobby-button outline" data-add ${vm.canAddSample ? "" : "disabled"}>+ Add sample player</button><button id="remove-sample" class="lobby-button subtle" data-remove ${vm.canRemoveSample ? "" : "disabled"}>Remove sample</button><button id="reset-preview" class="lobby-button subtle" data-reset>Reset preview</button></div></div></section>
    <aside class="room-sidebar" aria-label="Selected battlefield and rules"><div class="room-map"><img src="${map.image}" alt="${map.name} terrain overview" width="500" height="250" /><div><span class="overline">SELECTED BATTLEFIELD</span><h2>${map.name}</h2><p>${map.description}</p><small>${map.imageCredit}</small></div></div><div class="room-rules"><p class="overline">${vm.online ? "MATCH RULES" : "PREVIEW MATCH RULES"}</p>${rules(vm)}<p class="room-rule-note">${vm.online ? "The timer starts at the minimum connected human count and resets below it. A room can also start early when all connected humans vote (including 1 human). A match also requires reserved fallback capacity." : "The sample timer starts at the minimum human count and resets below it. The coordinator will enforce the real start rules when connected."}</p></div><div class="room-play"><a class="lobby-button brass" href="${vm.skirmishHref}">Play this map vs AI ${arrow}</a><p>Launches the existing local game with 3 AI opponents and its own match settings. Online matches use this lobby’s rules. AI practice uses its own settings.</p></div></aside></div>
  </main>`;
}

function seatMarkup(vm: LobbyViewModel): string {
  return vm.seats
    .map(
      (seat) =>
        `<li class="seat" data-kind="${seat.kind}"><span class="seat-number">${seat.number}</span>${typeof seat.colorIndex === "number" ? `<i class="faction-color-swatch" style="background:${FACTION_PALETTE[seat.colorIndex].hex}" aria-label="${FACTION_PALETTE[seat.colorIndex].name} faction color"></i>` : ""}<span class="seat-copy"><strong>${e(seat.name)}</strong><small>${e(seat.detail)}</small></span>${seat.kind === "you" && vm.selectedFlag ? flag(vm.profile.flagCode, vm.profile.name, "seat-flag") : `<span class="seat-emblem" aria-hidden="true">${seat.kind === "you" ? "◆" : seat.kind === "sample" ? "◇" : seat.kind === "ai" ? "▣" : "+"}</span>`}</li>`,
    )
    .join("");
}

function createDialog(vm: LobbyViewModel): string {
  return `<dialog id="lobby-dialog" class="directory-dialog" aria-labelledby="dialog-title"><form id="create-room"><div class="dialog-heading"><div><p class="overline">CUSTOM WAR ROOM</p><h2 id="dialog-title">Create a lobby</h2></div><button type="button" class="dialog-close" data-close-dialog aria-label="Close create lobby dialog">×</button></div><p class="dialog-description">${vm.online ? "Create a shared lobby with your chosen rules. When it starts, your browser hosts the match for everyone, so keep the match tab open until the game ends." : "Create a local preview, then try its roster and start rules."}</p><label>Lobby name<input name="title" value="${e(vm.profile.name)}'s lobby" maxlength="40" required /></label><label>Battlefield<select name="mapId">${vm.maps.map((map) => `<option value="${map.id}">${map.name}</option>`).join("")}</select></label><div class="settings-row three"><label>Human seats<input name="slots" type="number" min="2" max="${MAX_HUMAN_PLAYERS}" value="${FRIENDS_MATCH_RULES.slots}" required /></label><label>Minimum humans<input name="minimumHumans" type="number" min="1" max="20" value="2" required /></label><label>Start timer (seconds)<input name="countdownSeconds" type="number" min="15" max="300" value="60" required /></label></div><div class="settings-row three"><label>Map size<select name="worldSize"><option value="250">250 cells · longest edge</option><option value="500" selected>500 cells · longest edge</option><option value="1000">1000 cells · longest edge</option></select></label><label>Starting age<select name="startingAge">${STARTING_AGES.map(age => `<option value="${age}"${age === "StoneAge" ? " selected" : ""}>${startingAgeName(age)}</option>`).join("")}</select></label><label>Technology speed<select name="technologySpeed"><option value="1">1×</option><option value="2">2×</option><option value="3">3×</option></select></label></div><p class="settings-hint">Map size sets the longest edge. Starting age begins everyone in that age with prior technologies unlocked. Post-Modern starts everyone with all technologies and 1,000,000 gold.</p><p id="world-size-hint" class="settings-hint" role="status" hidden>${worldSizeHintText()}</p><div class="settings-row"><label>AI opponents<input name="aiCount" type="number" ${factionInputRange(500, "aiCount")} required /></label><label>Tribes<input name="tribeCount" type="number" ${factionInputRange(500, "tribeCount")} required /></label></div><p id="faction-settings-hint" class="settings-hint">${factionHint(500)}</p><div class="settings-row"><label>Resource density<select name="resourceDensity" aria-describedby="resource-settings-hint">${RESOURCE_MULTIPLIERS.map((value) => `<option value="${value}">${value}×${value === 1 ? " · Normal" : ""}</option>`).join("")}</select></label><label>Deposit output<select name="resourceOutput" aria-describedby="resource-settings-hint">${RESOURCE_MULTIPLIERS.map((value) => `<option value="${value}">${value}×${value === 1 ? " · Normal" : ""}</option>`).join("")}</select></label></div><p id="resource-settings-hint" class="settings-hint">Density adds more deposit locations. Output increases extraction from each deposit. These rules apply to every faction.</p>${playtestRuleFields()}<div class="settings-row"><label>Alliances<select name="alliances"><option value="disabled">Disabled</option><option value="allowed">Allowed</option></select></label><label>Victory<select name="victory"><option value="solo">Solo conquest</option><option value="allied">Allied conquest</option></select></label></div><div class="queue-opt-in"><label class="checkbox-label"><input name="infiniteGoldForPlayers" type="checkbox" /> Infinite Gold for Players</label><p class="settings-hint">Unlimited gold purchases for humans. AI, supplies and research times follow normal rules.</p></div><div class="queue-opt-in"><label class="checkbox-label"><input name="publicAiTakeover" type="checkbox" checked aria-describedby="live-join-hint" /> Allow new players to take over unclaimed AI empires</label><p id="live-join-hint" class="settings-hint">On by default. Returning players can rejoin a surviving reserved empire. Tribes and away human empires are never offered to strangers.</p></div><p class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="lobby-button subtle" data-close-dialog>Cancel</button><button class="lobby-button brass" type="submit">Create lobby ${arrow}</button></div></form></dialog>`;
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
      const cancelSeat =
        event.target.closest<HTMLElement>("[data-cancel-seat]");
      if (cancelSeat) {
        const chooser = cancelSeat.closest("details");
        if (chooser) {
          chooser.open = false;
          chooser.querySelector<HTMLElement>("summary")?.focus();
        }
        return;
      }
      const action = event.target.closest<HTMLElement>(
        "[data-preview],[data-room],[data-home],[data-add],[data-remove],[data-reset],[data-open-create],[data-open-flags],[data-close-dialog],[data-flag],[data-no-flag],[data-more-flags],[data-remove-room],[data-vote-start],[data-vote-map]",
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
      else if (action.hasAttribute("data-vote-start")) this.actions.voteStart();
      else if (action.dataset.voteMap) this.actions.voteMap(action.dataset.voteMap);
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
    // Each map size has its own base AI and tribe counts.
    root.addEventListener("change", (event) => {
      const select = event.target;
      if (select instanceof HTMLSelectElement && select.id === "faction-color") {
        this.actions.chooseColor(select.value === "" ? null : Number(select.value));
        return;
      }
      if (
        select instanceof HTMLSelectElement &&
        select.name === "mapId" &&
        select.form?.id === "create-room"
      ) {
        updateWorldSizeHint(select.form);
        return;
      }
      if (
        !(select instanceof HTMLSelectElement) ||
        select.name !== "worldSize" ||
        select.form?.id !== "create-room"
      )
        return;
      const worldSize = Number(select.value) as FactionWorldSize;
      for (const kind of ["aiCount", "tribeCount"] as const) {
        const input = select.form.elements.namedItem(kind);
        if (!(input instanceof HTMLInputElement)) continue;
        const { min, max } = factionCountRange(worldSize, kind);
        input.min = String(min);
        input.max = String(max);
        input.value = String(factionDefaults(worldSize)[kind]);
      }
      const hint = select.form.querySelector("#faction-settings-hint");
      if (hint) hint.textContent = factionHint(worldSize);
      updateWorldSizeHint(select.form);
    });
  }

  /** Keep the live selector and its ancestors mounted: removing even an
   * ancestor closes a browser-native dropdown. Only surrounding publications
   * are replaced; option nodes update in place when their facts change. */
  private refreshColorField(current: Element, next: Element): void {
    const select = current.querySelector<HTMLSelectElement>("select")!;
    const nextSelect = next.querySelector<HTMLSelectElement>("select")!;
    if (select.disabled !== nextSelect.disabled) select.disabled = nextSelect.disabled;
    for (let i = 0; i < nextSelect.options.length; i++) {
      const option = select.options[i], incoming = nextSelect.options[i];
      if (option.disabled !== incoming.disabled) option.disabled = incoming.disabled;
      if (option.textContent !== incoming.textContent) option.textContent = incoming.textContent;
    }
    if (select.value !== nextSelect.value) select.value = nextSelect.value;
    const swatch = current.querySelector<HTMLElement>(".faction-color-swatch")!;
    const nextSwatch = next.querySelector<HTMLElement>(".faction-color-swatch")!;
    if (swatch.style.background !== nextSwatch.style.background)
      swatch.style.background = nextSwatch.style.background;
    const error = current.querySelector(".faction-color-error");
    const nextError = next.querySelector(".faction-color-error");
    if (!nextError) error?.remove();
    else if (!error) current.append(nextError);
    else if (error.textContent !== nextError.textContent) error.textContent = nextError.textContent;
  }

  private replaceAround(current: Element, next: Element, retained: Element, nextRetained: Element): void {
    if (current === retained) return;
    const branch = Array.from(current.children).find(child => child === retained || child.contains(retained))!;
    const nextBranch = Array.from(next.children).find(child => child === nextRetained || child.contains(nextRetained))!;
    this.replaceAround(branch, nextBranch, retained, nextRetained);
    for (const child of Array.from(current.childNodes))
      if (child !== branch) child.remove();
    let before = true;
    for (const child of Array.from(next.childNodes)) {
      if (child === nextBranch) { before = false; continue; }
      if (before) current.insertBefore(child, branch);
      else current.appendChild(child);
    }
  }

  render(vm: LobbyViewModel): void {
    const focusedId = this.root.contains(document.activeElement)
      ? document.activeElement?.id
      : undefined;
    const openChoosers = Array.from(
      this.root.querySelectorAll<HTMLDetailsElement>(
        "details[data-seat-chooser][open]",
      ),
      (chooser) => chooser.dataset.seatChooser,
    );
    const currentHome = this.root.querySelector("main.directory-page");
    const editor = currentHome?.querySelector<HTMLFormElement>(
      "#empire-customization",
    );
    if (vm.page === "home" && currentHome && editor) {
      // Directory publications must not unmount the editor: selection, IME
      // composition and the browser's undo history belong to the live input.
      const template = document.createElement("template");
      template.innerHTML = home(vm);
      const nextHome = template.content.querySelector("main")!;
      const nextEditor = nextHome.querySelector("#empire-customization")!;
      const name = editor.querySelector<HTMLInputElement>("#empire-name")!;
      if (name.value !== vm.draftEmpireName) name.value = vm.draftEmpireName;
      this.refreshColorField(editor.querySelector(".faction-color-field")!, nextEditor.querySelector(".faction-color-field")!);
      editor.querySelector("#choose-flag")!.innerHTML =
        nextEditor.querySelector("#choose-flag")!.innerHTML;
      this.replaceAround(currentHome, nextHome, editor, nextEditor);
    } else if (vm.page !== "home" && this.root.querySelector("main.room-page")) {
      const currentRoom = this.root.querySelector("main.room-page")!;
      const template = document.createElement("template");
      template.innerHTML = lobby(vm);
      const nextRoom = template.content.querySelector("main")!;
      const field = currentRoom.querySelector(".faction-color-field")!;
      const nextField = nextRoom.querySelector(".faction-color-field")!;
      this.refreshColorField(field, nextField);
      this.replaceAround(currentRoom, nextRoom, field, nextField);
    } else {
      this.root.innerHTML = `${header()}${vm.page === "home" ? home(vm) : lobby(vm)}${footer(this.sourceUrl)}<div id="dialog-holder"></div>`;
    }
    for (const chooser of this.root.querySelectorAll<HTMLDetailsElement>(
      "details[data-seat-chooser]",
    ))
      chooser.open = openChoosers.includes(chooser.dataset.seatChooser);
    if (focusedId) {
      const focused = document.getElementById(focusedId);
      if (focused !== document.activeElement)
        focused?.focus({ preventScroll: true });
    }
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
    const timer = this.root.querySelector("[data-public-countdown]");
    const countdown = vm.publicCountdown;
    // Only the clock text changes between directory publications; replacing
    // the holder would steal focus from a keyboard user on its links.
    if (timer && countdown !== undefined) timer.textContent = countdown;
    else if (timer || countdown !== undefined) {
      const holder = this.root.querySelector<HTMLElement>("[data-public-holder]");
      if (holder && !holder.contains(document.activeElement)) holder.innerHTML = publicHolder(vm);
    }
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
