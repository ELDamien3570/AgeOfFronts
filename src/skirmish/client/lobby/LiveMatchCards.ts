import type { LiveMatchSummary } from "../../multiplayer/Protocol";
import type { LobbyViewModel } from "./LobbyViewModel";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

export function liveMatchHref(matchId: string, playerId?: number): string {
  const query = new URLSearchParams({ match: matchId });
  if (playerId !== undefined) query.set("seat", String(playerId));
  return `/skirmish/index.html?${query}`;
}

function elapsed(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${minutes}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, "0")}`;
}

function card(match: LiveMatchSummary, vm: LobbyViewModel): string {
  const map = vm.maps.find((candidate) => candidate.id === match.mapId);
  const away = Math.max(
    0,
    (match.claimedHumanSeats ?? match.connectedHumans) - match.connectedHumans,
  );
  const available = vm.connected && match.status !== "syncing";
  const rejoin = match.rejoinPlayerId !== undefined;
  const canTakeOver = match.publicTakeover && match.freeAiSeats.length > 0;
  const status =
    match.status === "syncing"
      ? "Synchronizing a player"
      : match.status === "paused"
        ? "Paused"
        : "Live";
  return `<article class="live-match-card" data-live-match="${escape(match.id)}">
    <div class="live-match-map">${map ? `<img src="${map.image}" alt="${escape(map.name)} terrain overview" width="500" height="250" loading="lazy" />` : ""}<span class="live-match-status" data-status="${match.status}">${status}</span></div>
    <div class="live-match-copy"><p class="overline">${escape(map?.name ?? match.mapId)} · ${elapsed(match.elapsedSeconds)} elapsed</p><h3>${escape(match.title)}</h3>
      <p class="live-match-count"><strong>${match.connectedHumans}</strong> connected human${match.connectedHumans === 1 ? "" : "s"}${away ? ` <span>· ${away} away / reserved</span>` : ""}</p>
      ${match.status === "paused" && match.graceRemainingMs !== undefined ? `<p class="live-match-wait" role="status">${match.graceRemainingMs > 0 ? `Resume within ${elapsed(Math.ceil(match.graceRemainingMs / 1000))} to keep this match open.` : "The return window is closing."}</p>` : ""}
      <p class="live-match-detail">${rejoin ? "Your empire is reserved for this browser’s guest identity." : match.publicTakeover ? `${match.freeAiSeats.length} unclaimed AI empire${match.freeAiSeats.length === 1 ? "" : "s"} available` : "Private match · returning players only"}</p>
      ${!available ? `<p class="live-match-wait" role="status">${vm.connected ? "A player is syncing. Joining will be available shortly." : "Reconnect to the lobby server to join."}</p>` : rejoin ? `<a id="rejoin-${escape(match.id)}" class="lobby-button brass" href="${escape(liveMatchHref(match.id))}">Rejoin your empire <span aria-hidden="true">↗</span></a>` : canTakeOver ? `<details class="live-seat-chooser" data-seat-chooser="${escape(match.id)}"><summary id="choose-${escape(match.id)}" class="lobby-button outline">Choose an AI empire <span aria-hidden="true">▾</span></summary><p>Take command of an existing empire with its current land, armies and research.</p><ul>${match.freeAiSeats.map((seat) => `<li><a id="takeover-${escape(match.id)}-${seat.playerId}" class="live-seat-link" href="${escape(liveMatchHref(match.id, seat.playerId))}"><span>${escape(seat.name)}</span><span>Take command ↗</span></a></li>`).join("")}</ul><button type="button" class="quiet-link" data-cancel-seat>Cancel</button></details>` : `<p class="live-match-wait">${match.publicTakeover ? "No eligible AI empires are available right now." : "New players cannot take over AI in this match."}</p>`}
    </div></article>`;
}

export function liveMatchesMarkup(vm: LobbyViewModel): string {
  if (!vm.online) return "";
  return `<section class="live-match-section" aria-labelledby="live-matches-title"><div class="holder-heading"><div><p class="overline">ALREADY ON THE BATTLEFIELD</p><h2 id="live-matches-title">Live matches</h2></div><span>${vm.activeMatches.length} ACTIVE</span></div>${vm.activeMatches.length ? `<div class="live-match-grid">${vm.activeMatches.map((match) => card(match, vm)).join("")}</div><p class="live-identity-note">Away human empires stay reserved. Rejoining uses the guest identity saved in this browser, never an empire name. Tribes cannot be taken over.</p>` : `<p class="live-matches-empty" role="status">${vm.connected ? "No active matches right now. Join a lobby below to start one." : "Connecting to the live match directory…"}</p>`}</section>`;
}
