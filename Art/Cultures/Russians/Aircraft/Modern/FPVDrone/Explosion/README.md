# FPV drone explosion

Compact vertical-overhead detonation: ignition, orange fireball and small fragments, then gray smoke dissolving to a fully transparent final frame. No persistent crater. Generated with built-in image_gen; the exact prompt is in `generation-prompts.json`, and the original 4 × 4 atlas remains in `SourceArt/Detonate.png`.

The `detonate` clip plays once over 1.5 seconds at 24 FPS. It contains 36 transparent 314 × 314 PNG frames, packed into `Detonate-Sheet_00.png` (2512 × 1570, eight columns, five rows). The final four atlas slots are unused. `animations.json` supplies exact rectangles, timing, center pivot, source registration and hashes. `Detonate-OneShot.webp` plays once; `Detonate-Preview.webp` repeats with an 850 ms transparent pause.

Sixteen painted source cells, including the empty terminal cell, are registered using the existing Modern Defense source helper and blended in premultiplied alpha. The exported frames are not independently generated paintings. `Validation.json` records alpha borders, final transparency and animated WebP frame count checks.

The effect appears in `Modern-Naval-Air-Review.html#fpv-explosion`, with replay, pause, scrubbing and small-size comparisons. Match integration uses the `impact-fpv-drone` runtime atlas prepared by `scripts/prepareCarrierDroneArtwork.cjs`. The authoritative swarm damage contract is implemented separately from the effect's artwork and timing.

Rebuild from the repository root with `node Art/Cultures/Russians/build-fpv-explosion.cjs`. Set `AGE_OF_FRONTS_SHARP` to the bundled sharp package path if sharp is not installed locally.
