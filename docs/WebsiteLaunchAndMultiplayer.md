# Website launch and multiplayer setup

Use this checklist after the AgeOfFronts project is uploaded to GitHub. Publish
the existing browser game as a Render Static Site first. Then add an authoritative
multiplayer backend and connect the lobby and game interface to it.

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
appears, and movement, recruitment, construction, and combat respond. Try World,
Four Islands, and Heightmap · Test 1. Click **Corresponding source** and confirm
that the GitHub revision opens.

Use the browser console and Network panel if the page is blank or stuck loading.
Missing JavaScript, worker, map, or image files must be fixed before connecting
the custom domain. DNS settings cannot fix an incomplete game build.

The current local page still includes the existing local skirmish controls and
map list. The three-card map selection and online lobby are future multiplayer work.

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

| Requirement         | First release                           |
| ------------------- | --------------------------------------- |
| Maps shown          | World, Four Islands, Heightmap · Test 1 |
| Mode                | Free for all                            |
| Total faction slots | 20                                      |
| Minimum humans      | 2                                       |
| Countdown duration  | 60 seconds                              |
| Match starts        | Human lobby fills or countdown expires  |
| Unfilled slots      | AI fills them when the roster is frozen |

Two humans start with 18 AI opponents. Twenty humans start with no AI replacements.
This is not 20 humans plus another 20 AI. Optional tribes must not silently exceed
the total faction count.

The intended flow is **pick a map > join its lobby > wait for players/countdown >
load the agreed match > play**. The server must choose and freeze the actual roster,
map settings, seed, and start; browsers display those decisions.

## Implement multiplayer in this order

1. **Introduce player identity and a transport port.** The client currently assumes
   the human is player 1 in several views, view models, selection helpers, and
   renderer paths. Replace those assumptions with the session's faction ID. Retain
   local play through a worker adapter and add a network adapter for online play.

2. **Run a two-human match on an authoritative server.** Reuse `Skirmish` as the
   gameplay domain in a Node match worker. Both browsers submit commands to that
   worker and render its snapshots. The server owns AI, resources, movement,
   construction, combat, research, elimination, and victory. The inherited
   OpenFront server is a different turn/intent relay; `start:server` does not
   connect the skirmish simulation automatically.

3. **Define and secure the wire protocol.** Add versioned messages, validated
   command payloads, command sequence IDs, acknowledgements, snapshot baselines,
   and full resets. Bind each connection to its faction on the server; never trust
   a submitted `playerId`. Enforce ownership, numeric bounds, rates, message sizes,
   and bounded queues. Typed-array worker messages need deliberate serialization
   before they can cross a WebSocket.

4. **Implement the lobby domain and its MVVM interface.** Add the three map cards,
   lobby membership, roster display, countdown, and connection/loading states.
   Serialize joins and starts so simultaneous arrivals cannot take the same seat
   or start duplicate matches. Freeze the roster once, fill AI vacancies, and use
   a loading/readiness barrier before playable ticks begin. The view model projects
   lobby state; it does not authorize starts or assign factions.

5. **Implement reconnect and host recovery.** A returning player must regain the
   same faction and receive a valid snapshot baseline. Handle duplicate tabs,
   sequence gaps, slow clients, heartbeats, and reconnect backoff. Define what
   happens when someone disconnects. A server restart needs a complete domain
   checkpoint and recovery log, or an explicitly limited cancellation policy.
   The current presentation snapshot is not a complete saved match.

6. **Prove capacity for 20 factions.** Test two humans plus 18 AI, mixed rosters,
   and 20 humans on all three maps. Measure tick lag, CPU, memory, bandwidth,
   snapshot pressure, and long-match behavior. Then determine how many matches a
   host can admit. The repository's recorded full-population trials already miss
   the 20-tick target, so reliable capacity is unfinished work, not something a
   lobby page or a WebSocket library will solve.

7. **Deploy the backend and complete operational checks.** Keep the frontend
   static and add a separate Render Web Service using HTTPS/WSS. Bind its listener
   to `0.0.0.0` and Render's `PORT`. Choose its compute plan from benchmarks. Add
   health/readiness checks, logs, metrics, admission limits, cleanup, and a deliberate
   deployment/recovery policy before a public playtest.

DDD and MVVM remain the architecture: domain aggregates own lobby and game rules;
application services orchestrate sessions, matches, clocks, and recovery;
infrastructure provides sockets, storage, and workers; view models project
read-only state. Network callbacks and page components must not become new places
to implement gameplay rules.

## Decisions to settle before their implementation

I recommend starting the countdown when the second human joins, resetting it if
the connected human count drops below two, and freezing immediately at 20 humans.
The 60-second duration and two-human minimum are confirmed; those reset/start
semantics still need explicit agreement.

We also need to choose the launch map size, loading timeout, disconnect grace and
AI takeover behavior, guest sessions versus accounts, mid-match admission policy,
whether temporary alliances are allowed in free for all, result persistence, and
the host-restart recovery guarantee. The detailed plan distinguishes recommendations
from confirmed requirements: [MultiplayerPlan.md](MultiplayerPlan.md).

## Hosting traps to avoid

Render's free backend sleeps after 15 minutes without inbound traffic and takes
about a minute to wake. It is suitable for a disposable prototype; I recommend
a continuously available paid backend for the intended public lobby service.
There is no need to buy a larger plan until benchmark results establish what
the match simulation needs.

Do not enable multiple backend instances before designing match ownership and
routing. Render assigns new WebSocket connections, including reconnects, to random
instances. A shared lobby directory and one authoritative owner per match are
needed; autoscaling alone cannot reconnect someone to their original game.

Do not silently lower gameplay limits, slow the simulation, or let renderer budgets
change movement to conceal server overload. Agree on any gameplay-cap change and
validate it explicitly. Keep 500 × 250 as the proposed starting map size until
benchmarks justify another size.

## References

- [Render Static Sites](https://render.com/docs/static-sites)
- [Render custom domains](https://render.com/docs/custom-domains)
- [Render DNS configuration](https://render.com/docs/configure-other-dns)
- [Render Web Service port binding](https://render.com/docs/web-services#port-binding)
- [Render WebSockets and routing](https://render.com/docs/websocket)
- [Render free service limitations](https://render.com/docs/free)
- [Vite production deployment guidance](https://vite.dev/guide/static-deploy.html)
