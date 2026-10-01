# Website launch and multiplayer setup

Use this checklist after the AgeOfFronts project is uploaded to GitHub. Publish
the existing browser game as a Render Static Site first. Multiplayer will use an
elected client host, a server coordinator and economy ledger, paused host migration,
and server fallback. The detailed architecture is in [MultiplayerPlan.md](MultiplayerPlan.md).

The current skirmish runs against AI in the player's browser. Hosting it on a
website makes that mode publicly playable; it does not synchronize matches between
players. A lobby page alone will not change that.

The static launch was completed on October 1, 2026 at
[www.ageoffronts.com](https://www.ageoffronts.com/). Both domain forms have HTTPS,
and the root redirects to `www`. Use the existing `age-of-fronts-skirmish` Static
Site for updates. The actual service, DNS records, and launch verification are
recorded in [RenderDeployment.md](RenderDeployment.md).

## Check the uploaded project

The deployed branch must contain the actual game source, `package.json`,
`package-lock.json`, `vite.skirmish.config.ts`, `skirmish/index.html`, the required
`resources/maps` files, and imported artwork. Include the prepared `render.yaml`
and frontend source-link change. Do not upload `node_modules`, local build output,
`.env` files, or `resources/age-of-fronts-source.zip`.

Once the current gameplay edits are finished, run `npm run build:skirmish` to check
the exact revision you intend to deploy. A deployment also runs that typecheck and
build; unresolved TypeScript errors will stop publication. Keep `main` as the
deployable branch and complete work on feature branches before merging it.

## Create the Render Static Site

1. In Render, choose **New > Static Site**.
2. Connect `ELDamien3570/AgeOfFronts` and select the uploaded `main` branch.
3. Enter the following settings. If the form asks for a Start Command, you are
   creating a Web Service; return to **New > Static Site**.

| Render field                             | Value                                               |
| ---------------------------------------- | --------------------------------------------------- |
| Name                                     | `age-of-fronts-skirmish`, or another available name |
| Branch                                   | `main`                                              |
| Root Directory                           | Leave blank                                         |
| Publish Directory                        | `build/skirmish`                                    |
| `NODE_VERSION` environment variable      | `24.18.0`                                           |
| `SKIP_INSTALL_DEPS` environment variable | `true`                                              |
| Start Command                            | None                                                |

Use this complete **Build Command**:

```sh
npm install --global --ignore-scripts npm@12.1.0 && npm ci --ignore-scripts && VITE_SKIRMISH_SOURCE_URL="https://github.com/ELDamien3570/AgeOfFronts/tree/${RENDER_GIT_COMMIT:?}" npm run build:skirmish
```

The project requires npm 12. The command installs that version, installs the locked
dependencies without running lifecycle scripts, then builds the game. Skipping
Render's automatic dependency installation allows that npm setup to happen first.

The source URL points to the exact public GitHub revision deployed by Render.
Keep that repository public. The local source ZIP is excluded from GitHub, so its
download link cannot serve as the source destination for a fresh Render deployment.

Alternatively, choose **New > Blueprint** and use the uploaded `render.yaml`. It
defines the same Static Site and settings. Choose one creation method so you do
not create two copies accidentally. More detail is in
[RenderDeployment.md](RenderDeployment.md).

## Test the Render URL before changing the domain

Wait for Render to report a successful deployment, then open the actual
`https://...onrender.com` URL shown by the new Static Site.

Check that the game page loads, a match starts, the simulation worker runs, artwork
appears, and movement, recruitment, construction, and combat respond. Try
Mediterranean and Africa at each supported resolution. Click **Corresponding source** and confirm
that the GitHub revision opens.

Use the browser console and Network panel if the page is blank or stuck loading.
Missing JavaScript, worker, map, or image files must be fixed before connecting
the custom domain. DNS settings cannot fix an incomplete game build.

The frontend now includes a lobby holder, up to three featured default map cards
rotating every 60 seconds, three custom
display spaces with an opt-in queue, empire name/flag customization and local
room previews, including separate resource density and deposit output presets.
The working AI game remains at `/skirmish/index.html`; online lobby
sessions are future multiplayer work. The UI scope, remaining feature decisions,
and review checklist are in [LobbyPagePlan.md](LobbyPagePlan.md). These frontend
changes require their own reviewed deployment after the initial static launch.

## Connect ageoffronts.com

1. In the new Static Site's settings, add **`www.ageoffronts.com`** as a custom
   domain. Render also adds the root domain and redirects it to `www`.
2. If those domains are attached to the earlier Web Service, move their Render
   bindings to the working Static Site during this cutover.
3. In Northwest's DNS settings, use the targets shown by the new Static Site.

| Record type | Host  | Target                                              | TTL     |
| ----------- | ----- | --------------------------------------------------- | ------- |
| A           | `@`   | `216.24.57.1`                                       | Default |
| CNAME       | `www` | The new Static Site's exact `onrender.com` hostname | Default |

Enter only the target hostname for CNAME, without `https://` or a path. Update
an existing matching web record rather than adding a conflicting duplicate. Keep
email records intact. Render also requires removing conflicting AAAA records for
the web domain because its custom-domain endpoint uses IPv4.

Do not assume the new service uses the old `ageoffronts.onrender.com` hostname.
Copy the new service's target from Render.

Return to Render and verify the domains. Wait for DNS and certificate issuance,
then test **`https://www.ageoffronts.com`** and **`https://ageoffronts.com`**. The second
should redirect to the first. Recheck an actual game through the custom domain.

## Keep deployment updates reliable

Push finished changes to the deployment branch and confirm that Render starts and
successfully finishes a deployment. If no deployment starts, use **Manual Deploy >
Deploy latest commit** on the existing Static Site and check the GitHub connection.
Run the skirmish typecheck/build and relevant tests before merging. Keep the previous
working release available for rollback and recheck a match after each deployment.

Do not run `npm run play` or Vite's preview server as the production server.
The Static Site serves the built files directly. When multiplayer is added, the
backend has its own build, start command, health checks, and deployment policy.

## Confirmed multiplayer behavior

| Requirement          | Default lobby preset                                        |
| -------------------- | ----------------------------------------------------------- |
| Maps shown           | Mediterranean and Africa                                    |
| Mode                 | Free for all                                                |
| Total faction slots  | 20                                                          |
| Minimum humans       | 2                                                           |
| Countdown duration   | 60 seconds                                                  |
| Match starts         | Human lobby fills or countdown expires                      |
| Unfilled slots       | AI fills them when the roster is frozen                     |
| Match executor       | One suitable connected client hosts                         |
| Host disconnect      | Pause, select a replacement, then resume                    |
| No valid client host | Resume the same match on the server                         |
| Gold/reserve checks  | Server-owned ledger; no direct edits or unpaid spending     |
| World-event trust    | Trust the host's world events for casual games with friends |

These are the default map-room settings: two humans start with 18 AI opponents;
twenty humans start with no AI replacements. Custom lobbies have configurable
capacity, minimum humans, timer, AI policy, size, technology speed and in-match
alliances with solo/allied victory. The homepage rotates up to three default map cards beside
at most three custom listings, with an opt-in waiting queue and empire name/flag
customization. See [LobbyPagePlan.md](LobbyPagePlan.md) for the local preview.
Optional tribes must not silently exceed the configured faction count.

The intended flow is **pick a map > join its lobby > wait for players/countdown >
load the agreed match > play**. The server must choose and freeze the actual roster,
map settings, seed, and start; browsers display those decisions.

## Implement multiplayer in this order

1. **Introduce identity and execution ports.** Replace the client's implicit
   player-1 identity with the session's faction. Preserve local play and reuse
   the same domain in client-host and Node-fallback adapters. Presentation consumes
   a transport port through view models.

2. **Build complete recovery first.** Presentation snapshots cannot resume a
   simulation. Preserve RNG, AI, orders, queued work, timers, expansion state,
   command cursors and ledger version. Prove equivalent continuation in a fresh
   browser worker and a Node worker, with a bounded journal/replay contract.

3. **Build the coordinator, ledger and protocol.** The server binds factions,
   orders commands, grants one host epoch/lease, checks economy transactions and
   stores recovery data. Clients cannot submit arbitrary balances or prices.
   Use shared rules for gold/reserves, deduplicate income/spending, and commit
   world outcomes with their ledger effects. Add versioned messages, reset
   snapshots, authenticated ingress and bounded queues.

   The user chose to trust host world events. These checks catch direct balance
   edits and unpaid spending; they cannot prove a plausible capture or trade
   delivery actually happened. That limitation is accepted for games with friends.

4. **Run a two-human client-hosted match.** Select a qualifying browser and run
   `Skirmish` in its worker. Relay commands/snapshots through the coordinator
   over WSS. The host player's commands use the same ingress as everyone else's.
   The host executes AI and world rules; fallback runs the same domain in Node.
   OpenFront's inherited `start:server` does not implement this automatically.
   WebRTC remains an optional later optimization.

5. **Implement paused migration and server fallback.** On host loss or lease
   expiry, freeze at the last committed boundary and reject the old host epoch.
   Restore on another qualifying client, or a reserved server worker if none
   qualifies. Resync clients and resume once without catch-up income or duplicate
   orders. The former host rejoins as a participant. If fallback is unexpectedly
   exhausted, remain visibly paused rather than restart or silently slow gameplay.

6. **Connect the lobby domain and MVVM interface.** Connect the existing local
   holder/customization preview to server directory sessions, custom-room creation,
   the three-space listing queue, validated settings and real membership. Serialize
   creation/promotion/join/start, freeze the manifest once and fill configured AI
   vacancies. Add loading, eligibility, hosting, pause, migration, fallback and
   reconnect states. Participant reconnect restores the original faction; it is
   distinct from changing the match executor. Names/flags never prove ownership.

7. **Prove 20-faction and fallback capacity.** Test two humans plus 18 AI, mixed
   rosters and 20 humans on all maps. Measure tick CPU, host rendering contention,
   upload/relay traffic, checkpoint cost and recovery duration. Exercise simultaneous
   host losses and server-fallback concurrency. Existing full-population trials
   miss the tick target, so moving execution to a client does not establish capacity.

8. **Deploy and test coordinator recovery.** Keep the frontend static. Add a
   separate Render Web Service, sharing HTTP/WSS on `0.0.0.0` and `PORT`. Size it
   from relay, ledger, storage and fallback benchmarks. Recover host epochs,
   checkpoints and ledgers consistently after restart/deploy before resuming.
   Add metrics, readiness checks, bounded admission and cleanup; then playtest
   with friends.

DDD and MVVM remain the architecture: domain aggregates own lobby, host assignment,
economy and game rules. Application services orchestrate execution and recovery;
infrastructure provides sockets, storage and workers; view models project state.
Network callbacks and pages must not become new places to implement gameplay rules.

## Decisions to settle before implementation

The client host, pause/replacement, server fallback and lightweight economy ledger
trusting host world events are confirmed. Other policies remain proposals:

- Start the countdown when the second human joins and reset below two before freeze.
- Initial world size, loading timeout, host consent/qualification thresholds,
  heartbeat/lease timeout and bounded election window.
- Checkpoint/commit cadence, journal replay contract, maximum recovery duration
  and simultaneous fallback reservations.
- Paused-command handling, participant disconnect grace/AI takeover and minimum
  humans after the match has already started.
- Guest sessions versus accounts, invitations/access controls, mid-match admission,
  default-room temporary alliances, result persistence and coordinator-restart recovery target.
- Custom listing leases, per-owner limits, fairness, queued-room admission and
  listing release/expiry policy; production settings ranges and default-room routing.
- Visible pause, retry and eventual cancellation behavior if fallback capacity
  is unexpectedly unavailable.

The detailed plan separates these recommendations from confirmed requirements:
[MultiplayerPlan.md](MultiplayerPlan.md).

## Hosting traps to avoid

Client hosting removes normal server simulation work; WSS relay, storage, economy
checks and fallback still need resources. Checkpoint traffic and a host also rendering
the game must be included in benchmarks. Do not assume a lightweight coordinator
can run every fallback or that client hosting necessarily reduces latency.

Render's free backend sleeps after idle periods, takes about a minute to wake and
can restart. Free hosting is an option for friends' trials if interruptions are
accepted; a continuously available coordinator is preferable for reliable migration.
Choose compute from measured fallback demand.

Do not enable multiple coordinator instances before designing shared match routing
and fenced ownership. New/reconnecting Render WebSockets can reach different
instances. Every accepted match still needs one coordinator owner and one executor.

Do not use presentation snapshots as complete saves, replay a purchase twice,
accept an old host's epoch, or grant income for wall-clock time spent paused.
Server-ledger checks do not independently prove host-reported income sources.

Do not silently lower gameplay limits or simulation speed to conceal overload.
Keep 500 cells on the longest edge as the proposed starting size until benchmarks
justify another size. Mediterranean is 500×250; square Africa is 500×500, so host
budgets must use the actual cell count. New maps await the sequential visual
review described in [MapReview.md](MapReview.md) before deployment.

## References

- [Render Static Sites](https://render.com/docs/static-sites)
- [Render custom domains](https://render.com/docs/custom-domains)
- [Render DNS configuration](https://render.com/docs/configure-other-dns)
- [Render Web Service port binding](https://render.com/docs/web-services#port-binding)
- [Render WebSockets and routing](https://render.com/docs/websocket)
- [Render free service limitations](https://render.com/docs/free)
- [Vite production deployment guidance](https://vite.dev/guide/static-deploy.html)
