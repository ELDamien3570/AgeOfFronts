# Age of Fronts — local AI skirmish

Run `npm run play` and open `http://127.0.0.1:9000`. This first playable mode
uses OpenFront's open maps, terrain model, seeded random generator, and heap.
It is an independent land-squad simulation; OpenFront's multiplayer relay is
not yet connected to this mode. No account or external API is needed to play.

Land squads use the provided Stone Age melee, ranged, and cavalry group art
from `Art/Soldier Icons`. Team bases, strength bars, and troop counts identify
each squad; zoom in to see the artwork. The ranged image depicts spear
throwers and uses the current archer rules. Squad art rotates toward observed
travel and keeps its last facing while stopped; labels and team bases stay
upright. This styling does not add ages.

Left click or drag to select your dots. Right click land to move; right click
an enemy dot to attack. **Shift + right click** queues waypoints (up to 32).
A normal order replaces the queue; `X` holds and clears it. Recruitment is
always available from the left panel: `Q` infantry, `W` ranged, `E` cavalry,
`T` transport, and `B` warship. Each needs a completed friendly matching
building; the nearest one to the selected force is used, or the nearest one
to the camp if nothing is selected. Building inspection does not control
recruitment. Land squads require 1,000 reserves; ships cost gold.
`R` orders manual replenishment for the damaged selected land squads that
are on friendly territory, leaving other selected units' orders alone:
squads stop, wait until three seconds clear of combat, and
transfer up to 50 reserve troops/sec until full. A new order cancels it.
`Ctrl+A` selects all land squads, and Space pauses. Wheel zooms; middle drag pans.
Double click a friendly squad or ship to select visible friendly units of
the same type, based on the current camera and zoom; Shift adds them to
the selection. Control groups use `1`–`9` and `0`: Shift+number adds the
selection to that group, number recalls it, and Ctrl+number replaces it
(or clears it with no selection). Groups include squads and ships, retain
embarked squads for recall after landing, discard dead units, and reset
when a new match starts. You can also click the numbered group buttons.
Squads capture their surroundings after sustained occupation and fight only
against other squads. Terrain affects speed. Buildings change owner when
their tile is captured, including unfinished construction. An opponent is
eliminated after losing its camp and all land squads, including embarked ones.

Archers show a gold six-tile range ring when selected and visible arrows for
released volleys. Attack orders approach the outer range and hold; they follow
targets that leave range but do not retreat from approaching enemies. A full
stationary archer squad delivers 25 damage per second at range (10 in melee),
one-quarter of the previous rate. Moving archers fire once every five seconds
instead of once per second; actual position changes determine this penalty.
Each released volley shows five simultaneous projectiles; these share one
damage event. The fixed-step simulation resolves damage independently of art.

Build on friendly land using the construction menu; highlighted tiles are
valid sites. Leave three tiles between buildings. A port needs a cardinally
adjacent water tile. Buildings cost gold and take time to complete:

Construction shortcuts enter placement mode: `A` city, `S` factory, `D` port,
`F` barracks, `G` archery range, and `H` stables. Click a highlighted tile to
place the building; Escape or right click cancels.

| Building | Cost / time | Role |
| --- | --- | --- |
| Barracks | 400 / 5 sec | Infantry: standard melee |
| Archery range | 500 / 6 sec | Archers: range 6, weaker at close range |
| Stables | 700 / 8 sec | Cavalry: faster melee |
| City | 800 / 8 sec | +40 reserve troops/sec |
| Factory | 1,000 / 10 sec | +20 gold/sec |
| Port | 900 / 10 sec | +12 trade gold/sec; recruits ships |

Inspect a building on the map or with the right-panel selector. Each player
starts with a completed barracks and 3,000 gold. Camp ownership provides
baseline reserve/gold income; completed economic buildings provide their own
income even after camp loss. Building costs and combat values are provisional
and centralized in `src/skirmish/Rules.ts`.

At a completed friendly port, recruit transports (300 gold, four squads,
600 HP) or warships (700 gold, 1,000 HP, automatic naval attacks at range 7).
Ships sail only on water and also support Shift-queued routes. Select ships
on the map or with the Fleet selector. `X` stops selected ships and clears
their route. Select land squads and **right click a friendly transport**, or
select a transport too and press **Meet transport & board**. Both sides travel
to a shared reachable coast marked in blue. Nearby arriving squads fill the
four whole-squad slots, accounting for existing cargo; excess squads hold
ashore until given a new order. Neutral or hostile shores must be captured
before loading. A new ship order or Hold cancels the meeting. Squads on
separate landmasses need separate boarding orders. Sail to water beside a passable coast,
stop, and **Choose landing coast** to unload. Hostile landings are allowed.
Embarked squads do not fight, capture, or replenish. Sinking a transport loses
its cargo; warships attack ships only. Ships do not keep an eliminated land
player alive. AI builds, recruits multiple squad types, replenishes, and uses
ships through the same commands as humans.

The initial balance is provisional: four starting squads per player, 12,000
total starting troops, three AI opponents by default, a 16-squad limit per
player, and a 1.5-second capture time. These are playtest settings, not a
large-lobby capacity claim. Additional limits are 32 buildings and eight ships
per player. Ages, upgrades, and fog are not implemented yet.
In island maps all camps start on one landmass; transports can reach the others.

