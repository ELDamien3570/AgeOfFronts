# Russian Bronze Spearman overhead animation review

The approved idle camera master is `../SourceArt/Native-Idle-TopDown-v2.png`. Its padded idle review remains available as `Idle-TopDown-v2.png`.

Nine solo clips cover breathing, walking, faster charge movement, overhand spear thrust, charge thrust, light hit, charge impact, side death and back death. Gameplay owns formation instancing, movement and damage timing. This review does not integrate assets into a match.

Original artwork and earlier animations remain in the parent folder. Native generation versions and prompts are preserved in `../SourceArt/TopDown-Animation-Generation.json`; whole-pose baking and fixed clip scale calibration are recorded in `../SourceArt/TopDown-Composition.json`. Rebuild with `../SourceArt/compose_topdown_animations.py`. Per-frame silhouette fitting and pixel painting are not used.

`Validation.json` records distinct frame hashes and transparent boundary checks. `Browser-Review.json` records served resource availability separately from live playback and user approval. The preview uses a bounded display footprint so full poses fit the canvas.
