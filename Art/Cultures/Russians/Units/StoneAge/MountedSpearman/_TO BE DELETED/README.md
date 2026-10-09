# Russian Stone Age mounted spearman

One mounted rider is the source for the cavalry formation in `Formation/`. The base unit remains a mounted spearman, with a held forward spear thrust for the charge attack, as confirmed by the user. The approved Russian red-and-cream costume, primitive tack, dark bay horse, stone spear and straight overhead camera are used throughout. Base civilization art is preserved.

Nine selected six-pose sheets cover idle, walk, normal spear thrust, light hit, heavy charge impact, gallop, charge thrust and two complete deaths. The user approved all nine clips on 2026-10-02, including the corrected `Charge-v5.png` gallop. Selected filenames, editable durations, authored saddle/root pivots and fixed per-clip scales are in `animations.json`. The source PNGs are RGBA 1536x1024 with 3x2 cells of 512px. `Generation.json` contains the exact built-in ImageGen prompts, references, selected/rejected status and copied output paths.

Seven first attempts are retained beside their selected `-v2` corrections. They had unsafe cell padding or insufficient walking leg motion; `SourceArt/Validation-v1.json` records those failures. The selected walk visibly alternates left and right foreleg reaches. Padding edits redraw complete tails, hooves and spear ends inside their cell rather than cropping the actor. Original alpha remains intact. Fixed per-clip scales normalize the padded sources; no frame is fitted to its silhouette during playback.

The user approved `Running-v2.png` and rejected the horse hoof movement in `Charge-v2.png`. `Charge-v3.png` repaired connected hindlegs but still read as a fast walk. `Charge-v4.png` added paired foreleg extension, staggered contact, push-off and gathering through one stride. Selected and approved `Charge-v5.png` preserves that choreography with repaired tail padding; the failed guards are retained in `SourceArt/Validation-gallop-v4.json`. The [University of Minnesota veterinary gait reference](https://vanat.ahc.umn.edu/gaits/transGallop.html) informed the four-beat, single-suspension prompt. User visual acceptance is recorded in `animations.json` and `Browser-Review.json`; source validation is not anatomical certification. `SourceArt/Gallop-v4-Generation.json` and `SourceArt/Gallop-v5-Generation.json` retain the exact motion and padding edit prompts. The approved walk is unchanged.

The two deaths are distinct full motions. `death` buckles the horse's knees and drops horse and rider together onto their side, with the rider visible beside the flank. `death-thrown` pitches the rider off to the left as the horse falls independently to the right; both bodies and the loose spear settle and hold. The five-rider formation mixes three together-falls and two thrown-rider deaths, staggered from front to back.

Spear thrusts retain the weapon throughout. Frame 3 is a presentation impact reference, not damage authority. The gallop supplies formation charge entry and Maintain charge; editable formation tracks provide wedge transitions. This art prototype contains no gameplay movement, combat, projectile, pathfinding or collision changes.

`Actor_Review.html` uses the existing single-actor review view model and offers all nine clips, frame stepping, repeat/replay, four facing directions, anchor guides and 32/48/64 px inspection previews. Reaction clips remain nonlooping; the review's Repeat checkbox is a playback convenience. Death can be viewed through all six poses and held on its final frame.

`Validation.json` records nine sheets, 54 distinct frames, authored preview bounds, source hashes and visible cell guards. The existing shared inspector accepts this folder as an optional target:

```powershell
python 'Art/Cultures/Russians/Units/StoneAge/Javelinist/inspect-sheets.py' 'Art/Cultures/Russians/Units/StoneAge/MountedSpearman'
```

Pillow is required. Low-alpha generator residue is recorded, not removed; passing visible guards does not certify zero-alpha atlas padding. Browser review and user visual acceptance remain separate from gameplay integration.
