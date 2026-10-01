# Main lobby page and connection checklist

## Frontend delivered

The homepage is a lobby directory with up to three featured default map cards beside three
custom display spaces. The customization bar sets an empire name and a flag; the
Create lobby dialog adds a configurable room to the holder or, with explicit
opt-in when full, to its waiting queue.

This is a working **local preview**, as requested. Empire identity, custom rooms,
and queue order are saved only in the current browser. Nothing connects players
or creates a shared online session. Sample players and the preview timer are
clearly labeled. Existing AI play is available at `/skirmish/index.html` and from
each default map room. The game's AF badge returns to the directory.

| Feature           | Local preview behavior                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Default rooms     | Mediterranean and Africa now; up to three featured cards rotate every 60 seconds as maps are added |
| Custom holder     | At most three listed custom rooms beside the default rooms                                    |
| Create lobby      | Title, map, capacity, minimum humans, timer, AI, size, research speed, resource density/output, alliances and victory |
| Waiting queue     | Explicit opt-in; FIFO promotion when a listed room closes                                     |
| Cancel / close    | Cancel a queue entry or close a listed room; promotion preserves order                        |
| Queue review      | Preview queued room settings without placing it in the custom holder                          |
| Empire name       | Trimmed, validated 1–20 character display name                                                |
| Flag picker       | Searchable local country/historical catalog; choose a flag or no flag                         |
| Saved settings    | Restore after reload; corrupt entries are ignored; blocked storage reports visit-only changes |
| Roster preview    | Your empire/flag, sample humans, vacant seats and configured AI filling                       |
| Local game launch | Chosen map with the existing AI game's own settings and three default AI opponents            |

The name/flag and custom match rules currently affect the **lobby preview**. They
are not passed into the existing local game. The launch link explicitly explains
this; integrating real faction identity and frozen settings belongs to the
multiplayer connection work.

## Rules available to creators

The default rooms retain the agreed 20 total faction slots, minimum two humans,
60-second timer, free for all and AI filling vacancies. Creators can change:

- Map: Mediterranean and Africa for this review; subsequent maps are added after approval.
- Total faction slots: 2–20, within the current simulation cap.
- Minimum humans: 1 up to the selected faction capacity.
- Countdown: 15–300 seconds in this preview.
- AI vacancy filling: enabled or disabled.
- Map size: longest edge of 250, 500 or 1000 cells, retaining source proportions.
  Mediterranean is 2:1; Africa is square. The room preview displays actual dimensions.
- Technology speed: 1×, 2× or 3×.
- Resource density: 1×, 2×, 3× or 5× deposit placement.
- Deposit output: a separate 1×, 2×, 3× or 5× extraction multiplier.
- In-match alliances: allowed or disabled.
- Victory: solo or allied conquest. Allied conquest requires alliances.

The user selected alliances and victory choice instead of fixed assigned teams.
Fixed team assignment is not part of this pass. Invalid capacity/minimum, timer,
size, research-speed, resource-multiplier, map and diplomacy combinations are rejected before a room
can occupy a space or enter the queue.

The sample timer starts at the configured human minimum, resets if the count
drops below it, and freezes immediately at full human capacity. AI fills only
vacancies when enabled; it never adds another 20 factions on top of the roster.
These exact timing semantics and the production configuration ranges still need
finalization for the online coordinator.

Preview defaults use a 500-cell longest edge, alliance-disabled solo conquest, 1× technology and
1× resource density/output. Earlier saved preview rooms receive the original 1×
resource rules when those fields are absent; existing room and queue order remain.
The default rooms' production world size and temporary-alliance policy remain
open; those values should not silently become online requirements.

The user requested retirement of World and Four Islands. They are removed from
the skirmish and custom-room selectors. Mediterranean retains its stable
`heightmap-test1` identity for saved links/rooms. Saved rooms using retired map IDs
are omitted with a visible notice; they are not silently redirected to another map.

Featured map cards rotate every 60 seconds using an injected clock. Rotation
does not replace the customization bar, custom holder or queue and does not
reset a lobby someone is previewing. Keyboard-focused card links remain until
focus leaves their holder. Only two maps are ready in this pass, so both remain
available while their order rotates; the pool grows after each map review.

Density and deposit output are independent controls. Density changes how many
natural deposit locations are generated; output changes extraction from each
deposit. Higher output does not reveal undiscovered resources, grant extraction
technology, bypass required buildings, or multiply manufactured goods again.
All factions use the same rules. Raising both can greatly accelerate the economy:
5× density with 5× output targets roughly 25× potential raw production, subject
to eligible terrain, ownership and extraction infrastructure.

Both values are saved and displayed in the room preview. Actual deposit generation
and extraction remain unchanged until the custom rules are connected to matches.
The deterministic generation, migration and validation requirements are recorded
in the multiplayer plan.

## OpenFront flag reuse

The picker reads `resources/countries.json` and uses the same `code !== "xx"` /
`restricted !== true` policy as `src/client/InventoryModal.ts`. There are 990
eligible catalog flags in the inspected source, and every corresponding file
exists in `resources/flags`. Only the selected flag and the visible picker page
load images; searching does not fetch an external catalog.

It uses local free country/historical flags, not account or paid cosmetics. Stored
flag codes are validated against the catalog and resolved into encoded local SVG
paths. Names/titles are escaped when rendered; they are not inserted as markup.

