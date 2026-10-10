# Mounted-gun animations

Both nest types have **Firing** and **Tracking** loops in **N/E/S/W** headings: **16 clips, 672 exported frames**. Animation uses the original paintings directly, with editable cutout masks, a fixed pit plate, separate upper-gun and barrel layers, and procedural muzzle flashes. No animation frames were regenerated with image generation.

## Motion and accuracy

- Firing: short axial barrel recoil and return, with brief flashes anchored to the moving muzzle. The receiver and pit remain steady within the clip.
- Heavy machine gun: one shot every six frames at 50 fps, **500 rounds/min**, six shots in a 36-frame / 0.72-second loop.
- Quad AA: four independently timed barrel/flash tracks at the same per-barrel cadence. Phase offsets are an artistic choice for the generic four-gun painting.
- Tracking: a 48-frame / 2-second loop at 24 fps. Only the upper gun assembly traverses; the pit and mounting surface stay fixed. Local arcs are ±20° for the machine gun and ±24° for AA.

The source artwork does not identify specific real weapon models. These are reference-guided visible mechanisms, not exact model reproductions. [USMC cycle-of-operation reference](https://www.trngcmd.marines.mil/Portals/207/Docs/TBS/B3M4238%20Heavy%20Machine%20Gun.pdf), [Army cyclic-rate reference](https://cpeground.army.mil/Equipment/Equipment-Portfolio/PM-MBCT-Lethality-Portfolio/M2-M2A1-50-Caliber-Machine-Gun/) and [Army quad-mount reference](https://www.army.mil/article/87246/Students_learn_from_WWII_weapon/) informed the motion. `mechanical-references.json` separates those references from art choices.

## Fixed footprint and draw scale

Animation frames are **336 × 336 RGBA**, with 40 px of transparent padding around the original 256 px terrain cell. Padding accommodates long barrels, traversal and flashes. The sprite pivot is **(168, 168)**; `cellRect` is **(40, 40, 256, 256)**. The pit remains the same world size as the static trench kit.

At a chosen map cell size, draw the animated image with:

```text
drawSize = cellSize × 336 / 256
drawOrigin = cellCenter − drawSize / 2
```

Each metadata file records `renderScaleInCells = 1.3125`. Rendering at that scale preserves the pit footprint. The 336 px frame is the padded sprite extent, not a new terrain-cell size.

All headings share one fixed north-oriented pit for each nest type. This intentionally differs from the earlier static facing set, whose complete pit rotated with the gun. Switching animated headings preserves the pit's access opening and floor orientation.

## Exports and editable source

`Gun_Animation_Manifest.json` is the catalog entry point. For each type and heading, `animations.json` provides two animations with frame rectangles, rates, duration and per-frame recoil/shot data.

- `Firing.png`, `Tracking.png`: complete composited sprite sheets, including the fixed pit.
- `Firing_Weapon.png`, `Tracking_Weapon.png`: transparent weapon-and-effect sheets for layered rendering.
- `layers/Pit_Base.png`: the fixed background used by every heading and motion.
- `layers/Gun_Body.png`, `Barrel_*.png`, `*_Mask.png`: editable original-paint cutouts.
- `rig.json`, `weapon-rigs.json`: masks, mounting pivots, recoil, shot phasing and tracking arcs.

For layered rendering, draw `Pit_Base.png` and then the weapon/effect frame at the same origin and scale. The original static nest PNG already contains a gun; the animation base plate supplies the unobstructed surface behind the animated weapon.

Occluded floor patches were rebuilt from the kit's shared earth/duckboard materials and neighboring painted sandbags. The bearing surface beneath each gun was reconstructed once. These patches stay fixed; the original source PNGs and trench pieces remain unchanged.

```powershell
python animate-gun-nests.py
python validate-gun-animations.py
```

`Gun_Animation_Validation.json` checks all 672 frames for layer composition, fixed background pixels, transparent margins, clipped parts, muzzle attachment, cadence, recoil return and loop continuity. It also checks hashes of 26 retained source files. This is asset validation; game import, targeting, firing damage and runtime integration are unverified.

Open `Gun_Animation_Preview.html` through the project's local art server. Play either motion, change heading, slow playback, pause and scrub individual frames. The trench-network panel uses actual map-cell scale; detail panels enlarge the same exported frames.

`Gun_Animation_Review.gif` shows both weapons firing and tracking side by side, using the exported frames and one shared palette. Regenerate it with `python make-animation-review.py`. `Gun_Animation_Pose_Review.png` shows both extremes of the tracking sweeps. Browser playback checks are recorded in `Gun_Animation_Preview_Verification.json`.
