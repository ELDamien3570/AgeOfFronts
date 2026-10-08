# Modern trenches and gun nests

Transparent Modern Age defenses that follow the wall kit's cardinal connection convention.

- **16 connected trench pieces:** isolated foxhole, ends, straights, all four corners, T junctions and cross.
- **Anti-infantry nest:** a single heavy machine gun in a sandbagged fighting pit.
- **Anti-air nest:** a larger four-barrel anti-aircraft mount in a reinforced sandbagged pit.
- **Four facings per nest:** north, east, south and west, exported as eight individual sprites and two facing atlases.

All production sprites use a **256 × 256 RGBA canvas**, transparent terrain around their footprints and center pivot **(128, 128)**. The trenches match the massive stone walls' **80 px body width** with a **104 px disturbed-earth shoulder profile**. Nest footprints are sized to 196 px, matching the large bastion's scale. Dark excavated channels, wooden duckboards and sandbag lips distinguish trenches from raised stone walls.

## Connections and placement

Use **N = 1, E = 2, S = 4, W = 8**, exactly as in the road and wall kits. North is the top of the image. The mask is the sum of the desired connections. The arms connect cell centers to edge centers. Mask 0 is an isolated foxhole; for an empty cell, draw no sprite.

Draw the trench first, then a nest at the **same cell, pivot and scale**. Both nest types fit all four corners, masks **3, 6, 9 and 12**, plus junctions **7, 11, 13, 14 and 15**. Hiding or replacing a nest leaves a continuous trench underneath. Nests are independent overlays and do not require alternate trench pieces.

Each static facing rotates the complete painted emplacement, including its access recess. Facings use lossless quarter-turn transforms so the hull, sandbags and equipment retain identical painted detail. The added [gun animation kit](Animations/README.md) supplies firing and tracking in all four headings, with a shared fixed pit and independently moving weapon layers.

## Files

| Location | Contents |
|---|---|
| `Trenches/tiles/` | Sixteen individual trench PNGs, named by mask |
| `Trenches/Trench_Atlas.png` | 1024 × 1024 atlas, 4 × 4 sprites in mask order |
| `Trenches/Trench_Atlas_Padded.png` | 1040 × 1040 atlas with 2 px edge extrusion per sprite |
| `Trenches/tiles.json` | Connections, pivots, dimensions, atlas rectangles and nest slots |
| `Gun Nests/AntiInfantry_N.png`, `_E`, `_S`, `_W` | Four heavy-machine-gun nest facings |
| `Gun Nests/AntiAir_N.png`, `_E`, `_S`, `_W` | Four anti-air nest facings |
| `Gun Nests/*_Atlas.png` | 1024 × 256 facing atlases in N/E/S/W order |
| `Gun Nests/*_Atlas_Padded.png` | 1040 × 260 atlases with 2 px extrusion |
| `Gun Nests/nests.json` | Facing rectangles and independent placement contract |
| `Modern_Defenses_Manifest.json` | Entry point for the full art catalog |

Use `paddedRect` to select the sprite interior from a padded atlas. Padding protects base-level filtering; mipmapped imports still need an appropriate sprite-import or sampling policy.

## Preview and source

Open `Modern_Defenses_Preview.html` through the project's local art server. It shows a connected trench network, all 16 pieces, corner joins, eight nest facings and a stone-wall width comparison. Toggle nest type, facing, terrain backdrop and cell size. Detail cards show both nest types in four directions at 96 px per cell.

The five immutable paintings in `generated/` were made with the **built-in image_gen tool**. Exact prompts and reference paths are retained in `generation-prompts.json`. `materials/` contains prepared earth, duckboard and sandbag components. `kit-authoring.json` exposes widths, bag spacing, nest footprint and placement slots; `build-modern-defenses.py` assembles the exports without changing the raw paintings.

```powershell
python build-modern-defenses.py
python validate-modern-defenses.py
```

`Modern_Defenses_Validation.json` records **512 compatible trench edge pairings**, atlas and extrusion agreement, **32 corner fits and 40 junction fits** across both nest types and all facings, plus preserved source hashes. `modern-defenses-review.png` includes actual 24, 32, 64 and 128 px nest samples. Review ground and opaque contact sheets are presentation files, not production terrain tiles.

This delivery is an **art kit and preview**. The Modern Age designation is catalog metadata. Game import, rendering, occupation, unlocking, combat and collision remain unverified. Trench movement and cover rules should be represented separately from solid-wall blocking if gameplay integration is added later.
