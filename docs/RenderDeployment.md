# Render deployment for the skirmish game

The current skirmish runs in the browser, including its simulation worker. Render
should publish `build/skirmish` as a Static Site. The existing OpenFront multiplayer
server does not host this simulation. Adding a backend later does not require
moving the frontend off static hosting.

## Live deployment: October 1, 2026

The game is published at [www.ageoffronts.com](https://www.ageoffronts.com/).
[ageoffronts.com](https://ageoffronts.com/) redirects there with HTTP 301. Both
domains are verified in Render and have issued TLS certificates.

| Item | Current value |
| ---- | ------------- |
| Render service | `age-of-fronts-skirmish` (Static Site) |
| Service ID | `srv-dav025npn0mc739f6630` |
| Render URL | `https://age-of-fronts-skirmish.onrender.com/` |
| Blueprint | `AgeOfFronts Website` |
| Deployment branch | `main` |
| Northwest root record | A `@` → `216.24.57.1` |
| Northwest web record | CNAME `www` → `age-of-fronts-skirmish.onrender.com.` |

The first successful release used commit
`31807b1834ff3bef00e5dbec9beaa129c3c33d1c`. Its typecheck, production build,
and 220 skirmish tests passed. World, Four Islands, and Heightmap · Test 1
loaded and ran on the Render URL. A World match also started through the custom
domain with artwork loaded and no captured browser errors. Email DNS records
were preserved. The earlier `AgeOfFronts` Web Service remains available under
its Render URL; the two website domain bindings moved to this Static Site.

Use the [existing Static Site dashboard](https://dashboard.render.com/static/srv-dav025npn0mc739f6630)
for future deployments. Do not create another service. Auto-Deploy is set to
**On Commit**; after pushing, confirm that a deployment appears and succeeds.
If it does not, use **Manual Deploy > Deploy latest commit** and check the
[GitHub connection](https://render.com/docs/git-provider). Public repository
cloning alone does not prove that GitHub push events are connected.

## Deploy from the repository configuration

1. Commit and push `render.yaml` and the accompanying frontend change to `main`.
2. In Render, choose **New > Blueprint**, connect this GitHub repository, and review
   the `age-of-fronts-skirmish` Static Site defined by `render.yaml`.
3. Create the Static Site and wait for a successful deployment. This is a new
   frontend service; the configuration does not replace the existing Web Service.
4. Test the new service's actual `onrender.com` URL before attaching the domain.

The configuration pins the tested Node 24.18.0 runtime, installs npm 12.1.0 to meet
`package.json`, installs locked dependencies without lifecycle scripts, and runs
the existing typecheck and skirmish build. `SKIP_INSTALL_DEPS=true` prevents Render
from installing dependencies before the required npm version is available.

The public source link is baked into the build using `RENDER_GIT_COMMIT`. It opens
that exact revision of `ELDamien3570/AgeOfFronts`. This avoids a broken link to the
local source ZIP, which is excluded from Git. Local builds keep their ZIP link.
Keep the repository public while using this source destination. Do not upload
`node_modules`, `.env` files, local build outputs, or the local source ZIP.

## Create a Static Site manually

If the service was created manually, use these settings instead of creating a
second service through a Blueprint:

| Setting                                  | Value                      |
| ---------------------------------------- | -------------------------- |
| Repository                               | `ELDamien3570/AgeOfFronts` |
| Branch                                   | `main`                     |
| Root Directory                           | Empty                      |
| Publish Directory                        | `build/skirmish`           |
| `NODE_VERSION` environment variable      | `24.18.0`                  |
| `SKIP_INSTALL_DEPS` environment variable | `true`                     |
| Start Command                            | None                       |

Build Command:

```sh
npm install --global --ignore-scripts npm@12.1.0 && npm ci --ignore-scripts && VITE_SKIRMISH_SOURCE_URL="https://github.com/ELDamien3570/AgeOfFronts/tree/${RENDER_GIT_COMMIT:?}" npm run build:skirmish
```

`build:skirmish` alone is a package script name. Render needs the complete shell
command. No SPA catch-all rewrite is required by the current single root page;
missing map or worker assets should return a real error, rather than HTML.

## Attach the domain after the game works

Add `www.ageoffronts.com` to the new Static Site. Render will also add
`ageoffronts.com` and redirect it to `www`. If those domains are still attached to
the old Web Service, move those bindings during this cutover.

Use the exact DNS targets shown by the new Static Site. At Northwest, the expected
records are:

| Type  | Host  | Target                                               |
| ----- | ----- | ---------------------------------------------------- |
| A     | `@`   | `216.24.57.1`                                        |
| CNAME | `www` | The new Static Site's actual `onrender.com` hostname |

Do not reuse `ageoffronts.onrender.com` unless the new Static Site explicitly
shows that hostname. Keep existing email records. Inspect any existing A, AAAA,
or CNAME records at `@` and `www` for conflicts, then verify the domain in Render.

Check HTTPS on both domain forms, the redirect to `www`, all map selections, game
worker startup, artwork loading, and the corresponding-source link. A successful
build or DNS verification alone does not establish that the game works in a browser.

## Multiplayer hosting

Keep this Static Site for the homepage, lobby interface, and game client. Add a
separate Render Web Service for the authoritative multiplayer application, reached
over HTTPS and WSS. Its HTTP and WebSocket routes must share Render's public port,
and the listener must bind to `0.0.0.0` using `PORT`.

See [the multiplayer plan](MultiplayerPlan.md) for the required domain, application,
transport, presentation, recovery, and performance work.

## Provider references

- [Render Static Sites](https://render.com/docs/static-sites)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render Node versions](https://render.com/docs/node-version)
- [Render custom domains](https://render.com/docs/custom-domains)
- [Render DNS configuration](https://render.com/docs/configure-other-dns)
- [Render WebSockets](https://render.com/docs/websocket)
