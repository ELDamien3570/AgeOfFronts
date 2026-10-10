Age of Fronts - explosion assets
Five effects: AerialBomb, ArtilleryImpact, GunshipImpact, ICBM, HydrogenBomb.
Each folder contains:
- Frames/Frame_###.png: transparent RGBA sequence, centered pivot, 24 fps.
- Sheet_##.png: packed PNG atlas pages. Read frame sheet/x/y/width/height from animations.json.
- OneShot.webp: animated preview played once.
- Preview.webp: looping review preview with a 900 ms transparent pause.
- animations.json: dimensions, timing, pivots, atlas page coordinates, per-frame hashes.
- SourceAtlas.png and generation-prompts.json: AI-painted source keyframes and exact prompts.
Effects are one-shot (loop=false) and finish with a fully transparent frame.
Each atlas page stays below 4096 pixels per side. Use all listed sheet pages.
PNG alpha is straight/unassociated. Use transparent alpha blending in the consumer.
Painted keyframes were centered and blended with premultiplied-alpha interpolation, with a final opacity fade.
build-effects.cjs requires Node.js and sharp. Supply a JSON config with output and jobs.
Existing finished outputs are protected; resume only accepts matching source art and prompts.
An explicit rebuild=true in the config replaces generated exports after checking that SourceAtlas.png matches the selected source.
This delivery contains assets and metadata; no game runtime code was changed.