## Architecture and build

MVVM and DDD are preserved:

- `lobby/LobbyDirectory.ts` owns custom listing capacity, opt-in queuing, FIFO
  promotion, cancellation and settings validation. It has no browser or network
  dependency.
- `lobby/LobbyRules.ts` contains default match rules and map identifiers.
- `lobby/EmpireProfile.ts` validates the display-name value.
- `client/lobby/LobbyViewModel.ts` projects the directory, customization and local
  sample roster/timer. It accesses persistence through `LobbyPreviewStore`.
- `BrowserLobbyPreviewStore` is an adapter using only the new
  `ageoffronts.lobby-preview.v1` key. It does not read/overwrite inherited account,
  authentication, paid-cosmetic or username settings.
- `LobbyView.ts` renders projections and forwards actions. Dialogs use native
  focus management; timer and flag-search updates retain their controls.
- `client/lobby/main.ts` composes the model, view, browser clock and routing.

Vite builds separate homepage/game entries. The homepage is published as
`build/skirmish/index.html`, alongside `build/skirmish/skirmish/index.html` for
the AI game. It does not import the battlefield renderer or start a game worker.
Fragment links (`/#lobby=world`, `/#room=<local-id>`) work on refresh without
additional Render rewrite rules. A custom preview link is meaningful only in the
browser that stores that room; real shareable room URLs require the coordinator.

Heightmap thumbnails use the same baked terrain/elevation, per-map environment,
forest cover and relief as the game, with the original attribution. Regenerate
a selected map after its assets change:

```sh
node scripts/generateLobbyMapPreview.mjs africa
```

## Online connection work

The full connection requirements are now part of
[MultiplayerPlan.md](MultiplayerPlan.md#main-page-custom-directory-and-empire-identity).
Implement a real session ViewModel and application port for coordinator commands
and projections. Keep the local preview separate from actual session authority.

The server must own directory revisions, room creation/ownership, membership,
queue order, promotion and expiry. Creation/cancellation/join retries need
idempotency keys. Resolve listing races atomically, keep the three-listing limit
distinct from concurrent-match capacity, and release a listing under the agreed
close/start/expiry policy.

Validate all rules and safe name/flag metadata on the server, then freeze them in
the match manifest. Enforce alliance/victory policy in the domain and ingress.
The chosen client host, resource ledger, paused migration, committed recovery and
server fallback remain the architecture agreed in the multiplayer plan.

Before connection implementation, decide:

1. Guest/session identity or accounts, plus private invites versus public access.
2. Per-owner room limit, queue fairness, listing leases and disconnected-owner
   behavior. Without limits or expiry, one person can monopolize the three spaces.
3. When a listed room releases its space, and whether queued/unlisted rooms can
   admit invited friends before being publicly displayed.
4. Whether each default card routes to a single waiting room or multiple rooms as
   earlier matches start/full rooms freeze.
5. Production timing/reset policy, settings ranges, default world size and default
   temporary-alliance policy.
6. Loading timeouts, reconnect grace, AI takeover, in-progress admission and results.

## Review checklist

- All available default maps and the three custom display spaces are present.
- Featured cards rotate every 60 seconds, with up to three shown and no reset of
  entered rooms, custom listings, queue entries, draft identity or keyboard focus.
- A fourth custom room requires queue opt-in. Closing a listed room promotes the
  earliest waiting room; cancelling one waiter preserves everyone else's order.
- Empire name/flag, rooms and queue survive reload in the same browser. Invalid
  stored entries do not break the page.
- Custom settings appear in their roster preview, including the selected timer,
  capacity, minimum, AI policy and diplomacy/victory pair.
- Default and custom preview links, Back/Forward, the AI map links and return
  navigation work. The custom links do not imply cross-browser sharing.
- Keyboard interaction, native dialog Escape/focus restoration, mobile layouts,
  timer updates and searchable flag images remain usable.
- Run `npm run test:skirmish` and `npm run build:skirmish` against the final combined
  revision before pushing/deploying. A Vite bundle alone is not a typecheck.
- Publish through the existing Render Static Site and pinned corresponding-source
  link. No DNS change is needed. The local frontend is not public until its
  reviewed revision is pushed/deployed alongside finished gameplay work.

## Local verification — October 1, 2026

The checked working-tree revision passed the TypeScript typecheck, the production
Vite build and all 283 tests across 39 skirmish test files, including 20 lobby
tests. Later concurrent gameplay edits require a fresh check before deployment.

Browser review verified creation and explicit queue opt-in, FIFO promotion,
custom rule previews, empire/flag and room persistence after reload, countdown
completion with AI vacancy filling, custom-link refresh and Back/Forward,
native-dialog Escape/focus restoration, and the 390-pixel mobile layout without
horizontal overflow. All three map links loaded their selected playable AI game;
the return link restored the saved lobby directory. No browser console errors
were recorded during that review.

The preview runs locally at `http://127.0.0.1:9010/`. It has not been published to
the custom domain and does not connect multiple browsers or start online matches.

The resource-control follow-up passed all 22 lobby tests, TypeScript typecheck
and production Vite build. Browser review created a queued room with 5× density
and 2× deposit output, reloaded its preview and verified both values remained
independent and visible. Existing saved rooms and queue positions were retained,
and no browser console errors were recorded.
