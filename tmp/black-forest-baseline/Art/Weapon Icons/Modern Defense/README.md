# Modern Defense proposals

Modern Age artwork for Age of Fronts, created with built-in ImageGen. All sprites use a vertical overhead camera and face screen north. These are asset and animation proposals; gameplay integration is separate.

| Asset | Canvas | Clips | Projectile / impact |
| --- | --- | --- | --- |
| MIRV launch complex | 1254 × 1254 | Idle, Launch | Carrier → three reentry warheads → nuclear detonations |
| Tracked twin-cannon anti-air vehicle | 627 × 627 | Idle, Movement, Attack | Tracer shell / small aerial flak burst |
| Wheeled SAM launcher | 627 × 627 | Idle, Movement, Attack | SAM missile / orange fire and charcoal smoke |
| Interceptor Humvee | 627 × 627 | Idle, Movement, Attack | Small interceptor rocket / pale flash and brief smoke ring |

The building is stored in `Art/Building Icons/MIRV Launch Complex/Top-Down-Correction`. Vehicles, projectiles and effects are in this folder. The Humvee's rear turret has two four-tube pods aimed forward over the cab.

Five separate projectile sprites use 627 × 627 canvases. The carrier has Flight and Separation clips; its separation event releases **three** instances of the reentry-warhead sprite. The four custom effects use 314 × 314 canvases. The MIRV warhead effect has a six-second flash, fireball, expanding shockwave and lingering overhead smoke sequence. Play it independently at each of the three impact points.

## Files and animation conventions

- `Icon.png`: transparent ready icon; the building also has `MIRVLaunchComplex_Modern.png`.
- `Frames/`: numbered, transparent RGBA PNG frames.
- `*-Sheet_XX.png`: row-major sprite-sheet pages, each at most 4096 pixels on either axis.
- `*-Preview.webp`: lossless looping animation preview, with a pause after one-shot clips.
- `*-OneShot.webp`: single-play version of launch, attack, separation and impact clips.
- `animations.json`: exact frame rectangles, timings, alpha mode, center pivot, sheet pages, file hashes, events and related-asset keys.
- `SourceArt/` and `generation-prompts.json`: original selected painted artwork and exact prompts.

Vehicles and projectiles use four painted poses per atlas. Attack clips include the idle ready pose at their beginning and end. The building uses full-resolution painted site poses. Rigid sprites hold their painted poses at 12 FPS without cross-fading their outlines. Movement is in place; the game supplies translation and heading rotation. Organic effects register opacity-weighted source centers to a fixed output center and blend sixteen painted source keys in premultiplied-alpha space at 24 FPS, then export straight-alpha PNGs. Effects fade to a completely transparent terminal frame. Exported frame counts include held and interpolated frames; they do not represent independently painted frames.

`Defense-Manifest.json` indexes all thirteen assets and twenty-one clips. `Generation-Manifest.json` records selected prompts, revisions and local reference copies. `Defense-Validation.json` records export checks. Review the gallery in `Modern-Defense-Review.html`; its firing demo shows how the separate sprites can be combined and is a presentation preview, not game logic.

## Rebuild and validate

Use Node.js with Sharp (`AGE_OF_FRONTS_SHARP` can point to the installed Sharp entry point), plus PowerShell 7 on Windows (`AGE_OF_FRONTS_POWERSHELL`). Run `build-defense.cjs Defense-Build-Config.json`, then `build-review.cjs`. The builder checks the existing source/prompt contract when resuming and stages new assets before moving them into their destination. It refuses to overwrite a different existing asset. Source paths in the generation records preserve the original ImageGen locations; final copies remain in each asset's `SourceArt` folder.

Run `validate-defense.py` with Python, Pillow and NumPy. It checks exact RGBA dimensions, transparent borders, frame hashes, pixel equality between each PNG and its sprite-sheet cell, texture bounds, preview durations/loops, terminal effect alpha and related-asset links. Export checks do not establish Unity runtime behavior.

## Visual form references

The user requested a silo-launched MIRV with three nuclear warheads. Basic exterior form references were [National Park Service MIRV history](https://www.nps.gov/articles/minuteman-iii-missile.htm) and [Army history of Humvee-mounted air defense](https://history.redstone.army.mil/miss-stingeravenger.html). The painted vehicles and launch complex are fictional game designs, not technical or operational diagrams.
