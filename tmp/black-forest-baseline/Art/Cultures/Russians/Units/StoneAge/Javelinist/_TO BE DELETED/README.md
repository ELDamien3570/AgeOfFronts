# Russian Stone Age javelinist

One ranged soldier, in the approved Russian red-and-cream costume and vertical overhead camera. Keep this actor separate from the clubman and base civilization artwork. Soldiers are instanced into formations at runtime; the existing formation artwork is retained as legacy source.

Nine selected sheets provide idle, walking, normal throw, reload, light hit, heavy charge impact, charge advance, charge throw, and full death collapse. All have six 512 px cells in a 1536×1024 transparent PNG. `Generation.json` records the built-in ImageGen prompts, references, output paths, and padding correction. `Charged.png` is the retained first attempt; `Charged-v2.png` is the selected corrected sheet.

`Running-v2.png` is the selected walking cycle. It corrects the repeated leading leg in the retained `Running.png`, using the approved clubman gait as a leg-motion reference while preserving javelinist equipment.

`animations.json` contains editable durations, authored torso pivots and a constant scale for each clip. The reduced padding-correction source is enlarged only at playback/composition to match the other soldier poses. Source pixels and alpha are preserved. Never register by fitting each frame's bounds during playback.

`reviewFootprint: 400` gives the enlarged inspection canvas one fixed framing for every motion, with room for long raised spears. The game-size previews keep their 32/48/64 px scales. This does not change sprite pixels, body proportions, gameplay scale or the clubman's existing review framing.

The selected attacks are `Attack-v3.png` and `ChargeAttack-v2.png`: planted overarm throws, release, follow-through, and unarmed recovery. Frame 3 (zero-based) remains the release marker. `Reload-v2.png` is a separate six-pose reach, grip, extraction, bring-around, and armed-ready sequence. `throwReloadContract` documents attack then reload then idle; runtime timing and projectile creation remain authoritative. Source reload begins with an empty hand and ends with one javelin drawn from the holder. Spare appearance is visual art, not an ammunition counter.

The looping charge-advance gait will supply both entry and Maintain charge. Wedge positions, staggered throws and transition-out tracks are formation work after actor acceptance. No gameplay movement, combat or projectile code is changed here.

`Actor_Review.html` reuses the clubman's existing single-actor playback view model. Reactions repeat for review by default while their source clips remain nonlooping. Six poses can be stepped individually, replayed, rotated, and checked at 32, 48 and 64 px.

Run `inspect-sheets.py` with Python and Pillow to check the selected source dimensions, RGBA, distinct frames, visible spill guards and hashes. It writes `Validation.json`; low-alpha generator residue is reported, not silently removed. Browser review and user acceptance remain separate from engine integration.

`SourceArt/Throw-Reload-Generation.json` preserves all built-in ImageGen prompts and native versions, including rejected drafts. `SourceArt/compose_throw_reload.py` reproduces uniform whole-pose scaling and padding with authored torso pivots. `Throw-Reload-Bake.json` records sources, tracks, hashes and preservation of the other six sheets. Original attacks and pre-revision metadata remain preserved. Revised motion acceptance is pending user review.