Gameplay advances at 20 fixed ticks per second in a worker. Commands and
integer-position domain simulation are separate from the canvas view and
snapshot-derived `SkirmishViewModel`; AI issues the same commands as the human
player. Rendering interpolates land movement between ticks.
Adding multiplayer still requires command/wire integration and reconnect
state handling; this mode does not claim those are already validated.

Validate with `npm run test:skirmish` and `npm run build:skirmish`.
`npm run source:skirmish` refreshes the source download linked in the footer;
run it after changes and before sharing a modified networked build.
Keep the AGPL notices and source offer. Open map assets are CC BY-SA 4.0.
Restricted proprietary assets were omitted from this checkout. This initial
import includes World, Four Islands, and The Box; upstream's other maps and
map-generator sources can be retrieved from the original repository.

Upstream source: openfrontio/OpenFrontIO at
`f372cdf9451cd8c3dc113aaaf8641e2609e2d3cb` (September 29, 2026).
The original README follows.

---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="proprietary/images/OpenFrontLogoDark.svg">
    <source media="(prefers-color-scheme: light)" srcset="proprietary/images/OpenFrontLogo.svg">
    <img src="proprietary/images/OpenFrontLogo.svg" alt="OpenFrontIO Logo" width="300">
  </picture>
</p>

[OpenFront.io](https://openfront.io/) is an online real-time strategy game focused on territorial control and alliance building. Players compete to expand their territory, build structures, and form strategic alliances in various maps based on real-world geography.

This is a fork/rewrite of WarFront.io. Credit to https://github.com/WarFrontIO.

![CI](https://github.com/openfrontio/OpenFrontIO/actions/workflows/ci.yml/badge.svg)
[![Crowdin](https://badges.crowdin.net/openfront-mls/localized.svg)](https://crowdin.com/project/openfront-mls)
[![CLA assistant](https://cla-assistant.io/readme/badge/openfrontio/OpenFrontIO)](https://cla-assistant.io/openfrontio/OpenFrontIO)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Assets: CC BY-SA 4.0](https://img.shields.io/badge/Assets-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## License

OpenFront source code is licensed under the **GNU Affero General Public License v3.0**

Current copyright notices appear in:

- Footer: "© OpenFront and Contributors"
- Loading screen: "© OpenFront and Contributors"

Modified versions must preserve these notices in reasonably visible locations.

See the [LICENSE](LICENSE) for complete requirements.

For asset licensing, see [LICENSE-ASSETS](LICENSE-ASSETS).  
For license history, see [LICENSING.md](LICENSING.md).

## 🌟 Features

- **Real-time Strategy Gameplay**: Expand your territory and engage in strategic battles
- **Alliance System**: Form alliances with other players for mutual defense
- **Multiple Maps**: Play across various geographical regions including Europe, Asia, Africa, and more
- **Resource Management**: Balance your expansion with defensive capabilities
- **Cross-platform**: Play in any modern web browser

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) v24.15.0 or newer in the Node 24 release line
- [npm](https://www.npmjs.com/) v12.1.0 or newer in the npm 12 release line
- A modern web browser (Chrome, Firefox, Edge, etc.)

Node.js may bundle an older npm version. Upgrade it before installing project dependencies:

```bash
npm install --global --ignore-scripts npm@12.1.0
```

## 🚀 Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/openfrontio/OpenFrontIO.git
   cd OpenFrontIO
   ```

2. **Install dependencies**

   ```bash
   npm run inst
   ```

   Do NOT use `npm install` nor `npm i` for project dependencies. Use `npm run inst`; it runs the safer `npm ci --ignore-scripts` to install exactly the versions in `package-lock.json` without running lifecycle scripts.

   The repository also rejects dependency releases less than seven days old and dependencies sourced from Git, remote URLs, local tarballs, or directories. Wait until a new release passes the seven-day window before updating it; security exceptions require explicit maintainer review.

## 🎮 Running the Game

### Development Mode

Run both the client and server in development mode with live reloading:

```bash
npm run dev
```

This will:

- Start the webpack dev server for the client
- Launch the game server with development settings
- Open the game in your default browser (to disable this behavior, set `SKIP_BROWSER_OPEN=true` in your environment)

### Client Only

To run just the client with hot reloading:

```bash
npm run start:client
```

### Server Only

To run just the server with development settings:

```bash
npm run start:server-dev
```

### Connecting to staging or production backends

Sometimes it's useful to connect to production servers when replaying a game, testing user profiles, purchases, or login flow.

> To replay a production game, make sure you're on the same commit that the game you want to replay was executed on, you can find the `gitCommit` value via `https://api.openfront.io/game/[gameId]`.
> Unfinished games cannot be replayed on localhost.

To connect to staging api servers:

```bash
npm run dev:staging
```

To connect to production api servers:

```bash
npm run dev:prod
```

## 🛠️ Development Tools

- **Format code**:

  ```bash
  npm run format
  ```

- **Lint code with Oxlint and ESLint**:

  ```bash
  npm run lint
  ```

- **Lint and fix code with Oxlint and ESLint**:

  ```bash
  npm run lint:fix
  ```

- **Testing**
  ```bash
  npm test
  ```

## 🏗️ Project Structure

- `/src/client` - Frontend game client
- `/src/core` - Deterministic game simulation
- `/src/server` - Backend game server
- `/resources` - Static assets (images, maps, etc.)
- `/zbin` - Compact binary wire format for zod schemas (self-contained, zod-only)

## 🤝 Contributing

Contributions and translations are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the approved-issue process, project governance, and translation info.
