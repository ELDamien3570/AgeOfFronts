# Russian Recurve Archer overhead animations

Idle-TopDown-v3.png is the approved camera master. This review develops solo overhead animations for the Classical Age iron-armored archer. Shots end with an empty bow; a separate arrow reload retrieves a replacement from the back quiver. Movement uses alternating strides, with a faster charge loop. Side and back deaths are distinct clips.

Native sources and built-in ImageGen prompts are preserved in ../SourceArt/TopDown-Animation-Generation.json. Editable frame registration is recorded in TopDown-Composition.json; rebuild with compose_topdown_animations.py. Earlier animations in the parent folder remain preserved.

Validation.json checks source cell boundaries and transparent output borders. Browser-Review.json records HTTP availability independently from live playback and user visual approval. Runtime owns projectile release and formation instancing.
