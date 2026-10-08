# Russian RPL-20 Machine Gunner

Contemporary Russian solo actor in Modern Age. Ten six-frame overhead clips: idle, walk, charge run, burst fire, advance-and-fire, belt-container reload, hit, charged impact, side death and back death. Digital camouflage, helmet cover, body armor, tactical gloves and an RPL-20 with a belt-fed rectangular ammunition container.

Generation.json and SourceArt/Animation-Generation.json preserve built-in ImageGen prompts, sources and superseded drafts. SourceArt/Composition.json records editable whole-pose frame registration. SourceArt/compose_animations.py rebuilds sheets without painting or alpha filtering. The approved Idle-v1.png remains unchanged; do not rerun prepare_idle.py over animation metadata. Charge reuses the alternating walk poses at a faster cadence.

Validation.json checks all 60 frames for transparent borders, source cell boundaries and preview bounds. Shooting and reload are separate clips; review sequences demonstrate both, while runtime owns ammunition and projectile timing. Animation approval and runtime integration are pending. Base art and the separate WWII Soviet DP-28 gunner remain preserved.

Equipment reference: https://www.kalashnikov.ru/pulemyot-rpl-20-pervye-podrobnosti/
