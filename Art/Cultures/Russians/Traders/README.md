# Russian overland traders

Stone Age and Bronze Age each have Idle and Travel loops. The walk uses separate
painted thighs, shins and shoes, with hip/knee/ankle articulation projected into
the overhead camera. Each foot alternates between constant-speed planted
stance and lifted, bent-knee recovery. The hip rises over the support leg at
midstance. This replaces the earlier Bronze Age toe-warp loop, which left the
same leg forward throughout and read as shuffling.

Bronze Age retains the corrected smooth wheel treads and projecting side hubs.
The cart, secured cargo, shafts, hubs and wheel silhouettes stay fixed. Wheel
grain scrolls inside the tread. Stone Age carries the user-selected loaded
back basket; shoulders, straps and basket sway together around the planted
feet. Actual world translation belongs to the game simulation.

Open the existing trader review with `?culture=russian#BronzeAge` to compare
Idle and Travel. `#Overview` also includes Classical Age's Travel loop. The optional Moving
ground checkbox uses the exported stance speed to show forward walking while
the review camera follows the unit. Turn it off to inspect the sprite against
a plain or checkerboard backdrop. The culture dropdown retains Base, whose paintings and sheets
are unchanged. The lower game-scale study uses the current land trader size
cap, atlas size and opacity; these assets are not integrated into a match.

## Sources and authoring

- `Generation-Manifest.json`: exact built-in imagegen prompts, source paths,
  revisions, source hashes and user approval.
- `BronzeAge/SourceArt/Trader_Russian_BronzeAge_v2.png`: selected smooth tread
  master; v1 is preserved beside it.
- `StoneAge/SourceArt/Trader_Russian_StoneAge_v1.png`: preserved basket-carrier master.
- `Shared/SourceArt/Walking_Leg_Atlas_v1.png`: six original generated limb pieces.
- `Shared/Generation-Manifest.json`: atlas prompt and original output path.
- Each age's `rig-authoring.json`: hip anchors, bone lengths, stride, contact
  timing, lift, widths, original-leg removal boundary and protected regions.
- Each age's `layers/`: six articulated paint layers, original painting,
  body occlusion layer, removal mask and local motion regions.
- Each age's `rig.json`: exact source placement and layer paths.

The culture builder reuses `Art/Trader Icons/animate-traders.py` with an explicit
source path. It writes only this Russian trader directory. The Base builder's
default source path and output behavior are unchanged.

## Export and validation

The existing trader contract is retained: RGBA 2560 × 1024 sheets, five columns
and two rows, ten 512 × 512 frames, center pivot (256, 256), screen-down facing.
Idle runs at 8 fps and Travel at 12 fps. Both loop. Exact frame rectangles are
in `BronzeAge/animations.json`.

From the repository root, with Python, Pillow, NumPy and OpenCV installed:

```powershell
python Art/Cultures/Russians/Traders/build-animations.py --age BronzeAge
python Art/Cultures/Russians/Traders/build-animations.py --age StoneAge
python Art/Cultures/Russians/Traders/validate-animations.py
```

`Trader_Animation_Validation.json` checks four sheets and 40 poses, frame counts,
transparent borders, loop seams, source hashes, fixed cart/shaft/hub pixels,
and fixed wheel alpha. It also checks both feet taking the lead, full stride
excursion, lifted recovery, bone lengths and planted contact matching world
translation. The preservation audits cover 335 Base trader art files and 122
approved boat files. Each age has a focused `Animation_Validation.json`.

`Review/Browser_Validation.json` records browser playback, frame stepping,
culture switching and game-scale inspection. Browser artwork review does not
certify engine integration. The standalone `BronzeAge/Idle.webp` and
`BronzeAge/Travel.webp` previews retain each clip's timing; Stone Age has the
same standalone previews. `walking-rig.py` owns the offline gait calculation
and limb composition. The metadata includes foot tracks and review-only ground
speed; these do not control simulation speed or gameplay.

## Classical Age caravan

The approved Classical party now has Idle and Travel loops. Two merchants and
two horses use twelve articulated legs with a shared planted-contact velocity,
independent walking phases and lifted recovery. The loaded wagon, connected
drawbars, lead ropes, harness and pack panniers retain their approved paint;
wheel grain rolls inside fixed smooth rims. `caravan-rig.py` extends the offline
authoring pipeline for multi-member parties; the earlier single-merchant rigs
remain unchanged.

Use `build-animations.py --age ClassicalAge` and
`validate-animations.py --age ClassicalAge` to work only on this party.
The focused check preserves earlier age reports. Full validation also audits
the Classical caravan and recognizes the new-age extension of the boat catalog
while checking the earlier entries against preserved masters and metadata.
`ClassicalAge/README.md` lists sources, editable layers and validation evidence.
