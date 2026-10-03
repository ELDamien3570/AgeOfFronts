# Lobby Fixes: Ghost Lobbies, Disconnect State & Match Rejoin Resilience

Implementation status - 3 October 2026: Implemented explicit scoped presence, immediate empty custom-room pruning/FIFO promotion, awaited disconnect of every affected match, bounded reserved-seat reconnect without replaying commands, larger bounded socket buffering, a 15-second baseline application window, finite admission protection across the empty deadline, reserved seat links/navigation teardown, and resize camera/toast isolation. Local validation recorded in Optimization Handoff/Evidence/remaining-five-combined-validation.md; native Opera behavior has not been certified.


This document outlines the detailed investigation, root causes, and implementation plan for fixing lobby lifecycle issues and match rejoining failures in Age of Fronts skirmish multiplayer.

---

## 1. Problem Statements

### 1.1 Issue A: Ghost Lobbies & False Human Presence
- Lobbies (both custom rooms and default map lobbies) frequently remain active after players disconnect or close their browsers.
- In the lobby directory, these lobbies report `1 / N HUMANS IN LOBBY` or on live match cards `1 connected human`, even when no human is actually present.
- Empty custom lobbies continue occupying visible display spaces (`CUSTOM_LOBBY_LIMIT = 3`), blocking other players and queued custom lobbies from being displayed.
- Visiting the site home page (`/`) forcefully auto-reconnects players into rooms they previously visited, changing the URL hash to `#room=...` or `#lobby=...` and resetting their disconnect grace timers.

### 1.2 Issue B: Rejoining Failure Loop
- The home page displays live matches with active seats or reconnect opportunities (e.g. `Resume within X:XX to keep this match open. Rejoin your empire ↗`).
- When the player clicks to rejoin or take over an empire, the game loads the map and starts `OnlineMatchSession`, reaching `this.initialized = true`.
- Immediately after initialization, the session fails and aborts with:
  > **"Connection lost. You have left this match. Return to the lobby to rejoin your reserved empire."**
- Clicking "Return to lobbies" brings the player back to the home page, which again advertises that the empire is reserved and can be rejoined, creating an inescapable failure loop until the server's empty match grace period expires.

---

## 2. Deep Root Cause Analysis

