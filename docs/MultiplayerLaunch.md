# Friends multiplayer launch

The homepage at `/` is the lobby browser. The game remains at
`/skirmish/index.html`; online games use the server-issued `?match=...` address.
No DNS change is needed if both custom domains already point to the Static Site.

## Push and deploy

1. Push the frontend, multiplayer source, tests, `package.json`,
   `vite.skirmish.config.ts`, and `render.yaml` together. Deploy the same Git
   revision to both services. Keep local `data/` databases out of Git and source
   archives. Gameplay changes already in the working tree belong to their own
   work; include the versions you intend to release.
2. In Render, create a **Node Web Service** from this repository and `main`.
   Use the `age-of-fronts-multiplayer` entry in `render.yaml`, or these settings:

   | Setting                      | Value                                                                         |
   | ---------------------------- | ----------------------------------------------------------------------------- |
   | Build command                | `npm install --global --ignore-scripts npm@12.1.0 && npm ci --ignore-scripts` |
   | Start command                | `npm run start:multiplayer`                                                   |
   | Health check                 | `/healthz`                                                                    |
   | `NODE_VERSION`               | `24.18.0`                                                                     |
   | `HOST`                       | `0.0.0.0`                                                                     |
   | `MULTIPLAYER_ORIGINS`        | `https://ageoffronts.com,https://www.ageoffronts.com`                         |
   | `MULTIPLAYER_MATCH_CAPACITY` | `1`                                                                           |

   Render supplies `PORT`. Copy the service's actual HTTPS `onrender.com` URL.
   Add your Static Site's exact `onrender.com` origin to `MULTIPLAYER_ORIGINS`
   if you want to test there before using the custom domain.

3. On the existing **Static Site**, set `VITE_MULTIPLAYER_URL` to that HTTPS
   backend URL, with no `/socket` suffix. Keep build command `npm run build:skirmish`
   (or the existing command in `render.yaml`) and publish directory
   `build/skirmish`. Rebuild the Static Site after setting the variable.
   Its build copies the new lobby homepage to `index.html`, so requests for
   `ageoffronts.com/` naturally open the lobby browser. Remove any old rule
   redirecting `/` to `/skirmish/index.html`, if one exists. Do not add an
   all-path rewrite to the homepage: the game and assets have their own paths.
4. Keep `ageoffronts.com` and `www.ageoffronts.com` attached to that Static Site.
   The frontend opens secure WebSockets to the separate Node service; the
   public domain continues serving the homepage and game assets.
5. Confirm the backend's `/healthz` reports admission `open`. Open the site on
   two devices or browsers, choose distinct empire names, and join the same
   room. For a quick check, create a 250-cell room with a 15-second timer.
   Both players should enter the same match. Closing the hosting player's tab
   should pause briefly, then continue on another player or the server.

Render Web Services accept public WebSockets; a Static Site alone cannot run
the coordinator. See [Render WebSockets](https://render.com/docs/websocket) and
[environment variables](https://render.com/docs/configure-environment-variables).

## First release limits

- One active match per coordinator is the initial admission ceiling. Other
  occupied rooms wait for capacity. Empty rooms allocate no simulation workers.
- Defaults require two humans. AI fills remaining faction slots only after
  the room meets its human minimum. Countdown resets below that minimum.
- Players who disconnect during play cannot reclaim their faction. It becomes
  AI-controlled and displays `zzz`; remaining players continue. Lobby seats
  retain a 60-second reconnect grace period.
- Host loss recovers from the last server-accepted checkpoint. Commands from
  the previous host are fenced, and only accepted state is shown to players.
- Gold and reserves use shared-domain command pricing and a lightweight server
  ledger. Host world income is trusted, as agreed; this is for friends, not
  competitive anti-cheat.
- Active match checkpoints live in the coordinator's memory. Restarting,
  redeploying or crashing the coordinator ends those games. Finish games before
  deployment. Durable active-match recovery and player reconnect are deferred.
- SQLite stores guest identities and lobbies. Render's default filesystem is
  ephemeral; if it is replaced, clients create new guest identities automatically.
  A persistent disk is optional for retaining these between deployments. This
  release does not require purchasing one. See [Render deploy storage](https://render.com/docs/deploys).
- The Free service configuration is a starting point for trying this with
  friends, not a measured capacity guarantee for Render hardware. Start with
  Small or Medium maps. Large maps and busy late-game battles need live testing;
  all players stay on the same committed state if execution slows, but game
  time may run more slowly. Only increase concurrency after measurement.
- No invitations, accounts, spectators or match history in this release.

## Local check

Run `npm run start:multiplayer`, then run the frontend with
`VITE_MULTIPLAYER_URL=http://127.0.0.1:9011` and `npm run play`.
Add the frontend's exact origin to `MULTIPLAYER_ORIGINS` when using another port.
The default development server is `http://127.0.0.1:9000`.

Checks: `npm run build:skirmish` and `npm run test:skirmish`.

The intended architecture remains DDD/MVVM: room and host-lease domain policies;
application match lifecycle and executor ports; WebSocket, SQLite and worker
infrastructure; browser session adapter and existing presentation ViewModels.
