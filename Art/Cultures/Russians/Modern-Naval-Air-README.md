# Russian modern carrier and FPV drone drafts

Open `http://127.0.0.1:9007/Cultures/Russians/Modern-Naval-Air-Review.html` after running `python scripts/serveArtInspection.py` from the repository root.

The painted transparent sources were generated with built-in image_gen. Exact master/body prompts and the carrier refinement prompt are recorded in `Modern-Naval-Air-Generation.json`. Existing Russian fleet, aviation and modern-defense galleries informed the overhead painted style. This is a visual concept set, not a claim of exact real-world ship reconstruction.

- Carrier: `Ships/Modern/Carrier/`; Idle and Sailing. The active master is `SourceArt/Carrier_Russian_Modern_v2.png`, revised to a stricter overhead camera with a flat stern edge and roof-only island. The earlier v1 master is preserved.
- Drone: `Aircraft/Modern/FPVDrone/`; Idle, Hover and Flight.
- Each clip is a 2560 × 2048 transparent PNG sheet, with twenty 512 × 512 frames in a 5 × 4 row-major grid. Metadata records rectangles, center pivot, screen-up facing, 20 FPS and loop flags.
- `SourceArt/` retains the generated images unchanged. `Icon.png` and `*-FirstFrame.png` provide extracted review frames.

Animation preserves the rigid painted hull/body. Carrier buoyancy and wakes, drone bobbing and propeller motion are deterministic visual effects. Frames are not separate generated paintings. Drone Idle holds the original stopped-rotor painting; moving clips use the generated body layer with procedural propellers. Small registration differences between the generated drone master and body remain subject to art approval.

Rebuild using `node Art/Cultures/Russians/build-modern-naval-air.cjs <path-to-@napi-rs/canvas>`. The renderer is shared in `modern-naval-air-renderer.mjs`. Export checks cover empty frames, transparent borders, sheet dimensions, hashes and visible changes in moving clips. `Modern-Naval-Air-Validation.json` records those checks. Browser review confirmed all five sheets load, playback and stepping work, and light/checkerboard backgrounds display correctly; the saved screenshot includes small-size comparisons.

The match renderer now registers runtime carrier, FPV drone and explosion atlases through `scripts/prepareCarrierDroneArtwork.cjs`. The runtime carrier uses `SourceArt/Carrier_Russian_EmptyDeck_v1.png`, allowing actual stationed fighters and bombers to be drawn on its deck. The original painted masters and source-gallery sheets above remain preserved. The carrier is a mobile six-berth base; one prepared drone swarm launches twenty interceptable members, whose unopposed combined damage is one-third of a healthy target. Runtime operations can be reviewed at `skirmish/carrier-drone-review.html` on the Vite development server. Source-gallery display sizes remain illustrative.
