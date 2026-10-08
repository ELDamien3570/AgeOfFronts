# Russian Classical Age Shield Warrior

Single-soldier animation review. Iron helmet, lamellar armor and scale shoulders over burgundy quilted clothing, iron axe in hand, round shield strapped to the back. Based on the supplied design, rendered in the established Russian sprite style.

The approved design reference is `Idle-Axe-TopSpike-v3.png`, preserved unchanged. Nine six-frame clips cover idle, walking, ordinary axe chop, light hit, charge impact, running charge, charge attack, side death, and back death. The shield stays strapped to the back. Animations await user visual review; gameplay and runtime instanced formations are separate work.

Walking and running charge currently share six authored alternating gait poses at different cadences (160 ms and 90 ms per frame). This is explicitly recorded in the source recipe. Each clip has six distinct frames and clear alpha gutters; the two death clips use separate authored falls.

The regular attack and charge attack both use `Attack-Axe-Consistent-v4.png`, retaining the user-approved heavy-chop sequence with identical frames, durations, pivots, and impact frame. Former attack sheets and native sources remain preserved.

The 2026-10-07 axe consistency pass uses the approved idle weapon as its reference across all nine clips. Built-in ImageGen corrects the blade, socket, shaft and top spike. Separate whole-pose cell corrections repair the first two side-death frames and the raised axe in back-death frame three. `SourceArt/Axe-Consistency-Generation.json` records selected and rejected edits; `SourceArt/Composition.json` records cell replacements, hashes, and a common 0.96 scale with ten-pixel padding. Timing and loop behavior remain unchanged. Artwork still awaits user visual review.

`animations.json` contains editable per-frame durations, fixed root pivots, loop flags, and attack impact frames. `SourceArt/compose_animations.py` reproducibly composes whole generated poses with common scale and padding. It does not paint equipment or remove generated alpha. `SourceArt/Composition.json` records source rectangles and hashes; `Generation.json` and `SourceArt/Animation-Generation.json` retain exact built-in ImageGen prompts and selected/superseded sources. Prior idle versions, base art, and native masters are preserved.

Open `Actor_Review.html` for playback, scrubbing, facing changes, and game-size previews. The Russian soldier gallery also exposes all nine clips. The proposed flanking resistance is recorded as future intent, with no gameplay change.