### 2.1 Indiscriminate Auto-Reconnection on Home Page Visit
* **Files**: [`CoordinatorServer.ts:246–250`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts#L246-L250), [`RoomCoordinator.ts:246–256`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/domain/RoomCoordinator.ts#L246-L256), [`main.ts:263–272`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/client/lobby/main.ts#L263-L272)
* **Mechanism**:
  1. Every browser keeps a persistent guest identity token in `localStorage` (`ageoffronts.guest-token.v1`).
  2. Whenever a player visits the home page (`/`) to browse lobbies or returns to the site, `OnlineLobbyConnection` opens a WebSocket and sends `{ type: "authenticate", token }`.
  3. In `CoordinatorServer.ts:247`, upon receiving `authenticate`, the server immediately calls `rooms.reconnect(guestId)`.
  4. In `RoomCoordinator.ts:246–256`:
     ```typescript
     reconnect(guestId: string): void {
       for (const room of this.state.rooms) {
         const member = room.members.find((candidate) => candidate.guestId === guestId);
         if (!member) continue;
         member.connected = true;
         delete member.disconnectedAt;
         if (room.ownerId === guestId) delete room.ownerMissingSince;
       }
     }
     ```
  5. The server blindly loops over **all rooms** on the coordinator, finds the guest's old room, flips `member.connected = true`, and wipes out `disconnectedAt`.
  6. Because `member.connected` is now `true`:
     - `LobbyViewModel.ts:107` counts `members.filter(m => m.connected).length`, which reports **`1 / N HUMANS IN LOBBY`**.
     - `advance(now)` never prunes the member because the 60-second grace timer is reset.
     - `removeEmptyCustoms()` never deletes the custom room.
     - In `main.ts:263–271`, the client sees that the server says the player is in `currentRoom`, and forcibly redirects their URL hash to `#room=...` or `#lobby=...`, trapping them in the room.

---

### 2.2 Incomplete Disconnection on WebSocket Close (`.find`)
* **Files**: [`CoordinatorServer.ts:409–415`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts#L409-L415)
* **Mechanism**:
  ```typescript
  const active = [...matches.values()].find(
    (match) =>
      match.connected(session.guestId) ||
      match.isAdmitting(session.guestId),
  );
  rooms.disconnect(session.guestId, now());
  if (active) void active.disconnect(session.guestId);
  options.store.write(rooms.snapshot());
  publish();
  ```
  1. Using `.find()` only catches the **first** match. If a guest had seats or admissions across multiple matches, subsequent matches are never notified of the disconnection.
  2. In any skipped match, `seat.connected` remains `true` and `LiveMatch.ts:722` continues to report `connectedHumans: 1`.
  3. `void active.disconnect(...)` is an unawaited asynchronous call; `publish()` immediately publishes directory updates before the async seat cleanup has settled.

---

### 2.3 Empty Custom Room Retention Logic
* **Files**: [`RoomCoordinator.ts:345–349`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/domain/RoomCoordinator.ts#L345-L349)
* **Mechanism**:
  ```typescript
  private removeEmptyCustoms(): void {
    this.state.rooms = this.state.rooms.filter(
      (room) => room.kind === "default" || room.members.length > 0,
    );
  }
  ```
  1. When the creator/owner of a custom room disconnects without clicking "Leave" or "Close", `room.members` still contains that disconnected member object for 60,000 ms (`RECONNECT_GRACE_MS`).
  2. Because `room.members.length === 1`, `removeEmptyCustoms()` keeps the custom room in the state.
  3. If no humans are connected in a custom room and the owner is gone, the empty room continues occupying one of the 3 custom lobby spaces.
  4. If that player opens the site again before 60 seconds elapses, Root Cause 2.1 triggers and permanently revives the room.

---

### 2.4 Hardcoded `{ reconnect: false }` in `OnlineMatchSession`
* **Files**: [`OnlineMatchSession.ts:76–83`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/client/OnlineMatchSession.ts#L76-L83), [`OnlineMatchSession.ts:137`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/client/OnlineMatchSession.ts#L137)
* **Mechanism**:
  1. In `OnlineMatchSession.ts:137`:
     ```typescript
     new OnlineLobbyConnection(endpoint, ..., { reconnect: false });
     ```
  2. In `OnlineLobbyConnection.ts:163–171`, if `options.reconnect === false`, any socket drop immediately triggers `this.onStatus(..., false)` without retrying.
  3. In `OnlineMatchSession.ts:76–83`:
     ```typescript
     (message, connected) => {
       if (this.stopped || (connected && this.initialized)) return;
       if (!connected && this.initialized) {
         this.fail(
           "Connection lost. You have left this match. Return to the lobby to rejoin your reserved empire.",
         );
         return;
       }
       this.status(message);
     }
     ```
  4. Once `this.initialized = true` is reached (which occurs right after loading the map), any socket drop aborts the session and kicks the player out with that exact error message.

---

### 2.5 Backpressure Drop During Baseline Sync (`1013 Connection too slow`)
* **Files**: [`CoordinatorServer.ts:165–177`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts#L165-L177), [`LiveMatch.ts:374–377`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/application/LiveMatch.ts#L374-L377)
* **Mechanism**:
  ```typescript
  const send = (client: WebSocket, message: ServerMessage) => {
    if (client.bufferedAmount > 2 * 1024 * 1024) {
      client.close(1013, "Connection too slow");
      return;
    }
    if (client.readyState === WebSocket.OPEN)
      client.send(JSON.stringify(message));
  };
  ```
  - When rejoining an ongoing match, the server captures a full game baseline (`result.baseline` in `LiveMatch.ts:375`) containing the complete snapshot of all tiles, units, cities, borders, and fog of war.
  - On larger maps (500x500 or 1000x1000) or mature matches, sending this entire baseline snapshot in a single WebSocket message can push `bufferedAmount` above 2MB, causing the server to immediately close the connection with code `1013`.
  - When the socket closes, Root Cause 2.4 triggers the `"Connection lost"` failure.

---

### 2.6 Short Sync Phase Timeout (`5_000ms`)
* **Files**: [`LiveMatch.ts:443–447`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/application/LiveMatch.ts#L443-L447)
* **Mechanism**:
  ```typescript
  const timeout = phase === "applying-baseline"
    ? (this.config.syncTimeoutMs ?? 5_000)
    : (this.config.preparationTimeoutMs ?? 30_000);
  ```
  - The client is given only 5 seconds (`5_000ms`) to receive the baseline, pass it to the Web Worker for decoding, apply it to the simulation, render the view, and send back `match-sync-applied`.
  - If decompression or worker execution takes longer than 5 seconds, `this.cancelSync` aborts the join and sends an error message, closing the session.

---

### 2.7 Tab Collisions & Ghost Admissions (`4001 Opened in another tab` / `Match already open`)
* **Files**: [`CoordinatorServer.ts:224–239`](file:///c:/Users/Damien/Documents/GitHub/AgeOfFronts/AgeOfFronts/src/skirmish/multiplayer/infrastructure/CoordinatorServer.ts#L224-L239)
* **Mechanism**:
  - If a player clicks "Rejoin your empire" from the home page, the home page tab already has an open WebSocket authenticated with the player's `guestId`.
  - If the match opens in a new tab or before the previous page unloads, the server closes the other socket with `4001 Opened in another tab`.
  - Conversely, if the previous match socket didn't close cleanly and `(match.connected(guestId) && match.isLoaded(guestId))` is still true, the coordinator closes the incoming socket with `4001 Match already open`.

---

## 3. Implementation Plan

### Phase 1: Coordinator & RoomCoordinator Scoped Reconnection
1. **Scope Reconnect by Room ID**:
   - In `CoordinatorServer.ts`, do **not** blindly call `rooms.reconnect(guestId)` on initial WebSocket authentication.
   - Modify `rooms.reconnect` to take an optional `roomId`:
     ```typescript
     reconnect(guestId: string, roomId?: string): void
     ```
   - Only set `member.connected = true` for a room if:
     - The client explicitly requests to join or reconnect to that room, or
     - The client's URL route explicitly matches that room (`#room=...` or `#lobby=...`).
2. **Remove Unwanted Auto-Redirect to Old Rooms**:
   - In `src/skirmish/client/lobby/main.ts:263–272`, remove the automatic redirect that checks `currentRoom` on initial state and forces the player into the room if their hash was empty.
   - If the player navigated to `/` (home), they should stay on the home page directory.
3. **Iterate All Active Matches on Disconnect**:
   - In `CoordinatorServer.ts:409–415`, replace `.find(...)` with a full iteration:
     ```typescript
     for (const match of matches.values()) {
       void match.disconnect(session.guestId);
     }
     ```
   - Ensure all matches release admissions, mark seats disconnected, and start their empty match timers.
4. **Prompt Pruning of Abandoned Custom Rooms**:
   - In `RoomCoordinator.ts`, if a custom room has **zero** connected members (`room.members.every(m => !m.connected)`) and the owner has disconnected, prune it immediately rather than reserving a display space for 60 seconds with 0 players.

---

### Phase 2: Match Reconnection & Synchronization Resilience
1. **Enable Reconnect Window in `OnlineMatchSession`**:
   - In `OnlineMatchSession.ts:137`, remove `{ reconnect: false }` or configure a bounded reconnect window (e.g. 15 seconds) so temporary WebSocket resets during handoffs do not instantly terminate the match session.
2. **Increase Socket Backpressure Limit**:
   - In `CoordinatorServer.ts:167`, increase the backpressure ceiling from 2MB to 8MB (`8 * 1024 * 1024`) or implement chunked snapshot transmission so large baseline states do not trigger `1013 Connection too slow`.
3. **Extend Sync Phase Timeout**:
   - In `LiveMatch.ts:443`, increase `syncTimeoutMs` default from 5,000ms to 15,000ms (`15_000`) to give lower-end devices and larger map decoders sufficient time to apply the baseline snapshot before expiring.
4. **Clear Empty Match Grace Period on Rejoin Qualification**:
   - In `LiveMatch.ts:285–308` and `LiveMatch.ts:352`, ensure `this.emptyDeadline` is paused or cleared as soon as a returning player begins synchronization, preventing the match from ending while the player is loading.
5. **Pass Player Seat in Rejoin Links**:
   - In `LiveMatchCards.ts:45`, ensure `liveMatchHref(match.id, match.rejoinPlayerId)` passes `match.rejoinPlayerId` so `OnlineMatchSession` sends the exact reserved seat ID during `watch-match`.

---

### Phase 3: Client Navigation & Lifecycle Cleanup
1. **Clean Lobby Socket on Match Navigation**:
   - In `src/skirmish/client/lobby/main.ts`, when navigating to `/skirmish/index.html` (or any external route), explicitly close or stop the lobby connection before the navigation executes to prevent tab collisions (`4001`) with the incoming match connection.
2. **Add `beforeunload` / `pagehide` Handlers**:
   - In `src/skirmish/client/lobby/main.ts`, attach a `pagehide` listener that sends a synchronous `leave` request or closes the socket cleanly when the user closes the window or navigates away.

---

## 4. Verification & Testing Strategy

### 4.1 Automated Tests
1. **`RoomCoordinator.test.ts`**:
   - Test that visiting the coordinator without a target room does not re-flag disconnected members as connected in old rooms.
   - Test that custom rooms with 0 connected members are promptly pruned when the owner leaves.
2. **`CoordinatorServer.test.ts`**:
   - Test that closing a socket disconnects the guest across multiple active matches simultaneously.
   - Test that connecting to `/` with a stored guest token does not mark the guest as connected in old rooms.
   - Test rejoining a match with baseline snapshot delivery without exceeding backpressure limits.
3. **`LiveMatch.test.ts` & `OnlineMatchSession.test.ts`**:
   - Test rejoining a running match with baseline application under simulated network latency.
   - Test that `emptyDeadline` does not expire while a returning player is actively applying the baseline.

### 4.2 Manual Verification Checklist
- [ ] Create a custom lobby, close the tab, and verify from another browser/incognito window that the lobby disappears immediately and does not report `1 / 4 HUMANS IN LOBBY`.
- [ ] Join a default lobby, close the tab, visit the homepage `/`, and verify that the URL hash stays at `/` (does not redirect to `#lobby=...`) and the lobby human count is `0`.
- [ ] Start an online match, close the browser tab, wait 10 seconds, open the home page, click "Rejoin your empire ↗", and verify that the game successfully loads back into the match without triggering "Connection lost".
- [ ] Verify that opening a match link in a new tab does not cause a crash or permanent lockout.

---

## 5. Client Fix: Opera Canvas Full Zoom-Out on Action Rejection

### 5.1 Problem Description
In the Opera browser, performing any rejected action (such as attempting to place a building on an ocean tile or on top of an incompatible building) causes the game camera to immediately zoom all the way out to fit the full map. This issue does not occur in Chrome.

### 5.2 Root Cause Analysis
1. **Toast Notification Trigger**:
   - When an action is rejected, the client receives `{ type: "rejected", message: ... }` (in `main.ts:490` and `main.ts:693`) and calls `notify(message)`.
   - `notify()` unhides `<div id="toast" role="status" class="toast" hidden></div>`.
2. **DOM Placement**:
   - In `src/skirmish/client/index.html:121`, `#toast` is an immediate child of `<main class="battlefield">`, alongside `<canvas id="canvas">`.
3. **ResizeObserver Trigger on Opera**:
   - In `src/skirmish/client/Renderer.ts:223–224`, `this.resizeObserver` observes `canvas.parentElement!` (`<main class="battlefield">`).
   - Opera's custom UI (sidebar, fractional DPI, workspace margins) and accessibility evaluation for `role="status"` live regions triggers a subpixel layout pass on `<main class="battlefield">` when `#toast` unhides, firing the `ResizeObserver` callback. Chrome ignores subpixel changes when bounding integer dimensions are stable.
4. **Flawed Resize Logic**:
   - In `src/skirmish/client/Renderer.ts:407–420`, `resize()`:
     - Lacks any dimension check to see if width and height actually changed.
     - Unconditionally calls `this.home()`.
     - `this.home()` sets `this.scale = this.fitScale` (the minimum scale that fits the whole map) and centers the camera, wiping out the player's active zoom and pan position.

### 5.3 Implementation Fix
1. **Preserve Camera in `Renderer.resize()` (`src/skirmish/client/Renderer.ts`)**:
   - Add a check comparing incoming dimensions to current dimensions:
     `if (Math.abs(rect.width - this.width) < 1 && Math.abs(rect.height - this.height) < 1 && this.initialized) return;`
   - Only call `this.home()` during the initial startup call when the renderer is first initializing.
   - On subsequent resizes, recompute `fitScale`, clamp `this.scale = Math.max(this.fitScale, Math.min(96, this.scale))`, and keep the camera focused on the existing world center point.
2. **Relocate `#toast` in `index.html` (`src/skirmish/client/index.html`)**:
   - Move `#toast` out of `<main class="battlefield">` up to `#app` or an overlay layer so that toast popups never trigger layout or resize observer events on the battlefield canvas container.
