# Russian emplacement firing animations

Four source-painted weapons cover Early Modern and Modern Anti-Aircraft Emplacement and Gun Nest. Each has N/E/S/W firing clips: 16 clips, 36 frames per clip, 576 transparent frames in total. All animations are drafts pending visual review. Existing building icons, generated masters and base assets are preserved.

The fixed pit, sandbags, tripod/outrigger supports and foundation never rotate or recoil. Only the upper assembly changes heading; individual barrels recoil along their projected firing axis. Short muzzle flashes and brief smoke attach to the animated muzzle positions. Modern AA retains its elevated, foreshortened skyward barrels and uses muzzle-centered blooms.

Editable source is in build-firing.py and weapon-rigs.json. Source-painted weapon/body layers and masks, repaired fixed bases, full sprites and weapon-only overlays are in each building's Animations folder. Built-in image_gen supplied one occlusion-repair plate per weapon; SourceArt/Generation.json records exact prompts, source references and generated file paths. Only the masked hidden portions use the generated plate; original paint remains unchanged elsewhere. No animation frames were individually regenerated.

Each clip exports Firing.png, Firing-Weapon.png, animations.json and Firing-Review.gif. PNG atlases and JSON are the integration assets; GIF is an inspection convenience. Frames are 640×640, with the original building footprint scaled to a 384×384 cell at offset (128,128). Shared frame pivots preserve alignment while added transparent padding contains rotated long barrels and effects. Timing is 50 frames/s and 0.72 seconds per loop. Early Modern AA uses a 12-frame shot cycle; the other weapons use a six-frame cycle, with alternating three-frame offsets for the Modern twin AA. These are art playback timings, not changes to game firing cadence.

Review.html supplies age, weapon and direction selections, play/pause, speed, restart, frame scrubbing, backgrounds and live 48/64/128 px cell previews. The four static building-inspection cards link to their filtered animation views.

Run:
- python Art/Cultures/Russians/Buildings/Animations/build-firing.py
- python Art/Cultures/Russians/Buildings/Animations/validate-firing.py
- node Art/Cultures/Russians/Buildings/Animations/validate-browser.cjs

Validation.json checks every exported frame, original PNG hashes, base invariance, layer composition, safe transparent margins, muzzle positions, flash pixels, shot intervals and return to battery. Browser-Validation.json checks rendered playback, pause, scrub, filters, all 16 directional selections and gallery links. Static/browser checks do not establish artistic acceptance or engine-runtime integration. No gameplay, targeting, damage, production, walls or base assets were edited.
