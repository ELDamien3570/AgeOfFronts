# Ship animations

Animated versions of all 14 original ship paintings, plus seven new trade ships: seven ages, warships, transports and traders. There are **21 ships and 49 primary clips**, with 10 frames each.

The original still PNGs remain unchanged. Animation uses their original painted pixels, separate moving layers and small transparent effects.

## Preview

Open [Ship Animation Review](http://127.0.0.1:9008/Ship%20Icons/Ship_Animation_Preview.html).

The review uses the same age tabs, frame stepping, speed and pivot controls as the existing soldier preview. It includes all seven ship ages, 24–512 px display sizes, ocean/checkerboard/white/dark backdrops, and an option to stop attack clips at their last frame.

The Culture dropdown selects Base or Russian. Base reads the existing fleet manifest; Russian reads `Art/Cultures/Russians/Ships/Ship_Animation_Manifest.json`. The selected culture is retained in the `culture` URL parameter while the age remains in the hash. Ages without authored culture assets show an empty state.

Culture manifests use the existing schema: each `assets` entry has an `age`, a stable role `category` (`Warships`, `Transport` or `Trade`), a `metadata` path relative to its manifest, and a `clips` filename list. Russian Stone Age metadata belongs under `StoneAge/Warship/animations.json`, `StoneAge/Transport/animations.json` and `StoneAge/Trade/animations.json`. Animation sheets resolve relative to their metadata file and follow the same import contract below. Add entries as the corresponding assets are authored; preserve the base paintings and animations.

Before animation approval, an entry may instead provide a `poster` path, an empty `clips` list and a `description`. These entries render as static masters with playback disabled. The game-scale comparison uses the current `MapSymbols` ship/trader size rules, `EraArtwork` frame extent and 128 px atlas resolution, the ship pipeline's 420-in-512 source fit, and the `PaintedTerrain` ocean palette. Choose Idle, Sailing or Attack; this view follows the main playback controls. Transports and traders use Idle when Attack is selected. Existing base runtime portraits provide a still comparison. This is a browser art study; culture art is not registered in the match renderer.

The three Russian Stone Age masters were approved for animation on 2026-10-02. Their seven clips use gentle buoyancy, single-hull or twin-hull sailing wakes, and a ranged spear-release cue for the warship. Lash-bound paddles, spare weapons and cargo remain attached. The attack cue matches the current ranged Stone Age warship role; it carries no gameplay authority.

Russian Bronze Age approved masters live under `Art/Cultures/Russians/Ships/BronzeAge/{Warship,Transport,Trade}/SourceArt/`. The current review set uses bronze-tipped spears and four working oar pairs for the warship, a pale birch-bark passenger hull with six open benches for the transport, and a wide freight platform with goods and traded metal for the trader. The regional material references, full built-in imagegen prompts, iterations and selected files are recorded in `BronzeAge/Generation-Manifest.json`. Specialized role layouts remain game interpretations. All seven Bronze Age clips were exported and visually approved by the user. Warship oars rotate as complete rigid painted layers; the transport's stowed paddles and the trade boat's cargo remain fixed. Stone Age rebuilds update only Stone Age catalog entries and preserve other ages and their clip counts.

Russian authoring lives in the corresponding age's `rig-authoring.json`. Rebuild only these boats with `python "Art/Cultures/Russians/Ships/build-animations.py" --age StoneAge` or `--age BronzeAge`. The culture builder reuses the base rendering helpers and writes only Russian outputs. Approved `SourceArt` PNGs remain unchanged. Each role has an editable hull layer, combined clips, separate vessel/water/weapon passes, and lossless animated WebP previews. `Animation_Validation.json` records frame-grid, transparency, clipping, loop-seam, pass-composition and source-preservation checks.

If the local server is stopped, run this from the repository root:

```powershell
python -m http.server 9008 --bind 127.0.0.1 --directory Art
```

The soldier preview is linked from the ship page and its original files are preserved. The ship page is a standalone art review with separate asset model, playback state and rendering functions.

## Files and import contract

| Property | Value |
| --- | --- |
| Primary clips per warship | Idle, Sailing, Attack |
| Primary clips per transport | Idle, Sailing |
| Primary clips per trade ship | Idle, Sailing |
| Format | Transparent RGBA PNG |
| Frame dimensions | 512 × 512 |
| Sheet dimensions | 2560 × 1024 |
| Grid | 5 columns × 2 rows |
| Order | Left to right, then next row |
| Pivot | (256, 256), normalized (0.5, 0.5) |
| Camera | Straight overhead, bow facing up |
| Suggested rates | Idle 8 fps, Sailing 12 fps, Attack 10 fps |
| Looping | Idle and Sailing loop; Attack plays once |

Each ship has a folder under `Warships/<Age>/`, `Transport/<Age>/` or `Trade/<Age>/` containing the primary sheets, `animations.json`, `rig.json`, `Source_Transparent.png` and a `layers/` directory.

`animations.json` supplies all ten frame rectangles, playback rates, loop flags and optional effect pass files. `Ship_Animation_Manifest.json` lists every primary clip and source hash.

## Trade ships

The traders have visible commercial cargo and green accents. Their new master paintings were created with the built-in imagegen tool using the corresponding transport as a style and overhead-camera reference, then animated directly with fixed cargo, moving cloth and transparent wakes.

| Age | Trade vessel |
| --- | --- |
| Stone Age | Lashed twin-hull cargo boat with baskets, hides, sacks and pottery |
| Bronze Age | Broad merchant boat with green-striped sail, amphorae and grain baskets |
| Classical Age | Round merchant hull with three secured amphora racks and a steering sweep |
| Early Medieval | Clinker cargo ship with striped sail, large crates and textile rolls |
| Late Medieval | Merchant cog with one large marked sail and a raised stern cabin |
| Early Modern | Merchant sailing ship with three sail tiers and a full cargo deck |
| Modern | Container freighter with an aft bridge and colorful corrugated containers |

`Trade/Trade_<Age>.png` holds each normalized transparent master. `Trade/generated/` preserves the original generated PNGs, including their alpha. `Trade/generation-prompts.json` contains the complete final prompt set and reference paths. `Trade/rig-authoring.json` stores masks and attachment points in the generated paintings' coordinates; `Trade/prepare-masters.py` packs the masters uniformly and writes the transformed `trade-rigs.json`. Complete pennant component masks are also retained under `Trade/masks/`.

The Stone Age and Modern traders use buoyancy and sailing wakes. Their fixed cargo remains secured. The five intervening ages also animate sail billow, with fluttering pennants where present. The Stone Age twin hulls have separate bow ripples.

## Motion

- Idle: gentle buoyancy, restrained sail and flag movement. Cargo and fixed equipment remain secured.
- Sailing: sail billow, flag flutter, small stern wake and synchronized rowing where the reference has oars. The Bronze Age, Classical and Early Medieval warships retain respectively five, 26 and nine pairs.
- Early warship attack: short ram or rowing surge, followed by recovery.
- Late Medieval and Early Modern attack: port cannon battery recoil, staggered muzzle flashes and fading smoke. `Attack_Starboard.png` and matching passes provide the opposite broadside without mirroring logos or changing the ship.
- Modern attack: the existing forward gun barrel recoils, flashes and emits a small smoke puff.

The Stone Age warship and Modern transport have no exposed moving equipment in their source paintings; their idle uses buoyancy, and sailing adds wake movement.

## Editable artwork and effect passes

The native 1254 × 1254 transparent layers preserve the original painting. Each oar has its own pivot and original paddle pixels. Cloth masks avoid the mast and yard. Gun layers retain the original barrels; tiny deck patches beneath recoiling barrels are reconstructed by inpainting. Flags retain their pole attachment.

`build-animations.py` contains the editable masks and motion settings. `rig.json` records the exported layer files, mask polygons, pivots and amplitudes. PNG layers can also be edited in an image editor; rebuilding from the original PNG regenerates them, so save painted layer edits separately.

Every clip has a `_Vessel.png` pass. Sailing and attack also have `_Water.png` passes. Gun attacks have `_Weapons.png` passes. The primary PNG already combines those passes in this order:

1. Water
2. Vessel
3. Weapon effects

Use either the combined PNG or the separate passes when integrating. Separate passes allow water and weapon presentation to have their own renderer ownership.

## Rebuilding and validation

The authoring scripts use Pillow, numpy and OpenCV. These are available in the Python runtime used for this delivery.

From the repository root:

```powershell
python "Art/Ship Icons/build-animations.py"
python "Art/Ship Icons/validate-animations.py"
```

A focused rebuild supports `--age EarlyMedieval --category Warships` or `--category Trade`. The default build uses two workers; `--workers 1` runs sequentially. `--manifest-only` refreshes the catalog without regenerating sheets. To change the trade framing or authored attachment points, run `Trade/prepare-masters.py` before rebuilding Trade.

Validation checks all 49 primary sheets, ten nonempty frames each, distinct poses, RGBA transparency, an empty 8 px frame guard and unchanged SHA-256 hashes for all 21 master sources. It separately verifies the 14 original paintings and all 309 existing warship/transport files against their preservation baselines. The report includes frame bounds and loop seam differences. Review artifacts are `ship-animation-overview.png`, `ship-small-size-review.png`, `ships-sailing-review.webp` and `Trade/trade-sailing-review.webp`.

These are art assets and a browser preview. They are not wired into the game renderer. Domain simulation remains authoritative for travel, attack cadence, projectiles and damage; visual event frames in the metadata must not trigger gameplay rules.

