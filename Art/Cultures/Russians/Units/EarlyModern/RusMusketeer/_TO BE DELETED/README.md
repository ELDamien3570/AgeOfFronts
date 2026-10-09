# Early Rus Musketeer

Early Modern streltsy-inspired solo unit. The user selected a long red coat, fur-trimmed cap and matchlock musket. The first idle shows a wooden powder-charge belt, leather pouches, brown boots, and a long firearm held low in two hands. Directly overhead camera matches the Russian unit review style.

The overhead idle v2 was approved for animation. The review now contains ten six-frame solo clips: idle, walk, musket shot, reload, get hit, get charged, charge running, advance-and-shoot, side death and back death. Firing is followed by a separate muzzle-loading reload; visual release markers do not implement gameplay ammunition or projectiles.

Generation.json and SourceArt/Animation-Generation.json preserve the built-in ImageGen prompts, references, native sources and superseded drafts. SourceArt/compose_animations.py bakes whole poses at a fixed scale with editable roots and timing metadata. It does not repaint or filter alpha. The approved Idle-TopDown-v2.png and all base artwork remain unchanged. Validation.json records 60 distinct frames, transparent edge guards, registered preview bounds and source hashes. Animation approval and runtime integration are pending.

All ten sheets and metadata returned HTTP 200 from the local review site. Browser automation failed to initialize, so live playback is not independently verified. Open Actor_Review.html to review each clip and the shot/reload sequence. Do not rerun prepare_idle.py after animation registration; it restores the earlier single-frame metadata.

Equipment reference: https://museum-artillery.ru/en/main-exposition/the-history-of-russian-artillery-up-to-the-mid19th-century.html
Idle-TopDown-v2.png is the current review design: higher overhead camera, larger visible cap crown and shoulder tops, reduced chest and boot projection. The first idle and both native sources are preserved; SourceArt/TopDown-Correction.json records the built-in ImageGen edit prompt.

Shooting stance v2 updates both firing clips: right foot retreats, chest turns, and the weapon braces at the shoulder while aiming screen-bottom. SourceArt/Shooting-Stance-v2.json preserves the built-in ImageGen edit prompts and references. Previous firing sheets remain available. Asset validation and HTTP checks passed; live playback remains unverified.


Rear-leg v3 corrects musket-shot frames 3 through 5. Frames 1, 2 and 6 use the previous whole poses; charge attack is unchanged. Built-in ImageGen prompt and source are recorded in SourceArt/Rear-Leg-v3.json. All 60 frames passed bake checks. Live playback remains unverified.

