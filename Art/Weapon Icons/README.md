# Age of Fronts weapon animation proposals

Twelve crewed RTS units, viewed directly overhead and facing screen-up. All icons and animation frames are **627 x 627 RGBA PNGs** with genuine transparency. Artwork was generated with the built-in ImageGen tool and packaged with Sharp.

Open `Weapon-Review.html` on the existing Art preview server, or visit [the weapon gallery](http://127.0.0.1:8877/Weapon%20Icons/Weapon-Review.html). Category, age, animation and background filters let you compare the assets. Each card has an individual frame slider and links to its files.

| Age | Field Artillery | Siege Weapons |
| --- | --- | --- |
| Bronze | — | Battering ram; siege tower |
| Classical | Mangonel | Onager |
| Early Medieval | Ballista | Trebuchet |
| Late Medieval | Organ gun | Bombard |
| Early Modern | Napoleonic cannon | Early howitzer |
| Modern | Browning machine gunner | Modern howitzer |

The ages follow the requested game progression. The Mangonel has a compact bucket arm; the heavier Onager has a rope sling. Their loaded arms extend south behind the front pivot and throw north. The Organ Gun has a shallow fan of five barrels parallel to the ground, with forward firing tips. The Browning crew carries the gun and folded tripod in movement and operates the deployed tripod during attack.

## Per-unit files

- `Icon.png`: ready pose.
- `Frames/`: numbered transparent PNGs for Idle, Movement and Attack.
- `Idle.png`, `Movement.png`, `Attack.png`: sprite sheets, six columns, read left to right then the next row.
- `Idle-Preview.webp`, `Movement-Preview.webp`, `Attack-Preview.webp`: lossless animated previews. The attack preview adds a 700 ms pause before repeating.
- `Attack-OneShot.webp`: attack cycle with one playback.
- `animations.json`: dimensions, central pivot, frame offsets, timing, loop flags, attack events and frame hashes.
- `SourceAtlases/`: original painted four-pose source PNGs for all three clips.
- `generation-prompts.json`: exact prompts and reference provenance.

Each animation has **four painted key poses held for explicit durations**, without interpolation. Idle has 12 frames over 1 second; movement has 8 frames over approximately 0.667 seconds. Attack has 24 frames over 2 seconds for the three stone throwers, 12 frames over 1 second for the Browning, and 18 frames over 1.5 seconds for the other units. Idle and movement loop. Attack metadata specifies a single cycle.

World movement belongs to the game: these sprites animate in place. There is one direction; rotate the unit around the central pivot `(313.5, 313.5)` for other headings. Artwork is proposed animation material and has not been integrated into the game engine.

The modern howitzer uses folded split trails during movement and deployed trails for idle and attack. Its previous transport proposal is retained under `_previous/ModernHowitzer_Modern_Before-Transport-Fix`.

## Source and validation

`Generation-Manifest.json` records the complete generation set. `Weapon-Manifest.json` indexes all units. `Weapons-Validation.json` verifies the roster, PNG sizes and alpha margins, frame hashes, exact sprite-sheet pixels, WebP sizes and timing, and loop semantics. Source atlases were visually reviewed for camera angle, crew silhouettes and attack direction.

`build-weapons.cjs` packages the generated source atlases; it needs Node.js and Sharp. Set `AGE_OF_FRONTS_SHARP` to the Sharp module path if it is not installed locally. On Windows it uses `promote-weapon.ps1` through PowerShell 7 to promote complete staging folders, with paths checked against the weapon workspace. Set `AGE_OF_FRONTS_POWERSHELL` if `pwsh.exe` is outside PATH. `build-review.cjs` builds the gallery from the manifest. `validate-weapons.py` needs Pillow and NumPy and performs read-only image checks, writing only the report.

Form references: [First Division Museum catapult educator material](https://www.firstdivisionmuseum.org/catapultcontest/educators.html) and [Royal Armouries artillery gallery](https://royalarmouries.org/fort-nelson/galleries-and-displays/voice-of-the-guns-gallery). The icons are gameplay designs rather than exact historical replicas.
