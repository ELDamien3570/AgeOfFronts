# Animated overland traders

Six overhead formations progress from one merchant pulling his own wagon to a large caravan and a modern freight truck. Each has Idle and Travel animation sheets. All face down, matching the existing land animations.

| Age | Formation |
| --- | --- |
| Bronze Age | One merchant pulling one two-wheel cargo wagon himself |
| Classical Age | Two merchants, one mule-drawn wagon and one pack donkey |
| Early Medieval | Two merchants, two horses and two cargo wagons |
| Late Medieval | Three merchants, three horses and three covered wagons |
| Early Modern | Four merchants, four horses and four covered wagons |
| Modern | One civilian freight truck |

Open `Trader_Animation_Preview.html` through the existing Art preview server. All ages shows the six travel loops; each age tab compares Idle and Travel. Controls include frame stepping, playback speed, 24–512 px sizes, backdrops and pivot display. The ship and soldier previews remain available through links.

The Culture dropdown also offers Russian. Its Bronze Age handcart and Stone Age
basket carrier each have articulated Idle and Travel loops. Moving ground
shows the planted-foot walk in motion. Russian sources and exports live separately in
`Art/Cultures/Russians/Traders/`; Base paintings and sheets are preserved.
The Russian view includes a comparison at current game screen sizes.

## Sprite contract

- Transparent RGBA PNG, 2560 × 1024, five columns and two rows.
- Ten 512 × 512 frames, left to right and then the next row.
- Consistent center pivot at (256, 256), normalized (0.5, 0.5).
- Idle: 8 fps. Travel: 12 fps. Both loop.
- Per-age `animations.json` includes exact rectangles and member counts.
- `Trader_Animation_Manifest.json` lists all six formations and twelve clips.

The animation moves painted feet, bodies, canvas covers, flags, suspension and tire treads. Harnesses and wagon silhouettes remain consistent. These are presentation loops: pathfinding, trading behavior and actual movement belong to the game simulation. No game renderer integration was added.

## Editable sources and rebuild

Original transparent paintings are in `generated/`. They were created with the built-in imagegen tool; exact prompts and reference paths are in `generation-prompts.json`.

Each age includes a normalized `Source_Transparent.png`, original painting, editable painted region layers, masks, and `rig.json`. Region definitions in `rig-authoring.json` use the original 1254 × 1254 painting coordinates. `animate-traders.py` deforms the original pixels with periodic local fields, then packs the frames. No new artwork is generated between frames.

With Python, Pillow, NumPy and OpenCV installed:

```powershell
python animate-traders.py
python validate-traders.py
```

To rebuild one formation, use `python animate-traders.py --age BronzeAge` (or another age directory).

`validate-traders.py` checks all twelve sheets, transparency, frame rectangles, unique frames, border clearance, loop seams and original source hashes. It also renders a six-age animated review and a small-size comparison. `Trader_Animation_Validation.json` records the results.

The existing-art hash audit recorded changes to soldier animation files after its baseline was captured during production. The trader authoring scripts only write inside this directory; those existing files were left untouched. The audit preserves this observation separately from the trader asset checks.
